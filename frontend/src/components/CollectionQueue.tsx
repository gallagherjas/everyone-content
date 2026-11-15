import { useState } from "react";
import type { CollectionTaskStatus } from "../../../collector/core/status";
import { fmtTime } from "../api";
import { names, operations, reason } from "../labels";
import { Badge, type BadgeTone } from "./Common";
import { CollectionRow } from "./CollectionControls";
import Pager, { usePaged } from "./Pager";

const statusLabel: Record<CollectionTaskStatus["status"], { label: string; tone: BadgeTone }> = {
  due: { label: "待执行", tone: "blue" },
  waiting: { label: "未到时间", tone: "gray" },
  running: { label: "执行中", tone: "warn" },
  paused: { label: "已暂停", tone: "warn" },
  disabled: { label: "已停用", tone: "danger" },
  archived: { label: "已归档", tone: "gray" },
};

export default function CollectionQueue({ tasks, counts, bloggerNames }: {
  tasks?: CollectionTaskStatus[]; counts?: { total: number; due: number }; bloggerNames: Map<string, string>;
}) {
  const [dueOnly, setDueOnly] = useState(false);
  const page = usePaged(dueOnly ? (tasks ?? []).filter(task => task.status === "due") : tasks ?? []);
  return <section className="panel space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">采集队列</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="队列筛选">
        {([["全部任务", false, counts?.total], ["待执行", true, counts?.due]] as const).map(([label, due, count]) =>
          <button key={label} type="button" aria-pressed={dueOnly === due} className={dueOnly === due ? "btn-primary" : "btn"}
            onClick={() => { setDueOnly(due); page.onChange(1); }}>{label} {count ?? "—"}</button>)}
      </div>
    </div>
    <p className="text-sm text-muted">周期任务成功后还会再次到期待执行。每轮结果见「采集 → 日志」，时间均为北京时间。</p>
    {!page.total && <p className="text-sm text-muted">{!tasks ? "正在读取队列…" : dueOnly ? "当前没有待执行任务。" : "当前帐号暂无排队任务。"}</p>}
    <div className="space-y-2">
      {page.slice.map(task => {
        const status = statusLabel[task.status];
        const window = task.operation === "videos" ? /^(.*)#(7|30)$/.exec(task.target) : null;
        const target = window ? `${window[1]} · 近${window[2]}天`
          : task.operation.startsWith("author_") ? bloggerNames.get(task.target) ?? task.target : task.target;
        const detail = reason(task.status === "paused" ? task.source_error : task.error);
        return <CollectionRow key={task.key} label={<>
          <span className="mr-2 text-xs font-normal text-muted">{names[task.provider] ?? task.provider}</span>
          {operations[task.operation] ?? task.operation}
          {target && target !== task.operation && <span className="ml-2 break-words font-normal">· {target}</span>}
        </>}>
          <span className="text-xs tabular-nums text-muted">
            {task.last_success_at == null ? "暂无成功记录" : `上次成功 ${fmtTime(task.last_success_at)}`}
          </span>
          <Badge tone={status.tone}>{status.label}</Badge>
          {detail && <p className="w-full text-xs text-muted">{detail}</p>}
        </CollectionRow>;
      })}
    </div>
    <Pager {...page} />
  </section>;
}
