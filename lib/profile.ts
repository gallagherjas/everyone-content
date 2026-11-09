export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_SECTIONS = [
  '账号定位', '身份与人设', '目标人群', '目标与转化', '内容策略', '内容形式与制作条件', '品牌与边界',
] as const;

export interface ProfileCompletion {
  initialized: boolean;
  missing_sections: string[];
}

// 只检查章节是否填写，不评价定位、文风或内容质量。
export function profileCompletion(markdown: string): ProfileCompletion {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (heading) {
      current = [];
      sections.set(heading[1], current);
    } else current?.push(line);
  }
  const missing_sections = PROFILE_SECTIONS.filter(name => {
    const lines = (sections.get(name) ?? [])
      .map(line => line.trim().replace(/^(?:>\s*)+/, '').replace(/^[-*+]\s+/, '').trim())
      .filter(line => line && !/^(填写|请填写|填写提示)[：:]/.test(line) && !/^[-_*#`\s]+$/.test(line))
      .filter(line => !/^(待填写|待补充|未填写|未确定|暂未确定|待定|TODO|TBD|[.。…]+)[。.!！?？\s]*$/i.test(line));
    if (!lines.length) return true;
    return (name === '账号定位' || name === '目标人群')
      && lines.every(line => /^(无|暂无|不适用|不涉及|暂不涉及)(?:[：:，,。\s].*)?$/.test(line));
  });
  return { initialized: missing_sections.length === 0, missing_sections };
}
