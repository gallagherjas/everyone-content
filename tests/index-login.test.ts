import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { createAccount } from '../lib/accounts.ts';
import { PlatformLoginManager, saveSession } from '../lib/platform-login.ts';
const root = mkdtempSync(join(tmpdir(), 'everyone-login-'));
after(() => rmSync(root, { recursive: true, force: true }));
const session = { name: 'sessionid', value: 'synthetic-test-session', domain: '.douyin.com', path: '/', expires: -1 };
function database() { const db = new DatabaseSync(':memory:'); migrate(db, ':memory:'); createAccount(db, '登录测试账号'); return db; }
function windowWith(cookies: () => Promise<any[]>, userAgent = async () => 'Test Agent') {
  let closed = false;
  return { cookies, userAgent, isClosed: () => closed, close: async () => { closed = true; } };
}
const saveInto = (db: DatabaseSync) => (provider: string, id: number, cookies: any[], agent?: string) => saveSession(db, provider, id, cookies, agent, root);

test('匿名和其他域会话不保存，登录后凭据按账号私密落盘，不回显或自动采集', async () => {
  const db = database();
  try {
    let step = 0;
    const window = windowWith(async () => step++ === 0 ? [{ ...session, domain: 'unrelated.test' }] : [session, { ...session, name: 'other', domain: 'unrelated.test' }]);
    const manager = new PlatformLoginManager({ launch: async () => window, sleep: async () => {}, save: saveInto(db) });
    manager.start(db, 1, 'index'); await manager.settle('index', 1);
    const state = manager.state(db, 1, 'index');
    assert.equal(state.status, 'configured'); assert.equal(state.configured, true);
    assert.ok(!JSON.stringify(state).includes(session.value));
    const path = String(db.prepare("SELECT auth_path FROM collection_credentials WHERE account_id=1 AND provider='index'").get()!.auth_path);
    // Windows不支持POSIX权限位，与loadSession的权限检查保持一致。
    if (process.platform !== 'win32') {
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(statSync(join(root, 'authorization', '1')).mode & 0o777, 0o700);
    }
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.cookie, 'sessionid=synthetic-test-session');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_requests').get()!.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_runs').get()!.n, 0);
    assert.equal(new PlatformLoginManager().state(db, 1, 'index').status, 'configured');
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('index','account:1',1,'login_required')").run();
    assert.equal(manager.state(db, 1, 'index').status, 'expired');
  } finally { db.close(); }
});
test('平台哨兵 cookie 隔离：抖音会话不构成小红书或B站登录', async () => {
  const db = database();
  try {
    let saves = 0, now = 0;
    const manager = new PlatformLoginManager({ launch: async () => windowWith(async () => [session]), clock: () => now, sleep: async () => { now += 600000; }, save: () => { saves++; } });
    manager.start(db, 1, 'xhs'); await manager.settle('xhs', 1);
    manager.start(db, 1, 'bili'); await manager.settle('bili', 1);
    assert.equal(manager.state(db, 1, 'xhs').status, 'timeout');
    assert.equal(manager.state(db, 1, 'bili').status, 'timeout');
    assert.equal(saves, 0);
    assert.throws(() => manager.state(db, 1, 'unknown'), /未知平台/);
  } finally { db.close(); }
});
test('同一账号重复点击只启动一次，其他账号不能串用登录窗口，取消后不保存', async () => {
  const db = database();
  try {
    const second = createAccount(db, '第二账号');
    let resolveWindow: (value: any) => void = () => {}, launches = 0, saves = 0;
    const manager = new PlatformLoginManager({ launch: async () => { launches++; return new Promise(resolve => resolveWindow = resolve); }, save: () => { saves++; } });
    manager.start(db, 1, 'index'); manager.start(db, 1, 'index');
    assert.equal(launches, 1);
    assert.throws(() => manager.start(db, second.id, 'index'), /另一个账号/);
    await manager.cancel(db, 1, 'index');
    resolveWindow(windowWith(async () => [session])); await manager.settle('index', 1);
    assert.equal(manager.state(db, 1, 'index').status, 'cancelled'); assert.equal(saves, 0);
  } finally { db.close(); }
});
test('取消发生在读取会话期间时不保存；失败消息不泄露上游文本', async () => {
  const db = database();
  try {
    let release: (value: string) => void = () => {}, saves = 0;
    const window = windowWith(async () => [session], () => new Promise(resolve => release = resolve));
    const manager = new PlatformLoginManager({ launch: async () => window, save: () => { saves++; } });
    manager.start(db, 1, 'index'); await new Promise(resolve => setImmediate(resolve));
    await manager.cancel(db, 1, 'index'); release('Test Agent'); await manager.settle('index', 1);
    assert.equal(saves, 0); assert.equal(manager.state(db, 1, 'index').status, 'cancelled');
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('index','account:1',1,'login_required')").run();
    const failing = new PlatformLoginManager({ launch: async () => { throw new Error('private upstream text'); } });
    failing.start(db, 1, 'index'); await failing.settle('index', 1);
    assert.equal(failing.state(db, 1, 'index').status, 'failed');
    assert.ok(!JSON.stringify(failing.state(db, 1, 'index')).includes('private upstream'));
  } finally { db.close(); }
});
test('登录等待超时及归档账号不会登记凭据', async () => {
  const db = database();
  try {
    let now = 0, saves = 0;
    const manager = new PlatformLoginManager({ launch: async () => windowWith(async () => []), clock: () => now, sleep: async () => { now += 600000; }, save: () => { saves++; } });
    manager.start(db, 1, 'index'); await manager.settle('index', 1);
    assert.equal(manager.state(db, 1, 'index').status, 'timeout'); assert.equal(saves, 0);
    db.prepare("UPDATE accounts SET status='archived' WHERE id=1").run();
    assert.throws(() => manager.start(db, 1, 'index'), /归档/);
    assert.throws(() => saveSession(db, 'index', 1, [session], 'Test Agent', join(root, 'archived')), /归档/);
    assert.equal(existsSync(join(root, 'archived')), false);
  } finally { db.close(); }
});
