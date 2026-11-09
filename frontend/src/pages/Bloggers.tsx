import { useCallback, useState } from "react";
import { useApi, fmtNum, fmtTime } from "../api";
import Pager from "../components/Pager";
import { TableBox } from "../components/Common";
import { Page } from "../components/Layout";
import { useCachedLoad } from "../components/PageCache";

interface Author {
  source_key: string; name: string; follower_count: number | null;
  last_seen_at: string | null; works: number;
}
interface Work {
  id: number; url: string; title: string; author: string;
  published_at: string | null; status: string;
  metrics: Record<string, number | null>; engagement: number; growth: number | null;
}

export default function BloggersPage() {
  const api = useApi();
  const [authors, setAuthors] = useState<Author[]>([]);
  const [list, setList] = useState<Work[]>([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState<string>("all");
  const [page, setPage] = useState(1);

  useCachedLoad('bloggers', useCallback(() => {
    api<Author[]>("/api/authors?scope=bloggers").then(setAuthors).catch(() => setAuthors([]));
  }, [api]));
  useCachedLoad('bloggers', useCallback(() => {
    const author = active === "all" ? "" : `&blogger=${encodeURIComponent(active)}`;
    api<{ total: number; items: Work[] }>(`/api/works?scope=bloggers&page=${page}${author}`)
      .then((r) => { setList(r.items); setTotal(r.total); }).catch(() => setList([]));
  }, [api, active, page]));
  const pick = (name: string) => { setActive(name); setPage(1); };

  const shown = list;

  return (
    <Page
      head="博主"
      items={[{ key: "all", label: "全部", count: authors.reduce((count, author) => count + author.works, 0) }, ...authors.map((a) => ({ key: a.source_key, label: a.name, count: a.works }))]}
      active={active}
      onPick={pick}
    >
      <div className="space-y-5">
      <p className="text-sm text-muted">仅展示本账号指数采集已收录、且身份与关注博主一致的作品，不单独查询博主新作。</p>
      {active !== "all" && (
        <div className="rounded-xl border border-line bg-card px-5 py-3 text-[13px] text-muted">
          {(() => {
            const a = authors.find((x) => x.source_key === active);
            if (!a) return null;
            return (
              <>
                <span className="text-ink">{a.name}</span>
                <span className="mx-2.5 text-line">·</span>
                {fmtNum(a.follower_count)} 粉丝
              </>
            );
          })()}
        </div>
      )}

      <TableBox>
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>作品</th>
              <th className="text-left">作者</th>
              <th>互动</th>
              <th>互动变化</th>
              <th>赞 / 评 / 转 / 藏</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((w) => (
              <tr key={w.id} onClick={() => window.open(w.url, "_blank")} className="cursor-pointer">
                <td className="max-w-[320px]">
                  <a href={w.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                    className="block truncate hover:text-brand hover:underline">{w.title || "(无标题)"}</a>
                  <div className="mt-0.5 text-xs text-fade">{fmtTime(w.published_at)} 发布</div>
                </td>
                <td className="text-muted">{w.author || "—"}</td>
                <td className="text-right font-display text-base">{fmtNum(w.engagement)}</td>
                <td className={`text-right ${(w.growth ?? 0) > 0 ? "text-brand" : "text-fade"}`}>
                  {w.growth === null ? "—" : w.growth > 0 ? `+${fmtNum(w.growth)}` : fmtNum(w.growth)}
                </td>
                <td className="text-right text-xs text-muted">
                  {fmtNum(w.metrics.likes ?? null)} / {fmtNum(w.metrics.comments ?? null)} / {fmtNum(w.metrics.shares ?? null)} / {fmtNum(w.metrics.collects ?? null)}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={5} className="py-12 text-center text-muted">{!authors.length ? '尚未关注博主，请在“设置 → 博主与关键词”中添加。' : '关注的博主暂无入库作品'}</td></tr>
            )}
          </tbody>
        </table>
      </TableBox>

      <Pager page={page} total={total} pageSize={20} onChange={setPage} />

    </div>
    </Page>
  );
}
