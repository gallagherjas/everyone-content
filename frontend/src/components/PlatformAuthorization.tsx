import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api';
import { Msg } from './Common';
import { useCachedLoad, useInvalidatePages, usePageVisible } from './PageCache';

interface AuthState { provider: string; label: string; status: string; configured: boolean; message: string; attempt_message?: string | null }
const PLATFORMS: { provider: string; label: string; hint: string }[] = [
  { provider: 'index', label: '抖音指数', hint: '按关键词发现话题、视频和达人指数。' },
  { provider: 'douyin', label: '抖音创作后台', hint: '采集账号粉丝和获赞快照。' },
  { provider: 'xhs', label: '小红书创作服务', hint: '采集账号粉丝和获赞快照。' },
  { provider: 'bili', label: 'B站创作中心', hint: '连接后需通过实采验证数据读取。' },
];
const connecting = (status?: string) => status === 'preparing' || status === 'waiting';

/** 采集设置的平台连接:每个平台独立扫码,会话保存在本机并绑定当前账号。 */
export default function PlatformAuthorization({ disabled }: { disabled: boolean }) {
  const api = useApi(), visible = usePageVisible(), invalidate = useInvalidatePages();
  const [states, setStates] = useState<AuthState[]>([]);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const load = useCallback(() => {
    Promise.all(PLATFORMS.map(p => api<AuthState>(`/api/auth/${p.provider}`)))
      .then(all => setStates(all))
      .catch(value => setError(String(value)));
  }, [api]);
  useCachedLoad('collection', load);
  const anyRunning = states.some(s => connecting(s.status));
  useEffect(() => {
    if (!visible || !anyRunning) return;
    const timer = setInterval(() => {
      Promise.all(PLATFORMS.map(p => api<AuthState>(`/api/auth/${p.provider}`))).then(all => {
        setStates(all);
        if (!all.some(s => connecting(s.status))) invalidate();
      }).catch(value => setError(String(value)));
    }, 1000);
    return () => clearInterval(timer);
  }, [api, visible, anyRunning, invalidate]);
  const action = async (provider: string, path: string) => {
    if (busy) return;
    setBusy(provider); setError('');
    try {
      const state = await api<AuthState>(`/api/auth/${provider}/${path}`, { method: 'POST' });
      setStates(list => list.map(s => s.provider === provider ? state : s));
    } catch (value) { setError(String(value)); }
    finally { setBusy(''); }
  };
  return <div className="space-y-5">
    <h3 className="text-lg font-semibold">连接平台</h3>
    <p className="text-sm leading-6 text-muted">打开专用登录窗口，扫码并按页面提示完成验证。登录会话自动保存在本机，按平台分别绑定当前账号。</p>
    <div className="space-y-3">
      {PLATFORMS.map(p => {
        const state = states.find(s => s.provider === p.provider);
        return <div key={p.provider} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 bg-canvas px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm">{p.label}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted">{p.hint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted" aria-label={`${p.label}登录状态`}>{state?.message ?? '正在检查连接状态…'}</span>
            {state?.attempt_message && <span className="text-xs text-warn">{state.attempt_message}</span>}
            {connecting(state?.status)
              ? <button className="btn" disabled={busy !== ''} onClick={() => action(p.provider, 'cancel')}>取消登录</button>
              : <button className="btn-primary" disabled={disabled || busy !== '' || !state} onClick={() => action(p.provider, 'start')}>{state?.configured ? '重新登录' : '扫码连接'}</button>}
          </div>
        </div>;
      })}
    </div>
    {error && <Msg tone="error">{error}</Msg>}
  </div>;
}
