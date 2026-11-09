import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DATA } from './strategies.ts';
import { type Account } from './accounts.ts';

export function lock(task: string) {
  mkdirSync(DATA, { recursive: true });
  const path = join(DATA, `${task}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(path);
      writeFileSync(join(path, 'pid'), String(process.pid));
      return () => rmSync(path, { recursive: true, force: true });
    } catch (error) {
      let pid = 0;
      try {
        pid = Number(readFileSync(join(path, 'pid'), 'utf8'));
      } catch {
        throw new Error('采集锁正在初始化，请稍后重试');
      }
      try {
        process.kill(pid, 0);
      } catch {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      throw new Error(`同类任务已在运行 (${task})`);
    }
  }
  throw new Error('无法取得任务锁');
}
export async function withTask(
  db: DatabaseSync,
  a: Account,
  task: string,
  fn: (log: (text: string) => void) => Promise<void | 'partial'>,
) {
  const existing = Number(process.env.EVERYONE_CONTENT_RUN_ID);
  const id =
    existing ||
    Number(db.prepare('INSERT INTO task_runs(account_id,task) VALUES(?,?)').run(a.id, task).lastInsertRowid);
  db.prepare('UPDATE task_runs SET pid=? WHERE id=? AND account_id=?').run(process.pid, id, a.id);
  const log = (text: string) => {
    console.log(`[${a.name}] ${text}`);
    db.prepare('UPDATE task_runs SET log=substr(log || ?,-60000) WHERE id=? AND account_id=?').run(
      `${text}\n`,
      id,
      a.id,
    );
  };
  try {
    const result = await fn(log);
    db.prepare("UPDATE task_runs SET status=?,finished_at=datetime('now') WHERE id=? AND account_id=?").run(
      result || 'done',
      id,
      a.id,
    );
  } catch (e) {
    log(`任务失败：${String(e).slice(0, 300)}`);
    db.prepare(
      "UPDATE task_runs SET status='failed',finished_at=datetime('now') WHERE id=? AND account_id=?",
    ).run(id, a.id);
    throw e;
  }
}
