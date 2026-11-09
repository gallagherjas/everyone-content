// 策略正文以 Git 对象为准，SQLite 只保存生效指针和审计记录；不改用户分支或暂存区。
import type { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { account, InputError } from './accounts.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const configuredData = process.env.EVERYONE_CONTENT_DATA_DIR;
export const DATA = configuredData ? resolve(configuredData) : join(ROOT, 'runtime');
const REPO = process.env.EVERYONE_CONTENT_GIT_ROOT || ROOT;
const ref = (id: number) => `refs/everyone-content/profiles/${id}`;
const git = (args: string[], input?: string) =>
  execFileSync('git', ['-C', REPO, ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 2_000_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'everyone-content',
      GIT_AUTHOR_EMAIL: 'strategy@localhost',
      GIT_COMMITTER_NAME: 'everyone-content',
      GIT_COMMITTER_EMAIL: 'strategy@localhost',
    },
  }).trim();
function head(id: number): string | null {
  try {
    return git(['rev-parse', '--verify', ref(id)]);
  } catch {
    return null;
  }
}
function filesAt(sha: string): Record<string, string> {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new InputError('策略版本无效');
  const names = git(['ls-tree', '--name-only', sha])
    .split('\n')
    .filter((name) => /^account-profile\.md$/.test(name));
  return Object.fromEntries(
    names.map((n) => [
      n,
      execFileSync('git', ['-C', REPO, 'show', `${sha}:${n}`], { encoding: 'utf8', maxBuffer: 1_000_000 }),
    ]),
  );
}
export function releaseDir(sha: string) {
  const files = filesAt(sha);
  const dir = join(DATA, 'releases', sha);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    if (!/^[\w.-]+$/.test(name)) throw new Error('策略快照包含非法路径');
    const target = join(dir, name);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) atomic(target, text);
  }
  return dir;
}
function atomic(path: string, text: string) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}
function commit(id: number, files: Record<string, string>, note: string) {
  const previous = head(id);
  const tree = git(
    ['mktree'],
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, text]) => `100644 blob ${git(['hash-object', '-w', '--stdin'], text)}\t${name}\n`)
      .join(''),
  );
  if (previous && git(['rev-parse', `${previous}^{tree}`]) === tree) return previous;
  const sha = git(['commit-tree', tree, ...(previous ? ['-p', previous] : []), '-m', note]);
  git(['update-ref', ref(id), sha, previous || '0000000000000000000000000000000000000000']);
  return sha;
}
export function ensureStrategy(db: DatabaseSync, id: number) {
  const a = account(db, id);
  if (a.strategy_sha) {
    if (!head(id)) git(['update-ref', ref(id), a.strategy_sha]);
    releaseDir(a.strategy_sha);
    return a.strategy_sha;
  }
  const files = { 'account-profile.md': readFileSync(join(ROOT, 'prompts', 'account-profile.md'), 'utf8') };
  const sha = commit(id, files, `账号 ${id}：初始化策略`);
  db.prepare('UPDATE accounts SET strategy_sha=? WHERE id=?').run(sha, id);
  db.prepare("INSERT INTO strategy_audit(account_id,action,sha,note) VALUES(?,'publish',?,?)").run(
    id,
    sha,
    '初始化策略',
  );
  releaseDir(sha);
  return sha;
}
function draftDir(id: number) {
  const dir = join(DATA, 'drafts', String(id));
  mkdirSync(dir, { recursive: true });
  return dir;
}
function active(db: DatabaseSync, id: number) {
  return ensureStrategy(db, id);
}
export function strategy(db: DatabaseSync, id: number) {
  const sha = active(db, id);
  const files = filesAt(sha);
  const names = ['account-profile.md'];
  const drafts = Object.fromEntries(
    names.map((n) => {
      const path = join(draftDir(id), n);
      return [n, existsSync(path) ? readFileSync(path, 'utf8') : files[n]];
    }),
  );
  const baseFile = join(draftDir(id), 'base.txt');
  const base = existsSync(baseFile) ? readFileSync(baseFile, 'utf8') : sha;
  const history = db
    .prepare(`SELECT action,sha,note,ts FROM strategy_audit WHERE account_id=? ORDER BY id DESC LIMIT 40`)
    .all(id);
  return {
    sha,
    base_sha: base,
    published: Object.fromEntries(names.map((n) => [n, files[n]])),
    draft: drafts,
    history,
  };
}
function checkBase(db: DatabaseSync, id: number, base: unknown) {
  if (base !== active(db, id)) throw new InputError('生效版本已改变，请重新加载后编辑', 409);
}
export function saveDraft(db: DatabaseSync, id: number, docs: unknown, base: unknown) {
  checkBase(db, id, base);
  const allowed = ['account-profile.md'];
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) throw new InputError('策略正文无效');
  if (
    Object.keys(docs).length !== allowed.length ||
    Object.keys(docs).some((name) => !allowed.includes(name))
  )
    throw new InputError('包含不支持的文件');
  for (const n of allowed) {
    const text = (docs as Record<string, unknown>)[n];
    if (typeof text !== 'string' || !text.trim() || text.length > 50000)
      throw new InputError(`${n} 须为 1–50000 字`);
  }
  for (const n of allowed) atomic(join(draftDir(id), n), (docs as Record<string, string>)[n]);
  atomic(join(draftDir(id), 'base.txt'), String(base));
  return strategy(db, id);
}
function activate(db: DatabaseSync, id: number, files: Record<string, string>, note: unknown) {
  if (typeof note !== 'string' || !note.trim() || note.length > 500)
    throw new InputError('请填写改动说明（最多 500 字）');
  const sha = commit(id, files, note.trim());
  releaseDir(sha);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE accounts SET strategy_sha=? WHERE id=?').run(sha, id);
    db.prepare("INSERT INTO strategy_audit(account_id,action,sha,note) VALUES(?,'publish',?,?)").run(
      id || null,
      sha,
      note.trim(),
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  atomic(join(draftDir(id), 'base.txt'), sha);
  return strategy(db, id);
}
export function publish(db: DatabaseSync, id: number, base: unknown, note: unknown) {
  checkBase(db, id, base);
  const state = strategy(db, id);
  if (state.base_sha !== state.sha) throw new InputError('草稿基于旧版本，请先重新加载当前版本', 409);
  return activate(db, id, { ...filesAt(state.sha), ...state.draft }, note);
}
export function rollback(db: DatabaseSync, id: number, sha: unknown, base: unknown) {
  checkBase(db, id, base);
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new InputError('历史版本无效');
  const known = db.prepare(`SELECT 1 FROM strategy_audit WHERE account_id=? AND sha=?`).get(id, sha);
  if (!known) throw new InputError('不能使用其他账号的版本', 404);
  const target = filesAt(sha);
  if (!target['account-profile.md']) throw new InputError('该版本不包含账号画像，无法恢复', 409);
  const files = { ...filesAt(active(db, id)), 'account-profile.md': target['account-profile.md'] };
  // 回滚也生成新提交，历史链不倒退，旧任务的快照仍然可用。
  const restored = commit(id, files, `回滚至 ${sha.slice(0, 8)}`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE accounts SET strategy_sha=? WHERE id=?').run(restored, id);
    db.prepare("INSERT INTO strategy_audit(account_id,action,sha,note) VALUES(?,'rollback',?,?)").run(
      id || null,
      restored,
      `回滚至 ${sha.slice(0, 8)}`,
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  releaseDir(restored);
  for (const [n, value] of Object.entries(files))
    if (n === 'account-profile.md') atomic(join(draftDir(id), n), value);
  atomic(join(draftDir(id), 'base.txt'), restored);
  return strategy(db, id);
}
export function context(db: DatabaseSync, id: number, sha?: string | null) {
  const a = account(db, id);
  const version = sha || ensureStrategy(db, id);
  if (!db.prepare('SELECT 1 FROM strategy_audit WHERE account_id=? AND sha=?').get(id, version))
    throw new InputError('策略版本不属于当前账号', 404);
  const dir = releaseDir(version);
  return { account_id: id, account_name: a.name, strategy_sha: version, strategy_dir: dir };
}
