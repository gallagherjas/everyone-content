import { useEffect, useState, type ReactNode } from "react";
import { AUTH_ERROR, INDEX_SCOPES, PLATFORM_PROVIDERS, type CollectionProvider, type ScheduleScope } from "../../../lib/collection-schedule";
import { useApi } from "../api";
import { collectionNames, reason } from "../labels";
import { useInvalidatePages } from "./PageCache";

const OUTCOME: Record<string, string> = {
  done: "采集完成，结果已更新。",
  partial: "本轮部分采集失败，请查看「采集 → 日志」。",
  failed: "本轮采集失败，请查看「采集 → 日志」。",
  done_with_deferred: "已有结果更新，部分任务延后。",
  deferred: "本轮采集延后，请查看「采集 → 日志」。",
  cached: "本轮复用已有结果。",
  empty: "本轮没有可执行的采集任务。",
};

type RunTarget = ScheduleScope | number;
interface ActiveRun { target: RunTarget; id: number | null; percent: number }
interface RunResult { target: RunTarget; message: string; failed: boolean }
interface Progress { running: boolean; progress: number | null; status: string | null }
export function useManualCollection() {
  const api = useApi(), invalidate = useInvalidatePages();
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const id = active?.id, target = active?.target;

  useEffect(() => {
    if (!id || target === undefined) return;
    let live = true;
    const poll = () => api<Progress>(`/api/collection/progress?run_id=${id}`).then(progress => {
      if (!live) return;
      if (progress.running) {
        setActive({ target, id, percent: progress.progress ?? 0 });
        return;
      }
      live = false;
      const status = progress.status ?? "";
      setActive(null);
      setResult({ target, failed: status === "partial" || status === "failed",
        message: OUTCOME[status] ?? "采集已结束，请查看「采集 → 日志」。" });
      invalidate();
    }).catch(() => {});
    void poll();
    const timer = setInterval(poll, 1500);
    return () => { live = false; clearInterval(timer); };
  }, [api, id, target, invalidate]);

  const start = async (target: RunTarget) => {
    if (active) return;
    setResult(null);
    setActive({ target, id: null, percent: 0 });
    try {
      const { run_id } = await (typeof target === "number"
        ? api<{ run_id: number }>(`/api/collection/records/${target}/retry`, { method: "POST" })
        : api<{ run_id: number }>("/api/run/collect", {
          method: "POST", body: JSON.stringify({ only: target }),
        }));
      setActive({ target, id: run_id, percent: 0 });
    } catch (error) {
      setActive(null);
      setResult({ target, message: String(error), failed: true });
      invalidate();
    }
  };
  return { active, result, start };
}

function ManualCollect({ scope, disabled, run }: {
  scope: ScheduleScope; disabled: boolean; run: ReturnType<typeof useManualCollection>;
}) {
  const { active, result, start } = run;
  return <CollectionRow label={collectionNames[scope]}>
    <button type="button" className="btn-primary shrink-0" disabled={disabled || !!active}
      aria-label={`手动采集${collectionNames[scope]}`} onClick={() => void start(scope)}>
      {active?.target === scope ? `采集中 ${active.percent}%` : "手动采集"}
    </button>
    <CollectionRunResult result={result} target={scope} />
  </CollectionRow>;
}

export function CollectionRunResult({ result, target }: { result: RunResult | null; target: RunTarget }) {
  return result?.target === target && <p role={result.failed ? "alert" : "status"}
    className={`w-full text-xs ${result.failed ? "text-danger" : "text-muted"}`}>{result.message}</p>;
}

export function CollectionRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5">
    <h4 className="min-w-24 flex-1 text-sm font-medium">{label}</h4>
    {children}
  </div>;
}

export function SourceBlocker({ error, disabled, onConnect, onResume }: {
  error: string; disabled: boolean; onConnect: () => void; onResume: () => void;
}) {
  const needsConnection = AUTH_ERROR.test(error);
  return <div className="flex items-center gap-2 text-xs text-muted">
    <span>{reason(error)}</span>
    <button className="btn shrink-0" disabled={!needsConnection && disabled} onClick={needsConnection ? onConnect : onResume}>
      {needsConnection ? "连接设置" : "恢复采集"}
    </button>
  </div>;
}

export default function CollectionControls({ archived, credentials, blockers, hasKeywords, hasBloggers, run, onConnect, onResume }: {
  archived: boolean; credentials?: Record<string, boolean>; blockers?: Record<CollectionProvider, string | null>;
  hasKeywords: boolean; hasBloggers: boolean; run: ReturnType<typeof useManualCollection>;
  onConnect: () => void; onResume: (provider: CollectionProvider) => void;
}) {
  const scopes = PLATFORM_PROVIDERS.filter(provider => credentials?.[provider]);
  const grid = "grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3";
  const blocked = (provider: CollectionProvider) => {
    const error = blockers?.[provider];
    return error && <SourceBlocker error={error} disabled={archived || !!run.active} onConnect={onConnect} onResume={() => onResume(provider)} />;
  };

  return <div className="mt-5 space-y-5 border-t border-line pt-5">
    <div className="space-y-2">
      <h3 className="text-base font-semibold">抖音指数采集</h3>
      {blocked('index')}
      <div className={grid}>
        {INDEX_SCOPES.map(scope => <ManualCollect key={scope} scope={scope} run={run}
          disabled={archived || blockers?.index !== null || !(scope === "author" ? hasBloggers : hasKeywords)} />)}
      </div>
    </div>
    {!!scopes.length && <div className="space-y-2 border-t border-line pt-4">
      <h3 className="text-base font-semibold">创作后台</h3>
      <div className={grid}>
        {scopes.map(scope => <div className="space-y-2" key={scope}>
          <ManualCollect scope={scope} run={run} disabled={archived || blockers?.[scope] !== null} />
          {blocked(scope)}
        </div>)}
      </div>
    </div>}
  </div>;
}
