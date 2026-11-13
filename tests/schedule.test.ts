import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../db/migrate.ts';
import { createAccount } from '../lib/accounts.ts';
import { defaultSchedules, latestScheduleSlot, validateSchedules } from '../lib/collection-schedule.ts';
import { runScheduledCollection } from '../lib/collection-scheduler.ts';
const now = Date.UTC(2026, 10, 9, 1, 30);
function setup() {
  const db = new DatabaseSync(':memory:'); migrate(db, ':memory:');
  createAccount(db, '调度测试账号');
  const calls: { id: number; args: string[] }[] = [];
  const start = (id: number, args: string[]) => {
    calls.push({ id, args });
    return { run_id: Number(db.prepare("INSERT INTO task_runs(account_id,task,status) VALUES(?,'collect','done')").run(id).lastInsertRowid) };
  };
  const save = (id: number, schedules: ReturnType<typeof defaultSchedules>) => {
    const row = db.prepare('SELECT config FROM accounts WHERE id=?').get(id)!;
    db.prepare('UPDATE accounts SET config=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.config as string), schedules }), id);
  };
  const authorize = (id: number) => db.prepare('INSERT INTO collection_credentials VALUES(?,?,?,?)').run(id, 'index', 'test-only-auth-path', `account:${id}`);
  return { db, calls, start, save, authorize };
}
test('指数定时默认关闭，按北京时间校验时间与请求上限', () => {
  const schedules = defaultSchedules();
  assert.deepEqual(Object.keys(schedules), ['index', 'douyin', 'xhs', 'bili']);
  assert.equal(latestScheduleSlot(schedules.index, now), null);
  schedules.index = { enabled: true, times: ['10:30', '09:30', '09:30'], request_limit: 2 };
  assert.deepEqual(validateSchedules(schedules).index.times, ['09:30', '10:30']);
  assert.equal(latestScheduleSlot(schedules.index, now - 1), null);
  assert.equal(latestScheduleSlot(schedules.index, now), '2026-11-09 01:30:00');
  assert.throws(() => validateSchedules({ index: { ...schedules.index, times: ['24:00'] } }));
  assert.throws(() => validateSchedules({ index: { ...schedules.index, request_limit: 11 } }));
  assert.throws(() => validateSchedules({ ...schedules, unsupported: schedules.index }));
});
test('时间点不重复，电脑唤醒只补当天最近一次', () => {
  const { db, calls, start, save, authorize } = setup();
  try {
    authorize(1); save(1, { index: { enabled: true, times: ['09:00', '09:30', '10:30'], request_limit: 3 } });
    assert.equal(runScheduledCollection(db, start, now)?.slot, '2026-11-09 01:30:00');
    assert.equal(runScheduledCollection(db, start, now), null);
    assert.equal(runScheduledCollection(db, start, now + 3600000)?.slot, '2026-11-09 02:30:00');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args, ['--scheduled', '--only=index', '--limit=3']);
  } finally { db.close(); }
});
test('采集忙碌不消耗时间点，恢复后仍可触发', () => {
  const { db, start, save, authorize } = setup();
  try {
    authorize(1); save(1, { index: { enabled: true, times: ['09:00'], request_limit: 1 } });
    assert.throws(() => runScheduledCollection(db, () => { throw new Error('busy'); }, now), /busy/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_schedule_runs').get()!.n, 0);
    assert.equal(runScheduledCollection(db, start, now)?.provider, 'index');
  } finally { db.close(); }
});
test('缺少授权、关闭开关和归档账号不运行；各账号独立', () => {
  const { db, calls, start, save, authorize } = setup();
  try {
    const second = createAccount(db, '独立账号');
    const enabled = { index: { enabled: true, times: ['09:00'], request_limit: 1 } };
    save(1, enabled); save(second.id, enabled);
    assert.equal(runScheduledCollection(db, start, now), null);
    authorize(second.id);
    assert.equal(runScheduledCollection(db, start, now)?.accountId, second.id);
    authorize(1); save(1, defaultSchedules());
    assert.equal(runScheduledCollection(db, start, now), null);
    save(1, enabled); db.prepare("UPDATE accounts SET status='archived' WHERE id=1").run();
    assert.equal(runScheduledCollection(db, start, now), null);
    assert.equal(calls.length, 1);
  } finally { db.close(); }
});
