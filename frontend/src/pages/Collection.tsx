import { useCallback,useEffect,useRef,useState } from "react";
import { useApi,fmtNum,fmtTime,type Account } from "../api";
import { Msg } from "../components/Common";
import { Page } from "../components/Layout";
import { names,reason,statuses } from "../labels";
import { useCachedLoad,useInvalidatePages,usePageVisible } from "../components/PageCache";
import { BudgetGrid } from "../components/SourceBudgets";
import Pager,{usePaged} from "../components/Pager";

interface Task {key:string;provider:string;operation:string;target:string;next_run_at:number;last_success_at:number|null;error:string|null;source_error:string|null;paused:number;disabled:number}
interface Run {id:number;provider:string;operation:string;target:string;status:string;observed_at:string;version:string|null;error:string|null}
interface Video {id:string;title:string;index:number|null;likes:number;comments:number|null;authorName:string;fans:number|null;duration:number|null;indexScope:{keyword:string;version:string;days:number}|null}
interface Topic {id:string;name:string;index:number;window:{begin:string;end:string};boards:{likes:{id:string;name:string;value:number|null}[];comments:{id:string;name:string;value:number|null}[]}}
interface Author {key:string;name:string;videos:string[];topics:string[];boards:string[]}
interface State {tasks:Task[];runs:Run[];budgets:{provider:string;daily_limit:number;used:number}[];indexCredential:boolean;discovery:null|{ready:boolean;keywords:string[];topics:Topic[];videos:Video[];authors:Author[];pending:{topicSearch:string[];videos:string[];topicRelations:string[]};counts:{uniqueVideos:number;eligibleVideos:number;retainedVideos:number;rejected:{likes:number;keywords:number}}}}
export default function CollectionPage({account}:{account:Account}) {
  const api=useApi(),archived=account.status==="archived";
  const [state,setState]=useState<State|null>(null),[view,setView]=useState("discovery"),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[failure,setFailure]=useState(false),[percent,setPercent]=useState<number|null>(null);
  const visible=usePageVisible(),invalidate=useInvalidatePages(),lastRuns=useRef<string|null>(null);
  const load=useCallback(()=>api<State>("/api/collection").then(value=>{
    setState(value);
    const runs=value.runs.map(run=>`${run.id}:${run.status}`).join(',');
    if(lastRuns.current!==null&&lastRuns.current!==runs)invalidate(['bloggers','contents','sources']);
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
  const topicPage=usePaged(discovery?.topics??[]),videoPage=usePaged(videos),authorPage=usePaged(discovery?.authors??[]),taskPage=usePaged(state?.tasks??[]),runPage=usePaged(state?.runs??[]);
  return <Page head="采集" active={view} onPick={key=>{setView(key);setMessage("");}} items={[
    {key:"discovery",label:"发现结果",count:discovery?.topics.length},
    {key:"videos",label:"入选视频",count:discovery?.videos.length},
    {key:"authors",label:"达人候选",count:discovery?.authors.length},
    {key:"tasks",label:"采集任务",count:state?.tasks.length},
    {key:"runs",label:"采集记录",count:state?.runs.length},
  ]}>
    <div className="space-y-5">
      {view==="discovery"&&<section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl">{account.name} · 采集</h2><p className="mt-2 text-sm text-muted">根据本帐号配置进行采集，可点击手动采集后即时采集</p></div>{percent===null?<button className="btn-primary" disabled={archived||busy} onClick={async()=>{try{await api("/api/run/collect",{method:"POST"});wasRunning.current=true;setPercent(0);setMessage("");}catch(e){setFailure(true);setMessage(String(e));}}}>手动采集</button>:<button className="btn-progress"><span className="absolute inset-0 flex items-center justify-center">{percent}%</span><span className="absolute inset-0 flex items-center justify-center bg-brand text-paper transition-[clip-path] duration-500" style={{clipPath:`inset(0 ${100-percent}% 0 0)`}}>{percent}%</span></button>}</div>
        <div className="mt-4"><BudgetGrid budgets={state?.budgets}/></div>
      </section>}
      {['discovery','videos','authors'].includes(view)&&(discovery?<>
        {view==="discovery"&&<>
        {!discovery.ready&&<section className="panel"><h3 className="font-display text-lg">数据尚未采齐</h3><p className="mt-2 text-sm text-muted">当前批次未完成，视频和达人将在补齐后展示。每轮和每日额度有限，可在额度允许时再次点击“手动采集”继续。</p><div className="mt-3 space-y-1 text-sm">{discovery.pending.topicSearch.length>0&&<p>待查询话题：{discovery.pending.topicSearch.join('、')}</p>}{discovery.pending.videos.length>0&&<p>待查询视频：{discovery.pending.videos.join('、')}</p>}{discovery.pending.topicRelations.length>0&&<p>待采集话题关联：{discovery.pending.topicRelations.join('、')}</p>}</div></section>}
        <section className="panel"><h3 className="font-display text-lg">近30天入选话题</h3><p className="mt-2 text-sm text-muted">种子词：{discovery.keywords.join(' · ')||'尚未配置'}。仅保留达标话题；关联视频及达人榜使用官方最近完整周。</p>
          {!discovery.topics.length&&<p className="mt-4 text-sm text-muted">{discovery.pending.topicSearch.length?'话题查询尚未采齐，补齐后再按规则筛选。':'暂无满足30天窗口和指数门槛的话题。旧累计数据不会替代30天结果。'}</p>}
          {topicPage.slice.map(t=><div className="mt-4 border-t border-line pt-4" key={t.id}><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{t.name}</strong><span>30天指数 {fmtNum(t.index)} · {t.window.begin}—{t.window.end}</span></div><div className="mt-3 grid gap-4 sm:grid-cols-2">{(['likes','comments'] as const).map(board=><div key={board}><p className="text-xs text-muted">{board==='likes'?'点赞达人榜':'评论达人榜'}</p><p className="mt-2 text-sm leading-7">{t.boards[board].map(a=>`${a.name}（${a.value===null?'未知':fmtNum(a.value)}）`).join(' · ')||'等待关联采集'}</p></div>)}</div></div>)}
          <Pager {...topicPage}/>
        </section>
        </>}
        {view==="videos"&&<section className="panel"><h3 className="font-display text-lg">入选视频</h3><p className="mt-2 text-sm text-muted">合并去重 {discovery.counts.uniqueVideos} 条；点赞不足或未知排除 {discovery.counts.rejected.likes} 条，关键词排除 {discovery.counts.rejected.keywords} 条；达标 {discovery.counts.eligibleVideos} 条，保留 {discovery.counts.retainedVideos} 条。</p>
          {!videos.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的入选视频。':'数据尚未采齐，采集进度请查看“发现结果”。'}</p>}
          <div className="mt-4 space-y-4">{videoPage.slice.map(v=><div key={v.id} className="border-t border-line pt-3"><a className="block text-sm hover:text-brand" href={`https://www.douyin.com/video/${v.id}`} target="_blank" rel="noreferrer">{v.title||v.id}</a><p className="mt-2 text-xs leading-6 text-muted">{v.authorName||'作者待补全'} · 点赞 {fmtNum(v.likes)}{v.comments!==null?` · 评论 ${fmtNum(v.comments)}`:''}{v.fans!==null?` · 粉丝 ${fmtNum(v.fans)}`:''}{v.duration!==null?` · ${v.duration}秒`:''} · {v.index===null?'视频指数未知':`${v.indexScope?.keyword} / ${v.indexScope?.version} 近7天指数 ${v.index}`}</p></div>)}</div>
          <Pager {...videoPage}/>
        </section>}
        {view==="authors"&&<section className="panel"><h3 className="font-display text-lg">达人候选</h3><p className="mt-2 text-sm text-muted">来自各查询中高指数的入选视频，以及入选话题的点赞、评论榜。昵称不能作为已核实身份。</p>{!discovery.authors.length&&<p className="mt-4 text-sm text-muted">{discovery.ready?'暂无满足当前规则的达人候选。':'数据尚未采齐，采集进度请查看“发现结果”。'}</p>}<div className="mt-3 space-y-3">{authorPage.slice.map(a=><div className="border-t border-line pt-3 text-sm" key={a.key}><span>{a.name}</span><span className="ml-3 text-xs text-muted">{a.videos.length?`${a.videos.length}条高指数视频 `:''}{a.topics.length?`话题：${a.topics.join('、')} `:''}{a.key.startsWith('nickname:')?'主页身份待核实':''}</span></div>)}</div><Pager {...authorPage}/></section>}
      </>:<section className="panel"><p className="text-sm text-muted">{state?state.indexCredential?'暂无发现数据；可在“设置 → 采集设置”中调整关键词和筛选规则。':'尚未登记指数授权文件；登记后自动启用指数采集。':'正在加载采集数据…'}</p></section>)}
      {view==="tasks"&&<section className="panel"><h3 className="font-display text-lg">采集任务</h3><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-muted"><th className="py-2">来源 / 类型</th><th>对象</th><th>下次到期</th><th>状态</th></tr></thead><tbody>{taskPage.slice.map(t=><tr key={t.key} className="border-t border-line"><td className="py-3">{names[t.provider]}<div className="text-xs text-muted">{t.operation}</div></td><td className="max-w-48 break-all pr-3">{t.target}</td><td className="pr-3 text-xs">{fmtTime(t.next_run_at)}</td><td className="text-xs">{t.paused||t.disabled?<><span className="text-clay">{reason(t.source_error||t.error)||"已暂停"}</span><button className="btn-sm ml-2" disabled={archived||busy} onClick={()=>action(()=>api("/api/collection/resume",{method:"POST",body:JSON.stringify({provider:t.provider})}),"暂停已解除，下一轮会重新检查。")}>恢复</button></>:reason(t.error)||"等待到期"}</td></tr>)}</tbody></table>{!state?.tasks.length&&<p className="py-4 text-sm text-muted">尚无任务；配置来源后手动运行，或等待自动调度。</p>}</div><Pager {...taskPage}/></section>}
      {view==="runs"&&<section className="panel"><h3 className="font-display text-lg">最近采集记录</h3><p className="mt-2 text-sm text-muted">时间均为北京时间。“查看记录”展示本次采集的入库数据。</p><div className="mt-4 space-y-3">{runPage.slice.map(r=><div key={r.id} className="flex flex-wrap justify-between gap-2 border-t border-line pt-3 text-sm"><span>{names[r.provider]} · {r.operation} · {r.target}<span className="ml-2 text-xs text-muted">{fmtTime(r.observed_at)}{r.version?` · 数据版本 ${r.version}`:""}</span></span><span>{statuses[r.status]??r.status}{r.error?` · ${reason(r.error)}`:""}{r.status==="ok"&&<a className="ml-3 text-brand" href="#" onClick={e=>{e.preventDefault();action(async()=>{const data=await api<{observed_at:string}>(`/api/collection/records/${r.id}`);return JSON.stringify({...data,observed_at:fmtTime(data.observed_at)},null,2);},"记录已加载");}}>查看记录</a>}</span></div>)}</div>{!state?.runs.length&&<p className="py-4 text-sm text-muted">尚无采集记录；手动采集后生成。</p>}<Pager {...runPage}/></section>}
      {message&&<Msg tone={failure?"error":"ok"}><span className="block max-h-96 overflow-auto whitespace-pre-wrap break-all">{message}</span></Msg>}
    </div>
  </Page>;
}
