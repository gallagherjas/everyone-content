import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi, type Account } from '../api';
import { INDEX_SCOPES, PLATFORM_PROVIDERS, providerForSchedule, type CollectionProvider, type CollectionSchedule as Schedule, type ScheduleScope } from '../../../lib/collection-schedule';
import { collectionNames, names } from '../labels';
import { CollectionRow } from './CollectionControls';
import { Msg, Toggle } from './Common';

export interface Budget { provider: string; daily_limit: number; used: number }

function TimeSelect({ name, times, disabled, onChange }: {
  name: string; times: string[]; disabled: boolean; onChange: (times: string[]) => void;
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
  const canAdd = !!draft && !times.includes(draft) && times.length < 24;
  const add = () => {
    if (!canAdd) return;
    onChange([...times, draft].sort());
    setDraft('');
  };
  return <div className="relative shrink-0" ref={ref}>
    <button type="button" className="field field-caret flex w-32 items-center text-left" disabled={disabled}
      aria-label={`${name}运行时间`} aria-expanded={open} title={times.join('、')} onClick={() => setOpen(value => !value)}>
      {times.length === 1 ? times[0] : `${times.length} 个时间`}
    </button>
    {open && <div className="absolute right-0 z-10 mt-2 w-52 rounded-xl border border-line bg-card p-2 shadow-lg">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <input type="time" step={60} className="field w-24" aria-label={`新增${name}运行时间`} value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} />
        <button type="button" className="btn-sm shrink-0" disabled={!canAdd} onClick={add}>＋ 添加</button>
      </div>
      <div className="max-h-44 overflow-auto pt-1">
        {times.map(time => <div key={time} className="flex items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-canvas">
          <span>{time}</span>
          <button type="button" aria-label={`移除${name}运行时间${time}`} title={times.length === 1 ? '至少保留一个运行时间' : undefined}
            className="rounded-full px-2 text-muted transition hover:text-danger disabled:opacity-40"
            disabled={times.length === 1} onClick={() => onChange(times.filter(value => value !== time))}>×</button>
        </div>)}
      </div>
    </div>}
  </div>;
}

export default function CollectionSchedule({ account, onSaved, budgets, credentials }: {
  account: Account; onSaved: (account: Account) => void; budgets?: Budget[]; credentials?: Record<string, boolean>;
}) {
  const api = useApi();
  const [draft, setDraft] = useState<Partial<Record<ScheduleScope, Schedule>>>({});
  const [limitDrafts, setLimitDrafts] = useState<Partial<Record<CollectionProvider, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const disabled = account.status === 'archived' || saving;
  const saved = account.config.schedules;
  const indexScopes: ScheduleScope[] = [...INDEX_SCOPES, ...(saved.index.enabled ? ['index'] as const : [])];
  const changes = Object.fromEntries([...indexScopes, ...PLATFORM_PROVIDERS]
    .filter(scope => draft[scope] && JSON.stringify(draft[scope]) !== JSON.stringify(saved[scope]))
    .map(scope => [scope, draft[scope]]));
  const dirty = Object.keys(changes).length > 0;
  const change = (scope: ScheduleScope, patch: Partial<Schedule>) => {
    setDraft(current => ({ ...current, [scope]: { ...(current[scope] ?? saved[scope]), ...patch } }));
    setMessage(null);
  };
  const commitLimit = (provider: CollectionProvider, budget?: Budget) => {
    const value = Number(limitDrafts[provider]);
    setLimitDrafts(current => { const { [provider]: _, ...rest } = current; return rest; });
    if (disabled || !budget || !Number.isInteger(value) || value < 1 || value > 10000 || value === budget.daily_limit) return;
    api('/api/collection/limits', { method: 'PUT', body: JSON.stringify({ provider, daily_limit: value }) })
      .then(() => setMessage({ text: '每日上限已更新。', failed: false }))
      .catch(error => setMessage({ text: String(error), failed: true }));
  };
  const dailyLimit = (provider: CollectionProvider) => {
    const budget = budgets?.find(b => b.provider === provider);
    return <label className="flex shrink-0 items-center gap-2 text-sm">
      <span className="text-xs text-muted">已用 {budget?.used ?? '—'}</span>
      <span>每日上限</span>
      <input type="number" min={1} max={10000} step={1} className="field mt-0 w-20"
        aria-label={`${names[provider]}每日采集次数上限`} disabled={!budget}
        value={limitDrafts[provider] ?? budget?.daily_limit ?? ''}
        onChange={event => setLimitDrafts(current => ({ ...current, [provider]: event.target.value }))}
        onBlur={() => commitLimit(provider, budget)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
    </label>;
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api<Account>('/api/collection/config', { method: 'PUT', body: JSON.stringify({ schedules: changes }) });
      onSaved(updated);
      setDraft({});
      setMessage({ text: '已保存定时设置。', failed: false });
    } catch (error) { setMessage({ text: String(error), failed: true }); }
    finally { setSaving(false); }
  };
  const scheduleRow = (scope: ScheduleScope) => {
    const label = scope === 'index' ? '原抖音指数合并' : collectionNames[scope];
    const provider = providerForSchedule(scope), schedule = draft[scope] ?? saved[scope];
    const connected = !!credentials?.[provider];
    return <CollectionRow key={scope} label={<>{label}{credentials && !connected && <span className="ml-2 text-xs font-normal text-muted">未连接</span>}</>}>
      <Toggle label={<><span className="sr-only">{label}</span>定时</>} checked={schedule.enabled}
        disabled={disabled || (!connected && !schedule.enabled)} onChange={enabled => change(scope, { enabled })} />
      <TimeSelect name={label} times={schedule.times} disabled={disabled} onChange={times => change(scope, { times })} />
      <label className="flex shrink-0 items-center gap-2 text-sm">
        <span>每轮上限</span>
        <input className="field mt-0 w-16" type="number" required min={1} max={10} step={1}
          aria-label={`${label}每轮请求上限`} value={schedule.request_limit}
          onChange={event => change(scope, { request_limit: Number(event.target.value) })} />
      </label>
      {provider !== 'index' && dailyLimit(provider)}
    </CollectionRow>;
  };
  return <form onSubmit={save} className="space-y-3">
    <p className="text-xs text-muted">运行时间为北京时间。每日额度按来源跨账号共用，08:00 重置。</p>
    <fieldset disabled={disabled} className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-base font-semibold">抖音指数采集</h3>
        <CollectionRow label="抖音指数共享额度">{dailyLimit('index')}</CollectionRow>
        {indexScopes.map(scheduleRow)}
      </div>
      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="text-base font-semibold">创作后台</h3>
        {PLATFORM_PROVIDERS.map(scheduleRow)}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary" disabled={!dirty}>{saving ? '保存中…' : '保存定时设置'}</button>
        <button type="button" className="btn" disabled={!dirty} onClick={() => { setDraft({}); setMessage(null); }}>取消修改</button>
      </div>
    </fieldset>
    {message && <Msg tone={message.failed ? 'error' : 'ok'}>{message.text}</Msg>}
  </form>;
}
