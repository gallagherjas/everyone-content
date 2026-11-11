import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api';
import { names } from '../labels';
import { Msg } from './Common';
import { useCachedLoad } from './PageCache';

interface Budget { provider: string; daily_limit: number; used: number }
function BudgetCard({ b, onLimit }: { b: Budget; onLimit?: (provider: string, limit: number) => void }) {
  const [draft, setDraft] = useState(String(b.daily_limit));
  useEffect(() => { setDraft(String(b.daily_limit)); }, [b.daily_limit]);
  const commit = () => {
    const value = Number(draft);
    if (onLimit && Number.isInteger(value) && value >= 1 && value <= 10000 && value !== b.daily_limit) onLimit(b.provider, value);
    else setDraft(String(b.daily_limit));
  };
  return <div className="rounded-xl border border-line p-4">
    <div className="text-sm">{names[b.provider]}</div>
    <div className="mt-2 flex items-center gap-1 text-xl">{b.used} / {onLimit
      ? <input className="field mt-0 w-20 text-lg" type="number" min={1} max={10000} step={1} aria-label={`${names[b.provider]}每日额度`} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      : b.daily_limit}</div>
    <p className="mt-1 text-xs text-muted">来源总额度，跨账号共用；每天北京时间08:00重置</p>
  </div>;
}
/** 额度卡片组：采集页内嵌（只读）与设置页“来源额度”面板（可编辑）共用 */
export function BudgetGrid({ budgets, onLimit }: { budgets: Budget[] | undefined; onLimit?: (provider: string, limit: number) => void }) {
  return <div className="grid gap-3">{budgets?.map(b => <BudgetCard key={b.provider} b={b} onLimit={onLimit} />)}</div>;
}
/** 设置页独立面板：展示并调整各来源每日额度 */
export default function SourceBudgets() {
  const api = useApi();
  const [budgets, setBudgets] = useState<Budget[] | null>(null), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const load = useCallback(() => api<{ budgets: Budget[] }>('/api/collection').then(s => setBudgets(s.budgets)).catch(() => {}), [api]);
  useCachedLoad('collection', load);
  const save = (provider: string, daily_limit: number) => {
    setFailed(false); setMessage('');
    api('/api/collection/limits', { method: 'PUT', body: JSON.stringify({ provider, daily_limit }) })
      .then(() => { setMessage('额度已更新，下一轮采集按新额度执行。'); return load(); })
      .catch(e => { setFailed(true); setMessage(String(e)); });
  };
  return <section className="panel space-y-5">
    <h2 className="font-display text-xl">来源额度</h2>
    <p className="text-sm leading-6 text-muted">抖音指数每日请求额度跨账号共用，用于控制本地请求用量；到量后本轮采集等待下一时间点。额度设置过高可能触发账号风控，建议不超过30次/天。</p>
    <BudgetGrid budgets={budgets ?? undefined} onLimit={save} />
    {message && <Msg tone={failed ? 'error' : 'ok'}>{message}</Msg>}
  </section>;
}
