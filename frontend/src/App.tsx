import { useEffect, useState } from "react";
import { api, AccountContext, type Account } from "./api";
import { Msg, PillTab } from "./components/Common";
import BloggersPage from "./pages/Bloggers";
import CollectPage from "./pages/Collect";
import CollectionPage from "./pages/Collection";
import SettingsPage from "./pages/Settings";
import MonitorPage from "./pages/Monitor";
import { KeepAlive, PageCacheProvider } from "./components/PageCache";
const TABS = [["monitor", "数据"], ["collection", "指数"], ["bloggers", "博主"], ["collect", "采集"], ["settings", "帐号"]];
const ACCOUNT_KEY = "everyone-content-selected-account";

export default function App() {
  const [tab, setTab] = useState("monitor"), [accounts, setAccounts] = useState<Account[] | null>(null);
  const [id, setId] = useState<number | null>(() => Number(localStorage.getItem(ACCOUNT_KEY)) || null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [first, setFirst] = useState("");
  useEffect(() => {
    api<Account[]>("/api/accounts").then((rows) => {
      setAccounts(rows);
      setId((selected) => rows.some((a) => a.id === selected) ? selected : null);
    }).catch((e) => setError(String(e)));
  }, []);
  const current = accounts?.find((a) => a.id === id);
  const selectAccount = (selected: number | null) => {
    setId(selected);
    if (selected === null) localStorage.removeItem(ACCOUNT_KEY);
    else localStorage.setItem(ACCOUNT_KEY, String(selected));
  };
  // 新建与删除在「帐号 → 帐号管理」进行;删除当前账号后自动落到剩余第一个。
  const create = async (name: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setError("");
    try { const a = await api<Account>("/api/accounts", { method: "POST", body: JSON.stringify({ name }) }); setAccounts((rows) => [...(rows ?? []), a]); selectAccount(a.id); setTab("settings"); return true; }
    catch (e) { setError(String(e)); return false; } finally { setBusy(false); }
  };
  const remove = async (accountId: number): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setError("");
    try {
      await api(`/api/accounts/${accountId}`, { method: "DELETE" });
      setAccounts((rows) => {
        const rest = (rows ?? []).filter((a) => a.id !== accountId);
        if (accountId === id) selectAccount(rest[0]?.id ?? null);
        return rest;
      });
      return true;
    } catch (e) { setError(String(e)); return false; } finally { setBusy(false); }
  };
  const update = (a: Account) => setAccounts((rows) => rows?.map((old) => old.id === a.id ? a : old) ?? null);
  return <div className="mx-auto min-h-screen max-w-7xl px-4 pb-16 sm:px-6">
    <header className="sticky top-0 z-40 mb-6 border-b border-line/70 py-4 backdrop-blur sm:py-5">
      <div className="flex items-center gap-4 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-3">
          <img className="h-12 w-12 shrink-0 object-contain" src="/brand/mascot.png" alt="" aria-hidden="true" />
          <div>
            <div className="text-lg font-semibold leading-tight">everyone-content</div>
            {current && <div className="text-xs leading-tight text-muted">{current.name}{current.status === "archived" ? "（已归档）" : ""}</div>}
          </div>
        </div>
        {current && <nav className="flex shrink-0 items-center gap-0.5 rounded-full bg-ink/[0.06] p-1" aria-label="工作台导航">{TABS.map(([key, label]) => <PillTab key={key} active={tab === key} onClick={() => setTab(key)}>{label}</PillTab>)}</nav>}
      </div>
    </header>
    {error && <div className="mb-4"><Msg tone="error">{error}</Msg></div>}
    {current && <AccountContext.Provider value={current.id}><PageCacheProvider key={current.id}><main>
      {current.status === "archived" && tab !== "settings" && <p className="mb-5 text-sm text-warn">当前账号已归档，可查看历史；恢复账号请进入「帐号」。</p>}
      <KeepAlive active={tab === "monitor"}><MonitorPage /></KeepAlive>
      <KeepAlive active={tab === "collection"}><CollectionPage /></KeepAlive>
      <KeepAlive active={tab === "bloggers"}><BloggersPage /></KeepAlive>
      <KeepAlive active={tab === "collect"}><CollectPage current={current} onUpdate={update} /></KeepAlive>
      <KeepAlive active={tab === "settings"}><SettingsPage current={current} accounts={accounts ?? []} onPick={selectAccount} onCreate={create} onDelete={remove} onUpdate={update} /></KeepAlive>
    </main></PageCacheProvider></AccountContext.Provider>}
    {accounts !== null && !current && <section className="panel mx-auto mt-16 max-w-md">
      <h2 className="text-center font-semibold text-lg">创建第一个账号</h2>
      <p className="mt-2 text-center text-sm text-muted">账号是独立的内容运营空间；后续在「帐号 → 帐号管理」新建、切换或删除。</p>
      <div className="mt-4 flex gap-2">
        <input className="field min-w-0 flex-1" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="账号名称" aria-label="新账号名称" maxLength={80}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void create(first).then(ok => ok && setFirst("")); }} />
        <button className="btn-primary shrink-0" disabled={busy || !first.trim()} onClick={() => void create(first).then(ok => ok && setFirst(""))}>新建账号</button>
      </div>
    </section>}
    {accounts === null && !error && <p className="text-sm text-muted">正在加载账号…</p>}
  </div>;
}
