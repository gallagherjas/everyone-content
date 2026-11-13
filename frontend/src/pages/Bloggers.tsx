import { useCallback, useEffect, useRef, useState } from "react";
import { useApi, fmtNum, fmtTime, relTime } from "../api";
import { Page } from "../components/Layout";
import { Badge, Msg, VIDEO_BADGES } from "../components/Common";
import { useCachedLoad } from "../components/PageCache";

interface BloggerRow {
  id: number; kind: "blogger" | "blogger_search"; userId?: string; name: string; status: string; note?: string; resolving?: boolean;
  profile?: { secUid: string | null; fans: number | null; likes: number | null; items: number | null; tag1: string | null; tag2: string | null; avatar: string | null; intro?: string };
  options?: { core?: boolean; info?: boolean }; worksCount?: number; lastCollectAt?: string | null;
}
interface WorkRow { id: string; title: string; likes: number | null; comments: number | null; shares: number | null; follows: number | null; publishedAt: string | null; url: string; badges?: string[] }
interface Trend { fans: { date: string; count: number | null }[]; likes: { date: string; count: number | null }[]; summary: { newFansDay: number | null; newFansWeek: number | null } }
interface Detail extends BloggerRow { works: WorkRow[]; trend: Trend | null }

/** 粉丝日增单序列柱状图(近14天),复用监控页柱体的视觉口径 */
function FanBars({ fans }: { fans: Trend["fans"] }) {
  const rows = fans.slice(-14);
  const max = Math.max(1, ...rows.map(r => r.count ?? 0));
  return <div>
    <div className="flex h-20 items-end gap-1 border-b border-line">
      {rows.map(r => <div key={r.date} title={`${r.date.slice(5)} 净增 ${fmtNum(r.count)}`}
        className="min-w-0 flex-1 rounded-t-[3px] bg-brand/80" style={{ height: `${Math.max(2, ((r.count ?? 0) / max) * 100)}%` }} />)}
    </div>
    <div className="mt-1.5 flex justify-between text-[10px] text-faint">
      <span>{rows[0]?.date.slice(5)}</span><span>峰值 {fmtNum(max)}</span><span>{rows.at(-1)?.date.slice(5)}</span>
    </div>
  </div>;
}

export default function BloggersPage() {
  const api = useApi();
  const [rows, setRows] = useState<BloggerRow[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [active, setActive] = useState<string>("");

  const [failed, setFailed] = useState(false), [message, setMessage] = useState("");
  const load = useCallback(() => api<BloggerRow[]>("/api/bloggers").then(setRows).catch(() => setRows([])), [api]);
  useCachedLoad('bloggers', load);
  const loadDetail = useCallback((id: number) => api<Detail>(`/api/bloggers/${id}`).then(setDetail).catch(e => { setDetail(null); setFailed(true); setMessage(String(e)); }), [api]);
  useEffect(() => { setDetail(null); if (active && !active.startsWith("s")) loadDetail(Number(active)); }, [active, loadDetail]);
  // 有待解析昵称时轮询，解析完成自动出现博主行。
  useEffect(() => {
    if (!rows.some(r => r.resolving)) return;
    const timer = setTimeout(load, 3000);
    return () => clearTimeout(timer);
  }, [rows, load]);
  // 解析成功但作品还没采到（当轮额度被关键词用尽时会顺延）:自动补采一轮,无需用户手动点。
  const followed = useRef(new Set<number>());
  useEffect(() => {
    for (const b of rows.filter(r => r.kind === "blogger" && r.status === "ready" && !r.lastCollectAt && !followed.current.has(r.id))) {
      followed.current.add(b.id);
      api("/api/run/collect", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    }
  }, [rows, api]);
  const bloggers = rows.filter(r => r.kind === "blogger"), pending = rows.filter(r => r.kind === "blogger_search");
  const current = bloggers.find(b => String(b.id) === active);
  // 进入页面默认选中第一个博主。
  useEffect(() => { if (!active && bloggers.length) setActive(String(bloggers[0].id)); }, [active, bloggers]);

  return <Page head="博主" active={active} onPick={setActive} items={[
    ...bloggers.map(b => ({ key: String(b.id), label: b.name })),
    ...pending.map(p => ({ key: `s${p.id}`, label: `${p.name}（解析中）` })),
  ]}>
    <div className="space-y-5">
      {active.startsWith("s") && (
        <section className="panel"><h3 className="font-semibold text-lg">{pending.find(p => `s${p.id}` === active)?.name}</h3>
          <p className="mt-2 text-sm text-muted">{pending.find(p => `s${p.id}` === active)?.status === "paused"
            ? "未找到该昵称的达人；请核对昵称后删除重新添加。" : "昵称解析中：一轮采集完成后自动转为博主，或稍后刷新查看。"}</p>
        </section>
      )}

      {detail && current && (
        <>
          <section className="panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-lg">{detail.name}</h3>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  <span>粉丝 <span className="font-medium text-ink">{fmtNum(detail.profile?.fans ?? null)}</span></span>
                  <span>获赞 <span className="font-medium text-ink">{fmtNum(detail.profile?.likes ?? null)}</span></span>
                  <span>作品 <span className="font-medium text-ink">{fmtNum(detail.profile?.items ?? null)}</span></span>
                  {detail.profile?.tag1 && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">{[detail.profile.tag1, detail.profile.tag2].filter(Boolean).join(" / ")}</span>}
                </p>
                {detail.profile?.intro && <p className="mt-2 max-w-2xl whitespace-pre-line text-sm leading-6 text-muted">{detail.profile.intro}</p>}
                <p className="mt-2 text-xs text-faint">最近采集 {detail.lastCollectAt ? `${fmtTime(detail.lastCollectAt)}（${relTime(detail.lastCollectAt)}）` : "尚未采集"}；开关与移出在「采集 → 博主」。</p>
              </div>
            </div>
          </section>

          {detail.trend && (
            <section className="panel">
              <h3 className="font-semibold text-lg">粉丝日增 · 近14天</h3>
              <p className="mt-2 text-sm text-muted">今日净增 <span className="font-medium text-ink">{fmtNum(detail.trend.summary.newFansDay)}</span> · 近7天 <span className="font-medium text-ink">{fmtNum(detail.trend.summary.newFansWeek)}</span></p>
              <div className="mt-3"><FanBars fans={detail.trend.fans} /></div>
            </section>
          )}

          <section className="panel">
            <h3 className="font-semibold text-lg">作品 · 近30天热门</h3>
            {!detail.works.length && <p className="mt-4 text-sm text-muted">近30天暂无上榜作品；数据随每轮采集更新。</p>}
            <div className="mt-4 space-y-2">
              {detail.works.map(w => <div key={w.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <a className="link min-w-0 flex-1 truncate text-sm" href={w.url} target="_blank" rel="noreferrer">{w.title || w.id}</a>
                  {!!w.badges?.length && <span className="flex shrink-0 gap-1">{w.badges.map(b => <Badge key={b} tone={VIDEO_BADGES[b]?.tone ?? "gray"}>{VIDEO_BADGES[b]?.label ?? b}</Badge>)}</span>}
                </div>
                <p className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs leading-6 text-muted">
                  <span className="shrink-0">{w.publishedAt ? `${w.publishedAt.endsWith("+08:00") ? fmtTime(w.publishedAt).slice(0, 10) : fmtTime(w.publishedAt)} 发布` : "发布时间未知"}</span>
                  <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                    <span className="w-20">赞 <span className="font-medium text-ink">{fmtNum(w.likes)}</span></span>
                    <span className="w-16">评 <span className="font-medium text-ink">{fmtNum(w.comments)}</span></span>
                    <span className="w-16">转 <span className="font-medium text-ink">{fmtNum(w.shares)}</span></span>
                    <span className="w-20">关注 <span className="font-medium text-ink">{fmtNum(w.follows)}</span></span>
                  </span>
                </p>
              </div>)}
            </div>
          </section>
        </>
      )}

      {!bloggers.length && !pending.length && <section className="panel"><p className="text-sm text-muted">尚未追踪博主；到「采集 → 博主」输入昵称开始追踪。</p></section>}
      {message && <Msg tone={failed ? "error" : "ok"}>{message}</Msg>}
    </div>
  </Page>;
}
