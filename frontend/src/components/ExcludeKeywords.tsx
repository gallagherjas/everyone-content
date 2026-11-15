import { useEffect, useId, useState } from 'react';
import { useApi, type Account, type AccountConfig } from '../api';
import { Msg } from './Common';
import { useInvalidatePages } from './PageCache';

type IndexConfig = AccountConfig['index'];
export const wordKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export const words = (values: string[]) => [...new Map(values.map(value => value.trim().replace(/^#+/, '')).filter(Boolean).map(value => [wordKey(value), value])).values()];
export const splitWords = (value: string) => words(value.split(/[\n,，;；]/));

export default function ExcludeKeywords({ disabled }: { disabled: boolean }) {
  const api = useApi();
  const invalidate = useInvalidatePages();
  const id = useId();
  const [index, setIndex] = useState<IndexConfig | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    api<Account>('/api/collection/config').then(value => { if (live) setIndex(value.config.index); })
      .catch(error => { if (live) { setFailed(true); setMessage(String(error)); } });
    return () => { live = false; };
  }, [api]);
  const policy = index?.discovery ?? {};
  const excluded = Array.isArray(policy.excludeKeywords) ? policy.excludeKeywords as string[] : [];
  const blocked = disabled || busy || index === null;
  const apply = async (edit: (current: string[]) => string[]) => {
    if (blocked) return;
    setBusy(true); setFailed(false); setMessage('');
    try {
      const latest = await api<Account>('/api/collection/config');
      const discovery = latest.config.index.discovery ?? {};
      const current = Array.isArray(discovery.excludeKeywords) ? discovery.excludeKeywords as string[] : [];
      const value = await api<Account>('/api/collection/config', { method: 'PUT', body: JSON.stringify({ ...latest.config.index, discovery: { ...discovery, excludeKeywords: edit(current) } }) });
      setIndex(value.config.index); setInput('');
      invalidate(['collection']);
      setMessage('已保存并重新筛选。');
    } catch (error) { setFailed(true); setMessage(String(error)); }
    finally { setBusy(false); }
  };
  const add = () => {
    const next = splitWords(input);
    if (next.length) void apply(current => words([...current, ...next]));
  };
  return <div className="space-y-2 border-t border-line pt-5">
    <label className="block text-sm font-medium" htmlFor={id}>排除关键词<span className="ml-2 text-xs font-normal text-muted">{excluded.length} 个</span></label>
    <p className="text-xs leading-6 text-muted" id={`${id}-hint`}>话题名称、视频标题或标签命中任一词就排除。新增和删除立即生效并重新筛选。</p>
    <div className="flex gap-2">
      <input id={id} className="field min-w-0 flex-1" value={input} aria-label="新增排除关键词" aria-describedby={`${id}-hint`} placeholder="输入词语，回车添加；支持逗号分隔" disabled={blocked} onChange={event => { setInput(event.target.value); setMessage(''); }} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(); }
      }} />
      <button type="button" className="btn-primary shrink-0" aria-label="添加排除关键词" disabled={blocked || !splitWords(input).length} onClick={add}>添加</button>
    </div>
    <div className="flex flex-wrap gap-2">
      {excluded.map(word => <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-canvas pl-3 pr-1 text-sm" key={wordKey(word)}>
        <span className="break-all">{word}</span><button type="button" className="rounded-full px-2 py-1 text-muted hover:text-danger disabled:opacity-40" aria-label={`从排除关键词移除“${word}”`} disabled={blocked} onClick={() => void apply(current => current.filter(value => wordKey(value) !== wordKey(word)))}>×</button>
      </span>)}
      {!excluded.length && <p className="text-sm text-muted">尚未添加</p>}
    </div>
    {message && <Msg tone={failed ? 'error' : 'ok'}>{message}</Msg>}
  </div>;
}
