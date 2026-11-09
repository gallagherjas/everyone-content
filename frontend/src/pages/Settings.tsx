import { useCallback, useState } from "react";
import { useApi, fmtNum, type Account } from "../api";
import { Page } from "../components/Layout";
import StrategyEditor from "../components/StrategyEditor";
import CollectionRules from "../components/CollectionRules";
import CollectionSchedule from "../components/CollectionSchedule";
import SourceBudgets from "../components/SourceBudgets";
import IndexAuthorization from "../components/IndexAuthorization";
import { ConfirmBtn, Msg, Tag, type Tone } from "../components/Common";
import { KeepAlive, useCachedLoad } from "../components/PageCache";
import Pager, { usePaged } from "../components/Pager";

interface Source { id: number; kind: string; source_key: string; name: string; status: string; note: string; sec_uid?: string; profile_url?: string }
interface Sources { bloggers: Source[]; keywords: Source[] }
interface Author { sec_uid: string; follower_count: number }
const SECTIONS = [["account", "账号资料"], ["sources", "博主与关键词"], ["rules", "采集设置"], ["strategy", "账号画像"]];
const srcStatus = (s: string): { label: string; tone: Tone } =>
  s === "ready" ? { label: "已启用", tone: "success" } : s === "paused" ? { label: "已暂停", tone: "fade" } : { label: "待补链接", tone: "amber" };

export default function SettingsPage({ current, onUpdate }: { current: Account; onUpdate: (account: Account) => void }) {
  const api = useApi();
  const [section, setSection] = useState("account");
  const [name, setName] = useState(current.name), [url, setUrl] = useState(current.profile_url);
  const [src, setSrc] = useState<Sources>({ bloggers: [], keywords: [] });
  const [authors, setAuthors] = useState<Author[]>([]);
  const [link, setLink] = useState(""), [bloggerName, setBloggerName] = useState(""), [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<number | null>(null), [editName, setEditName] = useState(""), [editNote, setEditNote] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const archived = current.status === "archived";
  const bloggerPage = usePaged(src.bloggers), keywordPage = usePaged(src.keywords);
  const load = useCallback(async () => { const [s, a] = await Promise.all([api<Sources>("/api/sources"), api<Author[]>("/api/authors")]); setSrc(s); setAuthors(a); }, [api]);
  useCachedLoad('sources', useCallback(() => { load().catch((e) => setMsg({ ok: false, text: String(e) })); }, [load]));
  const action = async (fn: () => Promise<void | string>, success = "已保存") => {
    if (busy) return; setBusy(true); setMsg(null);
    try { const result = await fn(); setMsg({ ok: true, text: result || success }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };
  const save = (patch: Partial<Account>) => action(async () => {
    const updated = await api<Account>(`/api/accounts/${current.id}`, { method: "PUT", body: JSON.stringify(patch) }); onUpdate(updated);
  });
  const sourceAction = (s: Source, method: string, status?: string) =>
    action(async () => { await api(`/api/sources/${s.id}`, { method, body: JSON.stringify({ status }) }); });
  const saveEdit = (id: number) =>
    action(async () => { await api(`/api/sources/${id}`, { method: "PUT", body: JSON.stringify({ name: editName.trim(), note: editNote.trim() }) }); setEditing(null); });

  const sourceRowActions = (s: Source) => {
    const st = srcStatus(s.status);
    return <>
      <Tag tone={st.tone}>{st.label}</Tag>
      <button className="btn-sm" disabled={archived || busy} onClick={() => sourceAction(s, "PUT", s.status === "ready" ? "paused" : "ready")}>{s.status === "ready" ? "暂停" : "启用"}</button>
      <ConfirmBtn label="移出" confirmLabel="确认移出" disabled={archived || busy} onConfirm={() => sourceAction(s, "DELETE")} />
    </>;
  };

  return <Page head="账号设置" items={SECTIONS.map(([key, label]) => ({ key, label }))} active={section} onPick={key => { setSection(key); setMsg(null); }}>
    <div className="space-y-5">
      {archived && <Msg tone="error">此账号已归档，数据只读。可在账号资料中恢复。</Msg>}
      <KeepAlive active={section === "account"}><section className="panel space-y-5">
        <h2 className="font-display text-xl">账号资料</h2>
        <label className="block text-sm">账号名称<input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <label className="block text-sm">抖音主页<input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.douyin.com/user/…（可选）" /></label>
        <p className="text-xs leading-6 text-muted">账号是独立的内容运营空间。关键词、采集规则、订阅及结果各自隔离；数据来自本账号已授权的抖音指数。关注博主只用于整理已收录作品。</p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => save({ name, profile_url: url })}>保存资料</button>
          {archived
            ? <button className="btn" disabled={busy} onClick={() => save({ status: "active" })}>恢复账号</button>
            : <ConfirmBtn size="md" label="归档账号" confirmLabel="确认归档" disabled={busy} onConfirm={() => save({ status: "archived" })} />}
        </div>
      </section></KeepAlive>
      <KeepAlive active={section === "sources"}>
        <section className="panel space-y-5">
          <h2 className="font-display text-xl">关注博主</h2>
          <div className="flex flex-wrap gap-2">
            <input className="field min-w-48 flex-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder="粘贴抖音博主主页分享链接" aria-label="博主主页分享链接" disabled={archived} />
            <input className="field w-36" value={bloggerName} onChange={(e) => setBloggerName(e.target.value)} placeholder="备注名（可选）" aria-label="博主备注名" disabled={archived} />
            <button className="btn-primary" disabled={archived || busy || !link.trim()} onClick={() => action(async () => {
              const result = await api<{ message: string }>("/api/bloggers", { method: "POST", body: JSON.stringify({ url: link.trim(), name: bloggerName.trim() || undefined }) });
              setLink(""); setBloggerName(""); return result.message;
            }, "已加入本账号。新数据将在下次采集时更新；可在任务页立即采集。")}>添加博主</button>
          </div>
          <div className="space-y-2">{bloggerPage.slice.map((s) => {
            const author = authors.find((a) => a.sec_uid === s.source_key);
            const href = s.source_key.startsWith("MS4w") ? `https://www.douyin.com/user/${encodeURIComponent(s.source_key)}` : s.profile_url;
            if (editing === s.id) return (
              <form key={s.id} onSubmit={(e) => { e.preventDefault(); saveEdit(s.id); }} className="flex flex-wrap gap-2 rounded-xl border border-line bg-paper px-4 py-3">
                <input className="field min-w-40 flex-1" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="博主备注名" aria-label="博主备注名" maxLength={80} autoFocus />
                <input className="field min-w-40 flex-1" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="采集源备注（可留空）" aria-label="采集源备注" maxLength={200} />
                <button className="btn-primary" disabled={busy || !editName.trim()}>保存</button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>取消</button>
              </form>
            );
            return (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                <div className="relative min-w-48 flex-1">
                  {href && <a className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-brand" href={href} target="_blank" rel="noopener noreferrer" aria-label={`打开${s.name}的抖音主页`} />}
                  <p className="text-sm">{s.name}</p>
                  <p className="mt-1 text-xs text-muted">粉丝 {author ? fmtNum(author.follower_count) : "—"}{s.note ? ` · ${s.note}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-sm" disabled={archived || busy} onClick={() => { setEditing(s.id); setEditName(s.name); setEditNote(s.note || ""); }}>编辑</button>
                  {sourceRowActions(s)}
                </div>
              </div>
            );
          })}{!src.bloggers.length && <p className="text-sm text-muted">尚未添加博主。</p>}</div><Pager {...bloggerPage} />
        </section>
        <section className="panel space-y-5">
          <h2 className="font-display text-xl">关键词筛选</h2>
          <p className="text-sm leading-6 text-muted">关键词属于当前账号；启用抖音指数后用于话题和视频查询，未启用时仅匹配已有的公开作品。</p>
          <div className="flex gap-2"><input className="field flex-1" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例如：效率工具、职场技能、日常生活" aria-label="新增关键词" maxLength={80} disabled={archived} /><button className="btn-primary" disabled={archived || busy || !keyword.trim()} onClick={() => action(async () => { await api("/api/keywords", { method: "POST", body: JSON.stringify({ keyword }) }); setKeyword(""); })}>添加</button></div>
          <div className="space-y-2">{keywordPage.slice.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
              <span className="text-sm">{s.name}{s.note && <span className="ml-3 text-xs text-muted">{s.note}</span>}</span>
              <div className="flex items-center gap-2">{sourceRowActions(s)}</div>
            </div>
          ))}{!src.keywords.length && <p className="text-sm text-muted">尚未添加关键词。</p>}</div><Pager {...keywordPage} />
        </section>
      </KeepAlive>
      <KeepAlive active={section === "rules"}>
        <IndexAuthorization disabled={archived} />
        <SourceBudgets />
        <CollectionSchedule account={current} onSaved={onUpdate} />
        <CollectionRules account={current} onSaved={async value => { onUpdate(value); }} />
      </KeepAlive>
      <KeepAlive active={section === "strategy"}><StrategyEditor disabled={archived} /></KeepAlive>
      {msg && <Msg tone={msg.ok ? "ok" : "error"}>{msg.text}</Msg>}
    </div>
  </Page>;
}
