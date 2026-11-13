import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './strategies.ts';

export interface WritingCorpus { preferences: string; originals: string }
// 写作语料按账号存于 runtime/writing/<account_id>/：目录0700、文件0600，不入库、不进Git。
const dirOf = (accountId: number) => join(DATA, 'writing', String(accountId));

export function writingCorpus(accountId: number): WritingCorpus {
  const read = (name: string) => {
    const file = join(dirOf(accountId), name);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  };
  return { preferences: read('preferences.md'), originals: read('originals.md') };
}

export function saveWriting(accountId: number, corpus: WritingCorpus): WritingCorpus {
  if (typeof corpus.preferences !== 'string' || typeof corpus.originals !== 'string')
    throw new Error('invalid_writing_corpus');
  if (corpus.preferences.length > 100_000 || corpus.originals.length > 200_000)
    throw new Error('writing_corpus_too_large');
  const dir = dirOf(accountId);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  for (const [name, content] of [['preferences.md', corpus.preferences], ['originals.md', corpus.originals]] as const) {
    writeFileSync(join(dir, name), content, { mode: 0o600 });
    chmodSync(join(dir, name), 0o600);
  }
  return writingCorpus(accountId);
}
