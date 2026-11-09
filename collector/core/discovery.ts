// A bounded selection over source evidence; rejected rows never become business objects.
export const normalize = (text: any): string => String(text ?? '').normalize('NFKC').toLowerCase().replace(/^#+/, '').replace(/\s+/g, '').trim();
export const count = (value: any): number | null => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const unique = (values: string[]): string[] => [...new Set(values)];
const terms = (values: string[]): string[] => unique(values.map(normalize).filter(Boolean));

export interface CollectionPolicy {
  excludeKeywords: string[]; minTopicIndex: number; maxTopics: number;
  minVideoLikes: number; maxVideos: number; maxAuthors: number;
}
export function collectionPolicy(value: any = {}): CollectionPolicy {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_collection_policy');
  for (const key of ['excludeKeywords', 'excludeTags'])
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((v: any) => typeof v !== 'string'))) throw new Error('invalid_collection_terms');
  const policy = {
    excludeKeywords: unique([...(value.excludeKeywords ?? []), ...(value.excludeTags ?? [])]),
    minTopicIndex: value.minTopicIndex ?? 10000, maxTopics: value.maxTopics ?? 3,
    minVideoLikes: value.minVideoLikes ?? 100, maxVideos: value.maxVideos ?? 40, maxAuthors: value.maxAuthors ?? 5,
  };
  for (const key of ['minTopicIndex', 'minVideoLikes', 'maxTopics', 'maxVideos', 'maxAuthors'] as const)
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 1) throw new Error('invalid_collection_limit');
  if (policy.minVideoLikes < 100 || policy.maxTopics > 5 || policy.maxVideos > 200 || policy.maxAuthors > 20) throw new Error('invalid_collection_limit');
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
  pending?: { topicSearch: string[]; videos: string[]; topicRelations: string[] };
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
    return [
      ...this.keywords.flatMap(keyword => [{type: 'topic_search', keyword, windowDays: 30}, {type: 'videos', keyword}]),
      ...this.topics().map(t => ({type: 'topic_relation', id: t.id})),
    ];
  }
  report() {
    const selectedTopics = this.topics(), topicIds = new Set(selectedTopics.map(t => t.id)), merged = new Map<string, any>();
    let received = 0;
    for (const capture of this.captures.filter((c: any) => c.type === 'videos' || c.type === 'topic_relation' && topicIds.has(c.id))) {
      for (const row of videoRows(capture.type, capture.data)) {
        const facts = videoFacts(row); if (!/^\d+$/.test(facts.id)) continue;
        received++;
        const item = merged.get(facts.id) ?? {id: facts.id, sources: [] as any[]};
        item.sources.push({capture, facts}); merged.set(facts.id, item);
      }
    }
    const rejected = {likes: 0, keywords: 0}, eligible: any[] = [];
    for (const item of merged.values()) {
      // Prefer video-search metrics; relation counters have a different statistical window.
      const sources = item.sources.sort((a: any, b: any) => Number(b.capture.type === 'videos') - Number(a.capture.type === 'videos') || b.capture.run.id - a.capture.run.id);
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

    const authors = new Map<string, any>();
    const addAuthor = (key: string, name: any, evidence: any) => {
      if (!name || excluded(name,this.policy)) return;
      if (!authors.has(key)) authors.set(key, {key, name, videos: [] as any[], topics: [] as any[], boards: [] as any[]});
      const author = authors.get(key)!;
      for (const field of ['videos', 'topics', 'boards']) if (evidence[field] && !author[field].includes(evidence[field])) author[field].push(evidence[field]);
    };
    const topics = selectedTopics.map((topic: any) => {
      const relation = this.captures.find((c: any) => c.type === 'topic_relation' && c.id === topic.id), boards: Record<string, any> = {};
      for (const [name, field] of [['likes', 'digg_author_list'], ['comments', 'comment_author_list']] as const) {
        boards[name] = (relation?.data[field] ?? []).filter((row: any) => row.author_id && row.author_name).map((row: any, i: number) => ({
          id: String(row.author_id), name: row.author_name, value: count(row[name === 'likes' ? 'digg_cnt' : 'comment_cnt']), rank: i + 1,
        }));
        for (const row of boards[name]) addAuthor('index_author:' + row.id, row.name, {topics: topic.name, boards: name});
      }
      return {...topic, relation, boards};
    });
    for (const rows of ranked) for (const video of rows.filter((v: any) => videos.includes(v)).slice(0, 3)) {
      const author = video.sources.find((s: any) => s.facts.authorId);
      const key = video.secUid ? 'sec_uid:' + video.secUid : author ? 'index_author:' + author.facts.authorId : 'nickname:' + normalize(video.authorName);
      addAuthor(key, video.authorName, {videos: video.id});
    }
    const rankedAuthors = [...authors.values()].sort((a, b) => Number(b.videos.length > 0 && b.topics.length > 0) - Number(a.videos.length > 0 && a.topics.length > 0) || b.videos.length - a.videos.length || b.boards.length - a.boards.length || b.topics.length - a.topics.length || a.key.localeCompare(b.key));
    const topicAuthors=rankedAuthors.filter(a=>a.topics.length),reserveAuthors=Math.min(topicAuthors.length,Math.floor(this.policy.maxAuthors/2));
    const candidates=[...rankedAuthors.filter(a=>a.videos.length).slice(0,this.policy.maxAuthors-reserveAuthors),...topicAuthors.slice(0,reserveAuthors),...rankedAuthors];
    const selectedAuthors=[...new Map(candidates.map(a=>[a.key,a])).values()].slice(0,this.policy.maxAuthors);
    const ready=this.ready!==false;
    return {ready,keywords: this.keywords, topics, videos:ready?videos:[], authors:ready?selectedAuthors:[],
      counts: {receivedVideos: received, uniqueVideos: merged.size, rejected, eligibleVideos: eligible.length, retainedVideos: ready?videos.length:0}, policy: this.policy};
  }
}
