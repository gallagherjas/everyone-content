import type { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initializationOverview } from './initialization.ts';

const START = '<!-- everyone-content:initialization:start -->';
const END = '<!-- everyone-content:initialization:end -->';

// 只投影账号编号、完成状态和版本，不把用户正文或凭据变成项目指令。
export function syncAgentInitialization(db: DatabaseSync, file: string) {
  const rows = initializationOverview(db).accounts;
  const summary = rows.length ? rows.map(row => {
    const label = `账号 ${row.account_id}${row.status === 'archived' ? '（已归档）' : ''}`;
    return row.initialized ? `${label} 已完成七部分画像（strategy_sha=${row.strategy_sha}）` : `${label} 未完成画像`;
  }).join('；') : '尚未初始化';
  const block = `${START}\n初始化状态：${summary}。\n${END}`;
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const start = before.indexOf(START), end = before.indexOf(END);
    if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) return false;
    const after = start < 0 ? `${before.trimEnd()}\n\n${block}\n`
      : before.slice(0, start) + block + before.slice(end + END.length);
    if (after === before) return true;
    writeFileSync(temp, after, 'utf8'); renameSync(temp, file);
    return true;
  } catch { return false; }
  finally { try { rmSync(temp, { force: true }); } catch {} }
}
