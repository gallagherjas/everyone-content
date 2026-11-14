import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exercise React with a simulated DOM; no browser or live business API is used.
test('首个账号由用户创建；页面缓存保留编辑状态，切换账号时隔离且隐藏时停止轮询', async () => {
  const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
  const require = createRequire(join(frontend, 'package.json'));
  const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
  const { build } = require('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'everyone-frontend-'));
  // Windows普通符号链接需要开发者模式，目录连接（junction）无需权限。
  try { symlinkSync(join(frontend, 'node_modules'), join(dir, 'node_modules'), 'dir'); }
  catch { symlinkSync(join(frontend, 'node_modules'), join(dir, 'node_modules'), 'junction'); }
  const bundle = await build({ entryPoints: [join(frontend, 'src/App.tsx')], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
  const filename = join(dir, 'App.mjs'); writeFileSync(filename, bundle.outputFiles[0].text);
  const window = new Window({ url: 'http://127.0.0.1:8788/' });
  const originals = new Map();
  const replace = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'localStorage']) replace(key, key === 'window' ? window : window[key]);
  replace('IS_REACT_ACT_ENVIRONMENT', true);
  let scroll = 0;
  Object.defineProperty(window, 'scrollY', { get: () => scroll });
  window.scrollTo = (_x, y) => { scroll = y; window.dispatchEvent(new window.Event('scroll')); };
  const timers = new Map(), noticeTimers = new Map(); let timerId = 0;
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  replace('setInterval', (callback, ms, ...args) => {
    if (ms !== 10000 && ms !== 20000) return originalInterval(callback, ms, ...args);
    (ms === 10000 ? timers : noticeTimers).set(++timerId, () => callback(...args)); return timerId;
  });
  replace('clearInterval', id => { if (!timers.delete(id) && !noticeTimers.delete(id)) originalClear(id); });
  const config = { schedules: Object.fromEntries(['index', 'douyin', 'xhs', 'bili'].map(provider => [provider, { enabled: false, times: ['10:00'], request_limit: 10 }])), index: { discovery: null, tasks: [] } };
  const accounts = [];
  const requests = [], runs = [], bloggers = [];
  const notices = { auth: [], issues: [], bloggers: [] };
  const emptyPlatform = () => ({ configured: false, paused: false, error: null, latest: null, deltaToday: null, delta7d: null, deltaLikes7: null, deltaViews7: null, series: [] });
  const monitorData = { platforms: { douyin: emptyPlatform(), xhs: emptyPlatform(), bili: emptyPlatform() }, total: { fans: 0, deltaToday: null, delta7d: null, platforms: 0 } };
  replace('fetch', async (input, init = {}) => {
    const url = new URL(String(input), window.location.href), account = Number(init.headers?.['x-everyone-content-account'] ?? 0), method = init.method ?? 'GET';
    requests.push({ url, account, method });
    let data;
    if (url.pathname === '/api/accounts' && method === 'POST') {
      data = { id: accounts.length + 1, name: JSON.parse(init.body).name, profile_url: '', platform: 'douyin', status: 'active', strategy_sha: null, config };
      accounts.push(data);
    }
    else if (url.pathname === '/api/accounts') data = accounts;
    else if (url.pathname === '/api/collection') data = { tasks: [], runs, budgets: [], credentials: {}, queue: { total: 0, due: 0 }, discovery: null };
    else if (url.pathname === '/api/collection/progress') data = { running: false, progress: null };
    else if (url.pathname === '/api/bloggers') data = bloggers;
    else if (/^\/api\/bloggers\/\d+$/.test(url.pathname)) data = { id: 1, kind: 'blogger', userId: 'u1', name: '甲', status: 'ready', profile: {}, works: [], trend: null };
    else if (url.pathname === '/api/notices') data = structuredClone(notices);
    else if (url.pathname === '/api/run/collect' && method === 'POST') data = { started: true, run_id: 1 };
    else if (url.pathname === '/api/monitor') data = monitorData;
    else if (/^\/api\/auth\/[\w-]+$/.test(url.pathname)) data = { provider: url.pathname.split('/').at(-1), label: '平台', status: 'missing', configured: false, message: '尚未连接。' };
    else if (url.pathname === '/api/sources') data = { keywords: [] };
    else if (url.pathname === '/api/collection/config') {
      data = accounts.find(value => value.id === account);
      if (method === 'PUT') data.config = { ...data.config, index: JSON.parse(init.body) };
    }
    else if (url.pathname === '/api/strategy') data = { sha: 'a'.repeat(40), base_sha: 'a'.repeat(40), draft: { 'account-profile.md': '初始画像' }, published: {}, history: [] };
    else if (url.pathname === '/api/keywords' && method === 'POST') data = { ok: true };
    else throw new Error(`Unexpected API: ${method} ${url.pathname}`);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  });
  const { createElement, StrictMode, act } = require('react');
  const { createRoot } = require('react-dom/client');
  const { default: App } = await import(pathToFileURL(filename).href);
  const host = window.document.createElement('div'); window.document.body.append(host);
  const root = createRoot(host);
  const visible = selector => [...window.document.querySelectorAll(selector)].filter(element => !element.closest('[hidden]'));
  const button = label => {
    const element = visible('button').find(value => value.textContent.trim() === label || value.firstElementChild?.textContent === label);
    assert.ok(element, `Missing button: ${label}`); return element;
  };
  const click = async label => act(async () => { button(label).click(); });
  const navigate = async label => act(async () => {
    const element = [...window.document.querySelectorAll('nav[aria-label="工作台导航"] button')].find(value => value.textContent === label);
    assert.ok(element); element.click();
  });
  const edit = async (element, value) => act(async () => {
    const prototype = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  const field = label => visible(`[aria-label="${label}"]`)[0];
  const count = path => requests.filter(request => request.url.pathname === path && request.method === 'GET').length;
  const switchAccount = async id => {
    await navigate('帐号');
    await act(async () => { window.document.querySelector(`button[aria-label="切换到 账号${id}"]`).click(); });
  };
  try {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(App))); });
    assert.equal(count('/api/monitor'), 0);
    assert.equal(window.localStorage.getItem('everyone-content-selected-account'), null);
    // 无账号时中央引导面板创建首账号，创建后自动进入帐号页
    await edit(field('新账号名称'), '账号1');
    await click('新建账号');
    assert.equal(window.localStorage.getItem('everyone-content-selected-account'), '1');
    await edit(field('新账号名称'), '账号2');
    await click('新建账号');
    await switchAccount(1);
    await navigate('指数');
    assert.equal(count('/api/collection'), 1); assert.equal(count('/api/monitor'), 0);
    assert.equal(timers.size, 1);
    await navigate('数据'); assert.equal(timers.size, 0);
    const monitorLoads = count('/api/monitor'); assert.equal(monitorLoads, 1);
    window.scrollTo(0, 420);
    await navigate('采集'); await click('定时');
    assert.match(window.document.body.textContent, /连接平台/);
    const limit = visible('input[type="number"]')[0]; await edit(limit, '3');
    const configLoads = count('/api/collection/config');
    await navigate('帐号'); await click('账号画像'); await edit(field('账号画像正文'), '尚未保存的画像');
    await navigate('采集'); await click('定时'); assert.equal(visible('input[type="number"]')[0].value, '3');
    assert.equal(count('/api/collection/config'), configLoads);
    await navigate('数据'); assert.equal(count('/api/monitor'), monitorLoads); assert.equal(scroll, 420);
    await navigate('采集'); await click('采集词'); await edit(field('新增关键词'), '新关键词'); await click('添加');
    assert.equal(requests.filter(request => request.method === 'POST' && request.url.pathname === '/api/keywords').length, 1);
    await edit(field('新增排除关键词'), '广告'); await act(async () => { window.document.querySelector('button[aria-label="添加排除关键词"]').click(); }); // 排除词增删即时保存并重新筛选
    assert.deepEqual(accounts[0].config.index.discovery.excludeKeywords, ['广告']);
    assert.equal(count('/api/monitor'), monitorLoads); // Hidden views do not fetch until needed.
    await navigate('指数'); assert.equal(timers.size, 1);
    const collectionLoads = count('/api/collection');
    runs.push({ id: 1, provider: 'index', operation: 'videos', target: '1', status: 'ok', observed_at: '2026-11-09 04:00:00', version: null, error: null });
    await act(async () => { [...timers.values()][0](); });
    assert.equal(count('/api/collection'), collectionLoads + 1); // 轮询发现新记录后重新加载
    await navigate('数据'); assert.equal(count('/api/monitor'), monitorLoads + 1); // 采集记录变化使监控重新加载
    await switchAccount(2); // 帐号页切换后，监控只加载新账号自己的快照
    await navigate('数据');
    assert.equal(requests.filter(request => request.url.pathname === '/api/monitor').at(-1).account, 2);
    await switchAccount(1);
    assert.equal(timers.size, 0);
    // 提醒：登录失效出横幅并点亮采集红点，横幅直达「采集 → 连接」，状态恢复后自愈
    assert.equal(noticeTimers.size, 1);
    const navTab = label => [...window.document.querySelectorAll('nav[aria-label="工作台导航"] button')].find(value => value.textContent === label);
    notices.auth = [{ provider: 'index' }], notices.issues = [{ kind: 'run_failed' }];
    await act(async () => { for (const fire of [...noticeTimers.values()]) fire(); });
    assert.match(window.document.body.textContent, /抖音指数登录已失效，相关采集已暂停。/);
    assert.ok(navTab('采集').querySelector('.bg-danger'));
    await act(async () => { [...window.document.querySelectorAll('button')].find(value => value.textContent === '去连接').click(); });
    assert.match(window.document.body.textContent, /连接平台/);
    notices.auth = [], notices.issues = [];
    await act(async () => { for (const fire of [...noticeTimers.values()]) fire(); });
    assert.ok(!/登录已失效/.test(window.document.body.textContent));
    assert.ok(!navTab('采集').querySelector('.bg-danger'));
    // 博主红点：首见静默记水位，新作品计未读，点开该博主即已读并落水位
    bloggers.push({ id: 1, kind: 'blogger', userId: 'u1', name: '甲', status: 'ready' });
    notices.bloggers = [{ id: 1, name: '甲', latest: '2026-11-14 07:00:00', items: [] }];
    await act(async () => { for (const fire of [...noticeTimers.values()]) fire(); });
    assert.equal(navTab('博主').textContent, '博主');
    notices.bloggers = [{ id: 1, name: '甲', latest: '2026-11-14 08:00:00', items: [{ title: '新视频', url: 'https://www.douyin.com/video/1', addedAt: '2026-11-14 08:00:00' }] }];
    await act(async () => { for (const fire of [...noticeTimers.values()]) fire(); });
    assert.ok(navTab('博主1'), '博主红点未显示未读数');
    await navigate('博主1'); // 进入博主页默认选中甲，即视为已读
    assert.equal(window.localStorage.getItem('everyone-content-blogger-seen-1'), JSON.stringify({ 1: '2026-11-14 08:00:00' }));
    assert.equal(navTab('博主').textContent, '博主');
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    await window.happyDOM.close(); rmSync(dir, { recursive: true, force: true });
  }
});
