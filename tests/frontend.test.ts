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
  const timers = new Map(); let timerId = 0;
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  replace('setInterval', (callback, ms, ...args) => {
    if (ms !== 10000) return originalInterval(callback, ms, ...args);
    timers.set(++timerId, () => callback(...args)); return timerId;
  });
  replace('clearInterval', id => { if (!timers.delete(id)) originalClear(id); });
  const config = { schedules: Object.fromEntries(['index'].map(provider => [provider, { enabled: false, times: ['10:00'], request_limit: 10 }])), index: { discovery: null, tasks: [] } };
  const accounts = [];
  const requests = [], runs = [];
  replace('fetch', async (input, init = {}) => {
    const url = new URL(String(input), window.location.href), account = Number(init.headers?.['x-everyone-content-account'] ?? 0), method = init.method ?? 'GET';
    requests.push({ url, account, method });
    let data;
    if (url.pathname === '/api/accounts' && method === 'POST') {
      data = { id: accounts.length + 1, name: JSON.parse(init.body).name, profile_url: '', platform: 'douyin', status: 'active', strategy_sha: null, config };
      accounts.push(data);
    }
    else if (url.pathname === '/api/accounts') data = accounts;
    else if (url.pathname === '/api/collection') data = { tasks: [], runs, budgets: [], indexCredential: false, discovery: null };
    else if (url.pathname === '/api/contents') data = Array.from({ length: 25 }, (_, n) => ({ id: account * 1000 + n + 1, published_url: `https://www.douyin.com/video/${account}-${n + 1}`, published_at: '2026-11-09 04:00:00', metrics: null }));
    else if (url.pathname === '/api/sources') data = { keywords: [] };
    else if (url.pathname === '/api/index-auth') data = { status: 'missing', configured: false, message: '尚未连接抖音指数。' };
    else if (url.pathname === '/api/collection/config') data = accounts.find(value => value.id === account);
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
  const switchAccount = async id => act(async () => {
    const select = window.document.querySelector('#account-switch'); select.value = String(id);
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  try {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(App))); });
    assert.equal(count('/api/collection'), 0);
    assert.equal(window.localStorage.getItem('everyone-content-selected-account'), null);
    assert.equal(button('创建账号').disabled, true);
    await edit(field('新账号名称'), '账号1');
    await click('创建账号');
    assert.equal(window.localStorage.getItem('everyone-content-selected-account'), '1');
    await click('＋ 新账号');
    await edit(field('新账号名称'), '账号2');
    await click('创建账号');
    await switchAccount(1);
    await navigate('采集');
    assert.equal(count('/api/collection'), 1); assert.equal(count('/api/contents'), 0);
    assert.equal(timers.size, 1);
    await navigate('已发布'); assert.equal(timers.size, 0);
    const contents = count('/api/contents'); assert.equal(contents, 1);
    await click('下一页 ›'); // 25条、每页20条，翻到第2页
    assert.match(window.document.body.textContent, /作品 #1022/);
    window.scrollTo(0, 420);
    await navigate('设置'); await click('采集设置');
    const limit = visible('input[type="number"]')[0]; await edit(limit, '3');
    const configLoads = count('/api/collection/config');
    await click('账号画像'); await edit(field('账号画像正文'), '尚未保存的画像');
    await click('采集设置'); assert.equal(visible('input[type="number"]')[0].value, '3');
    assert.equal(count('/api/collection/config'), configLoads);
    await navigate('已发布'); assert.equal(count('/api/contents'), contents); assert.equal(scroll, 420);
    assert.match(window.document.body.textContent, /作品 #1022/); // 分页保留
    await edit(field('已发布作品链接'), 'https://www.douyin.com/video/123');
    window.scrollTo(0, 260);
    await navigate('设置'); await click('账号画像'); assert.equal(field('账号画像正文').value, '尚未保存的画像');
    await click('关键词'); await edit(field('新增关键词'), '新关键词'); await click('添加');
    assert.equal(requests.filter(request => request.method === 'POST' && request.url.pathname === '/api/keywords').length, 1);
    assert.equal(count('/api/contents'), contents); // Hidden views do not fetch until needed.
    await navigate('已发布'); assert.equal(count('/api/contents'), contents + 1); // POST后缓存失效，重新加载
    assert.equal(field('已发布作品链接').value, 'https://www.douyin.com/video/123'); assert.equal(scroll, 260);
    await switchAccount(2);
    assert.equal(field('已发布作品链接').value, '');
    assert.match(window.document.body.textContent, /作品 #2001/); // 新账号从第1页展示自己的登记
    assert.equal(requests.filter(request => request.url.pathname === '/api/contents').at(-1).account, 2);
    await switchAccount(1); assert.equal(field('已发布作品链接').value, '');
    assert.equal(timers.size, 0);
    await navigate('采集'); assert.equal(timers.size, 1);
    const collectionLoads = count('/api/collection');
    await navigate('已发布'); await navigate('采集'); assert.equal(count('/api/collection'), collectionLoads);
    runs.push({ id: 1, provider: 'index', operation: 'videos', target: '1', status: 'ok', observed_at: '2026-11-09 04:00:00', version: null, error: null });
    await act(async () => { [...timers.values()][0](); });
    assert.equal(count('/api/collection'), collectionLoads + 1); // 轮询发现新记录后重新加载
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    await window.happyDOM.close(); rmSync(dir, { recursive: true, force: true });
  }
});
