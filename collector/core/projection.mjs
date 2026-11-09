import { upsertWork,upsertAuthor } from '../../lib/works.ts';
import { linkWork } from '../../lib/accounts.ts';
import { Discovery,normalize } from './discovery.mjs';
function identity(store,run,namespace,id,row={}) {
  if(!id)return;
  // Only an explicit sec_uid or profile link in the same response can connect ID namespaces.
  const sec=row.sec_uid??Object.values(row).filter(v=>typeof v==='string').map(v=>v.match(/(?:\/user\/|sec_uid=)(MS4wLjAB[\w-]+)/)?.[1]).find(Boolean);
  let author=null;
  if(sec&&/^MS4w/.test(sec)){
    store.db.prepare(`INSERT INTO authors(platform,author_id,name,last_seen_at) VALUES('douyin',?,?,?)
      ON CONFLICT(platform,author_id) DO UPDATE SET name=COALESCE(excluded.name,authors.name),last_seen_at=excluded.last_seen_at`)
      .run(sec,row.user_name??row.nickname??null,run.observed_at);
    author=store.db.prepare("SELECT id FROM authors WHERE platform='douyin' AND author_id=?").get(sec).id;
    store.db.prepare(`INSERT INTO collection_author_ids VALUES('sec_uid',?,?,?) ON CONFLICT(namespace,external_id)
      DO UPDATE SET author_id=excluded.author_id,evidence_run_id=excluded.evidence_run_id`).run(sec,author,run.id);
  }
  const old=store.db.prepare('SELECT author_id FROM collection_author_ids WHERE namespace=? AND external_id=?').get(namespace,String(id));
  if(old?.author_id&&author&&old.author_id!==author)throw new Error('identity_conflict');
  store.db.prepare(`INSERT INTO collection_author_ids VALUES(?,?,?,?) ON CONFLICT(namespace,external_id)
    DO UPDATE SET author_id=COALESCE(excluded.author_id,collection_author_ids.author_id),evidence_run_id=excluded.evidence_run_id`)
    .run(namespace,String(id),author,run.id);
}
// Read only the latest response for each configured seed / selected topic.
function captures(store, accountId, type, targets) {
  if (!targets.length) return [];
  const rows = store.db.prepare(`SELECT * FROM (
    SELECT r.*,ROW_NUMBER() OVER(PARTITION BY r.target ORDER BY r.id DESC) position,
      (SELECT parameters FROM collection_requests q WHERE q.run_id=r.id AND q.status='ok' ORDER BY q.id DESC LIMIT 1) parameters
    FROM collection_runs r JOIN collection_run_accounts a ON a.run_id=r.id
    WHERE a.account_id=? AND r.provider='index' AND r.operation=? AND r.status='ok'
      AND r.target IN (${targets.map(() => '?').join(',')})
  ) WHERE position=1`).all(accountId, type, ...targets);
  return rows.map(run => {
    const spec = JSON.parse(run.request), parameters = JSON.parse(run.parameters ?? '{}');
    const range = parameters.body?.param ?? parameters.payload?.param;
    let window = {end: run.version, days: 7};
    if (type === 'topic_search') {
      const ms = value => /^\d{8}$/.test(value ?? '') ? Date.parse(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`) : NaN;
      const days = (ms(range?.end_date) - ms(range?.start_date)) / 86400000 + 1;
      window = days === 30 && range.end_date === run.version ? {begin: range.start_date, end: range.end_date, days} : null;
    }
    return {type, id: spec.id, keyword: spec.keyword, run, window, data: store.data(run)};
  });
}
export function indexSelection(store, a) {
  const keywords = new Map();
  const configured = store.db.prepare("SELECT source_key FROM account_sources WHERE account_id=? AND kind='keyword' AND status='ready'").all(a.id).map(s => s.source_key);
  for (const keyword of [...configured, ...a.config.index.tasks.filter(t => ['videos','topic_search'].includes(t.type)).map(t => t.keyword)])
    if (keyword) keywords.set(normalize(keyword), keyword);
  const d = new Discovery(a.config.index.discovery ?? {}, [...keywords.values()]);
  const topics=captures(store,a.id,'topic_search',d.keywords);
  const dates=captures(store,a.id,'topic_dates',['topic_dates'])[0]?.data;
  const end=dates?.valid_day??topics.filter(c=>c.window).map(c=>c.window.end).sort().at(-1);
  const current=topics.filter(c=>c.window&&c.window.end===end);
  // Rank all configured seed queries in one window; never mix a new partial batch with old totals.
  if(current.length===d.keywords.length)for(const capture of current)d.ingest(capture);
  const videos=captures(store,a.id,'videos',d.keywords).filter(c=>c.run.version===end);
  for(const capture of videos)d.ingest(capture);
  const selected=d.topics(),relations=captures(store,a.id,'topic_relation',selected.map(t=>t.id)).filter(c=>!dates||c.run.version===dates.valid_week);
  for(const capture of relations)d.ingest(capture);
  d.ready=current.length===d.keywords.length&&videos.length===d.keywords.length&&relations.length===selected.length;
  d.pending={
    topicSearch:d.keywords.filter(k=>!current.some(c=>c.keyword===k)),
    videos:d.keywords.filter(k=>!videos.some(c=>c.keyword===k)),
    topicRelations:selected.filter(t=>!relations.some(c=>c.id===t.id)).map(t=>t.name),
  };
  return d;
}
function published(value) {
  if (value === null || value === undefined || value === '') return '';
  let ms;
  if (/^\d+$/.test(String(value))) ms = Number(value) * (Number(value) < 1e11 ? 1000 : 1);
  else ms = Date.parse(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(value) ? value.replace(' ','T') + '+08:00' : value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';
}
export function rebuildAccount(store, a) {
  const d = indexSelection(store,a), report = d.report(), db = store.db;
  for (const topic of report.topics) {
    db.prepare(`INSERT INTO collection_topics VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`).run(topic.id,topic.name);
    store.observation(topic.capture.run,'topic',topic.id,'topic_search',{
      topic_name:topic.name,topic_index:topic.index,item_cnt:topic.row.item_cnt??null,
      digg_cnt:topic.row.digg_cnt??null,play_read_cnt:topic.row.play_read_cnt??null,
    },topic.window);
    if (topic.relation&&report.ready) {
      store.observation(topic.relation.run,'topic',topic.id,'topic_relation',{
        item_ids:report.videos.filter(v=>v.sources.some(s=>s.capture===topic.relation)).map(v=>v.id),
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
    const wid=upsertWork(db,work,'index',{
      id:capture.run.id,observed_at:capture.run.observed_at,source:'index:'+capture.type,
      metric_at:capture.run.version?`${capture.run.version.slice(0,4)}-${capture.run.version.slice(4,6)}-${capture.run.version.slice(6,8)} 00:00:00`:null,
    });
    linkWork(db,a.id,wid,'index:selected');
    for(const content of db.prepare("SELECT id FROM contents WHERE account_id=? AND published_url=?").all(a.id,`https://www.douyin.com/video/${work.id}`))
      db.prepare('INSERT OR IGNORE INTO content_snapshots(content_id,ts,metrics) VALUES(?,?,?)').run(content.id,capture.run.observed_at,JSON.stringify(work.metrics));
    for(const source of video.sources)store.observation(source.capture.run,'work',wid,source.capture.type,source.facts,source.capture.window);
  }
  return d;
}
// Keep internal capture references out of the API, otherwise each video repeats whole responses.
export function selectionView(d) {
  const report=d.report();
  return {...report,pending:d.pending,
    topics:report.topics.map(({id,name,index,window,boards})=>({id,name,index,window,boards})),
    videos:report.videos.map(({sources,metric,...video})=>({...video,sources:sources.map(({capture})=>({runId:capture.run.id,type:capture.type,keyword:capture.keyword,topicId:capture.id,window:capture.window}))})),
  };
}
