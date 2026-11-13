// A bounded selection over source evidence; rejected rows never become business objects.
export const normalize = (text: any): string => String(text ?? '').normalize('NFKC').toLowerCase().replace(/^#+/, '').replace(/\s+/g, '').trim();
export const count = (value: any): number | null => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const unique = (values: string[]): string[] => [...new Set(values)];
const terms = (values: string[]): string[] => unique(values.map(normalize).filter(Boolean));

export interface CollectionPolicy {
  excludeKeywords: string[];
}
export function collectionPolicy(value: any = {}): CollectionPolicy {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_collection_policy');
  for (const key of ['excludeKeywords', 'excludeTags'])
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((v: any) => typeof v !== 'string'))) throw new Error('invalid_collection_terms');
  return { excludeKeywords: unique([...(value.excludeKeywords ?? []), ...(value.excludeTags ?? [])]) };
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
    badges: [Number(row.isLowFansButHot) === 1 && 'lowFansHot', Number(row.isHighFansRiseRate) === 1 && 'highFansRise', Number(row.isHighLikeRate) === 1 && 'highLikeRate', Number(row.isHighPlayOverRate) === 1 && 'highPlayOver'].filter(Boolean) as string[],
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
    return [...topics.values()].filter(t=>t.index!==null&&!excluded(t.name,this.policy))
      .sort((a, b) => b.index - a.index || a.id.localeCompare(b.id));
  }
  tasks() {
    // 话题只看30天指数；视频同时采集近7天与近30天两个窗口，地位同等；关联任务已停用（数据源保留）。
    return this.keywords.flatMap(keyword => [
      {type: 'topic_search', keyword, windowDays: 30},
      {type: 'videos', keyword, days: 7},
      {type: 'videos', keyword, days: 30},
    ]);
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
    // 全量入选,只按排除词淘汰;由前端按窗口排序展示 Top 榜。
    const eligible: any[] = [];
    let excludedByKeywords = 0;
    for (const item of merged.values()) {
      const sources = item.sources.sort((a: any, b: any) => b.capture.run.id - a.capture.run.id);
      const metric = sources.find((s: any) => s.facts.likes !== null), text = sources.map((s: any) => s.facts.title+' '+s.facts.tags.join(' ')).join(' ');
      if (excluded(text,this.policy)) { excludedByKeywords++; continue; }
      // 两窗口指数同等：各自独立记录，任一来源带指数即附该窗口值（同窗口取最新捕获）。
      const indexBy: Record<string, number|null> = {7: null, 30: null};
      for (const s of sources) if (s.capture.days && s.facts.index !== null && indexBy[s.capture.days] === null) indexBy[s.capture.days] = s.facts.index;
      const scope = sources.map((s: any) => s.capture.keyword).find(Boolean) ?? '';
      eligible.push({...item, title: sources.map((s: any) => s.facts.title).find(Boolean) ?? '', likes: metric?.facts.likes ?? null, comments: metric?.facts.comments ?? null,
        authorName: sources.map((s: any) => s.facts.authorName).find((v: any) => v !== null && v !== '') ?? '',
        fans: sources.map((s: any) => s.facts.fans).find((v: any) => v !== null) ?? null,
        duration: sources.map((s: any) => s.facts.duration).find((v: any) => v !== null) ?? null,
        publishedAt: sources.map((s: any) => s.facts.publishedAt).find((v: any) => v !== null && v !== '') ?? null,
        secUid: sources.map((s: any) => s.facts.secUid).find((v: any) => v !== null && v !== '') ?? null,
        indexBy, keyword: scope, badges: [...new Set(sources.flatMap((s: any) => s.facts.badges ?? []))], metric});
    }
    // 按(近7天+近30天)指数之和全局排序;无指数的视频沉到尾部。
    const total = (v: any) => (v.indexBy[7] ?? 0) + (v.indexBy[30] ?? 0);
    const videos = eligible.slice().sort((a, b) => total(b) - total(a) || Number(b.likes ?? 0) - Number(a.likes ?? 0) || a.id.localeCompare(b.id));

    // 达人指数：入选视频按作者归类，近30天指数相加得总体指数；平均指数=总体÷视频数。展示排序见前端。
    const authors = new Map<string, any>();
    for (const video of videos) {
      if (!video.authorName || excluded(video.authorName, this.policy)) continue;
      const author = video.sources.find((s: any) => s.facts.authorId);
      const key = video.secUid ? 'sec_uid:' + video.secUid : author ? 'index_author:' + author.facts.authorId : 'nickname:' + normalize(video.authorName);
      const entry = authors.get(key) ?? {key, name: video.authorName, videos: [] as any[], totalIndex: 0};
      entry.videos.push(video.id);
      if (video.indexBy[30] !== null) entry.totalIndex += video.indexBy[30];
      authors.set(key, entry);
    }
    const selectedAuthors = [...authors.values()].sort((a, b) => b.totalIndex - a.totalIndex || a.key.localeCompare(b.key));
    const ready=this.ready!==false;
    return {ready,keywords: this.keywords, topics: selectedTopics, videos:ready?videos:[], authors:ready?selectedAuthors:[],
      counts: {receivedVideos: received, uniqueVideos: merged.size, excludedKeywords: excludedByKeywords}, policy: this.policy};
  }
}
