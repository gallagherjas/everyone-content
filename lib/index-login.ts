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
import { authFromCookies, loadAuth } from '../collector/sources/douyin-index/client.ts';
import { ORIGIN } from '../collector/sources/douyin-index/protocol.ts';

const LOGIN_URL = ORIGIN + '/creator-micro/creator-count/arithmetic-index';
const running = (status: string) => status === 'preparing' || status === 'waiting';
const messages: Record<string, string> = {
  missing: '尚未连接抖音指数。', preparing: '正在准备专用登录窗口，首次使用可能需要下载浏览器。',
  waiting: '请在打开的抖音窗口扫码，并按页面提示完成验证。',
  configured: '登录会话已保存。采集时会校验指数访问权限。', expired: '登录已失效，请重新连接抖音指数。',
  cancelled: '登录已取消。', timeout: '等待登录超时，请重试。',
  failed: '无法完成登录，请检查网络及图形桌面环境后重试。',
};
interface Cookie { name: string; value: string; domain: string; path: string; expires: number }
interface LoginWindow {
  cookies(): Promise<Cookie[]>;
  userAgent(): Promise<string>;
  isClosed(): boolean;
  close(): Promise<void>;
}
interface Job { accountId: number; status: string; abort: AbortController; window?: LoginWindow; done?: Promise<void> }

async function openLoginWindow(signal: AbortSignal): Promise<LoginWindow> {
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
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    return {
      cookies: () => context.cookies(), userAgent: () => page.evaluate(() => navigator.userAgent),
      isClosed: () => page.isClosed() || !browser.isConnected(), close: () => browser.close(),
    };
  } catch (error) { await browser.close().catch(() => {}); throw error; }
}

export function saveIndexSession(db: DatabaseSync, id: number, cookies: Cookie[], userAgent: string, directory = DATA) {
  activeAccount(db, id);
  const auth = authFromCookies(cookies, userAgent);
  if (!/(?:^|; )(?:sessionid(?:_ss)?|sid_guard|sid_tt)=[^;]+/.test(auth.cookie)) throw new Error('login_session_missing');
  const folder = join(directory, 'authorization', String(id));
  mkdirSync(folder, { recursive: true, mode: 0o700 }); chmodSync(folder, 0o700);
  const file = join(folder, 'index.json'), temp = join(folder, randomUUID() + '.tmp');
  try {
    writeFileSync(temp, JSON.stringify(auth), { mode: 0o600, flag: 'wx' });
    loadAuth(temp, {});
    renameSync(temp, file);
    registerAuth(new CollectionStore(db, directory), id, file);
  } finally { rmSync(temp, { force: true }); }
}
function persistSession(id: number, cookies: Cookie[], userAgent: string) {
  const db = openDb();
  try { saveIndexSession(db, id, cookies, userAgent); } finally { db.close(); }
}

export class IndexLoginManager {
  private jobs = new Map<number, Job>();
  private launch: (signal: AbortSignal) => Promise<LoginWindow>;
  private save: typeof persistSession;
  private clock: () => number;
  private sleep: () => Promise<void>;
  constructor(options: { launch?: typeof openLoginWindow; save?: typeof persistSession; clock?: () => number; sleep?: () => Promise<void> } = {}) {
    this.launch = options.launch ?? openLoginWindow; this.save = options.save ?? persistSession;
    this.clock = options.clock ?? Date.now; this.sleep = options.sleep ?? (() => new Promise(resolve => setTimeout(resolve, 1000)));
  }
  state(db: DatabaseSync, id: number) {
    const configured = !!db.prepare('SELECT 1 FROM collection_credentials WHERE account_id=?').get(id);
    const error = db.prepare("SELECT error FROM collection_provider_state WHERE provider='index' AND scope=?").get(`account:${id}`)?.error;
    const job = this.jobs.get(id);
    const expired = /login_required|auth_required|invalid_auth|auth_file/.test(String(error ?? ''));
    const status = job && job.status !== 'configured' ? job.status : expired ? 'expired' : configured ? 'configured' : 'missing';
    return { status, configured, message: messages[status] };
  }
  start(db: DatabaseSync, id: number) {
    activeAccount(db, id);
    const current = this.jobs.get(id);
    if (current && running(current.status)) return this.state(db, id);
    if ([...this.jobs.values()].some(job => running(job.status))) throw new InputError('另一个账号正在登录，请先完成或取消', 409);
    const job: Job = { accountId: id, status: 'preparing', abort: new AbortController() };
    this.jobs.set(id, job); job.done = this.run(job);
    return this.state(db, id);
  }
  async cancel(db: DatabaseSync, id: number) {
    const job = this.jobs.get(id);
    if (job && running(job.status)) {
      job.status = 'cancelled'; job.abort.abort(); await job.window?.close().catch(() => {});
    }
    return this.state(db, id);
  }
  async settle(id: number) { await this.jobs.get(id)?.done; }
  private async run(job: Job) {
    try {
      job.window = await this.launch(job.abort.signal);
      if (job.abort.signal.aborted) return;
      job.status = 'waiting'; const deadline = this.clock() + 10 * 60_000;
      while (!job.abort.signal.aborted) {
        if (job.window.isClosed()) { job.status = 'cancelled'; return; }
        if (this.clock() >= deadline) { job.status = 'timeout'; return; }
        const cookies = await job.window.cookies();
        const auth = authFromCookies(cookies);
        if (/(?:^|; )(?:sessionid(?:_ss)?|sid_guard|sid_tt)=[^;]+/.test(auth.cookie)) {
          const userAgent = await job.window.userAgent();
          job.abort.signal.throwIfAborted();
          this.save(job.accountId, cookies, userAgent);
          job.status = 'configured'; return;
        }
        await this.sleep();
      }
    } catch { if (!job.abort.signal.aborted) job.status = job.window?.isClosed() ? 'cancelled' : 'failed'; }
    finally { await job.window?.close().catch(() => {}); }
  }
}
export const indexLogin = new IndexLoginManager();
