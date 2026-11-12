import { useEffect, useState } from "react";
import { api, AccountContext, type Account } from "./api";
import { Msg, PillTab } from "./components/Common";
import CollectionPage from "./pages/Collection";
import SettingsPage from "./pages/Settings";
import ContentsPage from "./pages/Contents";
import { KeepAlive, PageCacheProvider } from "./components/PageCache";
import RulesMenu from "./components/RulesMenu";
const TABS = [["collection", "采集"], ["contents", "已发布"], ["settings", "设置"]];
const ACCOUNT_KEY = "everyone-content-selected-account";
export default function App() {
  const [tab, setTab] = useState("collection"), [accounts, setAccounts] = useState<Account[] | null>(null);
  const [id, setId] = useState<number | null>(() => Number(localStorage.getItem(ACCOUNT_KEY)) || null);
  const [creating, setCreating] = useState(false), [name, setName] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Account[]>("/api/accounts").then((rows) => {
      setAccounts(rows);
      setId((selected) => rows.some((a) => a.id === selected) ? selected : null);
    }).catch((e) => setError(String(e)));
  }, []);
  const current = accounts?.find((a) => a.id === id);
  const firstAccount = accounts?.length === 0;
  const selectAccount = (selected: number | null) => {
    setId(selected);
    if (selected === null) localStorage.removeItem(ACCOUNT_KEY);
    else localStorage.setItem(ACCOUNT_KEY, String(selected));
  };
  const create = async () => {
    setBusy(true); setError("");
    try { const a = await api<Account>("/api/accounts", { method: "POST", body: JSON.stringify({ name }) }); setAccounts((rows) => [...(rows ?? []), a]); selectAccount(a.id); setName(""); setCreating(false); setTab("settings"); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const update = (a: Account) => setAccounts((rows) => rows?.map((old) => old.id === a.id ? a : old) ?? null);
  return <div className="mx-auto min-h-screen max-w-7xl px-4 pb-16 sm:px-6">
    <header className="sticky top-0 z-40 mb-6 border-b border-line bg-paper/95 py-4 backdrop-blur sm:py-5">
      <div className="flex items-center gap-4 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-3"><img className="h-12 w-12 shrink-0 object-contain" src="/brand/mascot.png" alt="" aria-hidden="true" /><div><div className="font-display text-lg">everyone-content</div><p className="text-xs text-muted">{new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" })} · 北京时间</p></div></div>
        {current && <nav className="flex shrink-0 gap-1" aria-label="工作台导航">{TABS.map(([key, label]) => <PillTab key={key} active={tab === key} onClick={() => setTab(key)}>{label}</PillTab>)}</nav>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <RulesMenu />
          {accounts && accounts.length > 0 && <>
            <label className="sr-only" htmlFor="account-switch">当前运营账号</label>
            <select id="account-switch" className="field max-w-64" value={current?.id ?? ""} onChange={(e) => selectAccount(Number(e.target.value) || null)}>
              <option value="" disabled>选择账号</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status === "archived" ? "（已归档）" : ""}</option>)}
            </select>
            <button className="btn shrink-0" onClick={() => setCreating(!creating)}>＋ 新账号</button>
          </>}
        </div>
      </div>
      {(firstAccount || creating) && <form onSubmit={(e) => { e.preventDefault(); create(); }} className="mt-4 flex flex-wrap gap-2 rounded-xl border border-line bg-card p-4">
        <input className="field min-w-48 flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="输入账号名称" aria-label="新账号名称" maxLength={80} autoFocus />
        <button className="btn-primary" disabled={busy || !name.trim()}>{busy ? "创建中…" : "创建账号"}</button>
        {!firstAccount && <button type="button" className="btn" disabled={busy} onClick={() => setCreating(false)}>取消</button>}
      </form>}
    </header>
    {error && <div className="mb-4"><Msg tone="error">{error}</Msg></div>}
    {current && <AccountContext.Provider value={current.id}><PageCacheProvider key={current.id}><main>
      {current.status === "archived" && tab !== "settings" && <p className="mb-5 text-sm text-clay">当前账号已归档，可查看历史；恢复账号请进入设置。</p>}
      <KeepAlive active={tab === "collection"}><CollectionPage account={current} /></KeepAlive>
      <KeepAlive active={tab === "contents"}><ContentsPage archived={current.status === "archived"} /></KeepAlive>
      <KeepAlive active={tab === "settings"}><SettingsPage current={current} onUpdate={update} /></KeepAlive>
    </main></PageCacheProvider></AccountContext.Provider>}
    {accounts === null && !error && <p className="text-sm text-muted">正在加载账号…</p>}
  </div>;
}
