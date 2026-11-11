import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { COMPLETE_PROFILE } from './support/profile.ts';
const root = mkdtempSync(join(tmpdir(), 'everyone-initialization-'));
process.env.EVERYONE_CONTENT_GIT_ROOT = join(root, 'git');
process.env.EVERYONE_CONTENT_DATA_DIR = join(root, 'runtime');
mkdirSync(process.env.EVERYONE_CONTENT_GIT_ROOT);
execFileSync('git', ['init', '-q', process.env.EVERYONE_CONTENT_GIT_ROOT]);
after(() => rmSync(root, { recursive: true, force: true }));
const { migrate } = await import('../db/migrate.ts');
const { createAccount, validateConfig } = await import('../lib/accounts.ts');
const { ensureStrategy, saveDraft, publish, rollback, context } = await import('../lib/strategies.ts');
const { initializationOverview, initializationStatus } = await import('../lib/initialization.ts');

test('画像完整性跟随生效版本，保存草稿和恢复版本后仍可独立读取', () => {
  const db = new DatabaseSync(':memory:'); migrate(db, ':memory:');
  try {
    createAccount(db, '首个账号');
    const blank = ensureStrategy(db, 1);
    assert.equal(initializationStatus(db, 1).initialized, false);
    assert.equal(initializationStatus(db, 1).missing_sections.length, 7);
    saveDraft(db, 1, { 'account-profile.md': COMPLETE_PROFILE }, blank);
    assert.equal(initializationStatus(db, 1).initialized, false);
    const active = publish(db, 1, blank, '确认完整画像');
    assert.equal(active.initialization.initialized, true);
    const second = createAccount(db, '第二个账号');
    ensureStrategy(db, second.id);
    assert.equal(initializationStatus(db, second.id).initialized, false);
    const partial = '# 账号画像\n\n## 账号定位\n园艺知识。\n\n## 目标人群\n城市居民。\n';
    saveDraft(db, 1, { 'account-profile.md': partial }, active.sha);
    assert.equal(initializationStatus(db, 1).initialized, true);
    const incomplete = publish(db, 1, active.sha, '暂存已确认部分');
    assert.equal(incomplete.initialization.initialized, false);
    const restored = rollback(db, 1, active.sha, incomplete.sha);
    assert.equal(restored.initialization.initialized, true);
    assert.equal(context(db, 1).initialized, true);
    assert.equal(context(db, 1, blank).initialized, false);
    rmSync(join(process.env.EVERYONE_CONTENT_DATA_DIR!, 'releases'), { recursive: true, force: true });
    const summary = initializationOverview(db);
    assert.equal(summary.accounts[0].initialized, true);
    assert.deepEqual(summary.accounts[0].setup, { complete: false, missing: ['index_auth', 'keywords', 'collection_config'] });
    assert.equal(existsSync(join(process.env.EVERYONE_CONTENT_DATA_DIR!, 'releases')), false);
    assert.ok(!JSON.stringify(summary).includes('家庭园艺爱好者'));
    db.prepare('UPDATE accounts SET strategy_sha=? WHERE id=1').run(blank);
    assert.equal(initializationStatus(db, 1).initialized, false);
  } finally { db.close(); }
});
test('已有数据库添加状态表时保留账号与配置；无对应版本的状态不视为完成', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, ':memory:');
    createAccount(db, '我的账号');
    db.exec('DROP TABLE account_initialization; PRAGMA user_version=1');
    db.prepare('UPDATE collection_limits SET daily_limit=12').run();
    migrate(db, ':memory:');
    assert.equal(db.prepare('SELECT name FROM accounts').get()!.name, '我的账号');
    assert.equal(db.prepare('SELECT daily_limit FROM collection_limits').get()!.daily_limit, 12);
    assert.equal(initializationStatus(db, 1).initialized, false);
  } finally { db.close(); }
});
test('初始化接受有效的旧版关键词和已保存的默认规则，暂停关键词及归档会更新缺项', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, ':memory:');
    const { id, config } = createAccount(db, '沿用历史配置');
    const sha = ensureStrategy(db, id);
    saveDraft(db, id, { 'account-profile.md': COMPLETE_PROFILE }, sha);
    publish(db, id, sha, '确认画像');
    const setup = () => initializationOverview(db).accounts[0].setup;
    db.prepare('INSERT INTO collection_credentials VALUES(?,?,?)').run(id, 'private-auth.json', `account:${id}`);
    db.prepare("INSERT INTO account_sources(account_id,kind,source_key,name,status) VALUES(?,'keyword','停用词','停用词','paused')").run(id);
    assert.deepEqual(setup().missing, ['keywords', 'collection_config']);
    const legacy = validateConfig({ ...config, index: { discovery: {}, tasks: [{ type: 'videos', keyword: '园艺' }] } });
    const setConfig = db.prepare('UPDATE accounts SET config=? WHERE id=?');
    setConfig.run(JSON.stringify(legacy), id);
    assert.deepEqual(setup(), { complete: true, missing: [] });
    db.prepare("UPDATE accounts SET status='archived' WHERE id=?").run(id);
    assert.deepEqual(setup(), { complete: false, missing: ['active_account'] });
  } finally { db.close(); }
});
