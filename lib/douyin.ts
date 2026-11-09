// 仅解析用户提供的明确主页身份，不请求任何外部服务。
export function authorId(value: string): string | null {
  if (/^MS4wLj[A-Za-z0-9_-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(^|\.)douyin\.com$/.test(url.hostname)) return null;
    const id = url.pathname.match(/^\/user\/(MS4wLj[A-Za-z0-9_-]+)\/?$/)?.[1] ?? url.searchParams.get('sec_uid');
    return id && /^MS4wLj[A-Za-z0-9_-]+$/.test(id) ? id : null;
  } catch { return null; }
}
