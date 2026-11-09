import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { COMPLETE_PROFILE } from './support/profile.ts';

const dir = mkdtempSync(join(tmpdir(), 'everyone-accounts-'));
process.env.EVERYONE_CONTENT_GIT_ROOT = join(dir, 'git');
process.env.EVERYONE_CONTENT_DATA_DIR = join(dir, 'runtime');
process.env.EVERYONE_CONTENT_INSTRUCTIONS_PATH = join(dir, 'AGENTS.md');
mkdirSync(process.env.EVERYONE_CONTENT_GIT_ROOT);
execFileSync('git', ['init', '-q', process.env.EVERYONE_CONTENT_GIT_ROOT]);
after(() => rmSync(dir, { recursive: true, force: true }));
const { migrate, DEFAULT_CONFIG } = await import('../db/migrate.ts');
const { createAccount } = await import('../lib/accounts.ts');

test('首次安装只有空白账号和指数额度；再次开库保留用户配置', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, ':memory:');
    const accounts = db.prepare('SELECT * FROM accounts').all();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].name, '默认账号');
    assert.equal(accounts[0].strategy_sha, null);
    assert.deepEqual(JSON.parse(accounts[0].config as string), DEFAULT_CONFIG);
    for (const table of ['works', 'authors', 'snapshots', 'account_sources', 'collection_credentials', 'collection_tasks', 'collection_runs', 'collection_requests', 'contents'])
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 0, table);
    assert.deepEqual(db.prepare('SELECT provider FROM collection_limits').all().map(row => row.provider), ['index']);
    const other = createAccount(db, '第二个账号');
    assert.deepEqual(other.config, DEFAULT_CONFIG);
    db.prepare('UPDATE collection_limits SET daily_limit=12').run();
    migrate(db, ':memory:');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM accounts').get()!.n, 2);
    assert.equal(db.prepare('SELECT daily_limit FROM collection_limits').get()!.daily_limit, 12);
    assert.throws(() => db.prepare("INSERT INTO collection_limits VALUES('unsupported',1,1,1)").run(), /CHECK/);
  } finally { db.close(); }
});

test('账号隔离、画像生效、指数配置与发布登记可通过本地API完成，保存博主不触发网络采集', async () => {
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const filename = join(dir, 'web.db');
  const child = spawn(process.execPath, ['server/index.ts'], {
    env: { ...process.env, EVERYONE_CONTENT_DB_PATH: filename, WEB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = ''; child.stdout.on('data', value => logs += value); child.stderr.on('data', value => logs += value);
  async function request(path: string, accountId?: number, method = 'GET', data?: unknown, expected = 200) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(accountId ? { 'x-everyone-content-account': String(accountId) } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
    return value;
  }
  try {
    for (let attempt = 0; ; attempt++) {
      try { await fetch(`http://127.0.0.1:${port}/api/accounts`); break; }
      catch { if (attempt >= 100) throw new Error(logs); await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    assert.equal((await request('/api/health')).app, 'everyone-content');
    const [first] = await request('/api/accounts');
    const second = await request('/api/accounts', undefined, 'POST', { name: '独立账号' }, 201);
    await request('/api/context', undefined, 'GET', undefined, 400);
    const overview = await request('/api/initialization');
    assert.equal(overview.accounts.find((row: any) => row.account_id === second.id).initialized, false);
    const login = await request('/api/index-auth', second.id);
    assert.equal(login.configured, false);
    assert.ok(!('cookie' in login));
    const initial = await request('/api/strategy', second.id);
    assert.match(initial.published['account-profile.md'], /填写：领域/);
    const profile = COMPLETE_PROFILE;
    const draft = await request('/api/strategy/draft', second.id, 'PUT', { docs: { 'account-profile.md': profile }, base_sha: initial.sha });
    assert.notEqual(draft.published['account-profile.md'], profile);
    const active = await request('/api/strategy/publish', second.id, 'POST', { base_sha: initial.sha, note: '初始化账号画像' });
    assert.equal(active.published['account-profile.md'], profile);
    assert.equal(active.initialization.initialized, true);
    assert.equal(active.instructions_synced, true);
    assert.equal((await request('/api/initialization')).accounts.find((row: any) => row.account_id === second.id).initialized, true);
    assert.equal((await request('/api/context', second.id)).strategy_sha, active.sha);
    await request(`/api/context?strategy_sha=${active.sha}`, first.id, 'GET', undefined, 404);
    await request('/api/strategy/draft', second.id, 'PUT', { docs: { 'account-profile.md': profile }, base_sha: initial.sha }, 409);
    await request('/api/keywords', second.id, 'POST', { keyword: '阳台种花' }, 201);
    const rules = { discovery: { minTopicIndex: 10000, maxTopics: 3, minVideoLikes: 100, maxVideos: 40, maxAuthors: 5, excludeKeywords: ['广告'] }, tasks: [] };
    await request('/api/collection/config', second.id, 'PUT', { index: rules });
    assert.deepEqual((await request('/api/sources', first.id)).keywords, []);
    assert.equal((await request('/api/sources', second.id)).keywords[0].name, '阳台种花');
    await request('/api/bloggers', second.id, 'POST', { url: 'https://www.douyin.com/user/MS4wLjABTEST', name: '参考博主' }, 201);
    await request('/api/bloggers', second.id, 'POST', { url: 'https://v.douyin.com/short' }, 400);
    const collection = await request('/api/collection', second.id);
    assert.equal(collection.indexCredential, false);
    assert.equal(collection.discovery, null);
    assert.deepEqual(collection.budgets.map((row: any) => row.provider), ['index']);
    await request('/api/run/collect', second.id, 'POST', { only: 'unsupported' }, 400);
    await request('/api/collection/limits', second.id, 'PUT', { provider: 'unsupported', daily_limit: 1 }, 400);
    const invalid = { ...second.config.schedules, unsupported: { enabled: true, times: ['10:00'], request_limit: 1 } };
    await request('/api/collection/config', second.id, 'PUT', { schedules: invalid }, 400);
    const db = new DatabaseSync(filename);
    try {
      assert.equal(db.prepare('SELECT COUNT(*) n FROM task_runs').get()!.n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_requests').get()!.n, 0);
    } finally { db.close(); }
    await request('/api/contents', second.id, 'POST', { published_url: 'https://www.douyin.com/video/9000000000000000001', published_at: '2020-01-01T10:00:00+08:00' }, 201);
    assert.equal((await request('/api/contents', second.id))[0].metrics, null);
    assert.deepEqual(await request('/api/contents', first.id), []);
    assert.equal((await request('/api/works', second.id)).total, 0);
    await request(`/api/accounts/${second.id}`, second.id, 'PUT', { status: 'archived' });
    await request('/api/keywords', second.id, 'POST', { keyword: '归档后不得写入' }, 409);
    await request('/api/index-auth/cancel', second.id, 'POST');
    await request('/api/index-auth/start', second.id, 'POST', undefined, 409);
  } finally {
    const exited = once(child, 'exit'); child.kill(); await exited;
  }
});
