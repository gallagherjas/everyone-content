import { useCallback, useState } from "react";
import { useApi, fmtNum } from "../api";
import { useCachedLoad } from "../components/PageCache";
import { Sparkline } from "../components/Sparkline";

type Provider = "douyin" | "xhs" | "bili";
const META: Record<Provider, { label: string; color: string }> = {
  douyin: { label: "抖音", color: "#17191e" },
  xhs: { label: "小红书", color: "#ff2442" },
  bili: { label: "B站", color: "#00a1d6" },
};
// 速览行的分类色签,呼应参考图数据分析栏的彩色标签
const CHIP_TONES: Record<string, string> = {
  总览: "bg-brand/10 text-brand", 规模: "bg-blue/10 text-blue", 涨粉: "bg-rose/10 text-rose", 内容: "bg-violet/10 text-violet", 异常: "bg-warn/10 text-warn",
};
interface Point { at: string; fans: number | null }
interface PlatformData {
  configured: boolean; paused: boolean; error: string | null;
  latest: { at: string; fans: number | null; likes: number | null; works: number | null; views: number | null } | null;
  deltaToday: number | null; delta7d: number | null; series: Point[];
}
interface MonitorData {
  platforms: Record<Provider, PlatformData>;
  total: { fans: number; deltaToday: number | null; delta7d: number | null; platforms: number };
}

const Delta = ({ value }: { value: number | null }) =>
  value == null ? <span className="text-xs text-faint">待下次快照</span>
    : <span className={`rounded-full px-2 py-0.5 text-xs leading-4 ${value >= 0 ? "bg-brand/10 text-brand" : "bg-danger/10 text-danger"}`}>{value >= 0 ? "+" : ""}{fmtNum(value)}</span>;

const Dot = ({ ok, warn }: { ok: boolean; warn: boolean }) =>
  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${warn ? "bg-warn" : ok ? "bg-brand" : "bg-faint"}`} />;

const stateText = (p: PlatformData) => (p.configured ? (p.paused ? "登录失效" : "已连接") : "未连接");

/** 数据监控:各创作后台账号级快照的大屏页;快照从连接次日起积累。 */
export default function MonitorPage() {
  const api = useApi();
  const [data, setData] = useState<MonitorData | null>(null), [error, setError] = useState("");
  const load = useCallback(() => api<MonitorData>("/api/monitor").then(setData).catch(e => setError(String(e))), [api]);
  useCachedLoad("monitor", load);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">正在加载监控数据…</p>;
  const platforms = (Object.keys(META) as Provider[]).map(key => ({ key, ...data.platforms[key] }));
  // 总粉丝曲线:各平台按北京自然日求和,当日有数的平台才计入。
  const dates = [...new Set(platforms.flatMap(p => p.series.map(s => s.at)))].sort();
  const totalSeries = dates.map(at =>
    platforms.reduce((n, p) => { const hit = p.series.find(s => s.at === at); return hit?.fans == null ? n : n + hit.fans; }, 0));
  // 数据速览:规则模板汇总总体规模、净增对比、内容互动与异常,只在有数据时成行。
  const insights: { tag: string; text: string }[] = [];
  const withFans = platforms.filter(p => p.latest?.fans != null);
  if (withFans.length) {
    const trend = data.total.delta7d == null ? "" : `，近7天${data.total.delta7d >= 0 ? "净增" : "净减"} ${fmtNum(Math.abs(data.total.delta7d))}`;
    insights.push({ tag: "总览", text: `全平台粉丝 ${fmtNum(data.total.fans)}，来自 ${data.total.platforms} 个平台${trend}。` });
  }
  const top = withFans.slice().sort((a, b) => (b.latest!.fans ?? 0) - (a.latest!.fans ?? 0))[0];
  if (top && withFans.length >= 2) insights.push({ tag: "规模", text: `粉丝规模最大的是${META[top.key].label}（${fmtNum(top.latest!.fans)}）。` });
  const ranked = platforms.filter(p => p.delta7d != null).sort((a, b) => b.delta7d! - a.delta7d!);
  if (ranked.length >= 2)
    insights.push({ tag: "涨粉", text: `近7天涨粉最多的是${META[ranked[0].key].label}（${ranked[0].delta7d! >= 0 ? "+" : ""}${fmtNum(ranked[0].delta7d!)}），最少的是${META[ranked.at(-1)!.key].label}（${fmtNum(ranked.at(-1)!.delta7d)}）。` });
  else if (ranked.length === 1)
    insights.push({ tag: "涨粉", text: `近7天${META[ranked[0].key].label}粉丝${ranked[0].delta7d! >= 0 ? "净增" : "净减"} ${fmtNum(Math.abs(ranked[0].delta7d!))}。` });
  const sum = (pick: (p: PlatformData) => number | null | undefined) => platforms.reduce((n, p) => n + (pick(p) ?? 0), 0);
  const works = sum(p => p.latest?.works), likes = sum(p => p.latest?.likes), views = sum(p => p.latest?.views);
  if (works || likes || views) {
    const parts = [works ? `作品 ${fmtNum(works)}` : "", likes ? `获赞 ${fmtNum(likes)}` : "", views ? `播放 ${fmtNum(views)}` : ""].filter(Boolean);
    insights.push({ tag: "内容", text: `内容与互动合计：${parts.join(" · ")}。` });
  }
  const paused = platforms.filter(p => p.configured && p.paused).map(p => META[p.key].label);
  if (paused.length) insights.push({ tag: "异常", text: `${paused.join("、")}的登录已失效，采集已暂停；重新连接后自动恢复。` });
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" aria-label="平台连接状态">
      {platforms.map(p => (
        <span key={p.key} className="flex items-center gap-1.5">
          <Dot ok={p.configured && !p.paused} warn={p.configured && p.paused} />
          {META[p.key].label}
          <span className="text-muted">{stateText(p)}</span>
        </span>
      ))}
    </div>
    <div className="grid items-stretch gap-5 lg:grid-cols-2">
      <section className="panel flex flex-col justify-between gap-4">
        <div>
          <p className="text-sm text-muted">全平台粉丝{data.total.platforms ? ` · 已连接 ${data.total.platforms} 个平台` : ""}</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">{fmtNum(data.total.fans)}</p>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted">今日 <Delta value={data.total.deltaToday} /> 近7天 <Delta value={data.total.delta7d} /></p>
        </div>
        <Sparkline values={totalSeries} width={240} />
      </section>
      <section className="panel space-y-3">
        <h2 className="text-lg font-semibold">数据速览</h2>
        {insights.length
          ? insights.map(line => (
            <p className="flex items-start gap-2 text-sm leading-6 text-muted" key={line.tag + line.text}>
              <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs leading-4 ${CHIP_TONES[line.tag] ?? "bg-ink/[0.06] text-muted"}`}>{line.tag}</span>
              {line.text}
            </p>
          ))
          : <p className="text-sm leading-6 text-muted">连接平台并积累快照后，这里汇总粉丝规模、净增与内容互动。</p>}
      </section>
    </div>
    <div className="grid gap-5 sm:grid-cols-3">
      {platforms.map(p => (
        <section className="panel" key={p.key}>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: META[p.key].color }} />
              {META[p.key].label}
            </span>
            <span className="text-xs text-muted">{stateText(p)}</span>
          </div>
          <p className="mt-3 text-3xl font-semibold tabular-nums">{p.latest?.fans != null ? fmtNum(p.latest.fans) : "—"}</p>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-muted">今日 <Delta value={p.deltaToday} /> 近7天 <Delta value={p.delta7d} /></p>
          <div className="mt-3"><Sparkline values={p.series.map(s => s.fans)} color={META[p.key].color} /></div>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span>获赞 {fmtNum(p.latest?.likes ?? null)}</span>
            <span>作品 {fmtNum(p.latest?.works ?? null)}</span>
            <span>播放 {fmtNum(p.latest?.views ?? null)}</span>
          </p>
        </section>
      ))}
    </div>
  </div>;
}
