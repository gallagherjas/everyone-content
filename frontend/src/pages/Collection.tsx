import { useCallback,useEffect,useRef,useState } from "react";
import { useApi,fmtNum,fmtTime,type Account } from "../api";
import { FilterSelect, HoverTip, Msg } from "../components/Common";
import { Page } from "../components/Layout";
import { names,reason,statuses } from "../labels";
import { useCachedLoad,useInvalidatePages,usePageVisible } from "../components/PageCache";
import Pager,{usePaged} from "../components/Pager";

interface Run {id:number;provider:string;operation:string;target:string;status:string;observed_at:string;version:string|null;error:string|null}
interface Video {id:string;title:string;indexBy:{'7':number|null;'30':number|null};keyword:string;likes:number;comments:number|null;authorName:string;fans:number|null;duration:number|null;publishedAt:string|null;badges?:string[]}
interface Topic {id:string;name:string;index:number;window:{begin:string;end:string}}
interface Author {key:string;name:string;videos:string[];totalIndex:number}
// 视频官方标记的四色徽章(无边框浅底),未识别类型落灰
const BADGE_TONES:Record<string,string>={lowFansHot:'bg-blue/10 text-blue',highFansRise:'bg-brand/10 text-brand',highLikeRate:'bg-rose/10 text-rose',highPlayOver:'bg-violet/10 text-violet'};
interface State {runs:Run[];budgets:{provider:string;daily_limit:number;used:number}[];indexCredential:boolean;discovery:null|{ready:boolean;keywords:string[];topics:Topic[];videos:Video[];authors:Author[];pending:{topicSearch:string[];videos:string[]};counts:{uniqueVideos:number;eligibleVideos:number;retainedVideos:number;rejected:{likes:number;keywords:number}}}}
export default function CollectionPage({account}:{account:Account}) {
  const api=useApi(),archived=account.status==="archived";
  const [state,setState]=useState<State|null>(null),[view,setView]=useState("discovery"),[authorSort,setAuthorSort]=useState<"total"|"average">("total"),[videoSort,setVideoSort]=useState<"7"|"30">("30"),[videoBadge,setVideoBadge]=useState(""),[runDetail,setRunDetail]=useState<{id:number;text:string}|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[failure,setFailure]=useState(false),[percent,setPercent]=useState<number|null>(null);
  const visible=usePageVisible(),invalidate=useInvalidatePages(),lastRuns=useRef<string|null>(null);
  const load=useCallback(()=>api<State>("/api/collection").then(value=>{
    setState(value);
    const runs=value.runs.map(run=>`${run.id}:${run.status}`).join(',');
    if(lastRuns.current!==null&&lastRuns.current!==runs)invalidate(['contents','sources']);
    lastRuns.current=runs;
  }),[api,invalidate]);
  const refresh=useCallback(()=>{load().catch(e=>setMessage(String(e)));},[load]);
  useCachedLoad('collection',refresh);
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
  // 视频筛选在前端切换：按官方标记类型过滤，按近7天/近30天窗口指数排序（所选窗口缺失的排后面）。
  const rankedVideos=videos.filter(v=>!videoBadge||v.badges?.includes(videoBadge)).sort((a,b)=>(b.indexBy[videoSort]??-1)-(a.indexBy[videoSort]??-1)||a.id.localeCompare(b.id));
  // 达人排序在前端切换：总体指数或平均指数（总体÷视频数），展示前10名。
  const rankedAuthors=[...(discovery?.authors??[])].sort((a,b)=>authorSort==="total"?b.totalIndex-a.totalIndex||a.key.localeCompare(b.key):b.totalIndex/b.videos.length-a.totalIndex/a.videos.length||a.key.localeCompare(b.key)).slice(0,10);
  const topicPage=usePaged(discovery?.topics??[]),videoPage=usePaged(rankedVideos),runPage=usePaged(state?.runs??[]);
  return <Page head="采集" active={view} onPick={key=>{setView(key);setMessage("");}} items={[
    {key:"discovery",label:"话题指数",count:discovery?.topics.length},
    {key:"videos",label:"视频指数",count:discovery?.videos.length},
    {key:"authors",label:"达人指数",count:rankedAuthors.length},
    {key:"runs",label:"采集记录",count:state?.runs.length},
  ]}>
    <div className="space-y-5">
      {["discovery","videos","authors"].includes(view)&&<section className="panel flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4"><h2 className="font-semibold text-xl">采集</h2><span className="text-sm" title="每日采集次数上限，跨账号共用；每天北京时间08:00重置">今日 {state?.budgets.find(b=>b.provider==='index')?.used ?? '—'}/{state?.budgets.find(b=>b.provider==='index')?.daily_limit ?? '—'}</span><span className="text-sm text-muted">根据本帐号配置进行采集，可点击手动采集后即时采集</span></div>
        <div className="flex flex-wrap items-center gap-4">{percent===null?<button className="btn-primary" disabled={archived||busy} onClick={async()=>{try{await api("/api/run/collect",{method:"POST"});wasRunning.current=true;setPercent(0);setMessage("");}catch(e){setFailure(true);setMessage(String(e));}}}>手动采集</button>:<button className="btn-progress"><span className="absolute inset-0 flex items-center justify-center">{percent}%</span><span className="absolute inset-0 flex items-center justify-center bg-brand text-white transition-[clip-path] duration-500" style={{clipPath:`inset(0 ${100-percent}% 0 0)`}}>{percent}%</span></button>}</div>
      </section>}
      {['discovery','videos','authors'].includes(view)&&(discovery?<>
        {view==="discovery"&&<>
        {!discovery.ready&&<section className="panel"><h3 className="font-semibold text-lg">数据尚未采齐</h3><p className="mt-2 text-sm text-muted">当前批次未完成，视频和达人将在补齐后展示。每轮和每日次数有限，可在次数允许时再次点击“手动采集”继续。</p><div className="mt-3 space-y-1 text-sm">{discovery.pending.topicSearch.length>0&&<p>待查询话题：{discovery.pending.topicSearch.join('、')}</p>}{discovery.pending.videos.length>0&&<p>待查询视频：{discovery.pending.videos.join('、')}</p>}</div></section>}
        <section className="panel"><h3 className="font-semibold text-lg">近30天入选话题</h3><p className="mt-2 text-sm text-muted">种子词：{discovery.keywords.join(' · ')||'尚未配置'}。仅保留达标话题。</p>
          {!discovery.topics.length&&<p className="mt-4 text-sm text-muted">{discovery.pending.topicSearch.length?'话题查询尚未采齐，补齐后再按规则筛选。':'暂无满足30天窗口和指数门槛的话题。旧累计数据不会替代30天结果。'}</p>}
          {topicPage.slice.map(t=><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-sm" key={t.id}><strong>{t.name}</strong><span>30天指数 {fmtNum(t.index)} · {t.window.begin}—{t.window.end}</span></div>)}
          <Pager {...topicPage}/>
        </section>
        </>}
        {view==="videos"&&<section className="panel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-lg">入选视频</h3><div className="flex flex-wrap items-center gap-2"><FilterSelect label="视频类型筛选" value={videoBadge} onChange={setVideoBadge} options={[["","全部类型"],["lowFansHot","低粉爆款"],["highFansRise","高涨粉"],["highLikeRate","高点赞率"],["highPlayOver","高完播率"]]}/><FilterSelect label="视频时间口径" value={videoSort} onChange={value=>setVideoSort(value as "7"|"30")} options={[["7","近7天"],["30","近30天"]]}/></div></div><p className="mt-2 text-sm text-muted">合并去重 {discovery.counts.uniqueVideos} 条；点赞不足或未知排除 {discovery.counts.rejected.likes} 条，关键词排除 {discovery.counts.rejected.keywords} 条；达标 {discovery.counts.eligibleVideos} 条，保留 {discovery.counts.retainedVideos} 条。两个窗口指数同等，切换排序查看。</p>
          {!videos.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的入选视频。':'数据尚未采齐，采集进度请查看“话题指数”。'}</p>}
          <div className="mt-4 space-y-4">{videoPage.slice.map(v=><div key={v.id} className="border-t border-line pt-3"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><HoverTip text={v.title||v.id}><a className="link block truncate text-sm" href={`https://www.douyin.com/video/${v.id}`} target="_blank" rel="noreferrer">{v.title||v.id}</a></HoverTip></div>{!!v.badges?.length&&<span className="flex shrink-0 gap-1">{v.badges.map(b=><span key={b} className={`rounded-full px-2 py-0.5 text-xs leading-4 ${BADGE_TONES[b]??'bg-ink/[0.06] text-muted'}`}>{ {lowFansHot:'低粉爆款',highFansRise:'高涨粉',highLikeRate:'高点赞率',highPlayOver:'高完播率'}[b]??b}</span>)}</span>}</div><p className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs leading-6 text-muted"><span><span className="text-ink">{v.authorName||'作者待补全'}</span>{' · 粉丝 '}<span className="text-ink">{fmtNum(v.fans)}</span>{v.publishedAt?` · ${String(v.publishedAt).slice(0,16)} 发布`:' · 发布时间未知'}</span><span>点赞 <span className="text-ink">{fmtNum(v.likes)}</span>{' · 近7天 '}<span className="text-ink">{fmtNum(v.indexBy['7'])}</span>{' · 近30天 '}<span className="text-ink">{fmtNum(v.indexBy['30'])}</span></span></p></div>)}</div>
          <Pager {...videoPage}/>
        </section>}
        {view==="authors"&&<section className="panel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-lg">达人指数</h3><FilterSelect label="达人口径筛选" value={authorSort} onChange={value=>setAuthorSort(value as "total"|"average")} options={[["total","按总体指数"],["average","按平均指数"]]}/></div><p className="mt-2 text-sm text-muted">入选视频按作者归类，近30天指数相加为总体指数，平均指数=总体÷视频数；展示前10名。昵称不能作为已核实身份。</p>{!rankedAuthors.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的达人指数。':'数据尚未采齐，采集进度请查看“话题指数”。'}</p>}<div className="mt-3 space-y-3">{rankedAuthors.map((a,i)=><div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm" key={a.key}><span className="flex items-baseline gap-2"><a className="link" href={a.key.startsWith('sec_uid:')?`https://www.douyin.com/user/${a.key.slice(8)}`:`https://www.douyin.com/search/${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer">{i+1}. {a.name}</a>{a.key.startsWith('nickname:')&&<span className="text-xs text-muted">主页身份待核实</span>}</span><span className="text-xs text-muted">{a.videos.length}条视频 · 总体 {fmtNum(a.totalIndex)} · 平均 {fmtNum(a.totalIndex/a.videos.length)}</span></div>)}</div></section>}
      </>:<section className="panel"><p className="text-sm text-muted">{state?state.indexCredential?'暂无发现数据；可在“设置 → 关键词”调整采集词与排除词，在“设置 → 采集设置”调整筛选参数。':'尚未连接抖音指数；请到“设置 → 采集设置”扫码登录。':'正在加载采集数据…'}</p></section>)}
      {view==="runs"&&<section className="panel"><h3 className="font-semibold text-lg">最近采集记录</h3><p className="mt-2 text-sm text-muted">时间均为北京时间。“查看记录”展示本次采集的入库数据。</p><div className="mt-4 space-y-3">{runPage.slice.map(r=><div key={r.id} className="border-t border-line pt-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{names[r.provider]} · {r.operation} · {r.target}<span className="ml-2 text-xs text-muted">{fmtTime(r.observed_at)}{r.version?` · 数据版本 ${r.version}`:""}</span></span><span>{statuses[r.status]??r.status}{r.error?` · ${reason(r.error)}`:""}{r.status==="ok"&&<a className="link ml-3" href="#" onClick={e=>{e.preventDefault();if(runDetail?.id===r.id){setRunDetail(null);return;}api<{observed_at:string}>(`/api/collection/records/${r.id}`).then(data=>setRunDetail({id:r.id,text:JSON.stringify({...data,observed_at:fmtTime(data.observed_at)},null,2)})).catch(err=>{setFailure(true);setMessage(String(err));});}}>{runDetail?.id===r.id?'收起记录':'查看记录'}</a>}</span></div>{runDetail?.id===r.id&&<div className="codebox mt-2 max-h-96">{runDetail.text}</div>}</div>)}</div>{!state?.runs.length&&<p className="py-4 text-sm text-muted">尚无采集记录；手动采集后生成。</p>}<Pager {...runPage}/></section>}
      {message&&<Msg tone={failure?"error":"ok"}><span className="block max-h-96 overflow-auto whitespace-pre-wrap break-all">{message}</span></Msg>}
    </div>
  </Page>;
}
