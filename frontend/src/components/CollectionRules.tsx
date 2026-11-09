import { useEffect, useId, useState, type FormEvent } from 'react';
import { useApi, type Account, type AccountConfig } from '../api';
import { Msg } from './Common';

type IndexConfig = AccountConfig['index'];
const limits = [
  ['minTopicIndex', '近30天最低话题指数', 10000, 1, undefined],
  ['maxTopics', '最多保留话题', 3, 1, 5],
  ['minVideoLikes', '最低点赞数', 100, 100, undefined],
  ['maxVideos', '最多保留视频', 40, 1, 200],
  ['maxAuthors', '最多保留达人候选', 5, 1, 20],
] as const;
const wordKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const words = (values: string[]) => [...new Map(values.map(value => value.trim().replace(/^#+/, '')).filter(Boolean).map(value => [wordKey(value), value])).values()];
const splitWords = (value: string) => words(value.split(/[\n,，;；]/));
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

function KeywordEditor({ values, input, onInput, onAdd, onRemove }: {
  values: string[]; input: string;
  onInput: (value: string) => void; onAdd: () => void; onRemove: (word: string) => void;
}) {
  const id = useId();
  return <div className="space-y-2">
    <label className="block text-sm font-medium" htmlFor={id}>排除关键词<span className="ml-2 text-xs font-normal text-muted">{values.length} 个</span></label>
    <p className="text-xs leading-6 text-muted" id={`${id}-hint`}>话题名称、视频标题或标签命中任一词就排除。新增和删除后，点击下方保存生效。</p>
    <div className="flex flex-wrap gap-2">
      {values.map(word => <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-paper pl-3 pr-1 text-sm" key={wordKey(word)}>
        <span className="break-all">{word}</span><button type="button" className="rounded-full px-2 py-1 text-muted hover:text-clay disabled:opacity-40" aria-label={`从排除关键词移除“${word}”`} onClick={() => onRemove(word)}>×</button>
      </span>)}
      {!values.length && <span className="text-xs text-fade">尚未添加</span>}
    </div>
    <div className="flex gap-2">
      <input id={id} className="field min-w-0 flex-1" value={input} aria-describedby={`${id}-hint`} placeholder="输入词语，回车添加；支持逗号分隔" onChange={event => onInput(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onAdd(); }
      }} />
      <button type="button" className="btn shrink-0" disabled={!splitWords(input).length} onClick={onAdd}>添加</button>
    </div>
  </div>;
}

export default function CollectionRules({ account, onSaved }: { account: Account; onSaved: (account: Account) => Promise<void> }) {
  const api = useApi();
  const [draft, setDraft] = useState(() => draftOf(account.config.index));
  const [saved, setSaved] = useState<IndexConfig | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<Account>('/api/collection/config').then(value => {
      if (live) { const current = draftOf(value.config.index); setDraft(current); setSaved(current); }
    }).catch(error => { if (live) { setFailed(true); setMessage(String(error)); } });
    return () => { live = false; };
  }, [api]);
  const policy = draft.discovery ?? {};
  const dirty = saved !== null && (JSON.stringify(draft) !== JSON.stringify(saved) || !!input.trim());
  const disabled = account.status === 'archived' || busy || saved === null;
  const excluded = policy.excludeKeywords as string[];
  const change = (key: string, value: unknown) => { setDraft(current => ({ ...current, discovery: { ...current.discovery, [key]: value } })); setMessage(''); };
  const add = () => { change('excludeKeywords', words([...excluded, ...splitWords(input)])); setInput(''); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (disabled || !dirty) return;
    setBusy(true); setFailed(false); setMessage('');
    try {
      const index = { ...draft, discovery: { ...policy,
        excludeKeywords: words([...excluded, ...splitWords(input)]),
        ...Object.fromEntries(limits.map(([key]) => [key, Number(policy[key])])),
      } };
      const value = await api<Account>('/api/collection/config', { method: 'PUT', body: JSON.stringify(index) });
      const current = draftOf(value.config.index); setDraft(current); setSaved(current); setInput('');
      await onSaved(value); setMessage('已保存，现有数据已按新规则重新筛选。');
    } catch (error) { setFailed(true); setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return <section className="panel space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg">抖音指数筛选规则</h3><span className="text-xs text-muted">{account.name} · {saved === null ? '正在加载规则' : dirty ? '有未保存修改' : '已保存'}</span></div>
    <form onSubmit={save}>
      <fieldset disabled={disabled} className="space-y-6">
        <KeywordEditor values={excluded} input={input} onInput={value => { setInput(value); setMessage(''); }}
          onAdd={add} onRemove={word => change('excludeKeywords', excluded.filter(value => value !== word))} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{limits.map(([key, label, fallback, min, max]) => <label className="block text-sm" key={key}>{label}<input className="field" type="number" required step="1" min={min} max={max} value={String(policy[key] ?? fallback)} onChange={event => change(key, event.target.value)} /></label>)}</div>
        <div className="flex flex-wrap items-center gap-3"><button type="submit" className="btn-primary" disabled={disabled || !dirty}>{busy ? '保存并重新筛选中…' : '保存并重新筛选'}</button><button type="button" className="btn" disabled={disabled || !dirty} onClick={() => { if (saved) setDraft(saved); setInput(''); setMessage(''); }}>取消修改</button></div>
      </fieldset>
    </form>
    {message && <Msg tone={failed ? 'error' : 'ok'}>{message}</Msg>}
  </section>;
}
