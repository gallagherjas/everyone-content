import { createDecipheriv, createHash } from 'node:crypto';
import { parseJson } from '../../../lib/json.mjs';
export { parseJson } from '../../../lib/json.mjs';
export const ORIGIN = 'https://creator.douyin.com';
const MODES = {
  '1': ['kbSjOqn9O7APLqUZxdCkTQ==','JuhL1cOV5JH9ojzt2g2EPg=='],
  '2': ['SjXbYTJb7zXoUToSicUL3A==','OekMLjghRg8vlX/PemLc+Q=='],
};
export const PATHS = {
  topic_dates: '/api/v2/index/get_topic_valid_date', author_dates: '/api/v2/daren/get_greater_users_valid_date',
  topic_search: '/api/v2/index/query_topic', videos: '/api/v2/index/itemQuery', author_search: '/api/v2/daren/get_sug_great_user_list',
  topic_trend: '/api/v2/index/get_multi_topic_list', topic_relation: '/api/v2/index/get_topic_relation', topic_audience: '/api/v2/index/get_multi_topic_portrait',
  author_info: '/api/v2/daren/get_author_info', author_core: '/api/v2/daren/get_great_user_mile_Info', author_average: '/api/v2/daren/get_great_item_mile_Info',
  author_works: '/api/v2/daren/get_great_user_top_video', author_fans: '/api/v2/daren/get_great_user_fans_info', author_similar: '/api/v2/daren/get_similar_users',
};
export function decode(text, mode) {
  let body = parseJson(text);
  if (mode) {
    if (!MODES[mode] || typeof body.data !== 'string') throw new Error('unsupported_encryption');
    const [key,iv] = MODES[mode].map(v => Buffer.from(v,'base64'));
    const cipher = createDecipheriv('aes-128-cbc',key,iv);
    body = parseJson(Buffer.concat([cipher.update(Buffer.from(body.data,'base64')),cipher.final()]).toString('utf8'));
  }
  return body;
}
export const unwrap = body => body?.data ?? body;
const date = value => { if (!/^\d{8}$/.test(value ?? '')) throw new Error('valid_date_missing'); return value; };
function window(end, days) {
  date(end);
  const d = new Date(`${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T00:00:00Z`);
  if (d.toISOString().slice(0,10).replaceAll('-','') !== end) throw new Error('invalid_date');
  d.setUTCDate(d.getUTCDate() - days + 1);
  return { begin_date:d.toISOString().slice(0,10).replaceAll('-',''),end_date:end };
}
export function requestFor(task, dates) {
  const { type, id, keyword } = task;
  if (!Object.hasOwn(PATHS,type)) throw new Error('endpoint_not_allowed');
  if (['topic_dates','author_dates'].includes(type)) return {path:PATHS[type],method:'GET',payload:null};
  if (['topic_search','videos','author_search'].includes(type) && (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 100)) throw new Error('invalid_keyword');
  if (type.startsWith('topic_') && type !== 'topic_search' && !/^\d+$/.test(id ?? '')) throw new Error('topic_id_required');
  if (type.startsWith('author_') && type !== 'author_search' && !/^[a-z0-9]+$/.test(id ?? '')) throw new Error('author_id_required');
  let payload;
  if (type === 'topic_search') {
    const range = window(dates.topic.valid_day,30);
    payload = {param:{app_name:'aweme',keyword,start_date:range.begin_date,end_date:range.end_date}};
  }
  else if (type === 'videos') payload = {query:keyword,authorIds:[],categoryId:'0',dateType:7,labelType:0,durationType:0};
  else if (type === 'author_search') payload = {keyword,total:'20'};
  else if (type.startsWith('topic_')) {
    const range = window(type === 'topic_relation' ? dates.topic.valid_week : dates.topic.valid_day, type === 'topic_relation' ? 7 : 30);
    payload = {app_name:'aweme',topic_ids:[id],...range};
    if (type === 'topic_audience') payload.start_date = range.begin_date;
  } else {
    payload = {user_id:id};
    if (type === 'author_works') { const w = window(dates.author.datetime,30); Object.assign(payload,{start_date:w.begin_date,end_date:w.end_date}); }
  }
  return {path:PATHS[type],method:'POST',payload};
}
export function validateData(type,d,task={}) {
  const arrays = (...keys) => keys.every(k => Array.isArray(d?.[k]));
  let valid = false;
  if (type === 'topic_dates') valid = /^\d{8}$/.test(d?.valid_day) && /^\d{8}$/.test(d?.valid_week);
  else if (type === 'author_dates') valid = /^\d{8}$/.test(d?.datetime);
  else if (type === 'topic_search') valid = arrays('topic_list');
  else if (type === 'videos') valid = Array.isArray(d) || arrays('data');
  else if (type === 'author_search') valid = arrays('userlist');
  else if (type === 'topic_trend') valid = arrays('topic_list') && d.topic_list.some(t => t.topic_id === task.id && Array.isArray(t.data));
  else if (type === 'topic_relation') valid = arrays('item_list','digg_author_list','comment_author_list');
  else if (type === 'topic_audience') valid = Array.isArray(d) && d.some(v => v.name_en === 'age' && Array.isArray(v.label_list));
  else if (type === 'author_info') valid = typeof d?.user_id === 'string' && d.user_id === task.id && 'fans_count' in d;
  else if (type === 'author_core') valid = arrays('fanslistday','likelistday') && d.fans_info && d.like_info;
  else if (type === 'author_average') valid = arrays('fans_info','like_info','share_info','comment_info');
  else if (type === 'author_works') valid = arrays('like_list','comment_list','share_list','follow_list','index_list','create_time_list');
  else if (type === 'author_fans') valid = ['Age','Gender','FirstTag'].every(k => typeof d?.[k] === 'string' && Array.isArray(parseJson(d[k])));
  else if (type === 'author_similar') valid = arrays('similar_user_list');
  if (!valid) throw new Error('schema_error');
  return d;
}
// Exclude URLs, thumbnails, ranks and moving-window boundary fields from change learning.
// Discovery tracks ID sets; metric tasks track aggregates, profiles track distributions.
export function semanticValue(type,d) {
  const ids = (rows,keys) => [...new Set((rows??[]).map(row => keys.map(k => row[k]).find(v => v !== undefined)).filter(v => v !== undefined).map(String))].sort();
  if (type === 'videos') return ids(Array.isArray(d)?d:d.data,['itemId']);
  if (type === 'topic_search') return ids(d.topic_list,['topic_id']);
  if (type === 'author_search') return ids(d.userlist,['user_id']);
  if (type === 'topic_relation') return Object.fromEntries(['item_list','digg_author_list','comment_author_list'].map(k=>[k,ids(d[k],['item_id','author_id'])]));
  if (type === 'author_similar') return ids(d.similar_user_list,['user_id']);
  if (type === 'author_works') return [...new Map(Object.values(d).filter(Array.isArray).flat().map(v => [v.item_id,{id:v.item_id,likes:v.like_cnt,comments:v.coment_cnt,shares:v.share_cnt,follows:v.follow_cnt}])).values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  if (type === 'author_core') return Object.fromEntries(Object.entries(d).filter(([k])=>k.endsWith('_info')));
  if (type === 'topic_trend') return d.topic_list.map(t=>({id:t.topic_id,latest:t.data.at(-1)}));
  const omit = /url|pic|logo|avatar|thumbnail|BaseResp|rank|update_time/i;
  const parseMaybe = value => { try { return clean(parseJson(value)); } catch { return value; } };
  const clean = value => Array.isArray(value) ? value.map(clean).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k])=>!omit.test(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,clean(v)])) : typeof value === 'string' && /^[\[{]/.test(value) ? parseMaybe(value) : value;
  return clean(d);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])) : value;
}
export const semanticHash = (type,d) => createHash('sha256').update(JSON.stringify(stable(semanticValue(type,d)))).digest('hex');
