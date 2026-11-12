import { useEffect, useState, type FormEvent } from 'react';
import { useApi, type Account, type AccountConfig } from '../api';
import { Msg } from './Common';
import { words } from './ExcludeKeywords';

type IndexConfig = AccountConfig['index'];
const limits = [
  ['minTopicIndex', '话题指数下限（30天）', 10000, 1, undefined],
  ['minVideoLikes', '点赞数下限', 100, 100, undefined],
  ['maxTopics', '话题保留数', 3, 1, 5],
  ['maxVideos', '视频保留数', 40, 1, 200],
] as const;
function draftOf(index: IndexConfig): IndexConfig {
  const policy = index.discovery ?? {};
  return { ...index, discovery: {
    ...Object.fromEntries(limits.map(([key, , fallback]) => [key, policy[key] ?? fallback])),
    excludeKeywords: words([
      ...(Array.isArray(policy.excludeKeywords) ? policy.excludeKeywords as string[] : []),
      ...(Array.isArray(policy.excludeTags) ? policy.excludeTags as string[] : []),
    ]),
  } };
}

export default function CollectionRules({ account, onSaved }: { account: Account; onSaved: (account: Account) => Promise<void> }) {
  const api = useApi();
  const [draft, setDraft] = useState(() => draftOf(account.config.index));
  const [saved, setSaved] = useState<IndexConfig | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<Account>('/api/collection/config').then(value => {
      if (live) { setDraft(draftOf(value.config.index)); setSaved(value.config.index); }
    }).catch(error => { if (live) { setFailed(true); setMessage(String(error)); } });
    return () => { live = false; };
  }, [api]);
  const policy = draft.discovery ?? {};
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(draftOf(saved));
  const needsSave = dirty || saved?.discovery === null;
  const disabled = account.status === 'archived' || busy || saved === null;
  const change = (key: string, value: unknown) => { setDraft(current => ({ ...current, discovery: { ...current.discovery, [key]: value } })); setMessage(''); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (disabled || !needsSave) return;
    setBusy(true); setFailed(false); setMessage('');
    try {
      // 保存前重读最新配置再合并，避免覆盖「排除关键词」等其他面板刚保存的改动。
      const latest = await api<Account>('/api/collection/config').then(value => value.config.index);
      const index = { ...latest, discovery: { ...draftOf(latest).discovery, ...Object.fromEntries(limits.map(([key]) => [key, Number(policy[key])])) } };
      const value = await api<Account>('/api/collection/config', { method: 'PUT', body: JSON.stringify(index) });
      setDraft(draftOf(value.config.index)); setSaved(value.config.index);
      await onSaved(value); setMessage('已保存，现有数据已按新规则重新筛选。');
    } catch (error) { setFailed(true); setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5 border-t border-line pt-6">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg">筛选参数<span className="group relative ml-1.5 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line align-middle font-sans text-[10px] leading-none font-normal text-muted">?<span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 rounded-lg border border-line bg-card px-2.5 py-1 font-sans text-xs whitespace-nowrap text-muted opacity-0 shadow-lg transition group-hover:opacity-100">请在顶部导航处查看采集规则。</span></span></h3><span className="text-xs text-muted">{account.name} · {saved === null ? '正在加载规则' : dirty ? '有未保存修改' : saved.discovery === null ? '默认规则待保存' : '已保存'}</span></div>
    <form onSubmit={save}>
      <fieldset disabled={disabled} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{limits.map(([key, label, fallback, min, max]) => <label className="block text-sm" key={key}>{label}<input className="field" type="number" required step="1" min={min} max={max} value={String(policy[key] ?? fallback)} onChange={event => change(key, event.target.value)} /></label>)}</div>
        <div className="flex flex-wrap items-center gap-3"><button type="submit" className="btn-primary" disabled={disabled || !needsSave}>{busy ? '保存并重新筛选中…' : '保存并重新筛选'}</button><button type="button" className="btn" disabled={disabled || !dirty} onClick={() => { if (saved) setDraft(draftOf(saved)); setMessage(''); }}>取消修改</button></div>
      </fieldset>
    </form>
    {message && <Msg tone={failed ? 'error' : 'ok'}>{message}</Msg>}
  </div>;
}
