import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionDay, collectionDayStart, formatTime, nextCollectionDay, parseCollectionDay, parseTime } from '../lib/time.ts';

test('数据库时间、带时区时间和毫秒时间戳统一显示北京时间，跨日也正确', () => {
  const expected = '2026-11-10 00:15:30';
  for (const value of ['2026-11-09 16:15:30', '2026-11-09T16:15:30Z', '2026-11-10T00:15:30+08:00', Date.UTC(2026, 10, 9, 16, 15, 30)])
    assert.equal(formatTime(value), expected);
  assert.equal(formatTime('2026-11-09 03:38:48'), '2026-11-09 11:38:48');
  assert.equal(parseTime('2026-11-09 03:38:48')?.getTime(), Date.parse('2026-11-09T03:38:48Z'));
  for (const value of [null, undefined, '', 'invalid']) assert.equal(formatTime(value), '—');
});

test('北京时间显示和表单输入不依赖设备所在时区', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
      process.env.TZ = zone;
      assert.equal(formatTime('2026-11-09 03:38:48'), '2026-11-09 11:38:48');
      assert.equal(new Date('2026-11-09T11:38+08:00').toISOString(), '2026-11-09T03:38:00.000Z');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('采集日、当日开始和次日开始都在北京时间午夜换日', () => {
  const midnight = Date.UTC(2026, 10, 15, 16);
  assert.equal(collectionDay(midnight-1), '2026-11-15');
  assert.equal(collectionDay(midnight), '2026-11-16');
  assert.equal(collectionDayStart(midnight+1), midnight);
  assert.equal(parseCollectionDay('2026-11-16'), midnight);
  assert.equal(nextCollectionDay(midnight-1), midnight);
});
