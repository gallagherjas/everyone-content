import { useState } from 'react';

/** 全局分页条:‹ 上一页 · 第 X / Y 页 · 下一页 › */
export default function Pager({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-4 pt-1 text-sm">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="btn-sm">‹ 上一页</button>
      <span className="text-muted">第 <span className="font-semibold text-ink">{page}</span> / {pages} 页<span className="mx-1.5 text-line">·</span>共 {total} 条</span>
      <button disabled={page >= pages} onClick={() => onChange(page + 1)} className="btn-sm">下一页 ›</button>
    </div>
  );
}

/** 客户端分页:整表已在内存时切页,返回值可整体展开到 <Pager/> */
export function usePaged<T>(items: T[], pageSize = 20) {
  const [page, setPage] = useState(1);
  const current = Math.min(page, Math.max(1, Math.ceil(items.length / pageSize)));
  return { slice: items.slice((current - 1) * pageSize, current * pageSize), page: current, total: items.length, pageSize, onChange: setPage };
}
