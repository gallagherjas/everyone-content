import { COLLECTION_PROVIDER_NAMES, type ScheduleScope } from "../../lib/collection-schedule";
import type { BloggerSearchState, BloggerSearchStatus } from "../../collector/core/bloggers";
import { formatTime } from "../../lib/time";

/** 采集域共用文案：采集页(任务/次数上限)与设置·采集记录共用 */
export const names: Record<string, string> = COLLECTION_PROVIDER_NAMES;
export const collectionNames: Record<ScheduleScope, string> = {
  topic_rank: "话题榜", video_rank: "视频榜", author: "博主追踪",
  index: names.index, douyin: names.douyin, xhs: names.xhs, bili: names.bili,
};
export const statuses: Record<string, string> = { ok: "完成", failed: "失败", cached: "复用缓存", running: "处理中", deferred: "已延后" };
export const operations: Record<string, string> = {
  account_snapshot: "账号快照", topic_dates: "话题有效日期", topic_search: "话题搜索",
  topic_trend: "话题趋势", topic_relation: "关联话题", videos: "视频搜索",
  author_dates: "博主有效日期", author_search: "博主搜索", author_works: "博主作品",
  author_core: "博主日增", author_info: "博主资料",
};
export const searchLabels: Record<BloggerSearchState, string> = {
  queued: "待解析", running: "解析中", blocked: "解析受阻",
  failed: "解析失败", deferred: "解析延后", not_found: "未找到",
};
const errors: Record<string, string> = {
  auth_required: "找不到本账号的授权。请到「采集 → 连接」连接对应平台。",
  login_required: "平台提示未登录。请到「采集 → 连接」重新连接，再试采此平台。",
  invalid_auth_cookie: "本机保存的会话无效。请重新连接。",
  invalid_user_agent: "本机保存的浏览器信息无效。请重新连接。",
  auth_file_must_be_private_0600: "本机授权文件须仅本人可读写。请重新连接。",
  source_dates_missing: "正在等待平台提供数据日期。下轮采集会重新检查。",
  service_unavailable: "暂时无法连接平台。请检查网络与平台能否访问。",
  transport_error: "请求未完成。请检查网络或代理后重试。",
  daily_budget_exhausted: "今日采集次数已达上限。请等北京时间 00:00 重置后再采。",
  tick_budget_exhausted: "本轮采集次数已达上限。剩余任务可在后续采集执行。",
  interval_pending: "平台请求间隔未到。到时可手动采集，或等下一次定时采集。",
  source_paused: "该来源已暂停。请查看本来源上一条失败记录。",
  rate_limited: "平台限制了请求频率，当前来源已暂停。请等限制解除后恢复采集。",
  payment_required: "平台要求开通相关数据权限。请在官方后台核对权限。",
  schema_error: "平台响应中找不到预期数据字段。该任务已停用，需检查采集适配。",
  decode_error: "平台数据无法解码。该任务已停用，需检查采集适配。",
  unsupported_encryption: "平台使用了当前版本不支持的数据格式。需更新采集适配。",
  unexpected_html: "平台返回了网页。请到官方后台检查登录或页面验证。",
  invalid_response: "平台返回的数据无法解析。请稍后再试。",
  business_error: "平台拒绝了本次数据请求。请到官方后台检查账号或数据权限。",
  identity_conflict: "响应里的账号或作品标识与请求不一致。请核对采集对象。",
  cancelled: "这条任务在完成前停止。请在下次采集继续。",
  request_failed: "采集请求未完成。请查看本来源近期记录，并检查平台能否访问。",
};
export function reason(code: string | null): string | null {
  if (!code) return null;
  if (code === "http_error_403") return "平台拒绝访问（HTTP 403）。请在官方后台检查权限或验证提示。";
  const http = /^http_error_(\d{3})$/.exec(code);
  if (http) return `平台请求未成功（HTTP ${http[1]}）。请检查平台能否访问。`;
  return Object.hasOwn(errors, code) ? errors[code] : "任务未能完成。请查看同一来源的近期采集记录。";
}

export function searchMessage({ searchState, error, nextRetryAt }: Partial<BloggerSearchStatus>) {
  if (searchState === 'not_found') return '未找到该昵称的达人。可到「采集 → 博主」移出后添加正确昵称。';
  return [reason(error ?? null), nextRetryAt && `预计 ${formatTime(nextRetryAt)} 后可自动重试。`,
    searchState === 'failed' && '可到「采集 → 日志」重试。'].filter(Boolean).join(' ');
}
