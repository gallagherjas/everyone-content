import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'everyone-notices-'));
process.env.EVERYONE_CONTENT_GIT_ROOT = join(root, 'git');
process.env.EVERYONE_CONTENT_DATA_DIR = join(root, 'runtime');
mkdirSync(process.env.EVERYONE_CONTENT_GIT_ROOT);
mkdirSync(process.env.EVERYONE_CONTENT_DATA_DIR);
after(() => rmSync(root, { recursive: true, force: true }));
const { migrate } = await import('../db/migrate.ts');
const { createAccount } = await import('../lib/accounts.ts');
const { noticeOverview } = await import('../lib/notices.ts');

function setup() {
  const db = new DatabaseSync(':memory:');
  migrate(db, ':memory:');
  return { db, id: createAccount(db, '提醒账号').id };
}

test('登录失效进横幅素材，非登录类暂停进异常明细，未连接的平台不提醒', () => {
  const { db, id } = setup();
  try {
    db.prepare('INSERT INTO collection_credentials VALUES(?,?,?,?)').run(id, 'index', 'a.json', `account:${id}`);
    db.prepare('INSERT INTO collection_credentials VALUES(?,?,?,?)').run(id, 'douyin', 'b.json', `account:${id}`);
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('index',?,1,'login_required')").run(`account:${id}`);
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('douyin',?,1,'rate_limited')").run(`account:${id}`);
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('xhs',?,1,'login_required')").run(`account:${id}`);
    const n = noticeOverview(db, id);
    assert.deepEqual(n.auth, [{ provider: 'index' }]);
    assert.deepEqual(n.issues, [{ kind: 'paused', provider: 'douyin', error: 'rate_limited' }]);
  } finally { db.close(); }
});

test('禁用任务按错误聚合，最近一轮失败只报一次，成功后自愈', () => {
  const { db, id } = setup();
  try {
    for (const key of ['k1', 'k2'])
      db.prepare("INSERT INTO collection_tasks(key,provider,scope,operation,target,spec,interval_ms,disabled,error) VALUES(?,'index',?,'videos','词#7','{}',86400000,1,'schema_error')").run(key, `account:${id}`);
    db.prepare('INSERT INTO collection_task_accounts VALUES(?,?,?)').run('k1', id, 's1');
    db.prepare('INSERT INTO collection_task_accounts VALUES(?,?,?)').run('k2', id, 's1');
    db.prepare("INSERT INTO task_runs(account_id,task,status) VALUES(?,'collect','failed')").run(id);
    let n = noticeOverview(db, id);
    assert.deepEqual(n.issues, [{ kind: 'disabled', error: 'schema_error', count: 2 }, { kind: 'run_failed' }]);
    db.prepare("INSERT INTO task_runs(account_id,task,status) VALUES(?,'collect','done')").run(id);
    n = noticeOverview(db, id);
    assert.equal(n.issues.some((i) => i.kind === 'run_failed'), false);
  } finally { db.close(); }
});

test('博主提醒只收近30天的博主域新增，水位取最新一条；未定位的博主为空', () => {
  const { db, id } = setup();
  try {
    db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name,note) VALUES(?,'blogger','sec1','博主甲',?)").run(id, JSON.stringify({ secUid: 'sec1' }));
    db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name,note) VALUES(?,'blogger','sec2','博主乙','')").run(id);
    const add = (url: string, title: string, reason: string, atMs: number) => {
      const wid = Number((db.prepare("INSERT INTO works(platform,author_id,url,title) VALUES('douyin','sec1',?,?) RETURNING id").get(url, title) as { id: number }).id);
      db.prepare('INSERT INTO account_works(account_id,work_id,reason,added_at) VALUES(?,?,?,?)').run(id, wid, reason, new Date(atMs).toISOString().replace('T', ' ').slice(0, 19));
    };
    add('https://www.douyin.com/video/1', '新视频', 'index:blogger', Date.now());
    add('https://www.douyin.com/video/2', '四十天前', 'index:blogger', Date.now() - 40 * 86400000);
    add('https://www.douyin.com/video/3', '关键词命中', 'keyword:园艺', Date.now());
    const n = noticeOverview(db, id);
    assert.equal(n.bloggers.length, 2);
    assert.equal(n.bloggers[0].name, '博主甲');
    assert.deepEqual(n.bloggers[0].items.map((w) => w.title), ['新视频']);
    assert.equal(n.bloggers[0].latest, n.bloggers[0].items[0].addedAt);
    assert.deepEqual(n.bloggers[1], { id: n.bloggers[1].id, name: '博主乙', latest: null, items: [] });
  } finally { db.close(); }
});
