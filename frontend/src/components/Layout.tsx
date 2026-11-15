import type { ReactNode } from "react";

export interface SideNavItem { key: string; label: ReactNode }

/** 全站统一页面骨架：左侧声明式导航 + 右侧内容，各页只传条目不重复写布局 */
export function Page({ head, items, active, onPick, children }: {
  head: string; items: SideNavItem[]; active: string; onPick: (key: string) => void; children: ReactNode;
}) {
  return (
    <div className="flex gap-8">
      <aside className="w-36 shrink-0">
          {/* 小屏顶栏分两行，为侧栏预留对应高度。 */}
          <div className="sticky top-36 flex flex-col gap-1 sm:top-28">
          <SideHead>{head}</SideHead>
          {items.map((item) => (
            <SideItem key={item.key} active={active === item.key} onClick={() => onPick(item.key)} label={item.label} />
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

/** 侧栏条目:选中翠绿浅底 */
export function SideItem({ active, onClick, label }: {
  active: boolean; onClick: () => void; label: ReactNode;
}) {
  return (
    <button onClick={onClick}
      className={`flex rounded-xl px-3.5 py-2 text-left text-sm transition ${
        active ? "bg-brand/10 font-medium text-brand" : "text-muted hover:bg-card hover:text-ink"
      }`}>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** 侧栏小标题 */
export function SideHead({ children }: { children: ReactNode }) {
  return <div className="mb-1 px-3.5 pt-2 text-[11px] tracking-widest text-faint">{children}</div>;
}
