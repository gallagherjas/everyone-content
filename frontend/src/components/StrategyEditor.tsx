import { useEffect, useState } from 'react';
import { useApi, fmtTime } from '../api';
import { ConfirmBtn, LinkBtn, Msg } from './Common';
import { profileCompletion, type ProfileCompletion } from '../../../lib/profile';
interface State {
  initialization: ProfileCompletion;
  sha: string;
  base_sha: string;
  draft: Record<string, string>;
  published: Record<string, string>;
  history: { sha: string; note: string; ts: string }[];
}
export default function StrategyEditor({ disabled = false }: { disabled?: boolean }) {
  const api = useApi();
  const [state, setState] = useState<State | null>(null),
    [body, setBody] = useState(''),
    [note, setNote] = useState(''),
    [compare, setCompare] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const apply = (value: State) => {
    setState(value);
    setBody(value.draft['account-profile.md'] || '');
  };
  useEffect(() => {
    api<State>('/api/strategy')
      .then(apply)
      .catch((e) => setMessage({ ok: false, text: String(e) }));
  }, []);
  const act = async (action: 'save' | 'publish' | 'rollback', sha?: string) => {
    if (!state || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (action === 'rollback')
        apply(
          await api<State>('/api/strategy/rollback', {
            method: 'POST',
            body: JSON.stringify({ sha, base_sha: state.sha }),
          }),
        );
      else {
        const draft = await api<State>('/api/strategy/draft', {
          method: 'PUT',
          body: JSON.stringify({ docs: { 'account-profile.md': body }, base_sha: state.sha }),
        });
        apply(
          action === 'save'
            ? draft
            : await api<State>('/api/strategy/publish', {
                method: 'POST',
                body: JSON.stringify({ base_sha: state.sha, note: note.trim() || '更新账号画像' }),
              }),
        );
      }
      setNote('');
      setMessage({ ok: true, text: action === 'save' ? '草稿已保存，尚未生效。' : '账号画像版本已保存。' });
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const stale = !!state && state.sha !== state.base_sha;
  const draftCompletion = profileCompletion(body);
  return (
    <div className="space-y-5">
      <section className="panel space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl">账号画像</h2>
          {state && <span className="text-xs text-muted">版本 {state.sha.slice(0, 8)}</span>}
        </div>
        {state && <p className="text-sm" aria-label="画像完整性">生效画像：{state.initialization?.initialized ? '完整' : '待补充'}</p>}
        {state && <p className="text-xs text-muted">{draftCompletion.initialized
          ? '当前编辑内容已填写完整。'
          : `当前编辑内容待补充：${draftCompletion.missing_sections.join('、')}。可先保存草稿。`}</p>}
        {stale && <Msg tone="error">草稿基于旧版本，请核对后重新加载。</Msg>}
        {state && (
          <>
            <textarea
              className="field min-h-80 leading-7"
              aria-label="账号画像正文"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={disabled || busy}
              spellCheck={false}
            />
            <LinkBtn onClick={() => setCompare(!compare)}>
              {compare ? '收起生效正文' : '查看生效正文'}
            </LinkBtn>
            {compare && <pre className="codebox">{state.published['account-profile.md']}</pre>}
            <input
              className="field"
              aria-label="改动说明"
              placeholder="改动说明（选填）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              disabled={disabled || busy}
            />
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={disabled || busy || stale} onClick={() => act('save')}>
                保存草稿
              </button>
              <button
                className="btn-primary"
                disabled={disabled || busy || stale}
                onClick={() => act('publish')}
              >
                保存并生效
              </button>
              <button
                className="btn"
                disabled={disabled || busy}
                onClick={() => {
                  setBody(state.published['account-profile.md']);
                  setState({ ...state, base_sha: state.sha });
                }}
              >
                恢复生效正文
              </button>
            </div>
          </>
        )}
        {message && <Msg tone={message.ok ? 'ok' : 'error'}>{message.text}</Msg>}
      </section>
      {state && (
        <section className="panel">
          <h2 className="font-display text-xl">版本历史</h2>
          <div className="mt-3 divide-y divide-line">
            {state.history.map((item, i) => (
              <div
                key={`${item.sha}-${i}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <span>
                  <span className="mr-3 font-mono text-xs text-brand">{item.sha.slice(0, 8)}</span>
                  {item.note}
                  <span className="ml-3 text-xs text-muted">{fmtTime(item.ts)}</span>
                </span>
                {item.sha !== state.sha && (
                  <ConfirmBtn
                    label="恢复此版本"
                    disabled={disabled || busy}
                    onConfirm={() => act('rollback', item.sha)}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
