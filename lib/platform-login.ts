import type { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { activeAccount, InputError } from './accounts.ts';
import { openDb } from './db.ts';
import { DATA } from './strategies.ts';
import { lock } from './tasks.ts';
import { CollectionStore } from '../collector/core/store.ts';
import { credentialBinding, registerAuth } from '../collector/core/settings.ts';
import { authFromCookies } from '../collector/sources/douyin-index/client.ts';
import { ORIGIN } from '../collector/sources/douyin-index/protocol.ts';
import { sessionFromCookies, writePrivateAuth, type PlatformAuth } from '../collector/sources/platform/session.ts';
import { BILI_CREATOR_HOME, BILI_SESSION_URL } from '../collector/sources/platform/snapshot.ts';
import { fetchPlatformIdentity, platformAccountLabel } from '../collector/sources/platform/identity.ts';
import { connectionStatus } from '../collector/core/availability.ts';
import { COLLECTION_PROVIDER_NAMES, type CollectionProvider } from './collection-schedule.ts';
import { indexSessionDetails, reuseIndexSession, saveIndexSession } from './index-sessions.ts';
import { credentialIdentity } from '../collector/core/credential-identity.ts';
import { resolveCredentialIdentity } from './platform-identities.ts';

const running = (status: string) => status === 'preparing' || status === 'waiting';
const messages: Record<string, string> = {
  missing: '尚未连接。', preparing: '正在准备专用登录窗口，首次使用可能需要下载浏览器。',
  waiting: '请在打开的窗口完成登录并按页面提示验证，会话会自动保存在本机。',
  configured: '会话已保存，待首次实采验证。', verified: '登录已通过采集验证。', expired: '平台无法使用已保存的会话，请重新连接。',
  cancelled: '登录已取消。', window_closed: '窗口在保存会话前关闭，请重新连接并等候自动保存。',
  timeout: '等待超时，未检测到平台登录会话。请重新连接并完成页面验证。',
  browser_setup_failed: '专用浏览器安装失败，请检查网络后重新连接。',
  login_page_unavailable: '无法打开平台登录页，请检查到平台的网络连接后重试。',
  session_read_failed: '无法读取登录状态，请重新扫码连接。',
  session_save_failed: '无法保存登录会话，请检查本机授权目录的写入权限后重试。',
  collection_busy: '采集正在运行，请等本轮结束后重新连接。',
  failed: '无法完成登录，请重新连接。',
};

// 各平台的扫码登录配置:入口页、cookie 挑选(含哨兵校验)与会话文件名。
export interface LoginPlatform { label: string; loginUrl: string; cookieUrl?: string; file: string; pick: (cookies: any[], userAgent?: string) => PlatformAuth }
export const LOGIN_PLATFORMS: Record<string, LoginPlatform> = {
  index: {
    label: COLLECTION_PROVIDER_NAMES.index,
    loginUrl: ORIGIN + '/creator-micro/creator-count/arithmetic-index',
    file: 'index.json',
    pick: (cookies, userAgent) => {
      const auth = authFromCookies(cookies, userAgent);
      if (!/(?:^|; )(?:sessionid(?:_ss)?|sid_guard|sid_tt)=[^;]+/.test(auth.cookie)) throw new Error('login_session_missing');
      return auth;
    },
  },
  douyin: {
    label: COLLECTION_PROVIDER_NAMES.douyin,
    loginUrl: 'https://creator.douyin.com/',
    file: 'douyin.json',
    pick: (cookies, userAgent) => sessionFromCookies(cookies, ['creator.douyin.com', '.douyin.com', 'douyin.com'],
      /(?:^|; )(?:sessionid(?:_ss)?|sid_guard|sid_tt)=[^;]+/, userAgent),
  },
  xhs: {
    label: COLLECTION_PROVIDER_NAMES.xhs,
    loginUrl: 'https://creator.xiaohongshu.com/',
    file: 'xhs.json',
    pick: (cookies, userAgent) => sessionFromCookies(cookies, ['creator.xiaohongshu.com', '.xiaohongshu.com', 'xiaohongshu.com'],
      /(?:^|; )web_session=[^;]+/, userAgent),
  },
  bili: {
    label: COLLECTION_PROVIDER_NAMES.bili,
    loginUrl: `https://passport.bilibili.com/login?gourl=${encodeURIComponent(BILI_CREATOR_HOME)}`,
    cookieUrl: BILI_SESSION_URL,
    file: 'bili.json',
    pick: (cookies, userAgent) => sessionFromCookies(cookies, ['member.bilibili.com', '.bilibili.com', 'bilibili.com'],
      /(?:^|; )SESSDATA=[^;]+/, userAgent),
  },
};

interface Cookie { name: string; value: string; domain: string; path: string; expires: number }
interface LoginWindow {
  cookies(): Promise<Cookie[]>;
  userAgent: string;
  isClosed(): boolean;
  close(): Promise<void>;
}
interface Job { key: string; accountId: number; provider: string; status: string; abort: AbortController; window?: LoginWindow; done?: Promise<void> }

async function openLoginWindow(signal: AbortSignal, loginUrl: string, cookieUrl?: string): Promise<LoginWindow> {
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
        child.once('error', () => reject(new Error('browser_setup_failed')));
        child.once('exit', code => code === 0 ? resolve() : reject(new Error('browser_setup_failed')));
      });
      signal.throwIfAborted();
      browser = await chromium.launch({ headless: false });
    }
  }
  try {
    signal.throwIfAborted();
    signal.addEventListener('abort', () => { void browser.close().catch(() => {}); }, { once: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    // 扫码后页面可能立即跳转，先在空白页读取浏览器标识。
    const userAgent = await page.evaluate(() => navigator.userAgent);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      .catch(() => { throw new Error(page.isClosed() ? 'window_closed' : 'login_page_unavailable'); });
    return {
      cookies: () => context.cookies(cookieUrl), userAgent,
      isClosed: () => page.isClosed() || !browser.isConnected(), close: () => browser.close(),
    };
  } catch (error) { await browser.close().catch(() => {}); throw error; }
}

// 会话落盘:哨兵校验 → 0600 临时文件 → 原子改名 → 登记凭据。directory 可注入供测试隔离。
export function saveSession(db: DatabaseSync, provider: string, id: number, cookies: Cookie[], userAgent?: string, directory: string = DATA) {
  activeAccount(db, id);
  const platform = LOGIN_PLATFORMS[provider];
  const auth = platform.pick(cookies, userAgent);
  if (provider === 'index') return saveIndexSession(db, id, auth, directory);
  const file = join(directory, 'authorization', String(id), platform.file);
  writePrivateAuth(file, auth);
  registerAuth(new CollectionStore(db, directory), id, file, provider);
}
function persistSession(provider: string, id: number, cookies: Cookie[], userAgent?: string) {
  let unlock: () => void;
  try { unlock = lock('collection'); } catch { throw new Error('collection_busy'); }
  try {
    const db = openDb();
    try { saveSession(db, provider, id, cookies, userAgent); } finally { db.close(); }
  } finally { unlock(); }
}

export class PlatformLoginManager {
  private jobs = new Map<string, Job>();
  private launch: typeof openLoginWindow;
  private save: typeof persistSession;
  private clock: () => number;
  private sleep: () => Promise<void>;
  private onConnected?: () => void;
  private identify: typeof fetchPlatformIdentity;
  constructor(options: { launch?: typeof openLoginWindow; save?: typeof persistSession; clock?: () => number; sleep?: () => Promise<void>;
    onConnected?: () => void; identify?: typeof fetchPlatformIdentity } = {}) {
    this.launch = options.launch ?? openLoginWindow; this.save = options.save ?? persistSession;
    this.clock = options.clock ?? Date.now; this.sleep = options.sleep ?? (() => new Promise(resolve => setTimeout(resolve, 1000)));
    this.onConnected = options.onConnected;
    this.identify = options.identify ?? fetchPlatformIdentity;
  }
  state(db: DatabaseSync, id: number, provider: string) {
    const platform = LOGIN_PLATFORMS[provider];
    if (!platform) throw new InputError('未知平台', 404);
    const connection = connectionStatus(db, id, provider);
    const job = this.jobs.get(`${provider}:${id}`);
    const attempt = job && job.status !== 'configured' ? job.status : null;
    const status = attempt && (running(attempt) || !connection.configured) ? attempt : connection.status;
    const credential = !running(status) && credentialBinding(db, id, provider);
    return { provider, label: platform.label, status, configured: connection.configured, message: messages[status],
      account_name: credential ? platformAccountLabel(credentialIdentity(db, provider as CollectionProvider, credential.auth_path)) : null,
      attempt_message: attempt && attempt !== status ? messages[attempt] : null,
      ...(provider === 'index' ? indexSessionDetails(db, id) : {}) };
  }
  async inspect(db: DatabaseSync, id: number, provider: CollectionProvider) {
    if (running(this.jobs.get(`${provider}:${id}`)?.status ?? '')) return this.state(db, id, provider);
    const accounts = provider === 'index' ? [id, ...indexSessionDetails(db, id).reuse_accounts.map(account => account.id)] : [id];
    await Promise.all(accounts.map(accountId => resolveCredentialIdentity(db, accountId, provider, this.identify)));
    return this.state(db, id, provider);
  }
  reuseIndex(db: DatabaseSync, id: number, sourceId: number) {
    const key = `index:${id}`;
    if (running(this.jobs.get(key)?.status ?? '')) throw new InputError('请先完成或取消当前扫码登录。', 409);
    let unlock: () => void;
    try { unlock = lock('collection'); }
    catch { throw new InputError('采集正在运行，请等本轮结束后复用会话。', 409); }
    try { reuseIndexSession(db, id, sourceId); }
    finally { unlock(); }
    this.jobs.delete(key);
    this.onConnected?.();
    return this.inspect(db, id, 'index');
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
      job.window = await this.launch(job.abort.signal, platform.loginUrl, platform.cookieUrl);
      if (job.abort.signal.aborted) return;
      job.status = 'waiting'; const deadline = this.clock() + 10 * 60_000;
      while (!job.abort.signal.aborted) {
        if (job.window.isClosed()) { job.status = 'window_closed'; return; }
        if (this.clock() >= deadline) { job.status = 'timeout'; return; }
        const cookies = await job.window.cookies();
        job.abort.signal.throwIfAborted();
        try { platform.pick(cookies); } catch { await this.sleep(); continue; }
        try { this.save(job.provider, job.accountId, cookies, job.window.userAgent); }
        catch (error) {
          job.status = (error as Error)?.message === 'collection_busy' ? 'collection_busy' : 'session_save_failed';
          return;
        }
        job.status = 'configured';
        this.onConnected?.();
        return;
      }
    } catch (error) {
      if (!job.abort.signal.aborted) {
        const code = (error as Error)?.message ?? '';
        job.status = job.window?.isClosed() ? 'window_closed'
          : ['browser_setup_failed', 'login_page_unavailable', 'window_closed'].includes(code) ? code
          : job.status === 'waiting' ? 'session_read_failed' : 'failed';
      }
    }
    finally { await job.window?.close().catch(() => {}); }
  }
}
