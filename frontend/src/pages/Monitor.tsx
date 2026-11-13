import { useCallback, useState, type ReactNode } from "react";
import { useApi, fmtNum } from "../api";
import { Badge, type BadgeTone } from "../components/Common";
import { formatTime } from "../../../lib/time";
import { useCachedLoad } from "../components/PageCache";
import { Sparkline } from "../components/Sparkline";

type Provider = "douyin" | "xhs" | "bili";
const META: Record<Provider, { label: string; color: string }> = {
  douyin: { label: "抖音", color: "#17191e" },
  xhs: { label: "小红书", color: "#ff2442" },
  bili: { label: "B站", color: "#00a1d6" },
};
// 速览行的结论类别色
const INSIGHT_TONES: Record<string, BadgeTone> = {};

interface Point { at: string; fans: number | null; likes: number | null; views: number | null }
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
    : <span className={`rounded-full px-2 py-0.5 text-xs leading-4 ${value >= 0 ? "bg-up/10 text-up" : "bg-danger/10 text-danger"}`}>{value >= 0 ? "+" : ""}{fmtNum(value)}</span>;

const stateText = (p: PlatformData) => (p.configured ? (p.paused ? "登录失效" : "已连接") : "未连接");
/** 速览文案里的动态数值与平台名:墨色中量字重,与灰色模板文字区分 */
const Em = ({ children }: { children: ReactNode }) => <span className="font-medium text-ink">{children}</span>;
const signed = (v: number | null) => v == null ? "—" : <span className={v >= 0 ? "text-up" : "text-danger"}>{v >= 0 ? "+" : ""}{fmtNum(v)}</span>;
const signedText = (v: number | null | undefined) => v == null ? "—" : `${v >= 0 ? "+" : ""}${fmtNum(v)}`;

/** 刻度取整:向上取到最近的美观倍数,让上限紧贴最高柱。 */
function niceMax(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

/** 每日净增堆叠柱状图:含 y 轴刻度/网格线、x 轴日期、悬停高亮与浮动明细,点击可固定。 */
function NetAddChart({ rows, dates, labels }: {
  rows: { key: string; color: string; values: (number | null)[] }[]; dates: string[]; labels: Record<string, string>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const H = 108;
  const totals = dates.map((_, d) => rows.reduce((n, r) => n + (r.values[d] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const active = pinned ?? hover;
  const show = active != null ? {
    idx: active, at: dates[active],
    segs: rows.map(r => ({ key: r.key, color: r.color, label: labels[r.key], v: r.values[active] ?? 0 })).filter(s => s.v > 0),
  } : null;
  const ticks = dates.length > 6
    ? Array.from({ length: 6 }, (_, n) => Math.round(n * (dates.length - 1) / 5))
    : dates.map((_, n) => n);
  return <div className="relative pt-3" onMouseLeave={() => setHover(null)}>
    <div className="relative" style={{ height: H }}>
      {/* 柱区必须有显式高度,否则子元素的百分比高度塌缩成内容高度,柱体不可见 */}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-[3px] border-b border-line" style={{ height: H }}>
        {dates.map((at, d) => {
          const segs = rows.map(r => ({ ...r, v: r.values[d] ?? 0 })).filter(s => s.v > 0);
          const isActive = active === d;
          return <div key={at} title={undefined}
            className={`flex min-w-0 flex-1 cursor-pointer flex-col justify-end gap-[2px] self-stretch transition-opacity ${active != null && !isActive ? "opacity-50" : ""}`}
            onMouseEnter={() => setHover(d)} onClick={() => setPinned(pinned === d ? null : d)}>
            {segs.length
              ? segs.map(s => <div key={s.key} className="w-full rounded-[3px]" style={{ height: `${(s.v / max) * 100}%`, background: `linear-gradient(180deg, ${s.color}, ${s.color}8C)` }} />)
              : <div className="w-full bg-ink/[0.04]" style={{ height: 2 }} />}
          </div>;
        })}
      </div>
      {/* 网格线与刻度值画在柱体之上:刻度带半透明底色,不挤压柱体 */}
      {[1, 0.5].map(f => (
        <div key={f} className="pointer-events-none absolute inset-x-0" style={{ bottom: `${f * 100}%` }}>
          <span className="absolute -top-2 left-0 rounded bg-card/80 px-1 text-[10px] leading-none text-faint">{fmtNum(max * f)}</span>
          <div className="h-px w-full bg-line/70" />
        </div>
      ))}
    </div>
    <div className="mt-2 flex justify-between pl-2.5 text-[10px] leading-none text-faint">
      {ticks.map(d => <span key={d}>{dates[d].slice(5)}</span>)}
    </div>
    {show && (
      <div className="pointer-events-none absolute z-10 w-max max-w-64 rounded-lg border border-line bg-card p-2.5 text-xs shadow-lg"
        style={{
          left: `${((show.idx + 0.5) / dates.length) * 100}%`, bottom: `${H + 40}px`,
          transform: show.idx <= 1 ? "translateX(0)" : show.idx >= dates.length - 2 ? "translateX(-100%)" : "translateX(-50%)",
        }}>
        <p className="font-medium text-ink">{show.at}</p>
        {show.segs.length
          ? show.segs.map(s => (
            <p key={s.key} className="mt-1 flex items-center gap-1.5 text-muted">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label} <span className="text-ink">+{fmtNum(s.v)}</span>
            </p>
          ))
          : <p className="mt-1 text-muted">当日无快照</p>}
      </div>
    )}
  </div>;
}

/** 数据监控:各创作后台账号级快照;总量看柱状图,对比看表格,结论看速览。 */
export default function MonitorPage() {
  const api = useApi();
  const [data, setData] = useState<MonitorData | null>(null), [error, setError] = useState("");
  const [win, setWin] = useState<1 | 7 | 30>(7);
  const load = useCallback(() => api<MonitorData>("/api/monitor").then(setData).catch(e => setError(String(e))), [api]);
  useCachedLoad("monitor", load);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">正在加载监控数据…</p>;
  const platforms = (Object.keys(META) as Provider[]).map(key => ({ key, ...data.platforms[key] }));
  // 每日净增:各平台当日粉丝 - 前一日粉丝,按北京自然日对齐;首日与前向缺口为空。
  const netDates = [...new Set(platforms.flatMap(p => p.series.map(s => s.at)))].sort();
  const netRows = platforms.map(p => ({
    key: p.key, color: META[p.key].color,
    values: netDates.map(at => {
      const idx = p.series.findIndex(s => s.at === at);
      const cur = idx >= 0 ? p.series[idx].fans : null, prev = idx > 0 ? p.series[idx - 1].fans : null;
      return cur == null || prev == null ? null : cur - prev;
    }),
  }));
  // 对比表衍生指标:周增长率(净增÷期初粉丝)与动量(本 7 天净增 - 上个 7 天净增)。
  const rows = platforms.map(p => {
    const s = p.series, i = s.length - 1;
    const fans = p.latest?.fans ?? null;
    const prev7 = i >= 7 && s[i].fans != null && s[i - 7].fans != null ? s[i].fans! - s[i - 7].fans! : null;
    const prev14 = i >= 14 && s[i - 7].fans != null && s[i - 14].fans != null ? s[i - 7].fans! - s[i - 14].fans! : null;
    return { ...p, fans, prev7, prev14 };
  });
  // 单日净增峰值(全平台合计)及其主要贡献平台。
  let peak: { at: string; total: number; key: string } | null = null;
  for (let d = 0; d < netDates.length; d++) {
    const at = netDates[d];
    let total = 0, key = "", best = 0;
    for (const r of netRows) { const v = r.values[d] ?? 0; total += v; if (v > best) { best = v; key = r.key; } }
    if (total > (peak?.total ?? 0)) peak = { at, total, key };
  }
  // 表格窗口增量:期末快照 - W 天前快照(快照不足返回 null)
  const winDelta = (p: PlatformData, key: "fans" | "likes" | "views"): number | null => {
    const s = p.series, i = s.length - 1, j = i - win;
    const cur = i >= 0 ? s[i][key] : null, base = j >= 0 ? s[j][key] : null;
    return cur == null || base == null ? null : cur - base;
  };
  const totalWinFans = rows.reduce((n, r) => { const d = winDelta(r, "fans"); return d == null ? n : n + d; }, 0);
  // 数据速览:恒定 5 行、每行独立容器;全部由每日序列实时计算,动态数值与平台名以墨色强调,模板文字保持灰。
  const today = formatTime(Date.now()).slice(0, 10);
  const netTotals = netDates.map((at, d) => ({ at, total: netRows.reduce((n, r) => n + (r.values[d] ?? 0), 0) }));
  const down = netTotals.filter(x => x.total < 0);
  const worstDown = down.length ? down.reduce((a, b) => b.total < a.total ? b : a) : null;
  const eff = platforms
    .filter(p => (p.latest?.likes ?? 0) > 0 && (p.latest?.works ?? 0) > 0)
    .map(p => ({ key: p.key, perLike: p.latest!.likes! / p.latest!.works!, perView: p.latest!.views! / p.latest!.works! }));
  const likeBest = eff.length ? eff.slice().sort((a, b) => b.perLike - a.perLike)[0] : null;
  const viewBest = eff.length ? eff.slice().sort((a, b) => b.perView - a.perView)[0] : null;
  const paused = platforms.filter(p => p.configured && p.paused).map(p => `${META[p.key].label}的登录已失效`);
  const stale = platforms.filter(p => p.configured && p.latest && p.latest.at < today).map(p => `${META[p.key].label}停留在 ${p.latest!.at.slice(5)}`);
  const issues = [...paused.map(t => `${t}，采集已暂停`), ...stale.map(t => `${t}，今日无快照`)];
  const insightRows: { tag: string; tone: BadgeTone; text: ReactNode }[] = [
    netTotals.length >= 14
      ? (() => {
        const cur = netTotals.slice(-7).reduce((n, x) => n + x.total, 0);
        const prev = netTotals.slice(-14, -7).reduce((n, x) => n + x.total, 0);
        const up = cur >= prev;
        const pct = prev !== 0 ? (Math.abs(cur - prev) / Math.abs(prev) * 100).toFixed(1) : null;
        return { tag: "环比", tone: (up ? "brand" : "danger") as BadgeTone, text: <>全平台近7天净增 <Em>{signedText(cur)}</Em>，上个7天 <Em>{signedText(prev)}</Em>{pct ? <>，环比<Em>{up ? "加速" : "放缓"} {pct}%</Em></> : null}。</> };
      })()
      : { tag: "环比", tone: "gray", text: "快照积累满 14 天后提供环比结论。" },
    likeBest && viewBest
      ? { tag: "回报", tone: "violet", text: likeBest.key === viewBest.key
        ? <>内容回报<Em>{META[likeBest.key].label}最好</Em>：篇均获赞 <Em>{fmtNum(Math.round(likeBest.perLike))}</Em>、篇均播放 <Em>{fmtNum(Math.round(viewBest.perView))}</Em>。</>
        : <>篇均获赞<Em>{META[likeBest.key].label}领先</Em>（<Em>{fmtNum(Math.round(likeBest.perLike))}</Em>/篇）；篇均播放<Em>{META[viewBest.key].label}领先</Em>（<Em>{fmtNum(Math.round(viewBest.perView))}</Em>/篇）。</> }
      : { tag: "回报", tone: "violet", text: "暂无内容数据。" },
    worstDown
      ? { tag: "回落", tone: "warn", text: <>近30天有 <Em>{down.length}</Em> 天粉丝净回落，最深的一天是 <Em>{worstDown.at.slice(5)}（{fmtNum(worstDown.total)}）</Em>。</> }
      : { tag: "回落", tone: "warn", text: "近30天无粉丝净回落。" },
    peak && peak.total > 0
      ? (() => {
        const day = netRows.find(r => r.key === peak!.key);
        return { tag: "峰值", tone: "blue" as BadgeTone, text: <>单日净增峰值 <Em>+{fmtNum(peak!.total)}</Em>（<Em>{META[(day?.key ?? "douyin") as Provider].label} · {peak!.at.slice(5)}</Em>）。</> };
      })()
      : { tag: "峰值", tone: "blue", text: "暂无数据。" },
    issues.length
      ? { tag: "异常", tone: "danger", text: <Em>{issues.join("；")}</Em> }
      : { tag: "异常", tone: "danger", text: "未检测到异常，各平台连接与采集状态正常。" },
  ];
  return <div className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-2">
      {/* 两卡高度钉为常量:速览只放结论,常规 4 条 */}
      <section className="panel flex h-[276px] flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted">全平台粉丝{data.total.platforms ? ` · 已连接 ${data.total.platforms} 个平台` : ""}</p>
            <p className="flex items-center gap-2 text-xs text-muted">今日 <Delta value={data.total.deltaToday} /> 近7天 <Delta value={data.total.delta7d} /></p>
          </div>
          <p className="mt-1 text-4xl font-semibold tabular-nums">{fmtNum(data.total.fans)}</p>
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between text-xs text-muted">
            <span>每日净增 · 近30天</span>
            <span className="flex gap-3">{platforms.map(p => (
              <span key={p.key} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: META[p.key].color }} />
                {META[p.key].label}
              </span>
            ))}</span>
          </div>
          <NetAddChart rows={netRows} dates={netDates} labels={Object.fromEntries(platforms.map(p => [p.key, META[p.key].label]))} />
        </div>
      </section>
      <section className="panel flex h-[276px] flex-col">
        <h2 className="text-lg font-semibold">数据速览</h2>
        {/* 恒定 5 行,行容器在固定卡内均匀分布,恰好充满 */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between">
          {insightRows.map(line => (
            <div key={line.tag} className="flex items-center gap-2 rounded-lg border border-line/70 bg-canvas/50 px-3 py-1">
              <Badge tone={line.tone}>{line.tag}</Badge>
              <span className="text-sm leading-5 text-muted">{line.text}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
    <section className="panel">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">平台对比</h2>
        <div className="flex items-center gap-1 rounded-full bg-ink/[0.06] p-1">
          {([1, 7, 30] as const).map(w => (
            <button key={w} type="button" onClick={() => setWin(w)}
              className={`rounded-full px-3 py-1 text-xs transition ${win === w ? "bg-card font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
              {w === 1 ? "昨日" : `近${w}天`}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="tbl table-fixed">
          <colgroup>
            <col className="w-[14%]" /><col className="w-[9%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[9%]" /><col className="w-[14%]" />
          </colgroup>
          <thead><tr>
            <th>平台</th><th className="!text-center">状态</th><th className="!text-center">粉丝</th><th className="!text-center">涨粉</th><th className="!text-center">涨粉率</th><th className="!text-center">涨粉占比</th><th className="!text-center">播放</th><th className="!text-center">点赞</th><th className="!text-center">近30天趋势</th>
          </tr></thead>
          <tbody>{rows.map(r => {
            const fansDelta = winDelta(r, "fans");
            const share = fansDelta != null && totalWinFans > 0 ? fansDelta / totalWinFans * 100 : null;
            return <tr key={r.key}>
              <td className="!pl-5"><span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: META[r.key].color }} />
                {META[r.key].label}
              </span></td>
              <td className={`text-center ${r.paused ? "text-warn" : r.configured ? "text-muted" : "text-faint"}`}>{stateText(r)}</td>
              <td className="text-center font-medium text-ink">{fmtNum(r.fans)}</td>
              <td className="text-center">{signed(fansDelta)}</td>
              <td className="text-center">{fansDelta == null || r.fans == null || r.fans - fansDelta <= 0 ? "—" : <span className={fansDelta >= 0 ? "text-up" : "text-danger"}>{fansDelta >= 0 ? "+" : ""}{(fansDelta / (r.fans - fansDelta) * 100).toFixed(1)}%</span>}</td>
              <td className="text-center">{share == null ? "—" : share < 0 ? <span className="text-danger">{share.toFixed(1)}%</span> : <span className="text-ink">{share.toFixed(1)}%</span>}</td>
              <td className="text-center">{signed(winDelta(r, "views"))}</td>
              <td className="text-center">{signed(winDelta(r, "likes"))}</td>
              <td className="!px-4"><Sparkline values={r.series.slice(-30).map(s => s.fans)} color={META[r.key].color} height={28} className="w-full" /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
