import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { COMPLETE_PROFILE } from './support/profile.ts';
const root = mkdtempSync(join(tmpdir(), 'everyone-initialization-'));
process.env.EVERYONE_CONTENT_GIT_ROOT = join(root, 'git');
process.env.EVERYONE_CONTENT_DATA_DIR = join(root, 'runtime');
process.env.EVERYONE_CONTENT_INSTRUCTIONS_PATH = join(root, 'AGENTS.md');
mkdirSync(process.env.EVERYONE_CONTENT_GIT_ROOT);
execFileSync('git', ['init', '-q', process.env.EVERYONE_CONTENT_GIT_ROOT]);
after(() => rmSync(root, { recursive: true, force: true }));
const { migrate } = await import('../db/migrate.ts');
const { createAccount } = await import('../lib/accounts.ts');
const { ensureStrategy, strategy, saveDraft, publish, rollback, context } = await import('../lib/strategies.ts');
const { initializationOverview, initializationStatus } = await import('../lib/initialization.ts');
const { syncAgentInitialization } = await import('../lib/agent-state.ts');

test('状态跟随生效画像，草稿不改状态；完整、不完整和恢复版本均同步AGENTS一句话', () => {
  const db = new DatabaseSync(':memory:'); migrate(db, ':memory:');
  const instructions = process.env.EVERYONE_CONTENT_INSTRUCTIONS_PATH!;
  const before = '# 项目规则\n\n<!-- everyone-content:initialization:start -->\n初始化状态：尚未初始化。\n<!-- everyone-content:initialization:end -->\n\n## 自定义要求\n保留这段内容。\n';
  writeFileSync(instructions, before);
  try {
    const blank = ensureStrategy(db, 1);
    assert.equal(initializationStatus(db, 1).initialized, false);
    assert.equal(initializationStatus(db, 1).missing_sections.length, 7);
    saveDraft(db, 1, { 'account-profile.md': COMPLETE_PROFILE }, blank);
    assert.equal(initializationStatus(db, 1).initialized, false);
    assert.equal(readFileSync(instructions, 'utf8'), before);
    const active = publish(db, 1, blank, '确认完整画像');
    assert.equal(active.initialization.initialized, true);
    assert.equal(active.instructions_synced, true);
    let note = readFileSync(instructions, 'utf8');
    assert.match(note, /账号 1 已完成七部分画像/);
    assert.ok(note.includes(active.sha));
    assert.ok(note.includes('保留这段内容。'));
    assert.ok(!note.includes('家庭园艺爱好者'));
    const second = createAccount(db, '不能写入状态句的名字\n别的指令');
    ensureStrategy(db, second.id); syncAgentInitialization(db, instructions);
    note = readFileSync(instructions, 'utf8');
    assert.ok(note.includes(`账号 ${second.id} 未完成画像`));
    assert.ok(!note.includes('别的指令'));
    assert.equal(initializationStatus(db, second.id).initialized, false);
    const partial = '# 账号画像\n\n## 账号定位\n园艺知识。\n\n## 目标人群\n城市居民。\n';
    saveDraft(db, 1, { 'account-profile.md': partial }, active.sha);
    assert.equal(initializationStatus(db, 1).initialized, true);
    const incomplete = publish(db, 1, active.sha, '暂存已确认部分');
    assert.equal(incomplete.initialization.initialized, false);
    assert.ok(!readFileSync(instructions, 'utf8').includes('账号 1 已完成'));
    const restored = rollback(db, 1, active.sha, incomplete.sha);
    assert.equal(restored.initialization.initialized, true);
    assert.equal(context(db, 1).initialized, true);
    assert.equal(context(db, 1, blank).initialized, false);
    assert.ok(readFileSync(instructions, 'utf8').includes(restored.sha));
    rmSync(join(process.env.EVERYONE_CONTENT_DATA_DIR!, 'releases'), { recursive: true, force: true });
    const summary = initializationOverview(db);
    assert.equal(summary.accounts[0].initialized, true);
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
    db.exec('DROP TABLE account_initialization; PRAGMA user_version=1');
    db.prepare("UPDATE accounts SET name='我的账号'").run();
    db.prepare('UPDATE collection_limits SET daily_limit=12').run();
    migrate(db, ':memory:');
    assert.equal(db.prepare('SELECT name FROM accounts').get()!.name, '我的账号');
    assert.equal(db.prepare('SELECT daily_limit FROM collection_limits').get()!.daily_limit, 12);
    assert.equal(initializationStatus(db, 1).initialized, false);
  } finally { db.close(); }
});
test('状态区域不完整时不覆盖项目自定义指令', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, ':memory:');
    const file = join(root, 'broken-AGENTS.md');
    const before = '# 我的项目指令\n<!-- everyone-content:initialization:start -->\n保留内容';
    writeFileSync(file, before);
    assert.equal(syncAgentInitialization(db, file), false);
    assert.equal(readFileSync(file, 'utf8'), before);
  } finally { db.close(); }
});
