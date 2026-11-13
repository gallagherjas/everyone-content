import { useEffect, useState } from 'react';
import { useApi, type Account } from '../api';
import { Msg } from './Common';

interface Corpus { preferences: string; originals: string }

/** 写作语料：本账号的写作偏好与原稿合集，与 runtime/writing/<账号>/ 下文件同源，保存即写回。 */
export default function WritingCorpusEditor({ account }: { account: Account }) {
  const api = useApi();
  const [draft, setDraft] = useState<Corpus>({ preferences: '', originals: '' });
  const [saved, setSaved] = useState<Corpus | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<Corpus>('/api/writing').then(value => { if (live) { setDraft(value); setSaved(value); } })
      .catch(error => { if (live) { setFailed(true); setMessage(String(error)); } });
    return () => { live = false; };
  }, [api]);
  const disabled = account.status === 'archived' || busy || saved === null;
  const dirty = saved !== null && (draft.preferences !== saved.preferences || draft.originals !== saved.originals);
  const pieces = (draft.originals.match(/^## /gm) ?? []).length;
  const save = async () => {
    if (disabled || !dirty) return;
    setBusy(true); setFailed(false); setMessage('');
    try {
      const value = await api<Corpus>('/api/writing', { method: 'PUT', body: JSON.stringify(draft) });
      setDraft(value); setSaved(value); setMessage('已保存，本账号写稿即按此资料为准。');
    } catch (error) { setFailed(true); setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return <section className="panel space-y-5">
    <h2 className="font-display text-xl">写作语料</h2>
    <p className="text-sm leading-6 text-muted">本账号的写作偏好与本人原稿，写稿时以此为准；偏好只作补充，不能替代3篇本人原稿的门槛。原稿最多20篇、正文合计不超过20000字，满额后最早的整篇淘汰。</p>
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="writing-preferences">写作偏好<span className="ml-2 text-xs font-normal text-muted">preferences.md</span></label>
      <textarea id="writing-preferences" className="field min-h-40 leading-7" aria-label="写作偏好正文" value={draft.preferences} disabled={disabled} spellCheck={false}
        onChange={e => { setDraft(current => ({ ...current, preferences: e.target.value })); setMessage(''); }} />
    </div>
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="writing-originals">原稿合集<span className="ml-2 text-xs font-normal text-muted">originals.md · {pieces} 篇 · 约 {draft.originals.length} 字（含标题与格式）</span></label>
      <textarea id="writing-originals" className="field min-h-80 leading-7" aria-label="原稿合集正文" value={draft.originals} disabled={disabled} spellCheck={false}
        onChange={e => { setDraft(current => ({ ...current, originals: e.target.value })); setMessage(''); }} />
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-primary" disabled={disabled || !dirty} onClick={save}>{busy ? '保存中…' : '保存语料'}</button>
      <button type="button" className="btn" disabled={disabled || !dirty} onClick={() => { if (saved) setDraft(saved); setMessage(''); }}>取消修改</button>
      <span className="text-xs text-muted">{saved === null ? '正在加载语料' : dirty ? '有未保存修改' : '已保存'} · 每篇以「## 」开头便于统计</span>
    </div>
    {message && <Msg tone={failed ? 'error' : 'ok'}>{message}</Msg>}
  </section>;
}
