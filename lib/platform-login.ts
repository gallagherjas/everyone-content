import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { activeAccount, InputError } from './accounts.ts';
import { openDb } from './db.ts';
import { DATA } from './strategies.ts';
import { CollectionStore } from '../collector/core/store.ts';
import { registerAuth } from '../collector/core/settings.ts';
import { authFromCookies } from '../collector/sources/douyin-index/client.ts';
import { ORIGIN } from '../collector/sources/douyin-index/protocol.ts';
import { sessionFromCookies, loadSession, type PlatformAuth } from '../collector/sources/platform/session.ts';

const running = (status: string) => status === 'preparing' || status === 'waiting';
const messages: Record<string, string> = {
  missing: '尚未连接。', preparing: '正在准备专用登录窗口，首次使用可能需要下载浏览器。',
  waiting: '请在打开的窗口完成登录并按页面提示验证，会话会自动保存在本机。',
  configured: '登录会话已保存。', expired: '登录已失效，请重新连接。',
  cancelled: '登录已取消。', timeout: '等待登录超时，请重试。',
  failed: '无法完成登录，请检查网络及图形桌面环境后重试。',
};

// 各平台的扫码登录配置:入口页、cookie 挑选(含哨兵校验)与会话文件名。
export interface LoginPlatform { label: string; loginUrl: string; file: string; pick: (cookies: any[], userAgent?: string) => PlatformAuth }
export const LOGIN_PLATFORMS: Record<string, LoginPlatform> = {
  index: {
    label: '抖音指数',
    loginUrl: ORIGIN + '/creator-micro/creator-count/arithmetic-index',
    file: 'index.json',
    pick: (cookies, userAgent) => {
      const auth = authFromCookies(cookies, userAgent);
      if (!/(?:^|; )(?:sessionid(?:_ss)?|sid_guard|sid_tt)=[^;]+/.test(auth.cookie)) throw new Error('login_session_missing');
      return auth;
    },
  },
  douyin: {
    label: '抖音创作后台',
    loginUrl: 'https://creator.douyin.com/',
    file: 'douyin.json',
    pick: (cookies, userAgent) => sessionFromCookies(cookies, ['creator.douyin.com', '.douyin.com', 'douyin.com'],
      /(?:^|; )(?:sessionid(?:_ss)?|sid_guard|sid_tt)=[^;]+/, userAgent),
  },
  xhs: {
    label: '小红书创作服务',
    loginUrl: 'https://creator.xiaohongshu.com/',
    file: 'xhs.json',
    pick: (cookies, userAgent) => sessionFromCookies(cookies, ['creator.xiaohongshu.com', '.xiaohongshu.com', 'xiaohongshu.com'],
      /(?:^|; )web_session=[^;]+/, userAgent),
  },
  bili: {
    label: 'B站创作中心',
    loginUrl: 'https://member.bilibili.com/platform/home',
    file: 'bili.json',
    pick: (cookies, userAgent) => sessionFromCookies(cookies, ['member.bilibili.com', '.bilibili.com', 'bilibili.com'],
      /(?:^|; )SESSDATA=[^;]+/, userAgent),
  },
};

interface Cookie { name: string; value: string; domain: string; path: string; expires: number }
interface LoginWindow {
  cookies(): Promise<Cookie[]>;
  userAgent(): Promise<string>;
  isClosed(): boolean;
  close(): Promise<void>;
}
interface Job { key: string; accountId: number; provider: string; status: string; abort: AbortController; window?: LoginWindow; done?: Promise<void> }

async function openLoginWindow(signal: AbortSignal, loginUrl: string): Promise<LoginWindow> {
  const { chromium } = await import('playwright');
  let browser;
  if (existsSync(chromium.executablePath())) browser = await chromium.launch({ headless: false });
  else {
    try { browser = await chromium.launch({ headless: false, channel: 'chrome' }); }
    catch {
      const require = createRequire(import.meta.url);
      const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'ignore', signal, timeout: 180_000 });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error('browser_setup_failed')));
      });
      signal.throwIfAborted();
      browser = await chromium.launch({ headless: false });
    }
  }
  try {
    signal.throwIfAborted();
    const context = await browser.newContext();
    const page = await context.newPage();
    signal.addEventListener('abort', () => { void browser.close().catch(() => {}); }, { once: true });
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    return {
      cookies: () => context.cookies(), userAgent: () => page.evaluate(() => navigator.userAgent),
      isClosed: () => page.isClosed() || !browser.isConnected(), close: () => browser.close(),
    };
  } catch (error) { await browser.close().catch(() => {}); throw error; }
}

// 会话落盘:哨兵校验 → 0600 临时文件 → 原子改名 → 登记凭据。directory 可注入供测试隔离。
export function saveSession(db: DatabaseSync, provider: string, id: number, cookies: Cookie[], userAgent?: string, directory: string = DATA) {
  activeAccount(db, id);
  const platform = LOGIN_PLATFORMS[provider];
  const auth = platform.pick(cookies, userAgent);
  const folder = join(directory, 'authorization', String(id));
  mkdirSync(folder, { recursive: true, mode: 0o700 }); chmodSync(folder, 0o700);
  const file = join(folder, platform.file), temp = join(folder, randomUUID() + '.tmp');
  try {
    writeFileSync(temp, JSON.stringify(auth), { mode: 0o600, flag: 'wx' });
    loadSession(temp);
    renameSync(temp, file);
    registerAuth(new CollectionStore(db, directory), id, file, provider);
  } finally { rmSync(temp, { force: true }); }
}
function persistSession(provider: string, id: number, cookies: Cookie[], userAgent?: string) {
  const db = openDb();
  try { saveSession(db, provider, id, cookies, userAgent); } finally { db.close(); }
}

export class PlatformLoginManager {
  private jobs = new Map<string, Job>();
  private launch: (signal: AbortSignal, loginUrl: string) => Promise<LoginWindow>;
  private save: (provider: string, accountId: number, cookies: Cookie[], userAgent?: string) => void;
  private clock: () => number;
  private sleep: () => Promise<void>;
  constructor(options: { launch?: typeof openLoginWindow; save?: typeof persistSession; clock?: () => number; sleep?: () => Promise<void> } = {}) {
    this.launch = options.launch ?? openLoginWindow; this.save = options.save ?? persistSession;
    this.clock = options.clock ?? Date.now; this.sleep = options.sleep ?? (() => new Promise(resolve => setTimeout(resolve, 1000)));
  }
  state(db: DatabaseSync, id: number, provider: string) {
    const platform = LOGIN_PLATFORMS[provider];
    if (!platform) throw new InputError('未知平台', 404);
    const configured = !!db.prepare('SELECT 1 FROM collection_credentials WHERE account_id=? AND provider=?').get(id, provider);
    const error = db.prepare('SELECT error FROM collection_provider_state WHERE provider=? AND scope=?').get(provider, `account:${id}`)?.error;
    const job = this.jobs.get(`${provider}:${id}`);
    const expired = /login_required|auth_required|invalid_auth|auth_file/.test(String(error ?? ''));
    const status = job && job.status !== 'configured' ? job.status : expired ? 'expired' : configured ? 'configured' : 'missing';
    return { provider, label: platform.label, status, configured, message: messages[status] };
  }
  start(db: DatabaseSync, id: number, provider: string) {
    if (!LOGIN_PLATFORMS[provider]) throw new InputError('未知平台', 404);
    activeAccount(db, id);
    const key = `${provider}:${id}`;
    const current = this.jobs.get(key);
    if (current && running(current.status)) return this.state(db, id, provider);
    if ([...this.jobs.values()].some(job => running(job.status))) throw new InputError('另一个账号正在登录，请先完成或取消', 409);
    const job: Job = { key, accountId: id, provider, status: 'preparing', abort: new AbortController() };
    this.jobs.set(key, job); job.done = this.run(job);
    return this.state(db, id, provider);
  }
  async cancel(db: DatabaseSync, id: number, provider: string) {
    const job = this.jobs.get(`${provider}:${id}`);
    if (job && running(job.status)) {
      job.status = 'cancelled'; job.abort.abort(); await job.window?.close().catch(() => {});
    }
    return this.state(db, id, provider);
  }
  async settle(provider: string, id: number) { await this.jobs.get(`${provider}:${id}`)?.done; }
  private async run(job: Job) {
    const platform = LOGIN_PLATFORMS[job.provider];
    try {
      job.window = await this.launch(job.abort.signal, platform.loginUrl);
      if (job.abort.signal.aborted) return;
      job.status = 'waiting'; const deadline = this.clock() + 10 * 60_000;
      while (!job.abort.signal.aborted) {
        if (job.window.isClosed()) { job.status = 'cancelled'; return; }
        if (this.clock() >= deadline) { job.status = 'timeout'; return; }
        const cookies = await job.window.cookies();
        let auth: PlatformAuth;
        try { auth = platform.pick(cookies); } catch { await this.sleep(); continue; }
        const userAgent = await job.window.userAgent();
        job.abort.signal.throwIfAborted();
        this.save(job.provider, job.accountId, cookies, userAgent);
        job.status = 'configured'; return;
      }
    } catch { if (!job.abort.signal.aborted) job.status = job.window?.isClosed() ? 'cancelled' : 'failed'; }
    finally { await job.window?.close().catch(() => {}); }
  }
}
export const platformLogin = new PlatformLoginManager();
