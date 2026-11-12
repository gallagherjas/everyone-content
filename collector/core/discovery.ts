// A bounded selection over source evidence; rejected rows never become business objects.
export const normalize = (text: any): string => String(text ?? '').normalize('NFKC').toLowerCase().replace(/^#+/, '').replace(/\s+/g, '').trim();
export const count = (value: any): number | null => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const unique = (values: string[]): string[] => [...new Set(values)];
const terms = (values: string[]): string[] => unique(values.map(normalize).filter(Boolean));

export interface CollectionPolicy {
  excludeKeywords: string[]; minTopicIndex: number; maxTopics: number;
  minVideoLikes: number; maxVideos: number;
}
export function collectionPolicy(value: any = {}): CollectionPolicy {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_collection_policy');
  for (const key of ['excludeKeywords', 'excludeTags'])
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((v: any) => typeof v !== 'string'))) throw new Error('invalid_collection_terms');
  const policy = {
    excludeKeywords: unique([...(value.excludeKeywords ?? []), ...(value.excludeTags ?? [])]),
    minTopicIndex: value.minTopicIndex ?? 10000, maxTopics: value.maxTopics ?? 3,
    minVideoLikes: value.minVideoLikes ?? 100, maxVideos: value.maxVideos ?? 40,
  };
  for (const key of ['minTopicIndex', 'minVideoLikes', 'maxTopics', 'maxVideos'] as const)
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 1) throw new Error('invalid_collection_limit');
  if (policy.minVideoLikes < 100 || policy.maxTopics > 5 || policy.maxVideos > 200) throw new Error('invalid_collection_limit');
  return policy;
}
function excluded(text: any, policy: CollectionPolicy) {
  const value = normalize(text);
  return terms(policy.excludeKeywords).some(t => value.includes(t));
}
export function videoRows(type: string, data: any): any[] {
  return type === 'videos' ? (Array.isArray(data) ? data : data.data ?? []) : type === 'topic_relation' ? data.item_list ?? [] : [];
}
export function videoFacts(row: any) {
  return {
    id: String(row.itemId ?? row.item_id ?? ''), title: String(row.title ?? row.video_text ?? row.desc ?? ''),
    tags: (Array.isArray(row.tags??row.hashtags)?row.tags??row.hashtags:[]).map((v: any)=>typeof v==='string'?v:v.name??v.cha_name??''),
    likes: count(row.likes ?? row.digg_cnt), comments: count(row.comment_cnt), index: count(row.index),
    fans: count(row.fans), duration: count(row.duration), authorName: String(row.nickname ?? row.author_name ?? ''),
    secUid: row.sec_uid ?? row.author?.sec_uid ?? null, authorId: row.author_id ? String(row.author_id) : null,
    publishedAt: row.createTime ?? row.create_time ?? null,
  };
}

export class Discovery {
  policy: CollectionPolicy; keywords: string[]; captures: any[];
  // 由投影层在汇总就绪度后写入；未写入时视为未就绪。
  ready?: boolean;
  pending?: { topicSearch: string[]; videos: string[] };
  constructor(policy: any, keywords: string[] = []) {
    this.policy = collectionPolicy(policy);
    this.keywords = unique(keywords.map(v => v.trim()).filter(Boolean));
    this.captures = [];
  }
  ingest(capture: any) { this.captures.push(capture); }
  topics(): any[] {
    const topics = new Map<string, any>();
    for (const capture of this.captures.filter((c: any) => c.type === 'topic_search' && c.window?.days === 30)) {
      for (const row of capture.data.topic_list ?? []) {
        const id = String(row.topic_id ?? ''), index = count(row.topic_index);
        if (!/^\d+$/.test(id)) continue;
        const previous = topics.get(id);
        if (!previous || capture.run.id > previous.capture.run.id)
          topics.set(id, {id, name: row.topic_name, index, window: capture.window, capture, row});
      }
    }
    return [...topics.values()].filter(t=>t.index!==null&&t.index>=this.policy.minTopicIndex&&!excluded(t.name,this.policy))
      .sort((a, b) => b.index - a.index || a.id.localeCompare(b.id)).slice(0, this.policy.maxTopics);
  }
  tasks() {
    // 话题只看30天指数；不再派生关联任务（数据源保留，需要时恢复派生即可）。
    return this.keywords.flatMap(keyword => [{type: 'topic_search', keyword, windowDays: 30}, {type: 'videos', keyword}]);
  }
  report() {
    const selectedTopics = this.topics(), merged = new Map<string, any>();
    let received = 0;
    for (const capture of this.captures.filter((c: any) => c.type === 'videos')) {
      for (const row of videoRows(capture.type, capture.data)) {
        const facts = videoFacts(row); if (!/^\d+$/.test(facts.id)) continue;
        received++;
        const item = merged.get(facts.id) ?? {id: facts.id, sources: [] as any[]};
        item.sources.push({capture, facts}); merged.set(facts.id, item);
      }
    }
    const rejected = {likes: 0, keywords: 0}, eligible: any[] = [];
    for (const item of merged.values()) {
      const sources = item.sources.sort((a: any, b: any) => b.capture.run.id - a.capture.run.id);
      const metric = sources.find((s: any) => s.facts.likes !== null), text = sources.map((s: any) => s.facts.title+' '+s.facts.tags.join(' ')).join(' ');
      if (!metric || metric.facts.likes < this.policy.minVideoLikes) { rejected.likes++; continue; }
      if (excluded(text,this.policy)) { rejected.keywords++; continue; }
      const indexed = sources.find((s: any) => s.facts.index !== null), field = (key: string) => sources.map((s: any) => s.facts[key]).find((v: any) => v !== null && v !== '');
      eligible.push({...item, title: field('title') ?? '', likes: metric.facts.likes, comments: metric.facts.comments,
        authorName: field('authorName') ?? '', fans: field('fans') ?? null, duration: field('duration') ?? null,
        publishedAt: field('publishedAt') ?? null, secUid: field('secUid') ?? null,
        index: indexed?.facts.index ?? null,
        indexScope: indexed ? {keyword: indexed.capture.keyword, version: indexed.capture.run.version, days: 7} : null, metric});
    }
    // Compare indices within their query/window and share the cap between those groups.
    const groups = new Map<string, any[]>(), unknown: any[] = [];
    for (const video of eligible) {
      if (!video.indexScope) { unknown.push(video); continue; }
      const scope = JSON.stringify(video.indexScope);
      if (!groups.has(scope)) groups.set(scope, []);
      groups.get(scope)!.push(video);
    }
    const ranked = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => rows.sort((a: any, b: any) => b.index - a.index || a.id.localeCompare(b.id)));
    unknown.sort((a, b) => b.likes - a.likes || a.id.localeCompare(b.id));
    const reserve = Math.min(unknown.length, Math.ceil(this.policy.maxVideos / 5)), videos: any[] = [];
    for (let i = 0; videos.length < this.policy.maxVideos - reserve && ranked.some(g => g.length > i); i++)
      for (const rows of ranked) if (rows[i] && videos.length < this.policy.maxVideos - reserve) videos.push(rows[i]);
    videos.push(...unknown.slice(0, this.policy.maxVideos - videos.length));

    // 达人指数：入选视频按作者归类，近7天指数相加得总体指数；平均指数=总体÷视频数。展示排序见前端。
    const authors = new Map<string, any>();
    for (const video of videos) {
      if (!video.authorName || excluded(video.authorName, this.policy)) continue;
      const author = video.sources.find((s: any) => s.facts.authorId);
      const key = video.secUid ? 'sec_uid:' + video.secUid : author ? 'index_author:' + author.facts.authorId : 'nickname:' + normalize(video.authorName);
      const entry = authors.get(key) ?? {key, name: video.authorName, videos: [] as any[], totalIndex: 0};
      entry.videos.push(video.id);
      if (video.index !== null) entry.totalIndex += video.index;
      authors.set(key, entry);
    }
    const selectedAuthors = [...authors.values()].sort((a, b) => b.totalIndex - a.totalIndex || a.key.localeCompare(b.key));
    const ready=this.ready!==false;
    return {ready,keywords: this.keywords, topics: selectedTopics, videos:ready?videos:[], authors:ready?selectedAuthors:[],
      counts: {receivedVideos: received, uniqueVideos: merged.size, rejected, eligibleVideos: eligible.length, retainedVideos: ready?videos.length:0}, policy: this.policy};
  }
}
