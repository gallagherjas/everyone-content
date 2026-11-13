import { useCallback, useState } from 'react';
import { useApi, fmtNum, fmtTime } from '../api';
import { Empty, Msg } from '../components/Common';
import Pager, { usePaged } from '../components/Pager';
import { useCachedLoad } from '../components/PageCache';
interface Published {
  id: number;
  published_url: string;
  published_at: string;
  metrics: string | null;
}
export default function ContentsPage({ archived }: { archived: boolean }) {
  const api = useApi();
  const [items, setItems] = useState<Published[]>([]),
    [url, setUrl] = useState(''),
    [date, setDate] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api<Published[]>('/api/contents').then(setItems), [api]);
  const page = usePaged(items);
  useCachedLoad('contents', useCallback(() => {
    load().catch((e) => setMessage({ ok: false, text: String(e) }));
  }, [load]));
  const act = async (fn: () => Promise<unknown>, text: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text });
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <section className="panel">
        <h2 className="font-display text-xl">已发布作品</h2>
        <p className="mt-2 text-sm text-muted">登记实际发布链接和时间；该作品被本账号指数采集收录时，展示来源提供的指标。</p>
        <fieldset disabled={archived || busy} className="mt-4 flex flex-wrap gap-2">
          <input
            className="field min-w-56 flex-1"
            aria-label="已发布作品链接"
            placeholder="https://www.douyin.com/video/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className="field w-56"
            type="datetime-local"
            aria-label="实际发布时间（北京时间）"
            title="实际发布时间（北京时间）"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            className="btn-primary"
            disabled={!url.trim() || !date}
            onClick={() =>
              act(async () => {
                await api('/api/contents', {
                  method: 'POST',
                  body: JSON.stringify({ published_url: url, published_at: `${date}+08:00` }),
                });
                setUrl('');
                setDate('');
              }, '发布信息已登记。')
            }
          >
            登记作品
          </button>
        </fieldset>
        {message && (
          <div className="mt-3">
            <Msg tone={message.ok ? 'ok' : 'error'}>{message.text}</Msg>
          </div>
        )}
      </section>
      {!items.length && <Empty title="尚未登记已发布作品" />}
      {page.slice.map((item) => {
        const metrics = item.metrics ? JSON.parse(item.metrics) : null;
        const total = metrics
          ? ['likes', 'comments', 'shares', 'collects'].reduce((n, key) => n + (metrics[key] || 0), 0)
          : null;
        return (
          <section className="panel" key={item.id}>
            <h3 className="font-display text-lg">作品 #{item.id}</h3>
            <a
              className="link mt-2 block break-all text-sm"
              href={item.published_url}
              target="_blank"
              rel="noreferrer"
            >
              {item.published_url}
            </a>
            <p className="mt-2 text-xs text-muted">
              发布：{fmtTime(item.published_at)} · 互动：{total === null ? '暂无指数数据' : fmtNum(total)}
            </p>
          </section>
        );
      })}
      <Pager {...page} />
    </div>
  );
}
