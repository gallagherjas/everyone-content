import { useEffect, useState } from "react";
import { api, AccountContext, type Account } from "./api";
import { Msg, PillTab } from "./components/Common";
import BloggersPage from "./pages/Bloggers";
import CollectionPage from "./pages/Collection";
import SettingsPage from "./pages/Settings";
import ContentsPage from "./pages/Contents";
import { KeepAlive, PageCacheProvider } from "./components/PageCache";
const TABS = [["collection", "采集"], ["bloggers", "博主"], ["contents", "已发布"], ["settings", "设置"]];
export default function App() {
  const [tab, setTab] = useState("collection"), [accounts, setAccounts] = useState<Account[]>([]);
  const [id, setId] = useState<number>(() => Number(localStorage.getItem("everyone-content-account")) || 1);
  const [creating, setCreating] = useState(false), [name, setName] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api<Account[]>("/api/accounts").then((rows) => { setAccounts(rows); if (!rows.some((a) => a.id === id)) setId(rows.find((a) => a.status === "active")?.id || rows[0]?.id || 1); }).catch((e) => setError(String(e))); }, []);
  useEffect(() => { localStorage.setItem("everyone-content-account", String(id)); }, [id]);
  const current = accounts.find((a) => a.id === id);
  const create = async () => {
    setBusy(true); setError("");
    try { const a = await api<Account>("/api/accounts", { method: "POST", body: JSON.stringify({ name }) }); setAccounts([...accounts, a]); setId(a.id); setName(""); setCreating(false); setTab("settings"); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const update = (a: Account) => setAccounts((rows) => rows.map((old) => old.id === a.id ? a : old));
  return <div className="mx-auto min-h-screen max-w-7xl px-4 pb-16 sm:px-6">
    <header className="sticky top-0 z-40 mb-6 border-b border-line bg-paper/95 py-4 backdrop-blur sm:py-5">
      <div className="flex items-center gap-4 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-3"><img className="h-12 w-12 shrink-0 object-contain" src="/brand/mascot.png" alt="" aria-hidden="true" /><div><div className="font-display text-lg">everyone-content</div><p className="text-xs text-muted">{new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" })} · 北京时间</p></div></div>
        <nav className="flex shrink-0 gap-1" aria-label="工作台导航">{TABS.map(([key, label]) => <PillTab key={key} active={tab === key} onClick={() => setTab(key)}>{label}</PillTab>)}</nav>
        <div className="ml-auto flex shrink-0 items-center gap-2"><label className="sr-only" htmlFor="account-switch">当前运营账号</label><select id="account-switch" className="field max-w-64" value={id} onChange={(e) => setId(Number(e.target.value))}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status === "archived" ? "（已归档）" : ""}</option>)}</select><button className="btn shrink-0" onClick={() => setCreating(!creating)}>＋ 新账号</button></div>
      </div>
      {creating && <form onSubmit={(e) => { e.preventDefault(); create(); }} className="mt-4 flex flex-wrap gap-2 rounded-xl border border-line bg-card p-4"><input className="field min-w-48 flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="给新账号起一个名字" aria-label="新账号名称" maxLength={80} autoFocus /><button className="btn-primary" disabled={busy || !name.trim()}>{busy ? "创建中…" : "创建账号"}</button><button type="button" className="btn" onClick={() => setCreating(false)}>取消</button><p className="w-full text-xs text-muted">新账号从空白采集配置开始，账号画像可在设置中维护。</p></form>}
    </header>
    {error && <div className="mb-4"><Msg tone="error">{error}</Msg></div>}
    {current ? <AccountContext.Provider value={id}><PageCacheProvider key={id}><main>
      {current.status === "archived" && tab !== "settings" && <p className="mb-5 text-sm text-clay">当前账号已归档，可查看历史；恢复账号请进入设置。</p>}
      <KeepAlive active={tab === "bloggers"}><BloggersPage /></KeepAlive>
      <KeepAlive active={tab === "collection"}><CollectionPage account={current} /></KeepAlive>
      <KeepAlive active={tab === "contents"}><ContentsPage archived={current.status === "archived"} /></KeepAlive>
      <KeepAlive active={tab === "settings"}><SettingsPage current={current} onUpdate={update} /></KeepAlive>
    </main></PageCacheProvider></AccountContext.Provider> : <p className="text-sm text-muted">{error ? "请检查服务后刷新。" : "正在加载账号…"}</p>}
  </div>;
}
