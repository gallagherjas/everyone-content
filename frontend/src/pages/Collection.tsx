import { useCallback,useEffect,useRef,useState } from "react";
import { useApi,fmtNum,fmtTime,type Account } from "../api";
import { Badge,FilterSelect,HoverTip,Msg,type BadgeTone } from "../components/Common";
import { Page } from "../components/Layout";
import ExcludeKeywords from "../components/ExcludeKeywords";
import { names,reason,statuses } from "../labels";
import { useCachedLoad,useInvalidatePages,usePageVisible } from "../components/PageCache";
import Pager,{usePaged} from "../components/Pager";

interface Run {id:number;provider:string;operation:string;target:string;status:string;observed_at:string;version:string|null;error:string|null}
interface Video {id:string;title:string;indexBy:{'7':number|null;'30':number|null};keyword:string;likes:number;comments:number|null;authorName:string;fans:number|null;duration:number|null;publishedAt:string|null;badges?:string[]}
interface Topic {id:string;name:string;index:number;window:{begin:string;end:string}}
interface Author {key:string;name:string;videos:string[];totalIndex:number}
// 视频官方标记的徽章色相,未识别类型落灰;采集状态徽章:完成绿、失败红、进行中玫红、复用缓存灰
const BADGE_TONE:Record<string,BadgeTone>={lowFansHot:'blue',highFansRise:'brand',highLikeRate:'rose',highPlayOver:'violet'};
const RUN_TONE:Record<string,BadgeTone>={ok:"up",failed:"danger",running:"warn",cached:"gray",deferred:"warn"};
/** 名次徽标:前三名用系统内置奖牌 emoji,其余灰色数字,统一居中 */
function RankNo({n}:{n:number}){
  return <span className="w-5 shrink-0 text-center leading-none">{n<=3?["🥇","🥈","🥉"][n-1]:<span className="text-xs text-faint">{n}</span>}</span>;
}
interface State {runs:Run[];budgets:{provider:string;daily_limit:number;used:number}[];credentials:Record<string,boolean>;discovery:null|{ready:boolean;keywords:string[];topics:Topic[];videos:Video[];authors:Author[];pending:{topicSearch:string[];videos:string[]};counts:{uniqueVideos:number;excludedKeywords:number}}}
interface Source {id:number;kind:string;source_key:string;name:string;status:string;note:string}
interface Sources {keywords:Source[]}
export default function CollectionPage({account}:{account:Account}) {
  const api=useApi(),archived=account.status==="archived";
  const [state,setState]=useState<State|null>(null),[view,setView]=useState("discovery"),[videoSort,setVideoSort]=useState<"7"|"30">("30"),[videoBadge,setVideoBadge]=useState(""),[runDetail,setRunDetail]=useState<{id:number;text:string}|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[failure,setFailure]=useState(false),[percent,setPercent]=useState<number|null>(null);
  const [src,setSrc]=useState<Sources>({keywords:[]}),[keyword,setKeyword]=useState("");
  const visible=usePageVisible(),invalidate=useInvalidatePages(),lastRuns=useRef<string|null>(null);
  const load=useCallback(()=>api<State>("/api/collection").then(value=>{
    setState(value);
    const runs=value.runs.map(run=>`${run.id}:${run.status}`).join(',');
    if(lastRuns.current!==null&&lastRuns.current!==runs)invalidate(['monitor','sources']);
    lastRuns.current=runs;
  }),[api,invalidate]);
  const refresh=useCallback(()=>{load().catch(e=>setMessage(String(e)));},[load]);
  useCachedLoad('collection',refresh);
  const loadSources=useCallback(()=>api<Sources>("/api/sources").then(setSrc).catch(e=>{setFailure(true);setMessage(String(e));}),[api]);
  useCachedLoad('sources',loadSources);
  useEffect(()=>{if(!visible)return;const timer=setInterval(refresh,10000);return()=>clearInterval(timer);},[visible,refresh]);
  const wasRunning=useRef(false);
  useEffect(()=>{
    if(!visible)return;let alive=true;
    const poll=()=>api<{running:boolean;progress:number|null}>("/api/collection/progress").then(p=>{
      if(!alive)return;
      setPercent(p.running?(p.progress??0):null);
      if(p.running)wasRunning.current=true;
      else if(wasRunning.current){wasRunning.current=false;refresh();setMessage("采集完成，结果已更新。");}
    }).catch(()=>{});
    poll();
    const timer=setInterval(poll,1500);
    return()=>{alive=false;clearInterval(timer);};
  },[visible,refresh,api]);
  const action=async(fn:()=>Promise<unknown>,text:string)=>{if(busy)return;setBusy(true);setFailure(false);setMessage("");try{const value=await fn();setMessage(typeof value==="string"?value:text);}catch(e){setFailure(true);setMessage(String(e));}finally{setBusy(false);}};
  const discovery=state?.discovery,videos=discovery?.videos??[];
  // 榜单在前端定口径：视频按所选窗口指数全局排序取 Top200，再按官方标记类型过滤；达人与话题同理取前 N。
  const rankedVideos=videos.slice().sort((a,b)=>(b.indexBy[videoSort]??-1)-(a.indexBy[videoSort]??-1)||a.id.localeCompare(b.id)).slice(0,200).filter(v=>!videoBadge||v.badges?.includes(videoBadge));
  // 达人双榜同屏：左列按总体指数、右列按平均指数（总体÷视频数），各展示前10名。
  const byTotal=[...(discovery?.authors??[])].sort((a,b)=>b.totalIndex-a.totalIndex||a.key.localeCompare(b.key)).slice(0,10);
  const byAverage=[...(discovery?.authors??[])].sort((a,b)=>b.totalIndex/b.videos.length-a.totalIndex/a.videos.length||a.key.localeCompare(b.key)).slice(0,10);
  const topTopics=(discovery?.topics??[]).slice(0,20);
  const videoPage=usePaged(rankedVideos),runPage=usePaged(state?.runs??[]);
  return <Page head="指数采集" active={view} onPick={key=>{setView(key);setMessage("");}} items={[
    {key:"discovery",label:"话题指数"},
    {key:"videos",label:"视频指数"},
    {key:"authors",label:"达人指数"},
    {key:"runs",label:"采集记录"},
    {key:"keywords",label:"关键词"},
  ]}>
    <div className="space-y-5">
      {["discovery","videos","authors"].includes(view)&&<section className="panel flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4"><h2 className="font-semibold text-xl">指数采集</h2><span className="text-sm" title="每日采集次数上限，跨账号共用；每天北京时间08:00重置">今日 {state?.budgets.find(b=>b.provider==='index')?.used ?? '—'}/{state?.budgets.find(b=>b.provider==='index')?.daily_limit ?? '—'}</span><span className="text-sm text-muted">根据本帐号配置进行采集，可点击手动采集后即时采集</span></div>
        <div className="flex flex-wrap items-center gap-4">{percent===null?<button className="btn-primary" disabled={archived||busy} onClick={async()=>{try{await api("/api/run/collect",{method:"POST"});wasRunning.current=true;setPercent(0);setMessage("");}catch(e){setFailure(true);setMessage(String(e));}}}>手动采集</button>:<button className="btn-progress"><span className="absolute inset-0 flex items-center justify-center">{percent}%</span><span className="absolute inset-0 flex items-center justify-center bg-brand text-white transition-[clip-path] duration-500" style={{clipPath:`inset(0 ${100-percent}% 0 0)`}}>{percent}%</span></button>}</div>
      </section>}
      {['discovery','videos','authors'].includes(view)&&(discovery?<>
        {view==="discovery"&&<>
        {!discovery.ready&&<section className="panel"><h3 className="font-semibold text-lg">数据尚未采齐</h3><p className="mt-2 text-sm text-muted">当前批次未完成，视频和达人将在补齐后展示。每轮和每日次数有限，可在次数允许时再次点击“手动采集”继续。</p><div className="mt-3 space-y-1 text-sm">{discovery.pending.topicSearch.length>0&&<p>待查询话题：{discovery.pending.topicSearch.join('、')}</p>}{discovery.pending.videos.length>0&&<p>待查询视频：{discovery.pending.videos.join('、')}</p>}</div></section>}
        <section className="panel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-lg">话题指数榜 · Top 20</h3>{!!topTopics.length&&<span className="text-sm text-muted">周期：{topTopics[0].window.begin}-{topTopics[0].window.end}</span>}</div><p className="mt-2 text-sm text-muted">取30天指数排名，共{discovery.keywords.length}个种子词。</p>
          {!discovery.topics.length&&<p className="mt-4 text-sm text-muted">{discovery.pending.topicSearch.length?'话题查询尚未采齐，补齐后自动上榜。':'暂无命中话题；可在「关键词」调整采集词。'}</p>}
          {/* 左列 1-10、右列 11-20：整榜 20 条一屏放下，无需分页 */}
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">{[0,1].map(col=><div className="space-y-2" key={col}>{topTopics.slice(col*10,col*10+10).map((t,idx)=><div className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm" key={t.id}><span className="flex min-w-0 items-center gap-2"><RankNo n={col*10+idx+1}/><span className="truncate font-medium text-ink">{t.name}</span></span><span className="shrink-0 font-medium text-ink">{fmtNum(t.index)}</span></div>)}</div>)}</div>
        </section>
        </>}
        {view==="videos"&&<section className="panel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-lg">视频指数榜 · Top 200</h3><div className="flex flex-wrap items-center gap-2"><FilterSelect label="视频类型筛选" value={videoBadge} onChange={setVideoBadge} options={[["","全部类型"],["lowFansHot","低粉爆款"],["highFansRise","高涨粉"],["highLikeRate","高点赞率"],["highPlayOver","高完播率"]]}/><FilterSelect label="视频时间口径" value={videoSort} onChange={value=>setVideoSort(value as "7"|"30")} options={[["7","近7天"],["30","近30天"]]}/></div></div><p className="mt-2 text-sm text-muted">共收集 {discovery.counts.uniqueVideos} 条，排除 {discovery.counts.excludedKeywords} 条。</p>
          {!videos.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的入选视频。':'数据尚未采齐，采集进度请查看“话题指数”。'}</p>}
          <div className="mt-4 space-y-2">{videoPage.slice.map(v=><div key={v.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2.5"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><HoverTip text={v.title||v.id}><a className="link block truncate text-sm" href={`https://www.douyin.com/video/${v.id}`} target="_blank" rel="noreferrer">{v.title||v.id}</a></HoverTip></div>{!!v.badges?.length&&<span className="flex shrink-0 gap-1">{v.badges.map(b=><Badge key={b} tone={BADGE_TONE[b]??"gray"}>{ {lowFansHot:'低粉爆款',highFansRise:'高涨粉',highLikeRate:'高点赞率',highPlayOver:'高完播率'}[b]??b}</Badge>)}</span>}</div><p className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs leading-6 text-muted"><span><span className="text-ink">{v.authorName||'作者待补全'}</span>{' · 粉丝 '}<span className="text-ink">{fmtNum(v.fans)}</span>{v.publishedAt?` · ${String(v.publishedAt).slice(0,16)} 发布`:' · 发布时间未知'}</span><span>点赞 <span className="text-ink">{fmtNum(v.likes)}</span>{' · 近7天 '}<span className="text-ink">{fmtNum(v.indexBy['7'])}</span>{' · 近30天 '}<span className="text-ink">{fmtNum(v.indexBy['30'])}</span></span></p></div>)}</div>
          <Pager {...videoPage}/>
        </section>}
        {view==="authors"&&<section className="panel"><h3 className="font-semibold text-lg">达人指数 · Top 10</h3><p className="mt-2 text-sm text-muted">取近30天指数相加为总体指数，平均指数=总体/视频数。</p>{!byTotal.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的达人指数。':'数据尚未采齐，采集进度请查看“话题指数”。'}</p>}{!!byTotal.length&&<div className="mt-3 grid grid-cols-1 gap-x-2 md:grid-cols-2">{([["按总体指数",byTotal],["按平均指数",byAverage]] as const).map(([label,list])=><div key={label}><h4 className="mb-2 px-3 text-base font-semibold">{label}</h4><div className="space-y-2">{list.map((a,i)=><div className="flex items-center gap-2 rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm" key={a.key}><RankNo n={i+1}/><a className="link min-w-0 flex-1 truncate" href={a.key.startsWith('sec_uid:')?`https://www.douyin.com/user/${a.key.slice(8)}`:`https://www.douyin.com/search/${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer">{a.name}</a><span className="flex shrink-0 items-baseline gap-2 text-xs text-muted tabular-nums"><span className="w-16"><span className="font-medium text-ink">{a.videos.length}</span>条视频</span><span className="w-20">总体 <span className="font-medium text-ink">{fmtNum(a.totalIndex)}</span></span><span className="w-24">平均 <span className="font-medium text-ink">{fmtNum(a.totalIndex/a.videos.length)}</span></span></span></div>)}</div></div>)}</div>}</section>}
      </>:<section className="panel"><p className="text-sm text-muted">{state?state.credentials?.index?'暂无发现数据；可在左侧「关键词」调整采集词与排除词。':'尚未连接抖音指数；请到“设置 → 采集设置”扫码登录。':'正在加载采集数据…'}</p></section>)}
      {view==="runs"&&<section className="panel"><h3 className="font-semibold text-lg">最近采集记录</h3><p className="mt-2 text-sm text-muted">时间均为北京时间。“查看记录”展示本次采集的入库数据。</p><div className="mt-4 space-y-2">{runPage.slice.map(r=><div key={r.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>{names[r.provider]} · {r.operation} · {r.target}<span className="ml-2 text-xs text-muted">{fmtTime(r.observed_at)}{r.version?` · 数据版本 ${r.version}`:""}</span></span><span className="flex items-center gap-2"><Badge tone={RUN_TONE[r.status]??"gray"}>{statuses[r.status]??r.status}</Badge>{r.error&&<span className="text-danger">{reason(r.error)}</span>}{r.status==="ok"&&<a className="link ml-1" href="#" onClick={e=>{e.preventDefault();if(runDetail?.id===r.id){setRunDetail(null);return;}api<{observed_at:string}>(`/api/collection/records/${r.id}`).then(data=>setRunDetail({id:r.id,text:JSON.stringify({...data,observed_at:fmtTime(data.observed_at)},null,2)})).catch(err=>{setFailure(true);setMessage(String(err));});}}>{runDetail?.id===r.id?'收起记录':'查看记录'}</a>}</span></div>{runDetail?.id===r.id&&<div className="codebox mt-2 max-h-96">{runDetail.text}</div>}</div>)}</div>{!state?.runs.length&&<p className="py-4 text-sm text-muted">尚无采集记录；手动采集后生成。</p>}<Pager {...runPage}/></section>}
      {view==="keywords"&&<section className="panel space-y-5">
        <h2 className="font-semibold text-xl">关键词筛选</h2>
        {/* 采集词与排除词两块镜像排列：标签+计数 → 说明 → 输入行 → 列表 */}
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="source-keyword">采集关键词<span className="ml-2 text-xs font-normal text-muted">{src.keywords.length} 个</span></label>
          <p className="text-xs leading-6 text-muted">启用抖音指数后用于话题和视频查询，每个关键词需要调用3次抖音指数。</p>
          <div className="flex gap-2"><input id="source-keyword" className="field flex-1" value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="例如：效率工具、职场技能、日常生活" aria-label="新增关键词" maxLength={80} disabled={archived}/><button className="btn-primary shrink-0" disabled={archived||busy||!keyword.trim()} onClick={()=>action(async()=>{await api("/api/keywords",{method:"POST",body:JSON.stringify({keyword})});setKeyword("");},"已添加关键词。")}>添加</button></div>
          {/* 与排除词同款小卡片：词 + × 直接移出，无状态概念 */}
          <div className="flex flex-wrap gap-2">{src.keywords.map(s=><span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-canvas pl-3 pr-1 text-sm" key={s.id}><span className="break-all">{s.name}</span><button type="button" className="rounded-full px-2 py-1 text-muted hover:text-danger disabled:opacity-40" aria-label={`移除关键词“${s.name}”`} disabled={archived||busy} onClick={()=>action(async()=>{await api(`/api/sources/${s.id}`,{method:"DELETE"});},"已移出。")}>×</button></span>)}{!src.keywords.length&&<p className="text-sm text-muted">尚未添加</p>}</div>
        </div>
        <ExcludeKeywords disabled={archived}/>
      </section>}
      {message&&<Msg tone={failure?"error":"ok"}><span className="block max-h-96 overflow-auto whitespace-pre-wrap break-all">{message}</span></Msg>}
    </div>
  </Page>;
}
