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
mkdirSync(process.env.EVERYONE_CONTENT_GIT_ROOT);
execFileSync('git', ['init', '-q', process.env.EVERYONE_CONTENT_GIT_ROOT]);
after(() => rmSync(dir, { recursive: true, force: true }));
const { migrate } = await import('../db/migrate.ts');
const { createAccount } = await import('../lib/accounts.ts');
const { defaultSchedules } = await import('../lib/collection-schedule.ts');

test('首次安装预置各来源采集次数上限；再次开库保留用户创建的账号和配置', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, ':memory:');
    for (const table of ['accounts', 'works', 'authors', 'account_sources', 'collection_credentials', 'collection_tasks', 'collection_runs', 'collection_requests', 'contents'])
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 0, table);
    assert.deepEqual(db.prepare('SELECT provider FROM collection_limits').all().map(row => row.provider).sort(), ['bili', 'douyin', 'index', 'xhs']);
    const first = createAccount(db, '我的账号');
    assert.deepEqual(first.config, { schedules: defaultSchedules(), index: { discovery: null, tasks: [] } });
    db.prepare('UPDATE collection_limits SET daily_limit=12').run();
    migrate(db, ':memory:');
    assert.deepEqual(db.prepare('SELECT name FROM accounts').all().map(row => row.name), ['我的账号']);
    assert.equal(db.prepare('SELECT daily_limit FROM collection_limits').get()!.daily_limit, 12);
  } finally { db.close(); }
});

test('v2数据库升级v3：移除博主采集源与作品快照表，关键词保留', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'douyin', profile_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', config TEXT NOT NULL, strategy_sha TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE account_sources (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL CHECK(kind IN ('blogger','keyword')), source_key TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ready', note TEXT NOT NULL DEFAULT '', UNIQUE(account_id, kind, source_key));
      CREATE TABLE snapshots (work_id INTEGER NOT NULL, ts TEXT NOT NULL, metrics TEXT NOT NULL, source TEXT NOT NULL, capture_id INTEGER, metric_at TEXT, PRIMARY KEY (work_id, ts));
      INSERT INTO accounts(id,name,config) VALUES(1,'默认账号','{}');
      INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(1,'blogger','MS4wLjAB','参考'),(1,'keyword','效率工具','效率工具');
      PRAGMA user_version=2;`);
    migrate(db, ':memory:');
    assert.deepEqual(db.prepare('SELECT source_key FROM account_sources').all().map(row => row.source_key), ['效率工具']);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='snapshots'").get()!.n, 0);
    assert.throws(() => db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name) VALUES(1,'blogger','x','x')").run(), /CHECK/);
  } finally { db.close(); }
});

test('账号隔离、画像生效与指数配置可通过本地API完成', async () => {
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
    assert.deepEqual(await request('/api/accounts'), []);
    assert.deepEqual((await request('/api/initialization')).accounts, []);
    await request('/api/accounts', undefined, 'POST', { name: ' ' }, 400);
    const first = await request('/api/accounts', undefined, 'POST', { name: ' 我的账号 ' }, 201);
    assert.equal(first.name, '我的账号');
    assert.equal((await request('/api/context', first.id)).initialized, false);
    assert.equal((await request('/api/accounts')).length, 1);
    const second = await request('/api/accounts', undefined, 'POST', { name: '独立账号' }, 201);
    await request('/api/context', undefined, 'GET', undefined, 400);
    const overview = await request('/api/initialization');
    assert.equal(overview.accounts.find((row: any) => row.account_id === second.id).initialized, false);
    const login = await request('/api/auth/index', second.id);
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
    const configuredAccount = async () => (await request('/api/initialization')).accounts.find((row: any) => row.account_id === second.id);
    assert.equal((await configuredAccount()).initialized, true);
    assert.deepEqual((await configuredAccount()).setup.missing, ['index_auth', 'keywords']);
    assert.equal((await request('/api/context', second.id)).strategy_sha, active.sha);
    await request(`/api/context?strategy_sha=${active.sha}`, first.id, 'GET', undefined, 404);
    await request('/api/strategy/draft', second.id, 'PUT', { docs: { 'account-profile.md': profile }, base_sha: initial.sha }, 409);
    await request('/api/keywords', second.id, 'POST', { keyword: '阳台种花' }, 201);
    const rules = { discovery: { minTopicIndex: 10000, maxTopics: 5, minVideoLikes: 500, maxVideos: 100, excludeKeywords: ['广告'] }, tasks: [] };
    await request('/api/collection/config', second.id, 'PUT', { index: rules });
    assert.deepEqual((await configuredAccount()).setup.missing, ['index_auth']);
    assert.deepEqual((await request('/api/sources', first.id)).keywords, []);
    assert.equal((await request('/api/sources', second.id)).keywords[0].name, '阳台种花');
    const collection = await request('/api/collection', second.id);
    assert.deepEqual(collection.credentials, {});
    assert.equal(collection.discovery, null);
    assert.deepEqual(collection.budgets.map((row: any) => row.provider), ['bili', 'douyin', 'index', 'xhs']);
    await request('/api/run/collect', second.id, 'POST', { only: 'unsupported' }, 400);
    await request('/api/collection/progress?run_id=1', second.id, 'GET', undefined, 404);
    await request('/api/collection/limits', second.id, 'PUT', { provider: 'unsupported', daily_limit: 1 }, 400);
    const invalid = { ...second.config.schedules, unsupported: { enabled: true, times: ['10:00'], request_limit: 1 } };
    await request('/api/collection/config', second.id, 'PUT', { schedules: invalid }, 400);
    const db = new DatabaseSync(filename);
    try {
      assert.equal(db.prepare('SELECT COUNT(*) n FROM task_runs').get()!.n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_requests').get()!.n, 0);
    } finally { db.close(); }
    await request(`/api/accounts/${second.id}`, second.id, 'PUT', { status: 'archived' });
    await request('/api/keywords', second.id, 'POST', { keyword: '归档后不得写入' }, 409);
    await request('/api/auth/index/cancel', second.id, 'POST');
    await request('/api/auth/index/start', second.id, 'POST', undefined, 409);
  } finally {
    const exited = once(child, 'exit'); child.kill(); await exited;
  }
});
