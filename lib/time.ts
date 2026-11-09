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
