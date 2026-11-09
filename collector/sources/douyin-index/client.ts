import { readFileSync, statSync } from 'node:fs';
import { ORIGIN, PATHS, decode, unwrap, validateData } from './protocol.ts';

export interface IndexAuth { cookie: string; userAgent?: string }

export function authFromCookies(cookies: any[], userAgent?: string): IndexAuth {
  const now = Date.now()/1000;
  const selected = cookies.filter(c => ['creator.douyin.com','.douyin.com','douyin.com'].includes(c.domain)
    && c.value && (!c.expires || c.expires < 0 || c.expires > now) && '/api/v2/'.startsWith(c.path || '/'));
  return {cookie:selected.map(c=>`${c.name}=${c.value}`).join('; '),userAgent};
}

export function loadAuth(file: string | undefined, env: Record<string, string | undefined> = process.env): IndexAuth {
  let auth: any;
  if (env.DOUYIN_INDEX_COOKIE) auth = {cookie:env.DOUYIN_INDEX_COOKIE,userAgent:env.DOUYIN_INDEX_USER_AGENT};
  else {
    if (!file) throw new Error('auth_required');
    const stat = statSync(file);
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('auth_file_must_be_private_0600');
    auth = JSON.parse(readFileSync(file,'utf8'));
    if (Array.isArray(auth.cookies)) auth = authFromCookies(auth.cookies,auth.userAgent);
  }
  if (typeof auth.cookie !== 'string' || !auth.cookie.trim() || /[\r\n]/.test(auth.cookie)) throw new Error('invalid_auth_cookie');
  if (auth.userAgent !== undefined && (typeof auth.userAgent !== 'string' || /[\r\n]/.test(auth.userAgent))) throw new Error('invalid_user_agent');
  return auth;
}
export class ReadClient {
  auth: IndexAuth; fetch: typeof fetch; intervalMs: number; sleep: (ms: number) => Promise<void>; last: number; busy: boolean;
  constructor(auth: IndexAuth, {fetchImpl = fetch, intervalMs = 2000, sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))} = {}) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error('minimum_interval_1000ms');
    this.auth=auth;this.fetch=fetchImpl;this.intervalMs=intervalMs;this.sleep=sleep;this.last=0;this.busy=false;
  }
  async read(task: any, req: { path: string; method: string; payload: any }) {
    if (!Object.values(PATHS).includes(req.path) || !Object.hasOwn(PATHS,task.type) || PATHS[task.type as string] !== req.path) throw new Error('endpoint_not_allowed');
    const method = ['topic_dates','author_dates'].includes(task.type)?'GET':'POST';
    if (req.method !== method) throw new Error('method_not_allowed');
    if (this.busy) throw new Error('serial_requests_required');
    this.busy=true;
    try {
      await this.sleep(Math.max(0,this.last+this.intervalMs-Date.now()));
      this.last=Date.now();
      let res: Response;
      try {
        res=await this.fetch(ORIGIN+req.path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{cookie:this.auth.cookie,appsource:'PC',referer:ORIGIN+'/creator-micro/creator-count/arithmetic-index',...(this.auth.userAgent?{'user-agent':this.auth.userAgent}:{}),...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(req.payload)}:{})});
      } catch (error) {
        if(/^(daily_budget_exhausted|tick_budget_exhausted|source_paused)$/.test((error as Error)?.message??''))throw error;
        throw new Error('transport_error');
      }
      if ([401,403].includes(res.status)) throw new Error('login_required');
      if (res.status===429) throw new Error('rate_limited');
      if (!res.ok) throw new Error('http_error_'+res.status);
      const text=await res.text();
      if (/^\s*</.test(text)) throw new Error('login_or_challenge_html');
      let body;
      try {body=decode(text,res.headers.get('x-encrypted'));}catch{throw new Error('decode_error');}
      const codes=[body?.status,body?.code,body?.status_code,body?.BaseResp?.StatusCode,body?.data?.BaseResp?.StatusCode].filter(x=>x!==undefined&&x!==null).map(Number);
      if(codes.some(c=>[8,401,403,10001,10002,10008,2190008].includes(c)))throw new Error('login_required');
      if(codes.some(c=>[429,10006].includes(c)))throw new Error('rate_limited');
      if(codes.some(c=>![0,200].includes(c)))throw new Error('business_error');
      const data=validateData(task.type,unwrap(body),task);
      return {status:res.status,encryption:res.headers.get('x-encrypted'),raw:text,data};
    } finally {this.busy=false;}
  }
}
