import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi, type Account, type AccountConfig } from '../api';
import { COLLECTION_PROVIDERS, type CollectionProvider } from '../../../lib/collection-schedule';
import { Msg, Toggle } from './Common';

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
    <button type="button" className="field flex w-36 items-center justify-between gap-2 text-left" disabled={disabled}
      aria-label={`${name}运行时间`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>{times.length} 个时间</span><span className="text-xs text-muted">▾</span>
    </button>
    {open && <div className="absolute z-10 mt-2 w-60 rounded-xl border border-line bg-card p-2 shadow-lg">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <input type="time" step={60} className="field w-28" aria-label={`新增${name}运行时间`} value={draft} onChange={event => setDraft(event.target.value)} />
        <button type="button" className="btn-sm shrink-0" disabled={!draft || times.includes(draft) || times.length >= 24} onClick={add}>＋ 添加</button>
      </div>
      <div className="max-h-44 overflow-auto pt-1">
        {[...times].sort().map(time => <div key={time} className="flex items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-paper">
          <span>{time}</span>
          <button type="button" aria-label={`移除${name}运行时间${time}`} className="rounded-full px-2 text-muted transition hover:text-clay disabled:opacity-40" disabled={times.length === 1} onClick={() => onChange(times.filter(value => value !== time))}>×</button>
        </div>)}
      </div>
    </div>}
  </div>;
}

const sources = {
  index: { name: '抖音指数', hint: '按关键词发现话题、视频和达人候选。' },
};
type Settings = Pick<AccountConfig, 'schedules'>;
const settingsOf = (account: Account): Settings => ({ schedules: account.config.schedules });

export default function CollectionSchedule({ account, onSaved }: { account: Account; onSaved: (account: Account) => void }) {
  const api = useApi();
  const [draft, setDraft] = useState(() => settingsOf(account));
  const [saved, setSaved] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<Account>('/api/collection/config').then(value => {
      if (live) { const settings = settingsOf(value); setDraft(settings); setSaved(settings); }
    }).catch(error => { if (live) { setFailed(true); setMessage(String(error)); } });
    return () => { live = false; };
  }, [api]);
  const disabled = account.status === 'archived' || busy || saved === null;
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const change = (provider: CollectionProvider, patch: Partial<AccountConfig['schedules'][CollectionProvider]>) => {
    setDraft(current => ({ ...current, schedules: { ...current.schedules, [provider]: { ...current.schedules[provider], ...patch } } }));
    setMessage('');
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
  return <section className="panel space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-xl">采集时间与参数</h2><span className="text-xs text-muted">{saved === null ? '正在加载设置' : dirty ? '有未保存修改' : '已保存'}</span></div>
    <p className="text-sm leading-6 text-muted">抖音指数每天可安排多个北京时间。关闭定时后，仍可随时手动采集。</p>
    <form onSubmit={save}>
      <fieldset disabled={disabled} className="space-y-6">
        {COLLECTION_PROVIDERS.map(provider => {
          const schedule = draft.schedules[provider], source = sources[provider];
          return <div key={provider} className="grid items-center gap-4 border-b border-line pb-6 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-8">
            <Toggle label={`${source.name}定时采集`} hint={source.hint} checked={schedule.enabled} disabled={disabled} onChange={enabled => change(provider, { enabled })} />
            <div className="space-y-2 text-sm"><span>运行时间</span><TimeSelect name={source.name} times={schedule.times} disabled={disabled} onChange={times => change(provider, { times })} /></div>
            <div className="space-y-2 text-sm"><label className="block">每轮采集次数<span className="ml-2 text-xs font-normal text-muted">建议1-10次</span><input type="number" required min={1} max={10} step={1} className="field w-24" value={schedule.request_limit} onChange={event => change(provider, { request_limit: Number(event.target.value) })} /></label></div>
          </div>;
        })}
        <p className="text-xs leading-6 text-muted">定时采集需要本机工作台服务运行。错过时间后，仅补跑当天最近一次；每次只运行已到期的指数任务。</p>
        <div className="flex flex-wrap gap-3"><button type="submit" className="btn-primary" disabled={disabled || !dirty}>{busy ? '保存中…' : '保存采集设置'}</button><button type="button" className="btn" disabled={disabled || !dirty} onClick={() => { if (saved) setDraft(saved); setMessage(''); }}>取消修改</button></div>
      </fieldset>
    </form>
    {message && <Msg tone={failed ? 'error' : 'ok'}>{message}</Msg>}
  </section>;
}
