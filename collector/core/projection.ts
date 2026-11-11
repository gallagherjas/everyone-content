import type { DatabaseSync } from 'node:sqlite';
import { upsertWork,upsertAuthor } from '../../lib/works.ts';
import { linkWork, type AccountConfig } from '../../lib/accounts.ts';
import { Discovery,normalize } from './discovery.ts';
import type { CollectionStore } from './store.ts';
function identity(store: CollectionStore,run: any,namespace: string,id: any,row: any={}) {
  if(!id)return;
  // Only an explicit sec_uid or profile link in the same response can connect ID namespaces.
  const sec=row.sec_uid??Object.values(row).filter((v: any)=>typeof v==='string').map((v: string)=>v.match(/(?:\/user\/|sec_uid=)(MS4wLjAB[\w-]+)/)?.[1]).find(Boolean);
  let author:any=null;
  if(sec&&/^MS4w/.test(sec)){
    store.db.prepare(`INSERT INTO authors(platform,author_id,name,last_seen_at) VALUES('douyin',?,?,?)
      ON CONFLICT(platform,author_id) DO UPDATE SET name=COALESCE(excluded.name,authors.name),last_seen_at=excluded.last_seen_at`)
      .run(sec,row.user_name??row.nickname??null,run.observed_at);
    author=(store.db.prepare("SELECT id FROM authors WHERE platform='douyin' AND author_id=?").get(sec) as any).id;
    store.db.prepare(`INSERT INTO collection_author_ids VALUES('sec_uid',?,?,?) ON CONFLICT(namespace,external_id)
      DO UPDATE SET author_id=excluded.author_id,evidence_run_id=excluded.evidence_run_id`).run(sec,author,run.id);
  }
  const old=store.db.prepare('SELECT author_id FROM collection_author_ids WHERE namespace=? AND external_id=?').get(namespace,String(id)) as any;
  if(old?.author_id&&author&&old.author_id!==author)throw new Error('identity_conflict');
  store.db.prepare(`INSERT INTO collection_author_ids VALUES(?,?,?,?) ON CONFLICT(namespace,external_id)
    DO UPDATE SET author_id=COALESCE(excluded.author_id,collection_author_ids.author_id),evidence_run_id=excluded.evidence_run_id`)
    .run(namespace,String(id),author,run.id);
}
// Read only the latest response for each configured seed / selected topic.
function captures(store: CollectionStore, accountId: number, type: string, targets: string[]): any[] {
  if (!targets.length) return [];
  const rows = store.db.prepare(`SELECT * FROM (
    SELECT r.*,ROW_NUMBER() OVER(PARTITION BY r.target ORDER BY r.id DESC) position,
      (SELECT parameters FROM collection_requests q WHERE q.run_id=r.id AND q.status='ok' ORDER BY q.id DESC LIMIT 1) parameters
    FROM collection_runs r JOIN collection_run_accounts a ON a.run_id=r.id
    WHERE a.account_id=? AND r.provider='index' AND r.operation=? AND r.status='ok'
      AND r.target IN (${targets.map(() => '?').join(',')})
  ) WHERE position=1`).all(accountId, type, ...targets) as any[];
  return rows.map(run => {
    const spec = JSON.parse(run.request), parameters = JSON.parse(run.parameters ?? '{}');
    const range = parameters.body?.param ?? parameters.payload?.param;
    let window: { begin?: string; end: string; days: number } | null = {end: run.version, days: 7};
    if (type === 'topic_search') {
      const ms = (value: any) => /^\d{8}$/.test(value ?? '') ? Date.parse(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`) : NaN;
      const days = (ms(range?.end_date) - ms(range?.start_date)) / 86400000 + 1;
      window = days === 30 && range.end_date === run.version ? {begin: range.start_date, end: range.end_date, days} : null;
    }
    return {type, id: spec.id, keyword: spec.keyword, run, window, data: store.data(run)};
  });
}
export function collectionKeywords(db: DatabaseSync, accountId: number, tasks: AccountConfig['index']['tasks'] = []) {
  const configured = db.prepare(`SELECT source_key FROM account_sources
    WHERE account_id=? AND kind='keyword' AND status='ready'`).all(accountId).map(row => String(row.source_key));
  const legacy = tasks.filter(task => ['videos', 'topic_search'].includes(task.type)).map(task => task.keyword);
  const keywords = new Map<string, string>();
  for (const keyword of [...configured, ...legacy])
    if (keyword) keywords.set(normalize(keyword), keyword.trim());
  return [...keywords.values()].filter(Boolean);
}

export function indexSelection(store: CollectionStore, a: any): Discovery {
  const d = new Discovery(a.config.index.discovery ?? {}, collectionKeywords(store.db, a.id, a.config.index.tasks));
  const topics=captures(store,a.id,'topic_search',d.keywords);
  const dates=captures(store,a.id,'topic_dates',['topic_dates'])[0]?.data;
  const end=dates?.valid_day??topics.filter((c: any)=>c.window).map((c: any)=>c.window.end).sort().at(-1);
  const current=topics.filter((c: any)=>c.window&&c.window.end===end);
  // Rank all configured seed queries in one window; never mix a new partial batch with old totals.
  if(current.length===d.keywords.length)for(const capture of current)d.ingest(capture);
  const videos=captures(store,a.id,'videos',d.keywords).filter((c: any)=>c.run.version===end);
  for(const capture of videos)d.ingest(capture);
  const selected=d.topics(),relations=captures(store,a.id,'topic_relation',selected.map((t: any)=>t.id)).filter((c: any)=>!dates||c.run.version===dates.valid_week);
  for(const capture of relations)d.ingest(capture);
  d.ready=current.length===d.keywords.length&&videos.length===d.keywords.length&&relations.length===selected.length;
  d.pending={
    topicSearch:d.keywords.filter(k=>!current.some((c: any)=>c.keyword===k)),
    videos:d.keywords.filter(k=>!videos.some((c: any)=>c.keyword===k)),
    topicRelations:selected.filter((t: any)=>!relations.some((c: any)=>c.id===t.id)).map((t: any)=>t.name),
  };
  return d;
}
function published(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  let ms;
  if (/^\d+$/.test(String(value))) ms = Number(value) * (Number(value) < 1e11 ? 1000 : 1);
  else ms = Date.parse(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(value) ? value.replace(' ','T') + '+08:00' : value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';
}
export function rebuildAccount(store: CollectionStore, a: any): Discovery {
  const d = indexSelection(store,a), report = d.report(), db = store.db;
  for (const topic of report.topics) {
    db.prepare(`INSERT INTO collection_topics VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`).run(topic.id,topic.name);
    store.observation(topic.capture.run,'topic',topic.id,'topic_search',{
      topic_name:topic.name,topic_index:topic.index,item_cnt:topic.row.item_cnt??null,
      digg_cnt:topic.row.digg_cnt??null,play_read_cnt:topic.row.play_read_cnt??null,
    },topic.window);
    if (topic.relation&&report.ready) {
      store.observation(topic.relation.run,'topic',topic.id,'topic_relation',{
        item_ids:report.videos.filter((v: any)=>v.sources.some((s: any)=>s.capture===topic.relation)).map((v: any)=>v.id),
        digg_author_list:topic.boards.likes,comment_author_list:topic.boards.comments,
      },topic.relation.window);
      for (const rows of [topic.boards.likes,topic.boards.comments]) for (const row of rows)
        identity(store,topic.relation.run,'index_author',row.id,{author_name:row.name});
    }
  }
  for (const video of report.videos) {
    const capture=video.metric.capture, facts=video.metric.facts;
    const work={id:video.id,title:video.title,publishedAt:published(video.publishedAt),
      authorId:/^MS4w/.test(video.secUid??'')?video.secUid:'',authorName:video.authorName,
      metrics:{views:null,likes:facts.likes,comments:facts.comments,shares:null,collects:null}};
    upsertAuthor(db,work);
    if(work.authorId){
      identity(store,capture.run,'sec_uid',work.authorId,{sec_uid:work.authorId,nickname:work.authorName});
      if(video.fans!==null)db.prepare("UPDATE authors SET follower_count=? WHERE platform='douyin' AND author_id=?").run(video.fans,work.authorId);
    }
    const wid=upsertWork(db,work,'index');
    linkWork(db,a.id,wid,'index:selected');
    for(const content of db.prepare("SELECT id FROM contents WHERE account_id=? AND published_url=?").all(a.id,`https://www.douyin.com/video/${work.id}`) as any[])
      db.prepare('INSERT OR IGNORE INTO content_snapshots(content_id,ts,metrics) VALUES(?,?,?)').run(content.id,capture.run.observed_at,JSON.stringify(work.metrics));
    for(const source of video.sources)store.observation(source.capture.run,'work',wid,source.capture.type,source.facts,source.capture.window);
  }
  return d;
}
// Keep internal capture references out of the API, otherwise each video repeats whole responses.
export function selectionView(d: Discovery): any {
  const report=d.report();
  return {...report,pending:d.pending,
    topics:report.topics.map(({id,name,index,window,boards}:any)=>({id,name,index,window,boards})),
    videos:report.videos.map(({sources,metric,...video}:any)=>({...video,sources:sources.map(({capture}:any)=>({runId:capture.run.id,type:capture.type,keyword:capture.keyword,topicId:capture.id,window:capture.window}))})),
  };
}
