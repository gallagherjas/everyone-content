import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { createAccount } from '../lib/accounts.ts';
import { defaultSchedules, latestScheduleSlot, validateSchedules } from '../lib/collection-schedule.ts';
import { runScheduledCollection, type CollectionLaunch } from '../lib/collection-scheduler.ts';
const now = Date.UTC(2026, 10, 9, 1, 30);
function setup() {
  const db = new DatabaseSync(':memory:'); migrate(db, ':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'everyone-schedule-')), file = join(dir, 'auth.json');
  writeFileSync(file, JSON.stringify({ cookie: 'synthetic-session' }), { mode: 0o600 });
  createAccount(db, '调度测试账号');
  const calls: { id: number; options: CollectionLaunch }[] = [];
  const start = (id: number, options: CollectionLaunch) => {
    calls.push({ id, options });
    return { run_id: Number(db.prepare("INSERT INTO task_runs(account_id,task,status) VALUES(?,'collect','done')").run(id).lastInsertRowid) };
  };
  const save = (id: number, schedules: Partial<ReturnType<typeof defaultSchedules>>) => {
    const row = db.prepare('SELECT config FROM accounts WHERE id=?').get(id)!;
    db.prepare('UPDATE accounts SET config=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.config as string), schedules }), id);
  };
  const authorize = (id: number) => db.prepare('INSERT INTO collection_credentials VALUES(?,?,?,?)').run(id, 'index', file, `account:${id}`);
  const close = () => { db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { db, calls, start, save, authorize, close };
}
test('采集定时默认关闭，预填北京时间午夜并校验时间与请求上限', () => {
  const schedules = defaultSchedules();
  assert.deepEqual(Object.keys(schedules), ['topic_rank', 'video_rank', 'author', 'index', 'douyin', 'xhs', 'bili']);
  assert.ok(Object.values(schedules).every(schedule => !schedule.enabled));
  assert.ok(Object.values(schedules).every(schedule => schedule.times.length === 1 && schedule.times[0] === '00:00'));
  assert.equal(latestScheduleSlot(schedules.index, now), null);
  const midnight = Date.UTC(2026, 10, 8, 16);
  assert.equal(latestScheduleSlot({ ...schedules.index, enabled: true }, midnight), '2026-11-08 16:00:00');
  schedules.index = { enabled: true, times: ['10:30', '09:30', '09:30'], request_limit: 2 };
  assert.deepEqual(validateSchedules(schedules).index.times, ['09:30', '10:30']);
  assert.equal(latestScheduleSlot(schedules.index, now - 1), null);
  assert.equal(latestScheduleSlot(schedules.index, now), '2026-11-09 01:30:00');
  assert.throws(() => validateSchedules({ index: { ...schedules.index, times: ['24:00'] } }));
  assert.throws(() => validateSchedules({ index: { ...schedules.index, request_limit: 11 } }));
  assert.throws(() => validateSchedules({ ...schedules, unsupported: schedules.index }));
});
test('时间点不重复，电脑唤醒只补当天最近一次', () => {
  const { db, calls, start, save, authorize, close } = setup();
  try {
    authorize(1); save(1, { index: { enabled: true, times: ['09:00', '09:30', '10:30'], request_limit: 3 } });
    assert.equal(runScheduledCollection(db, start, now)?.slot, '2026-11-09 01:30:00');
    assert.equal(runScheduledCollection(db, start, now), null);
    assert.equal(runScheduledCollection(db, start, now + 3600000)?.slot, '2026-11-09 02:30:00');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].options, { scheduled: true, only: 'index', limit: 3 });
  } finally { close(); }
});
test('话题榜、视频榜和博主各自按时触发，同一抖音指数授权支持三个范围', () => {
  const { db, calls, start, save, authorize, close } = setup();
  try {
    save(1, {
      topic_rank: { enabled: true, times: ['09:30'], request_limit: 2 },
      video_rank: { enabled: true, times: ['10:00'], request_limit: 6 },
      author: { enabled: true, times: ['10:00'], request_limit: 4 },
    });
    assert.equal(runScheduledCollection(db, start, now), null);
    authorize(1);
    assert.equal(runScheduledCollection(db, start, now)?.scope, 'topic_rank');
    assert.equal(runScheduledCollection(db, start, now), null);
    const secondSlot = now + 30 * 60_000;
    assert.equal(runScheduledCollection(db, start, secondSlot)?.scope, 'video_rank');
    assert.equal(runScheduledCollection(db, start, secondSlot)?.scope, 'author');
    assert.equal(runScheduledCollection(db, start, secondSlot), null);
    assert.deepEqual(calls.map(call => call.options), [
      { scheduled: true, only: 'topic_rank', limit: 2 },
      { scheduled: true, only: 'video_rank', limit: 6 },
      { scheduled: true, only: 'author', limit: 4 },
    ]);
  } finally { close(); }
});
test('采集忙碌不消耗时间点，恢复后仍可触发', () => {
  const { db, start, save, authorize, close } = setup();
  try {
    authorize(1); save(1, { index: { enabled: true, times: ['09:00'], request_limit: 1 } });
    assert.throws(() => runScheduledCollection(db, () => { throw new Error('busy'); }, now), /busy/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_schedule_runs').get()!.n, 0);
    assert.equal(runScheduledCollection(db, start, now)?.provider, 'index');
  } finally { close(); }
});
test('缺少授权、关闭开关和归档账号不运行；各账号独立', () => {
  const { db, calls, start, save, authorize, close } = setup();
  try {
    const second = createAccount(db, '独立账号');
    const enabled = { index: { enabled: true, times: ['09:00'], request_limit: 1 } };
    save(1, enabled); save(second.id, enabled);
    assert.equal(runScheduledCollection(db, start, now), null);
    authorize(second.id);
    db.prepare("INSERT INTO collection_provider_state(provider,scope,paused,error) VALUES('index',?,1,'login_required')").run(`account:${second.id}`);
    assert.equal(runScheduledCollection(db, start, now), null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_schedule_runs').get()!.n, 0);
    db.prepare("UPDATE collection_provider_state SET paused=0,error=NULL WHERE scope=?").run(`account:${second.id}`);
    assert.equal(runScheduledCollection(db, start, now)?.accountId, second.id);
    authorize(1); save(1, defaultSchedules());
    assert.equal(runScheduledCollection(db, start, now), null);
    save(1, enabled); db.prepare("UPDATE accounts SET status='archived' WHERE id=1").run();
    assert.equal(runScheduledCollection(db, start, now), null);
    assert.equal(calls.length, 1);
  } finally { close(); }
});
