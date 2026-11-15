import { useEffect, useState, type ReactNode } from "react";
import { INDEX_SCOPES, PLATFORM_PROVIDERS, type ScheduleScope } from "../../../lib/collection-schedule";
import { useApi } from "../api";
import { collectionNames } from "../labels";
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

interface ActiveRun { scope: ScheduleScope; id: number | null; percent: number }
interface RunResult { scope: ScheduleScope; message: string; failed: boolean }
interface Progress { running: boolean; progress: number | null; status: string | null }
function useManualCollection() {
  const api = useApi(), invalidate = useInvalidatePages();
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const id = active?.id, scope = active?.scope;

  useEffect(() => {
    if (!id || !scope) return;
    let live = true;
    const poll = () => api<Progress>(`/api/collection/progress?run_id=${id}`).then(progress => {
      if (!live) return;
      if (progress.running) {
        setActive({ scope, id, percent: progress.progress ?? 0 });
        return;
      }
      live = false;
      const status = progress.status ?? "";
      setActive(null);
      setResult({ scope, failed: status === "partial" || status === "failed",
        message: OUTCOME[status] ?? "采集已结束，请查看「采集 → 日志」。" });
      invalidate();
    }).catch(() => {});
    void poll();
    const timer = setInterval(poll, 1500);
    return () => { live = false; clearInterval(timer); };
  }, [api, id, scope, invalidate]);

  const start = async (scope: ScheduleScope) => {
    if (active) return;
    setResult(null);
    setActive({ scope, id: null, percent: 0 });
    try {
      const { run_id } = await api<{ run_id: number }>("/api/run/collect", { method: "POST", body: JSON.stringify({ only: scope }) });
      setActive({ scope, id: run_id, percent: 0 });
    } catch (error) {
      setActive(null);
      setResult({ scope, message: String(error), failed: true });
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
      {active?.scope === scope ? `采集中 ${active.percent}%` : "手动采集"}
    </button>
    {result?.scope === scope && <p role={result.failed ? "alert" : "status"}
      className={`w-full text-xs ${result.failed ? "text-danger" : "text-muted"}`}>{result.message}</p>}
  </CollectionRow>;
}

export function CollectionRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5">
    <h4 className="min-w-24 flex-1 text-sm font-medium">{label}</h4>
    {children}
  </div>;
}

export default function CollectionControls({ archived, credentials, hasKeywords, hasBloggers }: {
  archived: boolean; credentials?: Record<string, boolean>; hasKeywords: boolean; hasBloggers: boolean;
}) {
  const run = useManualCollection(), connected = !!credentials?.index;
  const scopes = PLATFORM_PROVIDERS.filter(provider => credentials?.[provider]);
  const grid = "grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3";

  return <div className="mt-5 space-y-5 border-t border-line pt-5">
    <div className="space-y-2">
      <h3 className="text-base font-semibold">抖音指数采集</h3>
      {credentials && !connected && <p className="text-sm text-muted">请先到「采集 → 连接」连接抖音指数。</p>}
      <div className={grid}>
        {INDEX_SCOPES.map(scope => <ManualCollect key={scope} scope={scope} run={run}
          disabled={archived || !connected || !(scope === "author" ? hasBloggers : hasKeywords)} />)}
      </div>
    </div>
    {!!scopes.length && <div className="space-y-2 border-t border-line pt-4">
      <h3 className="text-base font-semibold">创作后台</h3>
      <div className={grid}>
        {scopes.map(scope => <ManualCollect key={scope} scope={scope} run={run} disabled={archived} />)}
      </div>
    </div>}
  </div>;
}
