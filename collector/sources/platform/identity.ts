import { parseJson } from '../../../lib/json.ts';
import { DOUYIN_PROFILE_URL, SNAPSHOT_PLATFORMS } from './snapshot.ts';
import type { PlatformAuth } from './session.ts';

export interface PlatformIdentity {
  id: string;
  name: string | null;
  handle: string | null;
}

const DOUYIN_PROFILE = { url: DOUYIN_PROFILE_URL, referer: SNAPSHOT_PLATFORMS.douyin.referer };
const PROFILES = {
  index: DOUYIN_PROFILE,
  douyin: DOUYIN_PROFILE,
  xhs: { url: SNAPSHOT_PLATFORMS.xhs.origin + '/api/galaxy/user/info', referer: SNAPSHOT_PLATFORMS.xhs.referer },
  bili: { url: 'https://api.bilibili.com/x/web-interface/nav', referer: 'https://www.bilibili.com/' },
};

function label(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().slice(0, 120) || null : null;
}

export function parsePlatformIdentity(provider: keyof typeof PROFILES, body: any): PlatformIdentity | null {
  if (provider === 'index' || provider === 'douyin') {
    const profile = body?.user_profile, verified = body?.douyin_user_verify_info;
    const id = label(profile?.secret_id);
    if (body?.status_code !== 0 || !id || !/^MS4wLjAB[\w-]+$/.test(id)) return null;
    return { id, name: label(profile.nick_name) ?? label(verified?.nick_name),
      handle: label(profile.unique_id) ?? label(verified?.douyin_unique_id) };
  }
  if (provider === 'xhs') {
    const profile = body?.data, id = label(profile?.userId);
    if (body?.code !== 0 || body.success !== true || !id || !/^[a-f\d]{24}$/i.test(id)) return null;
    return { id, name: label(profile.userName), handle: label(profile.redId) };
  }
  const profile = body?.data, id = String(profile?.mid ?? '');
  if (body?.code !== 0 || profile?.isLogin !== true || !/^[1-9]\d*$/.test(id)) return null;
  return { id, name: label(profile.uname), handle: id };
}

export function platformAccountLabel(identity: PlatformIdentity | null): string | null {
  if (!identity) return null;
  const { name, handle, id } = identity;
  return name && handle && name !== handle ? `${name}（${handle}）` : name ?? handle ?? id;
}

export async function fetchPlatformIdentity(provider: keyof typeof PROFILES, auth: PlatformAuth,
  fetchImpl: typeof fetch = fetch): Promise<PlatformIdentity | null> {
  const { url, referer } = PROFILES[provider];
  // B 站自查接口在 api 子域，只发送用于全站登录的会话项。
  const cookie = provider === 'bili' ? /(?:^|;\s*)(SESSDATA=[^;]+)/.exec(auth.cookie)?.[1] : auth.cookie;
  if (!cookie) return null;
  const response = await fetchImpl(url, {
    headers: { cookie, referer, ...(auth.userAgent ? { 'user-agent': auth.userAgent } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) { await response.body?.cancel(); return null; }
  return parsePlatformIdentity(provider, parseJson(await response.text()));
}
