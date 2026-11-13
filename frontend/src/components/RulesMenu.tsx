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
      className="shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm text-amber-500 underline decoration-amber-500/50 underline-offset-4 transition hover:text-warn">采集规则</button>
    {open && pos && createPortal(
      <div className="fixed z-50 w-96 rounded-xl border border-line bg-card p-4 shadow-lg" style={{ top: pos.top, right: pos.right }} onMouseEnter={enter} onMouseLeave={leave}>
        <p className="text-xs leading-6 text-warn">tips：了解规则前请先打开抖音指数了解其基本知识。</p>
        <p className="text-sm font-medium">采集按 关键词 → 话题 → 视频 → 达人 逐级发现：</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-6 text-muted">
          <li>每个关键词进行话题搜索：近30天指数低于「话题指数下限（30天）」的话题淘汰，其余按指数从高到低，最多保留「话题保留数」个。</li>
          <li>为每个关键词分别搜索近7天与近30天两个窗口的视频，点赞数低于「点赞数下限」或未知的视频淘汰。</li>
          <li>达标视频按两窗口指数之和排序，最多保留「视频保留数」条；两个窗口同等，可切换排序查看。</li>
          <li>达人指数按入选视频的作者归类：近30天指数相加为总体指数，平均指数=总体÷视频数，可切换排序查看前10名。</li>
          <li>排除关键词全程生效：话题名称、视频标题或标签、达人昵称命中任一词即排除。</li>
        </ol>
        <p className="mt-2 text-xs leading-6 text-muted">调整筛选参数后点击「保存并重新筛选」，现有数据立即按新规则重新筛选，无需重新采集。</p>
      </div>, document.body)}
  </div>;
}
