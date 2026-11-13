import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi, type Account, type AccountConfig } from '../api';
import { COLLECTION_PROVIDERS, type CollectionProvider } from '../../../lib/collection-schedule';
import { Msg, Toggle } from './Common';
import { useCachedLoad } from './PageCache';
export interface Budget { provider: string; daily_limit: number; used: number }

/** 运行时间下拉：收起时固定大小，展开后首行添加、每行 × 删除 */
function TimeSelect({ name, times, disabled, onChange }: {
  name: string; times: string[]; disabled?: boolean; onChange: (times: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const add = () => { onChange([...times, draft]); setDraft(''); };
  return <div className="relative" ref={ref}>
    <button type="button" className="field field-caret flex w-32 items-center text-left" disabled={disabled}
      aria-label={`${name}运行时间`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>{times.length} 个时间</span>
    </button>
    {open && <div className="absolute z-10 mt-2 w-52 rounded-xl border border-line bg-card p-2 shadow-lg">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <input type="time" step={60} className="field w-24" aria-label={`新增${name}运行时间`} value={draft} onChange={event => setDraft(event.target.value)} />
        <button type="button" className="btn-sm shrink-0" disabled={!draft || times.includes(draft) || times.length >= 24} onClick={add}>＋ 添加</button>
      </div>
      <div className="max-h-44 overflow-auto pt-1">
        {[...times].sort().map(time => <div key={time} className="flex items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-paper">
          <span>{time}</span>
          <button type="button" aria-label={`移除${name}运行时间${time}`} title={times.length === 1 ? '至少保留一个运行时间；不想定时请关闭左侧开关' : undefined} className="rounded-full px-2 text-muted transition hover:text-clay disabled:opacity-40" disabled={times.length === 1} onClick={() => onChange(times.filter(value => value !== time))}>×</button>
        </div>)}
      </div>
    </div>}
  </div>;
}

const sources = {
  index: { name: '抖音指数', hint: '按关键词发现话题、视频和达人指数。' },
};
type Settings = Pick<AccountConfig, 'schedules'>;
const settingsOf = (account: Account): Settings => ({ schedules: account.config.schedules });

export default function CollectionSchedule({ account, onSaved }: { account: Account; onSaved: (account: Account) => void }) {
  const api = useApi();
  const [draft, setDraft] = useState(() => settingsOf(account));
  const [saved, setSaved] = useState<Settings | null>(null);
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<Account>('/api/collection/config').then(value => {
      if (live) { const settings = settingsOf(value); setDraft(settings); setSaved(settings); }
    }).catch(error => { if (live) { setFailed(true); setMessage(String(error)); } });
    return () => { live = false; };
  }, [api]);
  const loadBudgets = useCallback(() => api<{ budgets: Budget[] }>('/api/collection').then(s => setBudgets(s.budgets)).catch(() => {}), [api]);
  useCachedLoad('collection', loadBudgets);
  const disabled = account.status === 'archived' || busy || saved === null;
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const change = (provider: CollectionProvider, patch: Partial<AccountConfig['schedules'][CollectionProvider]>) => {
    setDraft(current => ({ ...current, schedules: { ...current.schedules, [provider]: { ...current.schedules[provider], ...patch } } }));
    setMessage('');
  };
  // 每日采集次数上限跨账号共用、独立接口：失焦即保存，不走下方保存按钮。
  const commitLimit = (provider: string) => {
    const budget = budgets?.find(b => b.provider === provider);
    const value = Number(limitDrafts[provider] ?? budget?.daily_limit);
    setLimitDrafts(current => { const { [provider]: _, ...rest } = current; return rest; });
    if (!budget || !Number.isInteger(value) || value < 1 || value > 10000 || value === budget.daily_limit) return;
    api('/api/collection/limits', { method: 'PUT', body: JSON.stringify({ provider, daily_limit: value }) })
      .then(() => { setFailed(false); setMessage('每日采集次数上限已更新，下一轮采集按新上限执行。'); return loadBudgets(); })
      .catch(error => { setFailed(true); setMessage(String(error)); });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (disabled || !dirty) return;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const value = await api<Account>('/api/collection/config', { method: 'PUT', body: JSON.stringify(draft) });
      const settings = settingsOf(value); setDraft(settings); setSaved(settings); onSaved(value);
      setMessage('已保存，开启的定时采集会按各自时间运行。');
    } catch (error) { setFailed(true); setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5 border-t border-line pt-6">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg">采集时间与次数</h3><span className="text-xs text-muted">{saved === null ? '正在加载设置' : dirty ? '有未保存修改' : '已保存'}</span></div>
    <p className="text-sm leading-6 text-muted">安排每天自动采集的时间与次数，关闭定时后仍可随时手动采集。每日采集次数上限跨账号共用，建议不超过30次/天。</p>
    <form onSubmit={save}>
      <fieldset disabled={disabled} className="space-y-4">
        {COLLECTION_PROVIDERS.map(provider => {
          const schedule = draft.schedules[provider], source = sources[provider];
          const budget = budgets?.find(b => b.provider === provider);
          return <div key={provider} className="space-y-4 rounded-xl border border-line bg-paper/40 p-4">
            <Toggle label={`${source.name}定时采集`} hint={source.hint} checked={schedule.enabled} disabled={disabled} onChange={enabled => change(provider, { enabled })} />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2"><span className="min-w-[7.5rem] shrink-0">运行时间</span><TimeSelect name={source.name} times={schedule.times} disabled={disabled} onChange={times => change(provider, { times })} /></div>
                <p className="text-xs leading-5 text-muted">点击展开，可增删运行时刻。</p>
              </div>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-2"><span className="min-w-[7.5rem] shrink-0">每日采集次数上限</span><input type="number" min={1} max={10000} step={1} className="field mt-0 w-20" aria-label={`${source.name}每日采集次数上限`} value={limitDrafts[provider] ?? String(budget?.daily_limit ?? '')} onChange={event => setLimitDrafts(current => ({ ...current, [provider]: event.target.value }))} onBlur={() => commitLimit(provider)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
                <p className="text-xs leading-5 text-muted">已用 {budget?.used ?? '—'} · 每天08:00重置，修改立即生效。</p>
              </div>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-2"><span className="min-w-[7.5rem] shrink-0">单次采集次数上限</span><input type="number" required min={1} max={10} step={1} className="field mt-0 w-20" value={schedule.request_limit} onChange={event => change(provider, { request_limit: Number(event.target.value) })} /></label>
                <p className="text-xs leading-5 text-muted">建议10次以下，不足的内容会在之后逐渐补全。</p>
              </div>
            </div>
          </div>;
        })}
        <p className="text-xs leading-6 text-muted">定时采集需要本机工作台服务运行。错过时间后仅补跑当天最近一次；达到每日采集次数上限后，本轮采集等待下一时间点。</p>
        <div className="flex flex-wrap gap-3"><button type="submit" className="btn-primary" disabled={disabled || !dirty}>{busy ? '保存中…' : '保存采集设置'}</button><button type="button" className="btn" disabled={disabled || !dirty} onClick={() => { if (saved) setDraft(saved); setMessage(''); }}>取消修改</button></div>
      </fieldset>
    </form>
    {message && <Msg tone={failed ? 'error' : 'ok'}>{message}</Msg>}
  </div>;
}
