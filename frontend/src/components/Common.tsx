import { useEffect, useState, type ReactNode } from "react";

/** 空状态占位(各列表页共用) */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-card/60 px-6 py-16 text-center">
      <div className="font-display text-2xl text-fade">{title}</div>
      {hint && <div className="mt-2 text-sm text-muted">{hint}</div>}
    </div>
  );
}

/** 表格容器(各表格页共用) */
export function TableBox({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-line bg-card">{children}</div>;
}

/** 状态徽章:success 通过 / amber 进行中 / clay 待处理 / fade 弱化 */
const TAG_TONES = {
  success: "border-brand/40 bg-brand/10 text-brand",
  amber: "border-amber/40 bg-amber/10 text-amber",
  clay: "border-clay/40 bg-clay/10 text-clay",
  fade: "border-line bg-paper text-fade",
};
export type Tone = keyof typeof TAG_TONES;

export function Tag({ tone = "fade", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs leading-4 ${TAG_TONES[tone]}`}>{children}</span>;
}

/** 行内提示:操作结果(ok)或错误(error),替代各页自绘的消息文案 */
export function Msg({ tone = "ok", children }: { tone?: "ok" | "error"; children: ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-2.5 text-sm ${tone === "ok" ? "border-brand/30 bg-brand/5 text-brand-deep" : "border-clay/40 bg-clay/5 text-clay"}`}>
      {children}
    </p>
  );
}

/** 主题开关(替代原生 checkbox) */
export function Toggle({ checked, onChange, disabled, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: ReactNode; hint?: string;
}) {
  return (
    <label className={`inline-flex items-start gap-2.5 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? "border-brand bg-brand" : "border-fade bg-paper"}`}>
        <span className={`absolute left-0.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-transform ${checked ? "translate-x-4 bg-paper" : "bg-fade"}`} />
      </button>
      <span className="text-sm leading-6">{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}

/** 胶囊页签(顶部导航/策略文档切换共用) */
export function PillTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition ${active ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>
      {children}
    </button>
  );
}

/** 文字链接按钮(展开/收起类交互) */
export function LinkBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="text-sm text-brand underline underline-offset-4 transition hover:text-brand-deep">{children}</button>;
}

/** 两步确认按钮:首击进入确认态,再击执行,3 秒未确认或失焦自动复原。替代原生 confirm() */
export function ConfirmBtn({ label, confirmLabel = "确认？", onConfirm, size = "sm", disabled }: {
  label: string; confirmLabel?: string; onConfirm: () => void; size?: "sm" | "md"; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const shape = size === "md" ? "rounded-xl border px-4 py-2 text-sm transition" : "rounded-full border px-3.5 py-1 text-xs transition";
  return (
    <button type="button" disabled={disabled} onBlur={() => setArmed(false)}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      className={`${shape} disabled:cursor-not-allowed disabled:opacity-40 ${
        armed ? "border-clay/60 bg-clay/10 text-clay" : "border-line text-muted hover:border-brand hover:text-brand"
      }`}>
      {armed ? confirmLabel : label}
    </button>
  );
}
