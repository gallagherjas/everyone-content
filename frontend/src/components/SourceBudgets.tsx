import { names } from '../labels';

export interface Budget { provider: string; daily_limit: number; used: number }
/** 每日采集次数上限只读卡片组：采集页内嵌展示。编辑入口在设置页「采集时间与次数」，失焦即保存。 */
export function BudgetGrid({ budgets }: { budgets: Budget[] | undefined }) {
  return <div className="grid gap-3">{budgets?.map(b => (
    <div className="rounded-xl border border-line p-4" key={b.provider}>
      <div className="text-sm">{names[b.provider]}</div>
      <div className="mt-2 text-xl">{b.used} / {b.daily_limit}</div>
      <p className="mt-1 text-xs text-muted">每日采集次数上限，跨账号共用；每天北京时间08:00重置</p>
    </div>
  ))}</div>;
}
