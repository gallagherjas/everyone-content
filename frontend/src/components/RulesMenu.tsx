import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';

/** 顶部导航的采集规则悬浮说明，面板挂到 body 避开顶栏的横向滚动裁剪。数据流白话版；规则的权威口径见 skills/collection/SKILL.md。 */
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
      className="whitespace-nowrap rounded-full border border-clay bg-clay/10 px-3.5 py-1.5 text-xs text-clay transition hover:bg-clay/20">采集规则</button>
    {open && pos && createPortal(
      <div className="fixed z-50 w-96 rounded-xl border border-line bg-card p-4 shadow-lg" style={{ top: pos.top, right: pos.right }} onMouseEnter={enter} onMouseLeave={leave}>
        <p className="text-xs leading-6 text-clay">tips：了解规则前请先打开抖音指数了解其基本知识。</p>
        <p className="text-sm font-medium">采集按 关键词 → 话题 → 视频 → 达人 逐级发现：</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-6 text-muted">
          <li>每个关键词进行话题搜索：近30天指数低于「话题指数下限（30天）」的话题淘汰，其余按指数从高到低，最多保留「话题保留数」个。</li>
          <li>为入选话题和每个关键词搜索视频，点赞数低于「点赞数下限」或未知的视频淘汰。</li>
          <li>达标视频按各查询的指数分别排序，最多保留「视频保留数」条。</li>
          <li>达人候选来自入选视频的作者与入选话题的点赞、评论达人榜，最多保留「达人保留数」个。</li>
          <li>排除关键词全程生效：话题名称、视频标题或标签、达人昵称命中任一词即排除。</li>
        </ol>
        <p className="mt-2 text-xs leading-6 text-muted">调整筛选参数后点击「保存并重新筛选」，现有数据立即按新规则重新筛选，无需重新采集。</p>
      </div>, document.body)}
  </div>;
}
