import { readFileSync, statSync } from 'node:fs';

// 平台登录会话:cookie 串 + 可选 UA。与抖音指数会话同构,文件同样要求 0600。
export interface PlatformAuth { cookie: string; userAgent?: string }

// 从浏览器 cookie 列表挑出目标域名的非过期项;必须命中哨兵 cookie 才算有效登录态。
export function sessionFromCookies(cookies: any[], domains: string[], sentinel: RegExp, userAgent?: string): PlatformAuth {
  const now = Date.now() / 1000;
  const cookie = cookies
    .filter(c => domains.includes(c.domain) && c.value && (!c.expires || c.expires < 0 || c.expires > now))
    .map(c => `${c.name}=${c.value}`).join('; ');
  if (!sentinel.test(cookie)) throw new Error('login_session_missing');
  return { cookie, userAgent };
}

export function loadSession(file: string | undefined, env: Record<string, string | undefined> = {}): PlatformAuth {
  let auth: any;
  if (env.cookie) auth = { cookie: env.cookie, userAgent: env.userAgent };
  else {
    if (!file) throw new Error('auth_required');
    const stat = statSync(file);
    // POSIX 校验组/其他位;Windows 的 mode 恒为 0666/0444,权限由用户目录 ACL 保证,跳过位检查。
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('auth_file_must_be_private_0600');
    auth = JSON.parse(readFileSync(file, 'utf8'));
  }
  if (typeof auth.cookie !== 'string' || !auth.cookie.trim() || /[\r\n]/.test(auth.cookie)) throw new Error('invalid_auth_cookie');
  if (auth.userAgent !== undefined && (typeof auth.userAgent !== 'string' || /[\r\n]/.test(auth.userAgent))) throw new Error('invalid_user_agent');
  return auth;
}
