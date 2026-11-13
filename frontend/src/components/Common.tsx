import { useEffect, useRef, useState, type ReactNode } from "react";

/** 空状态占位(各列表页共用) */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-card/60 px-6 py-16 text-center">
      <div className="text-2xl font-semibold text-muted">{title}</div>
      {hint && <div className="mt-2 text-sm text-muted">{hint}</div>}
    </div>
  );
}

/** 表格容器(各表格页共用) */
export function TableBox({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-line bg-card">{children}</div>;
}

/** 全局徽标:无边框浅底胶囊(视频榜/速览/状态共用),tone 取七种色相 */
const BADGE_TONES = {
  brand: "bg-brand/10 text-brand",
  blue: "bg-blue/10 text-blue",
  up: "bg-up/10 text-up",
  rose: "bg-rose/10 text-rose",
  violet: "bg-violet/10 text-violet",
  warn: "bg-warn/10 text-warn",
  danger: "bg-danger/10 text-danger",
  gray: "bg-ink/[0.06] text-muted",
};
export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ tone = "gray", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs leading-4 ${BADGE_TONES[tone]}`}>{children}</span>;
}

/** 悬浮提示:默认在上方显示带小角的面板,上方空间不足时翻到下方 */
export function HoverTip({ text, children }: { text: string; children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null), tipRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false), [below, setBelow] = useState(false);
  const enter = () => {
    const host = hostRef.current, tip = tipRef.current;
    if (host && tip) setBelow(host.getBoundingClientRect().top < tip.offsetHeight + 12);
    setShow(true);
  };
  return (
    <div className="relative" ref={hostRef} onMouseEnter={enter} onMouseLeave={() => setShow(false)}>
      {children}
      <div ref={tipRef} className={`pointer-events-none absolute left-0 z-50 w-max max-w-2xl rounded-lg border border-line bg-card p-3 text-xs leading-6 break-words whitespace-normal text-ink shadow-lg transition ${show ? "opacity-100" : "opacity-0"} ${below ? "top-full mt-2" : "bottom-full mb-2"}`}>
        {text}
        <span className={`absolute left-4 h-0 w-0 border-8 border-transparent ${below ? "-top-4 border-b-line" : "-bottom-4 border-t-line"}`} />
        <span className={`absolute left-[17px] h-0 w-0 border-[7px] border-transparent ${below ? "-top-[13px] border-b-card" : "-bottom-[13px] border-t-card"}`} />
      </div>
    </div>
  );
}

/** 筛选下拉:面板右上角的类型/口径筛选统一形态,选项为 [值, 文案] */
export function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[];
}) {
  return <select className="field field-caret w-auto py-1.5 text-xs" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
    {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </select>;
}

/** 行内提示:操作结果(ok)或错误(error),替代各页自绘的消息文案 */
export function Msg({ tone = "ok", children }: { tone?: "ok" | "error"; children: ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl px-4 py-2.5 text-sm ${tone === "ok" ? "bg-brand/10 text-brand-deep" : "bg-danger/10 text-danger"}`}>
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
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${checked ? "border-brand bg-brand" : "border-line bg-canvas"}`}>
        <span className={`absolute left-0.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-transform ${checked ? "translate-x-4 bg-white" : "bg-faint"}`} />
      </button>
      <span className="text-sm leading-6">{label}{hint && <span className="ml-2 text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}

/** 胶囊页签(顶部导航分段容器内):选中白底浮起,未选中弱化 */
export function PillTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition ${active ? "bg-card font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
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
        armed ? "border-danger/60 bg-danger/10 text-danger" : "border-line text-muted hover:border-brand hover:text-brand"
      }`}>
      {armed ? confirmLabel : label}
    </button>
  );
}
