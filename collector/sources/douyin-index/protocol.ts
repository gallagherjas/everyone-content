import { createDecipheriv, createHash } from 'node:crypto';
import { parseJson } from '../../../lib/json.ts';
export { parseJson } from '../../../lib/json.ts';
export const ORIGIN = 'https://creator.douyin.com';
const MODES: Record<string, string[]> = {
  '1': ['kbSjOqn9O7APLqUZxdCkTQ==','JuhL1cOV5JH9ojzt2g2EPg=='],
  '2': ['SjXbYTJb7zXoUToSicUL3A==','OekMLjghRg8vlX/PemLc+Q=='],
};
export const PATHS: Record<string, string> = {
  topic_dates: '/api/v2/index/get_topic_valid_date',
  topic_search: '/api/v2/index/query_topic', videos: '/api/v2/index/itemQuery',
  topic_relation: '/api/v2/index/get_topic_relation',
};
export function decode(text: string, mode: string | null): any {
  let body = parseJson(text);
  if (mode) {
    if (!MODES[mode] || typeof body.data !== 'string') throw new Error('unsupported_encryption');
    const [key,iv] = MODES[mode].map(v => Buffer.from(v,'base64'));
    const cipher = createDecipheriv('aes-128-cbc',key,iv);
    body = parseJson(Buffer.concat([cipher.update(Buffer.from(body.data,'base64')),cipher.final()]).toString('utf8'));
  }
  return body;
}
export const unwrap = (body: any): any => body?.data ?? body;
const date = (value: any) => { if (!/^\d{8}$/.test(value ?? '')) throw new Error('valid_date_missing'); return value; };
function window(end: string, days: number) {
  date(end);
  const d = new Date(`${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T00:00:00Z`);
  if (d.toISOString().slice(0,10).replaceAll('-','') !== end) throw new Error('invalid_date');
  d.setUTCDate(d.getUTCDate() - days + 1);
  return { begin_date:d.toISOString().slice(0,10).replaceAll('-',''),end_date:end };
}
export function requestFor(task: any, dates: any): { path: string; method: string; payload: any } {
  const { type, id, keyword } = task;
  if (!Object.hasOwn(PATHS,type)) throw new Error('endpoint_not_allowed');
  if (type === 'topic_dates') return {path:PATHS[type],method:'GET',payload:null};
  if (['topic_search','videos'].includes(type) && (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 100)) throw new Error('invalid_keyword');
  if (type === 'videos' && ![7, 30].includes(task.days)) throw new Error('invalid_video_window');
  if (type === 'topic_relation' && !/^\d+$/.test(id ?? '')) throw new Error('topic_id_required');
  let payload: any;
  if (type === 'topic_search') {
    const range = window(dates.topic.valid_day,30);
    payload = {param:{app_name:'aweme',keyword,start_date:range.begin_date,end_date:range.end_date}};
  }
  else if (type === 'videos') payload = {query:keyword,authorIds:[],categoryId:'0',dateType:task.days,labelType:0,durationType:0};
  else {
    const range = window(dates.topic.valid_week, 7);
    payload = {app_name:'aweme',topic_ids:[id],...range};
  }
  return {path:PATHS[type],method:'POST',payload};
}
export function validateData(type: string, d: any, task: any = {}): any {
  const arrays = (...keys: string[]) => keys.every(k => Array.isArray(d?.[k]));
  let valid = false;
  if (type === 'topic_dates') valid = /^\d{8}$/.test(d?.valid_day) && /^\d{8}$/.test(d?.valid_week);
  else if (type === 'topic_search') valid = arrays('topic_list');
  else if (type === 'videos') valid = Array.isArray(d) || arrays('data');
  else if (type === 'topic_relation') valid = arrays('item_list','digg_author_list','comment_author_list');
  if (!valid) throw new Error('schema_error');
  return d;
}
// Exclude URLs, thumbnails, ranks and moving-window boundary fields from change learning.
// Discovery tracks ID sets; metric tasks track aggregates, profiles track distributions.
export function semanticValue(type: string, d: any): any {
  const ids = (rows: any, keys: string[]): string[] => [...new Set<string>((rows??[]).map((row: any) => keys.map(k => row[k]).find((v: any) => v !== undefined)).filter((v: any) => v !== undefined).map(String))].sort();
  if (type === 'videos') return ids(Array.isArray(d)?d:d.data,['itemId']);
  if (type === 'topic_search') return ids(d.topic_list,['topic_id']);
  if (type === 'topic_relation') return Object.fromEntries(['item_list','digg_author_list','comment_author_list'].map(k=>[k,ids(d[k],['item_id','author_id'])]));
  const omit = /url|pic|logo|avatar|thumbnail|BaseResp|rank|update_time/i;
  const parseMaybe = (value: any): any => { try { return clean(parseJson(value)); } catch { return value; } };
  const clean = (value: any): any => Array.isArray(value) ? value.map(clean).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k])=>!omit.test(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,clean(v)])) : typeof value === 'string' && /^[\[{]/.test(value) ? parseMaybe(value) : value;
  return clean(d);
}
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])) : value;
}
export const semanticHash = (type: string, d: any): string => createHash('sha256').update(JSON.stringify(stable(semanticValue(type,d)))).digest('hex');
