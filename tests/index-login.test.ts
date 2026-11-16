import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { createAccount } from '../lib/accounts.ts';
import { PlatformLoginManager, saveSession } from '../lib/platform-login.ts';
import { fetchPlatformIdentity } from '../collector/sources/platform/identity.ts';
import { writePrivateAuth } from '../collector/sources/platform/session.ts';
const root = mkdtempSync(join(tmpdir(), 'everyone-login-'));
after(() => rmSync(root, { recursive: true, force: true }));
const session = { name: 'sessionid', value: 'synthetic-test-session', domain: '.douyin.com', path: '/', expires: -1 };
function database() { const db = new DatabaseSync(':memory:'); migrate(db, ':memory:'); createAccount(db, '登录测试账号'); return db; }
function windowWith(cookies: () => Promise<any[]>, userAgent = 'Test Agent') {
  let closed = false;
  return { cookies, userAgent, isClosed: () => closed, close: async () => { closed = true; } };
}
const saveInto = (db: DatabaseSync) => (provider: string, id: number, cookies: any[], agent?: string) =>
  saveSession(db, provider, id, cookies, agent, root);

test('匿名和其他域会话不保存，登录后凭据按账号私密落盘，不回显或自动采集', async () => {
  const db = database();
  try {
    let step = 0;
    const window = windowWith(async () => step++ === 0 ? [{ ...session, domain: 'unrelated.test' }] : [session, { ...session, name: 'other', domain: 'unrelated.test' }]);
    const manager = new PlatformLoginManager({ launch: async () => window, sleep: async () => {}, save: saveInto(db),
      identify: async (_provider, auth) => {
        assert.equal(auth.cookie, 'sessionid=synthetic-test-session');
        return { id: 'MS4wLjAB-test', name: '创作者', handle: 'douyin_test' };
      } });
    manager.start(db, 1, 'index'); await manager.settle('index', 1);
    const state = await manager.inspect(db, 1, 'index');
    assert.equal(state.status, 'configured'); assert.equal(state.configured, true);
    assert.equal(state.account_name, '创作者（douyin_test）');
    assert.deepEqual(state.session_accounts, ['登录测试账号']);
    assert.ok(!JSON.stringify(state).includes(session.value));
    const path = String(db.prepare("SELECT auth_path FROM collection_credentials WHERE account_id=1 AND provider='index'").get()!.auth_path);
    // Windows不支持POSIX权限位，与loadSession的权限检查保持一致。
    if (process.platform !== 'win32') {
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
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
test('平台身份从对应的自查接口获取，替换会话后旧身份失效', async () => {
  const db = database();
  try {
    const providerSessions = [
      ['index', session, '指数帐号', 'index_test'],
      ['douyin', { ...session, value: 'douyin-creator-test' }, '抖音后台', 'douyin_test'],
      ['xhs', { ...session, name: 'web_session', domain: '.xiaohongshu.com' }, '小红书测试', 'xhs_test'],
      ['bili', { ...session, name: 'SESSDATA', domain: '.bilibili.com' }, 'B 站测试', '9007199254740993'],
    ] as const;
    const calls: string[] = [];
    const manager = new PlatformLoginManager({ identify: async (provider, auth) => {
      const entry = providerSessions.find(row => row[0] === provider)!;
      assert.ok(auth.cookie.includes(entry[1].value) || auth.cookie === 'sessionid=updated-session');
      calls.push(provider);
      return fetchPlatformIdentity(provider, auth, async (input, init) => {
        const url = new URL(String(input));
        if (provider === 'bili') {
          assert.equal(url.hostname, 'api.bilibili.com');
          assert.equal(new Headers(init?.headers).get('cookie'), `SESSDATA=${entry[1].value}`);
          return new Response('{"code":0,"data":{"isLogin":true,"mid":9007199254740993,"uname":"B 站测试"}}');
        }
        if (provider === 'xhs') {
          assert.equal(url.pathname, '/api/galaxy/user/info');
          return Response.json({ code: 0, success: true, data: { userId: 'a'.repeat(24), userName: entry[2], redId: entry[3] } });
        }
        assert.equal(url.hostname, 'creator.douyin.com');
        return Response.json({ status_code: 0, user_profile: { secret_id: `MS4wLjAB-${provider}`,
          nick_name: auth.cookie === 'sessionid=updated-session' ? '更新后的抖音帐号' : entry[2], unique_id: entry[3] } });
      });
    } });
    for (const [provider, cookie, name, handle] of providerSessions) {
      saveSession(db, provider, 1, [cookie, { ...cookie, name: 'other_local_cookie' }], 'Test Agent', root);
      assert.equal((await manager.inspect(db, 1, provider)).account_name, `${name}（${handle}）`);
      assert.equal((await manager.inspect(db, 1, provider)).account_name, `${name}（${handle}）`);
    }
    assert.deepEqual(calls, ['index', 'douyin', 'xhs', 'bili']);
    const row = db.prepare("SELECT auth_path FROM collection_credentials WHERE provider='douyin'").get()!;
    writePrivateAuth(String(row.auth_path), { cookie: 'sessionid=updated-session' });
    assert.equal(manager.state(db, 1, 'douyin').account_name, null);
    assert.equal((await manager.inspect(db, 1, 'douyin')).account_name, '更新后的抖音帐号（douyin_test）');
    assert.equal(manager.state(db, 1, 'index').account_name, '指数帐号（index_test）');
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
test('B站使用官方登录页，并只读取可发送给创作中心总览的会话', async () => {
  const db = database();
  try {
    const biliSession = { name: 'SESSDATA', value: 'synthetic-bili-session', domain: '.bilibili.com', path: '/', expires: -1 };
    const manager = new PlatformLoginManager({
      launch: async (_signal, target, cookieUrl) => {
        const login = new URL(target);
        assert.equal(login.origin + login.pathname, 'https://passport.bilibili.com/login');
        assert.equal(login.searchParams.get('gourl'), 'https://member.bilibili.com/platform/home');
        assert.equal(cookieUrl, 'https://member.bilibili.com/x/web/data/index/stat?tmid=-1');
        return windowWith(async () => [biliSession]);
      },
      save: saveInto(db),
    });
    manager.start(db, 1, 'bili'); await manager.settle('bili', 1);
    assert.equal(manager.state(db, 1, 'bili').status, 'configured');
    const path = String(db.prepare("SELECT auth_path FROM collection_credentials WHERE account_id=1 AND provider='bili'").get()!.auth_path);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { cookie: 'SESSDATA=synthetic-bili-session', userAgent: 'Test Agent' });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_requests').get()!.n, 0);
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
    let release: (value: typeof session[]) => void = () => {}, saves = 0;
    const window = windowWith(() => new Promise(resolve => release = resolve));
    const manager = new PlatformLoginManager({ launch: async () => window, save: () => { saves++; } });
    manager.start(db, 1, 'index'); await new Promise(resolve => setImmediate(resolve));
    await manager.cancel(db, 1, 'index'); release([session]); await manager.settle('index', 1);
    assert.equal(saves, 0); assert.equal(manager.state(db, 1, 'index').status, 'cancelled');
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('index','account:1',1,'login_required')").run();
    const failing = new PlatformLoginManager({ launch: async () => { throw new Error('private upstream text'); } });
    failing.start(db, 1, 'index'); await failing.settle('index', 1);
    const state = failing.state(db, 1, 'index');
    assert.equal(state.status, 'failed');
    assert.equal(state.message, '无法完成登录，请重新连接。');
    const unreadable = new PlatformLoginManager({ launch: async () => windowWith(async () => { throw new Error('private upstream text'); }) });
    unreadable.start(db, 1, 'bili'); await unreadable.settle('bili', 1);
    const unreadableState = unreadable.state(db, 1, 'bili');
    assert.equal(unreadableState.status, 'session_read_failed');
    assert.equal(unreadableState.message, '无法读取登录状态，请重新扫码连接。');
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
