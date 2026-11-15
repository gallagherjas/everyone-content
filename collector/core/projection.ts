import type { DatabaseSync } from 'node:sqlite';
import { upsertWork,upsertAuthor } from '../../lib/works.ts';
import { linkWork, type AccountConfig } from '../../lib/accounts.ts';
import { Discovery,normalize } from './discovery.ts';
import { taskTarget, type CollectionStore } from './store.ts';
export function identity(store: CollectionStore,run: any,namespace: string,id: any,row: any={}) {
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
// 先选齐同一期的缓存，再加载响应正文。新一期未采齐时仍可展示上一期完整数据。
function captures(store: CollectionStore, accountId: number, type: string, targets: string[], validDay: string | null) {
  if (!targets.length) return { captures: [], pending: [], version: null };
  const rows = store.db.prepare(`SELECT * FROM (
    SELECT r.*,ROW_NUMBER() OVER(PARTITION BY r.target,r.version ORDER BY r.id DESC) position,
      CASE WHEN r.operation='topic_search' THEN
        (SELECT parameters FROM collection_requests q WHERE q.run_id=r.id AND q.status='ok' ORDER BY q.id DESC LIMIT 1)
      END parameters
    FROM collection_runs r JOIN collection_run_accounts a ON a.run_id=r.id
    WHERE a.account_id=? AND r.provider='index' AND r.operation=? AND r.status='ok'
      AND r.version IS NOT NULL AND (? IS NULL OR r.version<=?)
      AND r.target IN (${targets.map(() => '?').join(',')})
  ) WHERE position=1 ORDER BY version DESC`).all(accountId, type, validDay, validDay, ...targets) as any[];
  const byVersion = new Map<string, Map<string, any>>();
  for (const run of rows) {
    const spec = JSON.parse(run.request);
    let window: { begin?: string; end: string; days: number } = {end: run.version, days: spec.days ?? 7};
    if (type === 'topic_search') {
      const parameters = JSON.parse(run.parameters ?? '{}');
      const range = parameters.body?.param ?? parameters.payload?.param;
      const ms = (value: any) => /^\d{8}$/.test(value ?? '') ? Date.parse(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`) : NaN;
      const days = (ms(range?.end_date) - ms(range?.start_date)) / 86400000 + 1;
      if (days !== 30 || range.end_date !== run.version) continue;
      window = {begin: range.start_date, end: range.end_date, days};
    }
    if (!byVersion.has(run.version)) byVersion.set(run.version, new Map());
    byVersion.get(run.version)!.set(run.target, {type, keyword: spec.keyword, days: spec.days, run, window});
  }
  const current = byVersion.get(validDay ?? rows[0]?.version);
  const complete = [...byVersion].find(([, batch]) => batch.size === targets.length);
  return {
    captures: complete ? [...complete[1].values()].map(capture => ({...capture, data: store.data(capture.run)})) : [],
    pending: targets.filter(target => !current?.has(target)),
    version: complete?.[0] ?? null,
  };
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
  const dateRun = store.db.prepare(`SELECT r.* FROM collection_runs r JOIN collection_run_accounts x ON x.run_id=r.id
    WHERE x.account_id=? AND r.provider='index' AND r.operation='topic_dates' AND r.status='ok' ORDER BY r.id DESC LIMIT 1`).get(a.id);
  const validDay = dateRun ? store.data(dateRun).valid_day ?? null : null;
  const specs = d.tasks();
  const batch = (type: string) => captures(store, a.id, type, specs.filter(spec => spec.type === type).map(taskTarget), validDay);
  const topics = batch('topic_search'), videos = batch('videos');
  for (const capture of [...topics.captures, ...videos.captures]) d.ingest(capture);
  d.ready = !topics.pending.length && !videos.pending.length;
  d.pending = {topicSearch: topics.pending, videos: [...new Set(videos.pending.map(target => target.slice(0, target.lastIndexOf('#'))))]};
  d.versions = {topics: topics.version, videos: videos.version};
  return d;
}
export function published(value: any): string {
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
  return {...report,pending:d.pending,versions:d.versions,
    topics:report.topics.map(({id,name,index,window}:any)=>({id,name,index,window})),
    videos:report.videos.map(({sources,metric,...video}:any)=>({...video,sources:sources.map(({capture}:any)=>({runId:capture.run.id,type:capture.type,keyword:capture.keyword,topicId:capture.id,window:capture.window}))})),
  };
}
