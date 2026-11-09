import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { createAccount } from '../lib/accounts.ts';
import { IndexLoginManager, saveIndexSession } from '../lib/index-login.ts';
const root = mkdtempSync(join(tmpdir(), 'everyone-login-'));
after(() => rmSync(root, { recursive: true, force: true }));
const session = { name: 'sessionid', value: 'synthetic-test-session', domain: '.douyin.com', path: '/', expires: -1 };
function database() { const db = new DatabaseSync(':memory:'); migrate(db, ':memory:'); return db; }
function windowWith(cookies: () => Promise<any[]>, userAgent = async () => 'Test Agent') {
  let closed = false;
  return { cookies, userAgent, isClosed: () => closed, close: async () => { closed = true; } };
}
test('匿名和其他域会话不保存，登录后凭据按账号私密落盘，不回显或自动采集', async () => {
  const db = database();
  try {
    let step = 0;
    const window = windowWith(async () => step++ === 0 ? [{ ...session, domain: 'unrelated.test' }] : [session, { ...session, name: 'other', domain: 'unrelated.test' }]);
    const manager = new IndexLoginManager({ launch: async () => window, sleep: async () => {}, save: (id, cookies, agent) => saveIndexSession(db, id, cookies, agent, root) });
    manager.start(db, 1); await manager.settle(1);
    const state = manager.state(db, 1);
    assert.equal(state.status, 'configured'); assert.equal(state.configured, true);
    assert.ok(!JSON.stringify(state).includes(session.value));
    const path = String(db.prepare('SELECT auth_path FROM collection_credentials WHERE account_id=1').get()!.auth_path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, 'authorization', '1')).mode & 0o777, 0o700);
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.cookie, 'sessionid=synthetic-test-session');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_requests').get()!.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_runs').get()!.n, 0);
    assert.equal(new IndexLoginManager().state(db, 1).status, 'configured');
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('index','account:1',1,'login_required')").run();
    assert.equal(manager.state(db, 1).status, 'expired');
  } finally { db.close(); }
});
test('同一账号重复点击只启动一次，其他账号不能串用登录窗口，取消后不保存', async () => {
  const db = database();
  try {
    const second = createAccount(db, '第二账号');
    let resolveWindow: (value: any) => void = () => {}, launches = 0, saves = 0;
    const manager = new IndexLoginManager({ launch: async () => { launches++; return new Promise(resolve => resolveWindow = resolve); }, save: () => { saves++; } });
    manager.start(db, 1); manager.start(db, 1);
    assert.equal(launches, 1);
    assert.throws(() => manager.start(db, second.id), /另一个账号/);
    await manager.cancel(db, 1);
    resolveWindow(windowWith(async () => [session])); await manager.settle(1);
    assert.equal(manager.state(db, 1).status, 'cancelled'); assert.equal(saves, 0);
  } finally { db.close(); }
});
test('取消发生在读取会话期间时不保存；失败消息不泄露上游文本', async () => {
  const db = database();
  try {
    let release: (value: string) => void = () => {}, saves = 0;
    const window = windowWith(async () => [session], () => new Promise(resolve => release = resolve));
    const manager = new IndexLoginManager({ launch: async () => window, save: () => { saves++; } });
    manager.start(db, 1); await new Promise(resolve => setImmediate(resolve));
    await manager.cancel(db, 1); release('Test Agent'); await manager.settle(1);
    assert.equal(saves, 0); assert.equal(manager.state(db, 1).status, 'cancelled');
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('index','account:1',1,'login_required')").run();
    const failing = new IndexLoginManager({ launch: async () => { throw new Error('private upstream text'); } });
    failing.start(db, 1); await failing.settle(1);
    assert.equal(failing.state(db, 1).status, 'failed');
    assert.ok(!JSON.stringify(failing.state(db, 1)).includes('private upstream'));
  } finally { db.close(); }
});
test('登录等待超时及归档账号不会登记凭据', async () => {
  const db = database();
  try {
    let now = 0, saves = 0;
    const manager = new IndexLoginManager({ launch: async () => windowWith(async () => []), clock: () => now, sleep: async () => { now += 600000; }, save: () => { saves++; } });
    manager.start(db, 1); await manager.settle(1);
    assert.equal(manager.state(db, 1).status, 'timeout'); assert.equal(saves, 0);
    db.prepare("UPDATE accounts SET status='archived' WHERE id=1").run();
    assert.throws(() => manager.start(db, 1), /归档/);
    assert.throws(() => saveIndexSession(db, 1, [session], 'Test Agent', join(root, 'archived')), /归档/);
    assert.equal(existsSync(join(root, 'archived')), false);
  } finally { db.close(); }
});
