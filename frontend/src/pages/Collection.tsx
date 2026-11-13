import { useCallback,useEffect,useRef,useState } from "react";
import { useApi,fmtNum } from "../api";
import { Badge,FilterSelect,HoverTip,VIDEO_BADGES } from "../components/Common";
import { Page } from "../components/Layout";
import { useCachedLoad,useInvalidatePages,usePageVisible } from "../components/PageCache";
import Pager,{usePaged} from "../components/Pager";

interface Video {id:string;title:string;indexBy:{'7':number|null;'30':number|null};keyword:string;likes:number;comments:number|null;authorName:string;fans:number|null;duration:number|null;publishedAt:string|null;badges?:string[]}
interface Topic {id:string;name:string;index:number;window:{begin:string;end:string}}
interface Author {key:string;name:string;videos:string[];totalIndex:number}
// 视频官方标记的徽章口径见 Common.VIDEO_BADGES,与博主作品列表共享。
/** 名次徽标:前三名用系统内置奖牌 emoji,其余灰色数字,统一居中 */
function RankNo({n}:{n:number}){
  return <span className="w-5 shrink-0 text-center leading-none">{n<=3?["🥇","🥈","🥉"][n-1]:<span className="text-xs text-faint">{n}</span>}</span>;
}
interface State {credentials:Record<string,boolean>;runs:{id:number;status:string}[];discovery:null|{ready:boolean;keywords:string[];topics:Topic[];videos:Video[];authors:Author[];pending:{topicSearch:string[];videos:string[]};counts:{uniqueVideos:number;excludedKeywords:number}}}
/** 指数数据面：只读榜单（话题/视频/达人），采集入口与配置在「采集」板块。 */
export default function CollectionPage() {
  const api=useApi();
  const [state,setState]=useState<State|null>(null),[view,setView]=useState("discovery"),[videoSort,setVideoSort]=useState<"7"|"30">("30"),[videoBadge,setVideoBadge]=useState("");
  const visible=usePageVisible(),invalidate=useInvalidatePages(),lastRuns=useRef<string|null>(null);
  // 本页是采集数据的常驻轮询者：记录变化时广播刷新监控等其他数据页。
  const refresh=useCallback(()=>{api<State>("/api/collection").then(value=>{
    setState(value);
    const runs=value.runs.map(run=>`${run.id}:${run.status}`).join(',');
    if(lastRuns.current!==null&&lastRuns.current!==runs)invalidate(['monitor','sources']);
    lastRuns.current=runs;
  }).catch(()=>{});},[api,invalidate]);
  useCachedLoad('collection',refresh);
  useEffect(()=>{if(!visible)return;const timer=setInterval(refresh,10000);return()=>clearInterval(timer);},[visible,refresh]);
  const discovery=state?.discovery,videos=discovery?.videos??[];
  // 榜单在前端定口径：视频按所选窗口指数全局排序取 Top200，再按官方标记类型过滤；达人与话题同理取前 N。
  const rankedVideos=videos.slice().sort((a,b)=>(b.indexBy[videoSort]??-1)-(a.indexBy[videoSort]??-1)||a.id.localeCompare(b.id)).slice(0,200).filter(v=>!videoBadge||v.badges?.includes(videoBadge));
  // 达人双榜同屏：左列按总体指数、右列按平均指数（总体÷视频数），各展示前10名。
  const byTotal=[...(discovery?.authors??[])].sort((a,b)=>b.totalIndex-a.totalIndex||a.key.localeCompare(b.key)).slice(0,10);
  const byAverage=[...(discovery?.authors??[])].sort((a,b)=>b.totalIndex/b.videos.length-a.totalIndex/a.videos.length||a.key.localeCompare(b.key)).slice(0,10);
  const topTopics=(discovery?.topics??[]).slice(0,20);
  const videoPage=usePaged(rankedVideos);
  return <Page head="指数" active={view} onPick={setView} items={[
    {key:"discovery",label:"话题指数"},
    {key:"videos",label:"视频指数"},
    {key:"authors",label:"达人指数"},
  ]}>
    <div className="space-y-5">
      {discovery?<>
        {view==="discovery"&&<>
        {!discovery.ready&&<section className="panel"><h3 className="font-semibold text-lg">数据尚未采齐</h3><p className="mt-2 text-sm text-muted">当前批次未完成，视频和达人将在补齐后展示。每轮和每日次数有限，可在「采集 → 总览」多次手动采集继续。</p><div className="mt-3 space-y-1 text-sm">{discovery.pending.topicSearch.length>0&&<p>待查询话题：{discovery.pending.topicSearch.join('、')}</p>}{discovery.pending.videos.length>0&&<p>待查询视频：{discovery.pending.videos.join('、')}</p>}</div></section>}
        <section className="panel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-lg">话题指数榜 · Top 20</h3>{!!topTopics.length&&<span className="text-sm text-muted">周期：{topTopics[0].window.begin}-{topTopics[0].window.end}</span>}</div><p className="mt-2 text-sm text-muted">取30天指数排名，共{discovery.keywords.length}个种子词。</p>
          {!discovery.topics.length&&<p className="mt-4 text-sm text-muted">{discovery.pending.topicSearch.length?'话题查询尚未采齐，补齐后自动上榜。':'暂无命中话题；可在「采集 → 采集词」调整采集词。'}</p>}
          {/* 左列 1-10、右列 11-20：整榜 20 条一屏放下，无需分页 */}
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">{[0,1].map(col=><div className="space-y-2" key={col}>{topTopics.slice(col*10,col*10+10).map((t,idx)=><div className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm" key={t.id}><span className="flex min-w-0 items-center gap-2"><RankNo n={col*10+idx+1}/><span className="truncate font-medium text-ink">{t.name}</span></span><span className="shrink-0 font-medium text-ink">{fmtNum(t.index)}</span></div>)}</div>)}</div>
        </section>
        </>}
        {view==="videos"&&<section className="panel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-lg">视频指数榜 · Top 200</h3><div className="flex flex-wrap items-center gap-2"><FilterSelect label="视频类型筛选" value={videoBadge} onChange={setVideoBadge} options={[["","全部类型"],["lowFansHot","低粉爆款"],["highFansRise","高涨粉"],["highLikeRate","高点赞率"],["highPlayOver","高完播率"]]}/><FilterSelect label="视频时间口径" value={videoSort} onChange={value=>setVideoSort(value as "7"|"30")} options={[["7","近7天"],["30","近30天"]]}/></div></div><p className="mt-2 text-sm text-muted">共收集 {discovery.counts.uniqueVideos} 条，排除 {discovery.counts.excludedKeywords} 条。</p>
          {!videos.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的入选视频。':'数据尚未采齐，进度可在「采集 → 记录」查看。'}</p>}
          <div className="mt-4 space-y-2">{videoPage.slice.map(v=><div key={v.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2.5"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><HoverTip text={v.title||v.id}><a className="link block truncate text-sm" href={`https://www.douyin.com/video/${v.id}`} target="_blank" rel="noreferrer">{v.title||v.id}</a></HoverTip></div>{!!v.badges?.length&&<span className="flex shrink-0 gap-1">{v.badges.map(b=><Badge key={b} tone={VIDEO_BADGES[b]?.tone??"gray"}>{VIDEO_BADGES[b]?.label??b}</Badge>)}</span>}</div><p className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-xs leading-6 text-muted tabular-nums"><span className="flex min-w-0 items-baseline gap-2"><span className="max-w-44 truncate font-medium text-ink">{v.authorName||'作者待补全'}</span><span className="w-24 shrink-0">粉丝 <span className="text-ink">{fmtNum(v.fans)}</span></span><span className="w-36 shrink-0">{v.publishedAt?`${String(v.publishedAt).slice(0,16)} 发布`:'发布时间未知'}</span></span><span className="flex shrink-0 items-baseline gap-3"><span className="w-20">点赞 <span className="text-ink">{fmtNum(v.likes)}</span></span><span className="w-24">近7天 <span className="text-ink">{fmtNum(v.indexBy['7'])}</span></span><span className="w-24">近30天 <span className="text-ink">{fmtNum(v.indexBy['30'])}</span></span></span></p></div>)}</div>
          <Pager {...videoPage}/>
        </section>}
        {view==="authors"&&<section className="panel"><h3 className="font-semibold text-lg">达人指数 · Top 10</h3><p className="mt-2 text-sm text-muted">取近30天指数相加为总体指数，平均指数=总体/视频数。</p>{!byTotal.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的达人指数。':'数据尚未采齐，进度可在「采集 → 记录」查看。'}</p>}{!!byTotal.length&&<div className="mt-3 grid grid-cols-1 gap-x-2 md:grid-cols-2">{([["按总体指数",byTotal],["按平均指数",byAverage]] as const).map(([label,list])=><div key={label}><h4 className="mb-2 px-3 text-base font-semibold">{label}</h4><div className="space-y-2">{list.map((a,i)=><div className="flex items-center gap-2 rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm" key={a.key}><RankNo n={i+1}/><a className="link min-w-0 flex-1 truncate" href={a.key.startsWith('sec_uid:')?`https://www.douyin.com/user/${a.key.slice(8)}`:`https://www.douyin.com/search/${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer">{a.name}</a><span className="flex shrink-0 items-baseline gap-2 text-xs text-muted tabular-nums"><span className="w-16"><span className="font-medium text-ink">{a.videos.length}</span>条视频</span><span className="w-20">总体 <span className="font-medium text-ink">{fmtNum(a.totalIndex)}</span></span><span className="w-24">平均 <span className="font-medium text-ink">{fmtNum(a.totalIndex/a.videos.length)}</span></span></span></div>)}</div></div>)}</div>}</section>}
      </>:<section className="panel"><p className="text-sm text-muted">{state?state.credentials?.index?'暂无发现数据；可在「采集 → 采集词」调整采集词与排除词。':'尚未连接抖音指数；请到「采集 → 授权与定时」扫码登录。':'正在加载采集数据…'}</p></section>}
    </div>
  </Page>;
}
