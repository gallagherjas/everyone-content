import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api';
import { Msg } from './Common';
import { useInvalidatePages, usePageVisible } from './PageCache';

interface State { status: string; configured: boolean; message: string }
export default function IndexAuthorization({ disabled }: { disabled: boolean }) {
  const api = useApi(), visible = usePageVisible(), invalidate = useInvalidatePages();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const running = state?.status === 'preparing' || state?.status === 'waiting';
  const load = useCallback(() => api<State>('/api/index-auth').then(setState).catch(value => setError(String(value))), [api]);
  useEffect(() => { if (visible) void load(); }, [visible, load]);
  useEffect(() => {
    if (!visible || !running) return;
    const timer = setInterval(() => {
      api<State>('/api/index-auth').then(value => {
        setState(value);
        if (value.status === 'configured') invalidate();
      }).catch(value => setError(String(value)));
    }, 1000);
    return () => clearInterval(timer);
  }, [api, visible, running, invalidate]);
  const action = async (path: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try { setState(await api<State>(path, { method: 'POST' })); }
    catch (value) { setError(String(value)); }
    finally { setBusy(false); }
  };
  return <section className="panel space-y-4">
    <h2 className="font-display text-xl">连接抖音指数</h2>
    <p className="text-sm leading-6 text-muted">打开专用抖音登录窗口，扫码并按页面提示完成验证。登录会话自动保存在本机，并绑定当前账号。</p>
    <p className="text-sm" aria-label="指数登录状态">{state?.message ?? '正在检查连接状态…'}</p>
    <div className="flex flex-wrap gap-3">
      <button className="btn-primary" disabled={disabled || busy || running || !state}
        onClick={() => action('/api/index-auth/start')}>{state?.configured ? '重新登录' : '扫码连接抖音指数'}</button>
      {running && <button className="btn" disabled={busy} onClick={() => action('/api/index-auth/cancel')}>取消登录</button>}
    </div>
    {error && <Msg tone="error">{error}</Msg>}
  </section>;
}
