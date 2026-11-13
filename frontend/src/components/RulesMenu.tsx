import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';

/** 顶栏右侧的采集规则悬浮说明，面板挂到 body 避开顶栏的横向滚动裁剪，右缘对齐触发器。数据流白话版；规则的权威口径见 skills/collection/SKILL.md。 */
export default function RulesMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef(0);
  const enter = () => {
    window.clearTimeout(closeTimer.current);
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom, right: window.innerWidth - rect.right });
    }
    setOpen(true);
  };
  const leave = () => { closeTimer.current = window.setTimeout(() => setOpen(false), 150); };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  return <div className="shrink-0" onMouseEnter={enter} onMouseLeave={leave}>
    <button type="button" ref={btnRef} aria-expanded={open} onFocus={enter} onBlur={leave}
      className="shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm text-brand underline decoration-brand/50 underline-offset-4 transition hover:text-brand-deep">指数采集规则</button>
    {open && pos && createPortal(
      <div className="fixed z-50 w-96 rounded-xl border border-line bg-card p-4 shadow-lg" style={{ top: pos.top, right: pos.right }} onMouseEnter={enter} onMouseLeave={leave}>
        <p className="text-xs leading-6 text-brand">tips：了解规则前请先打开抖音指数了解其基本知识。</p>
        <p className="text-sm font-medium">采集按 关键词 → 话题 → 视频 → 达人 逐级发现：</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-6 text-muted">
          <li>每个关键词搜索全部命中话题，以及近7天与近30天两个窗口的视频；不做数量与指数门槛限制。</li>
          <li>排除关键词全程生效：话题名称、视频标题或标签、达人昵称命中任一词即排除。</li>
          <li>页面按指数排名展示榜单：话题 Top20、视频 Top200（可切近7天/近30天口径与类型）、达人 Top10。</li>
        </ol>
        <p className="mt-2 text-xs leading-6 text-muted">调整采集词与排除词即时生效，现有数据立即按新规则重新整理，无需重新采集。</p>
      </div>, document.body)}
  </div>;
}
