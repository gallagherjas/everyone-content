import { formatTime } from './time.ts';

export const PLATFORM_PROVIDERS = ['douyin', 'xhs', 'bili'] as const;
export const COLLECTION_PROVIDERS = ['index', ...PLATFORM_PROVIDERS] as const;
export type CollectionProvider = typeof COLLECTION_PROVIDERS[number];
export const COLLECTION_PROVIDER_NAMES: Record<CollectionProvider, string> = {
  index: '抖音指数', douyin: '抖音创作后台', xhs: '小红书创作服务', bili: 'B站创作中心',
};
export const AUTH_ERROR = /^(login_required|auth_required|invalid_auth_cookie|invalid_user_agent|auth_file_must_be_private_0600)$/;
export const INDEX_SCOPES = ['topic_rank', 'video_rank', 'author'] as const;
export const SCHEDULE_SCOPES = [...INDEX_SCOPES, ...COLLECTION_PROVIDERS] as const;
export type ScheduleScope = typeof SCHEDULE_SCOPES[number];
export const COLLECTION_SCOPES: readonly string[] = [...SCHEDULE_SCOPES, 'topic'];
export const providerForScope = (scope: string): CollectionProvider =>
  COLLECTION_PROVIDERS.find(provider => provider === scope) ?? 'index';

export interface CollectionSchedule {
  enabled: boolean;
  times: string[];
  request_limit: number;
}
export type CollectionSchedules = Record<ScheduleScope, CollectionSchedule>;

export function defaultSchedules(): CollectionSchedules {
  return Object.fromEntries(SCHEDULE_SCOPES.map(scope => [scope, {
    enabled: false, times: ['00:00'], request_limit: 10,
  }])) as CollectionSchedules;
}

export function validateSchedules(value: unknown): CollectionSchedules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('定时采集配置无效');
  if (Object.keys(value).some(scope => !SCHEDULE_SCOPES.includes(scope as ScheduleScope)))
    throw new Error('定时采集配置无效');
  const schedules = { ...defaultSchedules(), ...value };
  return Object.fromEntries(SCHEDULE_SCOPES.map(scope => {
    const schedule = schedules[scope];
    if (!schedule || typeof schedule.enabled !== 'boolean' || !Array.isArray(schedule.times)
      || schedule.times.length < 1 || schedule.times.length > 24
      || schedule.times.some(time => typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))
      throw new Error('每类采集需设置1–24个北京时间，格式为 HH:mm');
    if (!Number.isInteger(schedule.request_limit) || schedule.request_limit < 1 || schedule.request_limit > 10)
      throw new Error('每轮定时采集请求上限须为1–10的整数');
    return [scope, { enabled: schedule.enabled, times: [...new Set(schedule.times)].sort(), request_limit: schedule.request_limit }];
  })) as CollectionSchedules;
}

// Use only the latest elapsed slot today: waking the computer does not replay every missed run.
export function latestScheduleSlot(schedule: CollectionSchedule, now: number): string | null {
  if (!schedule.enabled) return null;
  const beijing = formatTime(now);
  const time = [...schedule.times].sort().filter(value => value <= beijing.slice(11, 16)).at(-1);
  return time ? new Date(`${beijing.slice(0, 10)}T${time}:00+08:00`).toISOString().slice(0, 19).replace('T', ' ') : null;
}
