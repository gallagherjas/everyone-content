import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'everyone-writing-'));
process.env.EVERYONE_CONTENT_DATA_DIR = join(root, 'runtime');
test.after(() => rmSync(root, { recursive: true, force: true }));
const { writingCorpus, saveWriting } = await import('../lib/writing.ts');

test('写作语料按账号隔离读写，目录与文件保持私密', () => {
  assert.deepEqual(writingCorpus(1), { preferences: '', originals: '' });
  saveWriting(1, { preferences: '偏好甲', originals: '## 稿一\n正文' });
  assert.equal(writingCorpus(1).preferences, '偏好甲');
  assert.equal(writingCorpus(2).preferences, ''); // 账号隔离
  // Windows不支持POSIX权限位，与登录会话的权限断言保持一致跳过。
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(root, 'runtime', 'writing', '1')).mode & 0o777, 0o700);
    assert.equal(statSync(join(root, 'runtime', 'writing', '1', 'originals.md')).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, 'runtime', 'writing', '1', 'preferences.md')).mode & 0o777, 0o600);
  }
});
test('拒绝非文本输入与超长语料', () => {
  assert.throws(() => saveWriting(1, { preferences: null as any, originals: '' }), /invalid_writing_corpus/);
  assert.throws(() => saveWriting(1, { preferences: 'x'.repeat(100_001), originals: '' }), /too_large/);
  assert.equal(writingCorpus(1).preferences, '偏好甲'); // 失败写入不落盘
});
