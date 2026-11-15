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
  const timers = new Map(), noticeTimers = new Map(), progressTimers = new Map(); let timerId = 0;
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  replace('setInterval', (callback, ms, ...args) => {
    const collection = ms === 10000 ? timers : ms === 20000 ? noticeTimers : ms === 1500 ? progressTimers : null;
    if (!collection) return originalInterval(callback, ms, ...args);
    collection.set(++timerId, () => callback(...args)); return timerId;
  });
  replace('clearInterval', id => { if (!timers.delete(id) && !noticeTimers.delete(id) && !progressTimers.delete(id)) originalClear(id); });
  const config = { schedules: Object.fromEntries(['index', 'douyin', 'xhs', 'bili'].map(provider => [provider, { enabled: false, times: ['10:00'], request_limit: 10 }])), index: { discovery: null, tasks: [] } };
  const accounts = [];
  const requests = [], runs = [], bloggers = [], sources = [];
  let manualOutcome = null;
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
    else if (url.pathname === '/api/collection') {
      const keywords = sources.filter(s => s.account === account).map(s => s.name);
      const excluded = accounts.find(a => a.id === account)?.config.index.discovery?.excludeKeywords ?? [];
      const topics = keywords.map((name, i) => ({ id: String(i), name: `${name}话题`, index: 100, window: {} }));
      if (!excluded.includes('广告')) topics.push({ id: 'ad', name: '广告话题', index: 1, window: {} });
      data = { tasks: [], runs, budgets: [], credentials: {}, queue: { total: 0, due: 0 },
        discovery: { keywords, topics, videos: [], authors: [], ready: true, pending: { topicSearch: [], videos: [] } } };
    }
    else if (url.pathname === '/api/collection/progress') data = { run_id: 1, running: false, progress: null, status: manualOutcome };
    else if (url.pathname === '/api/bloggers') data = bloggers;
    else if (/^\/api\/bloggers\/\d+$/.test(url.pathname)) data = { id: 1, kind: 'blogger', userId: 'u1', name: '甲', status: 'ready', profile: {}, works: [], trend: null };
    else if (url.pathname === '/api/notices') data = structuredClone(notices);
    else if (url.pathname === '/api/run/collect' && method === 'POST') data = { started: true, run_id: 1 };
    else if (url.pathname === '/api/monitor') data = monitorData;
    else if (/^\/api\/auth\/[\w-]+$/.test(url.pathname)) data = { provider: url.pathname.split('/').at(-1), label: '平台', status: 'missing', configured: false, message: '尚未连接。' };
    else if (url.pathname === '/api/sources') data = { keywords: sources.filter(s => s.account === account) };
    else if (/^\/api\/sources\/\d+$/.test(url.pathname) && method === 'DELETE') {
      const index = sources.findIndex(s => s.account === account && s.id === Number(url.pathname.split('/').at(-1)));
      assert.ok(index >= 0);
      sources.splice(index, 1); data = { ok: true };
    }
    else if (url.pathname === '/api/collection/config') {
      data = accounts.find(value => value.id === account);
      if (method === 'PUT') data.config = { ...data.config, index: JSON.parse(init.body) };
    }
    else if (url.pathname === '/api/strategy') data = { sha: 'a'.repeat(40), base_sha: 'a'.repeat(40), draft: { 'account-profile.md': '初始画像' }, published: {}, history: [] };
    else if (url.pathname === '/api/keywords' && method === 'POST') {
      sources.push({ id: sources.length + 1, name: JSON.parse(init.body).keyword, account });
      data = { ok: true };
    }
    else throw new Error(`Unexpected API: ${method} ${url.pathname}`);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  });
  const { createElement, StrictMode, act } = require('react');
  const { createRoot } = require('react-dom/client');
  const { default: App } = await import(pathToFileURL(filename).href);
  const host = window.document.createElement('div'); window.document.body.append(host);
  let root = createRoot(host);
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
  const shows = value => visible('span,p').some(el => el.textContent.trim() === value);
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
    assert.ok(shows('新关键词话题'));
    assert.ok(!shows('广告话题'));
    const collectionLoads = count('/api/collection');
    runs.push({ id: 1, provider: 'index', operation: 'videos', target: '1', status: 'ok', observed_at: '2026-11-09 04:00:00', version: null, error: null });
    await act(async () => { [...timers.values()][0](); });
    assert.equal(count('/api/collection'), collectionLoads + 1); // 轮询发现新记录后重新加载
    await navigate('数据'); assert.equal(count('/api/monitor'), monitorLoads + 1); // 采集记录变化使监控重新加载
    await navigate('采集'); await click('采集词');
    await act(async () => { field('移除关键词“新关键词”').click(); });
    assert.equal(field('移除关键词“新关键词”'), undefined);
    await act(async () => { field('从排除关键词移除“广告”').click(); });
    await navigate('指数');
    assert.ok(!shows('新关键词话题'));
    assert.ok(shows('广告话题'));
    await switchAccount(2); // 帐号页切换后，监控只加载新账号自己的快照
    await navigate('数据');
    assert.equal(requests.filter(request => request.url.pathname === '/api/monitor').at(-1).account, 2);
    await switchAccount(1);
    assert.equal(timers.size, 0);
    // 异常只在铃铛里展开，可跳到处理入口，恢复后红点和条目同步消失。
    assert.equal(noticeTimers.size, 1);
    const navTab = label => [...window.document.querySelectorAll('nav[aria-label="工作台导航"] button')].find(value => value.textContent === label);
    const reminder = () => field('提醒'), panel = () => field('异常提醒');
    notices.auth = [{ provider: 'index' }], notices.issues = [{ kind: 'run_partial' }];
    await act(async () => { for (const fire of [...noticeTimers.values()]) fire(); });
    assert.ok(reminder().querySelector('.bg-danger'));
    assert.ok(!navTab('采集').querySelector('.bg-danger'));
    assert.equal(panel(), undefined);
    assert.ok(!shows('抖音指数登录已失效'));
    await act(async () => { reminder().click(); });
    assert.match(panel().textContent, /抖音指数登录已失效.*最近一轮部分采集失败/);
    await act(async () => { window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); });
    assert.equal(panel(), undefined);
    await act(async () => { reminder().click(); });
    await click('去连接');
    assert.match(window.document.body.textContent, /连接平台/);
    assert.equal(panel(), undefined);
    await act(async () => { reminder().click(); });
    await click('查看日志');
    assert.ok(visible('h2').some(el => el.textContent === '采集日志'));
    await act(async () => { reminder().click(); });
    notices.auth = [], notices.issues = [];
    await act(async () => { for (const fire of [...noticeTimers.values()]) fire(); });
    assert.equal(panel().textContent, '提醒暂无异常。');
    assert.ok(!reminder().querySelector('.bg-danger'));
    await act(async () => { window.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); });
    assert.equal(panel(), undefined);
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
    await navigate('采集'); await click('总览');
    runs.unshift({ id: 2, provider: 'douyin', operation: 'account_snapshot', target: 'account_snapshot', status: 'failed',
      observed_at: '2026-11-15 04:57:17', version: null, error: 'login_required' });
    manualOutcome = 'partial';
    await click('手动采集');
    await act(async () => { for (const fire of progressTimers.values()) await fire(); });
    assert.equal(requests.filter(r => r.url.pathname === '/api/collection/progress').at(-1).url.searchParams.get('run_id'), '1');
    assert.ok(visible('span').some(el => el.textContent.includes('本轮部分采集失败')));
    await click('日志');
    assert.ok(visible('p').some(el => el.textContent.includes('平台提示未登录')));
    assert.ok(visible('span').some(el => el.textContent === '账号快照'));

    const reopen = async saved => {
      await act(async () => { root.unmount(); });
      const key = 'everyone-content-selected-account';
      if (saved === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(saved));
      root = createRoot(host);
      await act(async () => { root.render(createElement(StrictMode, null, createElement(App))); });
    };
    await reopen(null);
    assert.equal(field('新账号名称'), undefined);
    assert.equal(requests.filter(r => r.url.pathname === '/api/monitor').at(-1).account, 1);
    await reopen(2);
    assert.equal(requests.filter(r => r.url.pathname === '/api/monitor').at(-1).account, 2);
    accounts[0].status = 'archived';
    await reopen(999);
    assert.equal(window.localStorage.getItem('everyone-content-selected-account'), '2');
    assert.equal(requests.filter(r => r.url.pathname === '/api/monitor').at(-1).account, 2);
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    await window.happyDOM.close(); rmSync(dir, { recursive: true, force: true });
  }
});
