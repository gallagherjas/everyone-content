import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = base ? `${base}/${name}` : name;
    return statSync(join(dir, name)).isDirectory() ? walk(join(dir, name), rel) : [rel];
  });
}

// .agents/skills是skills的同步真实副本（非符号链接），保证Windows检出即可用；正文只改skills/。
test('.agents/skills与skills逐字节一致', () => {
  const skills = readdirSync(join(root, 'skills')).sort();
  assert.deepEqual(readdirSync(join(root, '.agents', 'skills')).sort(), skills);
  for (const skill of skills) {
    const expected = walk(join(root, 'skills', skill));
    assert.deepEqual(walk(join(root, '.agents', 'skills', skill)), expected, skill);
    for (const rel of expected)
      assert.equal(
        readFileSync(join(root, '.agents', 'skills', skill, rel), 'utf8'),
        readFileSync(join(root, 'skills', skill, rel), 'utf8'),
        `${skill}/${rel}`,
      );
  }
});
