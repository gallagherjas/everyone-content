import { useCallback,useEffect,useRef,useState } from "react";
import { useApi,fmtNum,fmtTime,type Account } from "../api";
import { Badge,ConfirmBtn,FilterSelect,HoverTip,Msg,type BadgeTone } from "../components/Common";
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
interface State {runs:Run[];budgets:{provider:string;daily_limit:number;used:number}[];credentials:Record<string,boolean>;discovery:null|{ready:boolean;keywords:string[];topics:Topic[];videos:Video[];authors:Author[];pending:{topicSearch:string[];videos:string[]};counts:{uniqueVideos:number;excludedKeywords:number}}}
interface Source {id:number;kind:string;source_key:string;name:string;status:string;note:string}
interface Sources {keywords:Source[]}
export default function CollectionPage({account}:{account:Account}) {
  const api=useApi(),archived=account.status==="archived";
  const [state,setState]=useState<State|null>(null),[view,setView]=useState("discovery"),[authorSort,setAuthorSort]=useState<"total"|"average">("total"),[videoSort,setVideoSort]=useState<"7"|"30">("30"),[videoBadge,setVideoBadge]=useState(""),[runDetail,setRunDetail]=useState<{id:number;text:string}|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[failure,setFailure]=useState(false),[percent,setPercent]=useState<number|null>(null);
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
  const srcStatus=(s:string):{label:string;tone:BadgeTone}=>s==="ready"?{label:"已启用",tone:"brand"}:{label:"已暂停",tone:"gray"};
  const sourceRowActions=(s:Source)=>{const st=srcStatus(s.status);return <>
    <Badge tone={st.tone}>{st.label}</Badge>
    <button className="btn-sm" disabled={archived||busy} onClick={()=>action(async()=>{await api(`/api/sources/${s.id}`,{method:"PUT",body:JSON.stringify({status:s.status==="ready"?"paused":"ready"})});},"状态已更新。")}>{s.status==="ready"?"暂停":"启用"}</button>
    <ConfirmBtn label="移出" confirmLabel="确认移出" disabled={archived||busy} onConfirm={()=>action(async()=>{await api(`/api/sources/${s.id}`,{method:"DELETE"});},"已移出。")}/>
  </>;};
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
  // 达人排序在前端切换：总体指数或平均指数（总体÷视频数），展示前10名。
  const rankedAuthors=[...(discovery?.authors??[])].sort((a,b)=>authorSort==="total"?b.totalIndex-a.totalIndex||a.key.localeCompare(b.key):b.totalIndex/b.videos.length-a.totalIndex/a.videos.length||a.key.localeCompare(b.key)).slice(0,10);
  const topTopics=(discovery?.topics??[]).slice(0,20);
  const topicPage=usePaged(topTopics),videoPage=usePaged(rankedVideos),runPage=usePaged(state?.runs??[]),keywordPage=usePaged(src.keywords);
  return <Page head="指数采集" active={view} onPick={key=>{setView(key);setMessage("");}} items={[
    {key:"discovery",label:"话题指数",count:discovery?Math.min(discovery.topics.length,20):undefined},
    {key:"videos",label:"视频指数",count:discovery?Math.min(rankedVideos.length,200):undefined},
    {key:"authors",label:"达人指数",count:discovery?rankedAuthors.length:undefined},
    {key:"runs",label:"采集记录"},
    {key:"keywords",label:"关键词",count:src.keywords.length},
  ]}>
    <div className="space-y-5">
      {["discovery","videos","authors"].includes(view)&&<section className="panel flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4"><h2 className="font-semibold text-xl">指数采集</h2><span className="text-sm" title="每日采集次数上限，跨账号共用；每天北京时间08:00重置">今日 {state?.budgets.find(b=>b.provider==='index')?.used ?? '—'}/{state?.budgets.find(b=>b.provider==='index')?.daily_limit ?? '—'}</span><span className="text-sm text-muted">根据本帐号配置进行采集，可点击手动采集后即时采集</span></div>
        <div className="flex flex-wrap items-center gap-4">{percent===null?<button className="btn-primary" disabled={archived||busy} onClick={async()=>{try{await api("/api/run/collect",{method:"POST"});wasRunning.current=true;setPercent(0);setMessage("");}catch(e){setFailure(true);setMessage(String(e));}}}>手动采集</button>:<button className="btn-progress"><span className="absolute inset-0 flex items-center justify-center">{percent}%</span><span className="absolute inset-0 flex items-center justify-center bg-brand text-white transition-[clip-path] duration-500" style={{clipPath:`inset(0 ${100-percent}% 0 0)`}}>{percent}%</span></button>}</div>
      </section>}
      {['discovery','videos','authors'].includes(view)&&(discovery?<>
        {view==="discovery"&&<>
        {!discovery.ready&&<section className="panel"><h3 className="font-semibold text-lg">数据尚未采齐</h3><p className="mt-2 text-sm text-muted">当前批次未完成，视频和达人将在补齐后展示。每轮和每日次数有限，可在次数允许时再次点击“手动采集”继续。</p><div className="mt-3 space-y-1 text-sm">{discovery.pending.topicSearch.length>0&&<p>待查询话题：{discovery.pending.topicSearch.join('、')}</p>}{discovery.pending.videos.length>0&&<p>待查询视频：{discovery.pending.videos.join('、')}</p>}</div></section>}
        <section className="panel"><h3 className="font-semibold text-lg">话题指数榜 · Top 20</h3><p className="mt-2 text-sm text-muted">种子词：{discovery.keywords.join(' · ')||'尚未配置'}；搜索全部命中话题，按近30天指数排名。</p>
          {!discovery.topics.length&&<p className="mt-4 text-sm text-muted">{discovery.pending.topicSearch.length?'话题查询尚未采齐，补齐后自动上榜。':'暂无命中话题；可在「关键词」调整采集词。'}</p>}
          <div className="mt-4 space-y-2">{topicPage.slice.map((t,idx)=><div className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm" key={t.id}><span className="flex items-baseline gap-2"><span className="w-6 text-right text-xs text-faint">{(topicPage.page-1)*topicPage.pageSize+idx+1}</span><span className="font-medium text-ink">{t.name}</span></span><span className="text-muted">30天指数 <span className="font-medium text-ink">{fmtNum(t.index)}</span> · {t.window.begin}—{t.window.end}</span></div>)}</div>
          <Pager {...topicPage}/>
        </section>
        </>}
        {view==="videos"&&<section className="panel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-lg">视频指数榜 · Top 200</h3><div className="flex flex-wrap items-center gap-2"><FilterSelect label="视频类型筛选" value={videoBadge} onChange={setVideoBadge} options={[["","全部类型"],["lowFansHot","低粉爆款"],["highFansRise","高涨粉"],["highLikeRate","高点赞率"],["highPlayOver","高完播率"]]}/><FilterSelect label="视频时间口径" value={videoSort} onChange={value=>setVideoSort(value as "7"|"30")} options={[["7","近7天"],["30","近30天"]]}/></div></div><p className="mt-2 text-sm text-muted">合并去重 {discovery.counts.uniqueVideos} 条；排除词排除 {discovery.counts.excludedKeywords} 条；按所选口径的指数排名展示前 200。</p>
          {!videos.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的入选视频。':'数据尚未采齐，采集进度请查看“话题指数”。'}</p>}
          <div className="mt-4 space-y-2">{videoPage.slice.map(v=><div key={v.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2.5"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><HoverTip text={v.title||v.id}><a className="link block truncate text-sm" href={`https://www.douyin.com/video/${v.id}`} target="_blank" rel="noreferrer">{v.title||v.id}</a></HoverTip></div>{!!v.badges?.length&&<span className="flex shrink-0 gap-1">{v.badges.map(b=><Badge key={b} tone={BADGE_TONE[b]??"gray"}>{ {lowFansHot:'低粉爆款',highFansRise:'高涨粉',highLikeRate:'高点赞率',highPlayOver:'高完播率'}[b]??b}</Badge>)}</span>}</div><p className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs leading-6 text-muted"><span><span className="text-ink">{v.authorName||'作者待补全'}</span>{' · 粉丝 '}<span className="text-ink">{fmtNum(v.fans)}</span>{v.publishedAt?` · ${String(v.publishedAt).slice(0,16)} 发布`:' · 发布时间未知'}</span><span>点赞 <span className="text-ink">{fmtNum(v.likes)}</span>{' · 近7天 '}<span className="text-ink">{fmtNum(v.indexBy['7'])}</span>{' · 近30天 '}<span className="text-ink">{fmtNum(v.indexBy['30'])}</span></span></p></div>)}</div>
          <Pager {...videoPage}/>
        </section>}
        {view==="authors"&&<section className="panel"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-lg">达人指数</h3><FilterSelect label="达人口径筛选" value={authorSort} onChange={value=>setAuthorSort(value as "total"|"average")} options={[["total","按总体指数"],["average","按平均指数"]]}/></div><p className="mt-2 text-sm text-muted">入选视频按作者归类，近30天指数相加为总体指数，平均指数=总体÷视频数；展示前10名。昵称不能作为已核实身份。</p>{!rankedAuthors.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的达人指数。':'数据尚未采齐，采集进度请查看“话题指数”。'}</p>}<div className="mt-3 space-y-2">{rankedAuthors.map((a,i)=><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm" key={a.key}><span className="flex items-baseline gap-2"><a className="link" href={a.key.startsWith('sec_uid:')?`https://www.douyin.com/user/${a.key.slice(8)}`:`https://www.douyin.com/search/${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer">{i+1}. {a.name}</a>{a.key.startsWith('nickname:')&&<span className="text-xs text-muted">主页身份待核实</span>}</span><span className="text-xs text-muted">{a.videos.length}条视频 · 总体 <span className="font-medium text-ink">{fmtNum(a.totalIndex)}</span> · 平均 <span className="font-medium text-ink">{fmtNum(a.totalIndex/a.videos.length)}</span></span></div>)}</div></section>}
      </>:<section className="panel"><p className="text-sm text-muted">{state?state.credentials?.index?'暂无发现数据；可在左侧「关键词」调整采集词与排除词。':'尚未连接抖音指数；请到“设置 → 采集设置”扫码登录。':'正在加载采集数据…'}</p></section>)}
      {view==="runs"&&<section className="panel"><h3 className="font-semibold text-lg">最近采集记录</h3><p className="mt-2 text-sm text-muted">时间均为北京时间。“查看记录”展示本次采集的入库数据。</p><div className="mt-4 space-y-2">{runPage.slice.map(r=><div key={r.id} className="rounded-lg border border-line/70 bg-canvas/50 px-3 py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>{names[r.provider]} · {r.operation} · {r.target}<span className="ml-2 text-xs text-muted">{fmtTime(r.observed_at)}{r.version?` · 数据版本 ${r.version}`:""}</span></span><span className="flex items-center gap-2"><Badge tone={RUN_TONE[r.status]??"gray"}>{statuses[r.status]??r.status}</Badge>{r.error&&<span className="text-danger">{reason(r.error)}</span>}{r.status==="ok"&&<a className="link ml-1" href="#" onClick={e=>{e.preventDefault();if(runDetail?.id===r.id){setRunDetail(null);return;}api<{observed_at:string}>(`/api/collection/records/${r.id}`).then(data=>setRunDetail({id:r.id,text:JSON.stringify({...data,observed_at:fmtTime(data.observed_at)},null,2)})).catch(err=>{setFailure(true);setMessage(String(err));});}}>{runDetail?.id===r.id?'收起记录':'查看记录'}</a>}</span></div>{runDetail?.id===r.id&&<div className="codebox mt-2 max-h-96">{runDetail.text}</div>}</div>)}</div>{!state?.runs.length&&<p className="py-4 text-sm text-muted">尚无采集记录；手动采集后生成。</p>}<Pager {...runPage}/></section>}
      {view==="keywords"&&<section className="panel space-y-5">
        <h2 className="font-semibold text-xl">关键词筛选</h2>
        {/* 采集词与排除词两块镜像排列：标签+计数 → 说明 → 输入行 → 列表 */}
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="source-keyword">采集关键词<span className="ml-2 text-xs font-normal text-muted">{src.keywords.length} 个</span></label>
          <p className="text-xs leading-6 text-muted">启用抖音指数后用于话题和视频查询，未启用时仅匹配已有的公开作品。</p>
          <div className="flex gap-2"><input id="source-keyword" className="field flex-1" value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="例如：效率工具、职场技能、日常生活" aria-label="新增关键词" maxLength={80} disabled={archived}/><button className="btn-primary shrink-0" disabled={archived||busy||!keyword.trim()} onClick={()=>action(async()=>{await api("/api/keywords",{method:"POST",body:JSON.stringify({keyword})});setKeyword("");},"已添加关键词。")}>添加</button></div>
          <div className="space-y-2">{keywordPage.slice.map(s=><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-3" key={s.id}><span className="text-sm">{s.name}{s.note&&<span className="ml-3 text-xs text-muted">{s.note}</span>}</span><div className="flex items-center gap-2">{sourceRowActions(s)}</div></div>)}{!src.keywords.length&&<p className="text-sm text-muted">尚未添加</p>}</div>
          <Pager {...keywordPage}/>
        </div>
        <ExcludeKeywords disabled={archived}/>
      </section>}
      {message&&<Msg tone={failure?"error":"ok"}><span className="block max-h-96 overflow-auto whitespace-pre-wrap break-all">{message}</span></Msg>}
    </div>
  </Page>;
}
