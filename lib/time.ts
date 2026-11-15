type TimeValue = string | number | Date | null | undefined;

const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function parseTime(value: TimeValue): Date | null {
  if (value === null || value === undefined || value === '') return null;
  let input = typeof value === 'string' ? value.trim().replace(' ', 'T') : value;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(input)) input += 'Z';
  const date = input instanceof Date ? input : new Date(input);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatTime(value: TimeValue): string {
  const date = parseTime(value);
  return date ? formatter.format(date) : '—';
}

// 采集日使用北京时间自然日，存储时间戳仍为 UTC。
export const COLLECTION_DAY_MS = 86400000;
export const BEIJING_OFFSET_MS = 8 * 3600000;
export const collectionDay = (ms: number): string => new Date(ms + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
export const collectionDayStart = (ms: number): number =>
  Math.floor((ms + BEIJING_OFFSET_MS) / COLLECTION_DAY_MS) * COLLECTION_DAY_MS - BEIJING_OFFSET_MS;
export const parseCollectionDay = (day: string): number => Date.parse(day) - BEIJING_OFFSET_MS;
export const nextCollectionDay = (ms: number): number => collectionDayStart(ms) + COLLECTION_DAY_MS;
