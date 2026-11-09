// 本地采集工作台：账号归属、原始响应和采样事实由SQLite保存。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../lib/db.ts';
import { lock } from '../lib/tasks.ts';
import {
  account,
  activeAccount,
  createAccount,
  listAccounts,
  sources,
  validateConfig,
  InputError,
  linkWork,
  matchKeywords,
} from '../lib/accounts.ts';
import {
  ensureStrategy,
  strategy,
  saveDraft,
  publish,
  rollback,
  context,
  ROOT,
  DATA,
  INSTRUCTIONS,
} from '../lib/strategies.ts';
import { authorId } from '../lib/douyin.ts';
import { initializationOverview } from '../lib/initialization.ts';
import { syncAgentInitialization } from '../lib/agent-state.ts';
import { indexLogin } from '../lib/index-login.ts';
import { CollectionStore, PROVIDERS, atomic } from '../collector/core/store.mjs';
import { collectionStatus } from '../collector/core/status.mjs';
import { planCollection } from '../collector/core/planner.mjs';
import { runScheduledCollection } from '../lib/collection-scheduler.ts';
const PORT = Number(process.env.WEB_PORT ?? 8788),
  DIST = join(ROOT, 'frontend', 'dist');
const TASKS: Record<string, string> = { collect: 'collector/run.ts' };
const json = (res: ServerResponse, data: unknown, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
async function body(req: IncomingMessage): Promise<Record<string, any>> {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 350000) throw new InputError('请求正文过大', 413);
  }
  try {
    const value = JSON.parse(text || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new InputError('请求须为 JSON 对象');
  }
}
const visibleMetrics = (raw: string) => {
  const m = JSON.parse(raw);
  if (m.views === 0) m.views = null;
  return m;
};
const engagement = (metrics: Record<string, number>) =>
  ['likes', 'comments', 'shares', 'collects'].reduce((n, k) => n + Number(metrics[k] || 0), 0);
const latest = `(SELECT metrics FROM snapshots s WHERE s.work_id=w.id AND s.ts<=datetime('now') ORDER BY ts DESC LIMIT 1)`;
const prev = `(SELECT metrics FROM snapshots s WHERE s.work_id=w.id AND s.ts<=datetime('now') ORDER BY ts DESC LIMIT 1 OFFSET 1)`;
function page(url: URL) {
  return Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || value.length > max)
    throw new InputError(`${label}格式无效（最多 ${max} 字）`);
  return value.trim();
}
function profile(value: unknown) {
  const v = text(value, '主页地址', 1000);
  if (!v) return '';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new InputError('请填写抖音主页链接');
  }
  if (u.protocol !== 'https:' || !/(^|\.)douyin\.com$/.test(u.hostname))
    throw new InputError('请使用 HTTPS 抖音链接');
  return v;
}
function videoUrl(value: unknown) {
  const v = profile(value);
  if (!/^https:\/\/(?:www\.)?douyin\.com\/video\/\d+/.test(v))
    throw new InputError('请填写完整作品链接：https://www.douyin.com/video/作品ID');
  return v;
}
function scopedId(req: IncomingMessage) {
  const raw = req.headers['x-everyone-content-account'];
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new InputError('请先选择账号');
  return Number(raw);
}
function taskState(db: DatabaseSync, accountId: number, task: string) {
  const r = db
    .prepare('SELECT * FROM task_runs WHERE account_id=? AND task=? ORDER BY id DESC LIMIT 1')
    .get(accountId, task) as Record<string, any> | undefined;
  if (r?.status === 'running' && r.pid) {
    try {
      process.kill(r.pid, 0);
    } catch {
      db.prepare(
        "UPDATE task_runs SET status='failed',finished_at=datetime('now'),log=log || ? WHERE id=?",
      ).run('\n任务进程已退出，可重新运行。', r.id);
      r.status = 'failed';
    }
  }
  return { ...r, running: r?.status === 'running', log: r?.log || '' };
}
function startTask(db: DatabaseSync, accountId: number, task: string, extra: string[] = []) {
  if (!TASKS[task]) throw new InputError('未知任务');
  const group = ['collect'];
  const jobs = db
    .prepare(
      `SELECT DISTINCT account_id,task FROM task_runs WHERE status='running' AND task IN (${group.map(() => '?').join(',')})`,
    )
    .all(...group) as { account_id: number; task: string }[];
  for (const job of jobs)
    if (taskState(db, job.account_id, job.task).running)
      throw new InputError('共享采集资源正在使用中，请稍后重试', 409);
  try { const unlock = lock('collection'); unlock(); }
  catch { throw new InputError('共享采集资源正在使用中，请稍后重试', 409); }
  const runId = Number(
    db.prepare('INSERT INTO task_runs(account_id,task) VALUES(?,?)').run(accountId, task).lastInsertRowid,
  );
  const child = spawn(process.execPath, [TASKS[task], `--account=${accountId}`, ...extra], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      EVERYONE_CONTENT_RUN_ID: String(runId),
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: [process.env.NO_PROXY, process.env.no_proxy, 'localhost,127.0.0.1,::1']
        .filter(Boolean)
        .join(','),
      no_proxy: [process.env.NO_PROXY, process.env.no_proxy, 'localhost,127.0.0.1,::1']
        .filter(Boolean)
        .join(','),
    },
  });
  db.prepare('UPDATE task_runs SET pid=? WHERE id=?').run(child.pid ?? null, runId);
  let error = '';
  child.stderr?.on('data', (data) => {
    error = (error + String(data)).slice(-2000);
  });
  const finish = (code: number | null) => {
    const conn = openDb();
    try {
      conn
        .prepare(
          "UPDATE task_runs SET status=?,finished_at=datetime('now'),log=log || ? WHERE id=? AND status='running'",
        )
        .run(code === 0 ? 'done' : 'failed', code === 0 ? '' : `\n${error || '任务进程未正常完成'}`, runId);
    } finally {
      conn.close();
    }
    setTimeout(scheduleCollection, 0).unref();
  };
  child.on('error', (e) => {
    error = String(e);
    finish(1);
  });
  child.on('close', finish);
  return { started: true, run_id: runId };
}

function scheduleCollection() {
  let db: DatabaseSync | undefined;
  try {
    db = openDb();
    runScheduledCollection(db, (id, args) => startTask(db!, id, 'collect', args));
  } catch (error) {
    if (!(error instanceof InputError && error.status === 409)) console.error('定时采集调度失败：', error instanceof Error ? error.message : '未知错误');
  } finally { db?.close(); }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL, db: DatabaseSync) {
  const path = url.pathname,
    method = req.method;
  if (path === '/api/initialization' && method === 'GET') return json(res, initializationOverview(db));
  if (path === '/api/health' && method === 'GET') return json(res, { app: 'everyone-content' });
  if (path === '/api/accounts') {
    if (method === 'GET') return json(res, listAccounts(db));
    if (method === 'POST') {
      const a = createAccount(db, (await body(req)).name);
      ensureStrategy(db, a.id);
      syncAgentInitialization(db, INSTRUCTIONS);
      return json(res, account(db, a.id), 201);
    }
  }
  const id = scopedId(req),
    a = account(db, id);
  if (path === '/api/context' && method === 'GET')
    return json(res, context(db, id, url.searchParams.get('strategy_sha')));
  if (method !== 'GET' && path !== '/api/index-auth/cancel' && !/^\/api\/accounts\/\d+$/.test(path)) activeAccount(db, id);
  if (path === '/api/index-auth' && method === 'GET') return json(res, indexLogin.state(db, id));
  if (path === '/api/index-auth/start' && method === 'POST') return json(res, indexLogin.start(db, id), 202);
  if (path === '/api/index-auth/cancel' && method === 'POST') return json(res, await indexLogin.cancel(db, id));
  const acct = path.match(/^\/api\/accounts\/(\d+)$/);
  if (acct && method === 'PUT') {
    if (Number(acct[1]) !== id) throw new InputError('账号上下文不一致', 409);
    const b = await body(req);
    const name = b.name === undefined ? a.name : text(b.name, '账号名称', 80);
    if (!name) throw new InputError('账号名称不能为空');
    const status = b.status ?? a.status;
    if (!['active', 'archived'].includes(status)) throw new InputError('账号状态无效');
    const config = b.config === undefined ? a.config : validateConfig(b.config);
    db.prepare('UPDATE accounts SET name=?,profile_url=?,status=?,config=? WHERE id=?').run(
      name,
      b.profile_url === undefined ? a.profile_url : profile(b.profile_url),
      status,
      JSON.stringify(config),
      id,
    );
    if (status === 'archived') await indexLogin.cancel(db, id);
    syncAgentInitialization(db, INSTRUCTIONS);
    return json(res, account(db, id));
  }
  if (path === '/api/collection/config') {
    if (method === 'GET') return json(res, a);
    if (method === 'PUT') {
      const update = await body(req);
      let unlock: () => void;
      try { unlock = lock('collection'); }
      catch { throw new InputError('采集任务正在运行，请稍后保存规则。', 409); }
      try {
        const current = activeAccount(db, id);
        const patch = Object.hasOwn(update, 'discovery') || Object.hasOwn(update, 'tasks') ? { index: update } : update;
        const config = validateConfig({ ...current.config, ...patch });
        atomic(db, () => {
          db.prepare('UPDATE accounts SET config=? WHERE id=?').run(JSON.stringify(config), id);
          planCollection(new CollectionStore(db, DATA), { accountIds: [id] });
        });
        return json(res, account(db, id));
      } finally { unlock(); }
    }
  }
  if (path === '/api/collection' && method === 'GET') return json(res, collectionStatus(db, a, new CollectionStore(db, DATA)));
  if (path === '/api/collection/progress' && method === 'GET') {
    const t = taskState(db, id, 'collect');
    return json(res, { running: t.running, progress: t.running ? Number(t.progress ?? 0) : null });
  }
  if (path === '/api/collection/limits' && method === 'PUT') {
    const b = await body(req);
    if (!PROVIDERS.includes(b.provider)) throw new InputError('采集来源无效');
    if (!Number.isInteger(b.daily_limit) || b.daily_limit < 1 || b.daily_limit > 10000)
      throw new InputError('每日额度须为1–10000的整数');
    db.prepare('UPDATE collection_limits SET daily_limit=? WHERE provider=?').run(b.daily_limit, b.provider);
    return json(res, { ok: true });
  }
  const collectionRecord = path.match(/^\/api\/collection\/records\/(\d+)(\/raw)?$/);
  if (collectionRecord && method === 'GET') {
    const r = db
      .prepare(
        `SELECT r.* FROM collection_runs r JOIN collection_run_accounts x ON x.run_id=r.id WHERE r.id=? AND x.account_id=?`,
      )
      .get(Number(collectionRecord[1]), id) as Record<string, any> | undefined;
    if (!r) throw new InputError('采集记录不存在或不属于当前账号', 404);
    const store = new CollectionStore(db, DATA);
    if (collectionRecord[2]) {
      const raw = db
        .prepare(
          'SELECT raw_path,raw_sha FROM collection_requests WHERE run_id=? AND raw_path IS NOT NULL ORDER BY id DESC LIMIT 1',
        )
        .get(r.id) as { raw_path: string; raw_sha: string } | undefined;
      if (!raw) throw new InputError('本次没有可读取的原始响应', 404);
      return json(res, { raw: store.read(raw.raw_path, raw.raw_sha) });
    }
    return json(res, {
      id: r.id,
      provider: r.provider,
      operation: r.operation,
      observed_at: r.observed_at,
      version: r.version,
      status: r.status,
      data: r.data_path ? store.data(r) : null,
    });
  }
  if (path === '/api/collection/resume' && method === 'POST') {
    const b = await body(req),
      provider = text(b.provider, '来源', 20);
    if (!PROVIDERS.includes(provider)) throw new InputError('采集来源无效');
    const scopes = db
      .prepare(
        'SELECT DISTINCT t.scope FROM collection_tasks t JOIN collection_task_accounts x ON x.task_key=t.key WHERE x.account_id=? AND t.provider=?',
      )
      .all(id, provider) as { scope: string }[];
    if (!scopes.length) throw new InputError('来源不属于当前账号', 404);
    for (const { scope } of scopes) {
      db.prepare('UPDATE collection_provider_state SET paused=0,error=NULL WHERE provider=? AND scope=?').run(
        provider,
        scope,
      );
      db.prepare(
        'UPDATE collection_tasks SET disabled=0,error=NULL,next_run_at=0 WHERE provider=? AND scope=? AND key IN(SELECT task_key FROM collection_task_accounts WHERE account_id=?)',
      ).run(provider, scope, id);
    }
    return json(res, { ok: true });
  }
  if (path === '/api/authors' && method === 'GET') {
    const followed = url.searchParams.get('scope') === 'bloggers';
    const rows = db
      .prepare(
        followed ? `SELECT s.source_key,a.author_id sec_uid,COALESCE(NULLIF(a.name,''),s.name) name,a.follower_count,a.last_seen_at,
      (SELECT COUNT(*) FROM account_works aw JOIN works w ON w.id=aw.work_id WHERE aw.account_id=? AND w.author_id=s.source_key AND w.platform=?) works
      FROM account_sources s LEFT JOIN authors a ON a.author_id=s.source_key AND a.platform=?
      WHERE s.account_id=? AND s.kind='blogger' ORDER BY a.follower_count DESC,s.id`
        : `SELECT a.author_id sec_uid,a.name,a.follower_count,a.last_seen_at,
      (SELECT COUNT(*) FROM account_works aw JOIN works w ON w.id=aw.work_id WHERE aw.account_id=? AND w.author_id=a.author_id AND w.platform=a.platform) works
      FROM authors a WHERE EXISTS(SELECT 1 FROM account_works aw JOIN works w ON w.id=aw.work_id WHERE aw.account_id=? AND w.author_id=a.author_id AND w.platform=a.platform)
      OR EXISTS(SELECT 1 FROM account_sources s WHERE s.account_id=? AND s.kind='blogger' AND s.source_key=a.author_id)
      ORDER BY a.follower_count DESC`,
      )
      .all(...(followed ? [id, a.platform, a.platform, id] : [id, id, id])) as Record<string, any>[];
    return json(
      res,
      rows.map((r) => ({ ...r, name: r.name || '未知', follower_count: r.follower_count ?? null })),
    );
  }
  if (path === '/api/works' && method === 'GET') {
    const p = page(url),
      author = url.searchParams.get('author'),
      blogger = url.searchParams.get('blogger'),
      status = url.searchParams.get('status');
    const conds = ['aw.account_id=?'],
      args: (string | number)[] = [id];
    if (url.searchParams.get('scope') === 'bloggers' || blogger !== null) {
      conds.push('w.platform=?'); args.push(a.platform);
      conds.push(`EXISTS(SELECT 1 FROM account_sources s WHERE s.account_id=aw.account_id AND s.kind='blogger'
        AND s.source_key=w.author_id${blogger !== null ? ' AND s.source_key=?' : ''})`);
      if (blogger !== null) args.push(blogger);
    }
    if (author) {
      conds.push('a.name=?');
      args.push(author);
    }
    if (status === 'gone') conds.push("w.status='gone'");
    const from = `FROM account_works aw JOIN works w ON w.id=aw.work_id LEFT JOIN authors a ON a.author_id=w.author_id AND a.platform=w.platform WHERE ${conds.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) n ${from}`).get(...args) as { n: number }).n;
    const order = 'w.published_at DESC,w.id DESC';
    const rows = db
      .prepare(
        `SELECT w.*,a.name author,${latest} latest,${prev} prev ${from}
      ORDER BY ${order} LIMIT 20 OFFSET ?`,
      )
      .all(...args, (p - 1) * 20) as Record<string, any>[];
    return json(res, {
      total,
      page: p,
      items: rows.map((r) => {
        const metrics = visibleMetrics(r.latest || '{}');
        return {
          ...r,
          author: r.author || '',
          metrics,
          engagement: engagement(metrics),
          growth: r.prev ? engagement(metrics) - engagement(JSON.parse(r.prev)) : null,
        };
      }),
    });
  }
  const workDetail = path.match(/^\/api\/works\/(\d+)$/);
  if (workDetail && method === 'GET') {
    const w = db
      .prepare(
        `SELECT w.* FROM works w JOIN account_works aw ON aw.work_id=w.id WHERE w.id=? AND aw.account_id=?`,
      )
      .get(Number(workDetail[1]), id);
    if (!w) throw new InputError('作品不属于当前账号', 404);
    const snaps = db
      .prepare('SELECT ts,metrics FROM snapshots WHERE work_id=? ORDER BY ts')
      .all(Number(workDetail[1])) as { ts: string; metrics: string }[];
    return json(res, {
      ...w,
      series: snaps.map((s) => ({
        ts: s.ts,
        ...visibleMetrics(s.metrics),
        engagement: engagement(JSON.parse(s.metrics)),
      })),
    });
  }
  if (path === '/api/sources' && method === 'GET') {
    const all = sources(db, id);
    return json(res, {
      config: a.config,
      bloggers: all
        .filter((s) => s.kind === 'blogger')
        .map((s) => ({
          ...s,
          sec_uid: s.source_key.startsWith('MS4w') ? s.source_key : undefined,
          profile_url: s.source_key.startsWith('http') ? s.source_key : undefined,
        })),
      keywords: all.filter((s) => s.kind === 'keyword'),
    });
  }
  if (['/api/bloggers', '/api/keywords'].includes(path) && method === 'POST') {
    const b = await body(req),
      kind = path.endsWith('bloggers') ? 'blogger' : 'keyword';
    let sourceKey: string, name: string;
    if (kind === 'blogger') {
      const url = text(b.url, '博主链接', 2000);
      if (!/MS4wLj[A-Za-z0-9_-]+/.test(url)) profile(url);
      const parsed = authorId(url);
      if (!parsed) throw new InputError('请粘贴完整抖音主页链接，短链接不支持本地解析');
      sourceKey = parsed;
      const known = db
        .prepare("SELECT name FROM authors WHERE platform='douyin' AND author_id=?")
        .get(sourceKey) as { name: string } | undefined;
      name = (b.name ? text(b.name, '博主名称', 100) : known?.name) || sourceKey.slice(0, 12);
    } else {
      sourceKey = text(b.keyword, '关键词', 80);
      name = sourceKey;
      if (!sourceKey) throw new InputError('关键词不能为空');
    }
    if (sources(db, id).some((s) => s.kind === kind && s.source_key === sourceKey))
      throw new InputError('该账号已添加此采集源', 409);
    db.prepare('INSERT INTO account_sources(account_id,kind,source_key,name,note) VALUES(?,?,?,?,?)').run(
      id,
      kind,
      sourceKey,
      name,
      b.note ? text(b.note, '备注', 1000) : '',
    );
    let message = '已加入本账号；公共历史数据已关联。';
    if (kind === 'blogger') {
      const cached = db
        .prepare("SELECT id FROM works WHERE platform='douyin' AND author_id=?")
        .all(sourceKey) as { id: number }[];
      for (const w of cached) linkWork(db, id, w.id, `blogger:${name}`);
      message += '仅展示指数采集已收录的作品，不单独请求博主新作。';
    } else matchKeywords(db, a);
    return json(res, { ok: true, name, message }, 201);
  }
  const source = path.match(/^\/api\/sources\/(\d+)$/);
  if (source && ['PUT', 'DELETE'].includes(method || '')) {
    const s = sources(db, id).find((s) => s.id === Number(source[1]));
    if (!s) throw new InputError('采集源不存在', 404);
    if (method === 'DELETE')
      db.prepare('DELETE FROM account_sources WHERE id=? AND account_id=?').run(s.id, id);
    else {
      const b = await body(req),
        status = b.status ?? s.status;
      if (!['ready', 'paused'].includes(status)) throw new InputError('状态必须为 ready / paused');
      db.prepare('UPDATE account_sources SET status=?,name=?,note=? WHERE id=? AND account_id=?').run(
        status,
        b.name === undefined ? s.name : text(b.name, '名称', 100),
        b.note === undefined ? s.note : text(b.note, '备注', 1000),
        s.id,
        id,
      );
      if (s.kind === 'keyword' && status === 'ready') matchKeywords(db, a);
    }
    return json(res, { ok: true });
  }
  if (path === '/api/strategy' && method === 'GET') return json(res, strategy(db, id));
  if (path === '/api/strategy/draft' && method === 'PUT') {
    const b = await body(req);
    return json(res, saveDraft(db, id, b.docs, b.base_sha));
  }
  if (path === '/api/strategy/publish' && method === 'POST') {
    const b = await body(req);
    return json(res, publish(db, id, b.base_sha, b.note));
  }
  if (path === '/api/strategy/rollback' && method === 'POST') {
    const b = await body(req);
    return json(res, rollback(db, id, b.sha, b.base_sha));
  }
  if (path === '/api/contents' && method === 'GET')
    return json(
      res,
      db
        .prepare(
          `SELECT c.id,c.status,c.published_url,c.published_at,c.strategy_sha,(SELECT metrics FROM content_snapshots s WHERE s.content_id=c.id ORDER BY ts DESC LIMIT 1) metrics FROM contents c WHERE c.account_id=? AND c.status='published' ORDER BY c.created_at DESC`,
        )
        .all(id),
    );
  if (path === '/api/contents' && method === 'POST') {
    const b = await body(req),
      url = videoUrl(b.published_url),
      date = new Date(b.published_at);
    if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now())
      throw new InputError('请填写正确的实际发布时间');
    const next = Number(db.prepare('SELECT COALESCE(MAX(id),0)+1 id FROM contents').get()?.id);
    const result = db
      .prepare(
        "INSERT INTO contents(id,account_id,status,published_url,published_at,strategy_sha) VALUES(?,?,'published',?,?,NULL)",
      )
      .run(next, id, url, date.toISOString().replace('T', ' ').slice(0, 19));
    return json(res, { id: Number(result.lastInsertRowid) }, 201);
  }
  if (path === '/api/run/collect' && method === 'POST') {
    const b = await body(req),
      extra: string[] = [];
    if (b.only) {
      if (!PROVIDERS.includes(b.only)) throw new InputError('采集来源无效');
      extra.push(`--only=${b.only}`);
    }
    return json(res, startTask(db, id, 'collect', extra), 202);
  }
  throw new InputError('接口不存在', 404);
}

{
  const db = openDb();
  try {
    for (const a of listAccounts(db)) ensureStrategy(db, a.id);
    if (!syncAgentInitialization(db, INSTRUCTIONS)) console.warn('AGENTS.md初始化状态尚未同步，请检查项目目录写入权限。');
  } finally {
    db.close();
  }
}
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
createServer(async (req, res) => {
  let db: DatabaseSync | undefined;
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (
      !['GET', 'HEAD'].includes(req.method || '') &&
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    )
      throw new InputError('禁止跨站写入', 403);
    if (url.pathname.startsWith('/api/')) {
      db = openDb();
      return await api(req, res, url, db);
    }
    let file = resolve(DIST, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(DIST + sep) || !existsSync(file) || statSync(file).isDirectory())
      file = join(DIST, 'index.html');
    if (!existsSync(file)) return json(res, { error: '前端尚未构建，请运行 npm run build:web' }, 503);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public,max-age=3600',
    });
    res.end(readFileSync(file));
  } catch (e) {
    json(
      res,
      { error: e instanceof Error ? e.message : '服务异常' },
      e instanceof InputError ? e.status : 500,
    );
  } finally {
    db?.close();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`everyone-content → http://127.0.0.1:${PORT}`));

setInterval(scheduleCollection, 30_000).unref();
setTimeout(scheduleCollection, 1000).unref();
