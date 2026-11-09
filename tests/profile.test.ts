import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROFILE_SECTIONS, profileCompletion } from '../lib/profile.ts';
import { COMPLETE_PROFILE } from './support/profile.ts';

test('空白框架及填写提示不构成初始化，只有定位和人群也不够', () => {
  const template = readFileSync(new URL('../prompts/account-profile.md', import.meta.url), 'utf8');
  assert.deepEqual(profileCompletion(template).missing_sections, [...PROFILE_SECTIONS]);
  const partial = '# 账号画像\n\n## 账号定位\n园艺科普。\n\n## 目标人群\n城市居民。\n';
  const state = profileCompletion(partial);
  assert.equal(state.initialized, false);
  assert.equal(state.missing_sections.length, 5);
});
test('全部七节实际填写才完成，注释和待填写文本不冒充答案', () => {
  assert.deepEqual(profileCompletion(COMPLETE_PROFILE), { initialized: true, missing_sections: [] });
  const pending = COMPLETE_PROFILE.replace('以实拍图文和短口播为主，使用家庭阳台拍摄。', '<!-- 稍后补充 -->\n待定');
  assert.deepEqual(profileCompletion(pending), { initialized: false, missing_sections: ['内容形式与制作条件'] });
  assert.equal(profileCompletion(COMPLETE_PROFILE.replace('分享阳台园艺知识，帮助新手把植物养活。', '不适用')).initialized, false);
});
