import { useCallback, useEffect, useState } from "react";
import { api, AccountContext, type Account } from "./api";
import { Msg, PillTab } from "./components/Common";
import { NoticesProvider, NoticeMenu, useNotices } from "./components/Notices";
import BloggersPage from "./pages/Bloggers";
import CollectPage from "./pages/Collect";
import CollectionPage from "./pages/Collection";
import SettingsPage from "./pages/Settings";
import MonitorPage from "./pages/Monitor";
import { KeepAlive, PageCacheProvider } from "./components/PageCache";
const TABS = [["monitor", "数据"], ["collection", "指数"], ["bloggers", "博主"], ["collect", "采集"], ["settings", "帐号"]];
const ACCOUNT_KEY = "everyone-content-selected-account";

function TopNav({ current, tab, setTab, onNoticeAction }: {
  current: Account; tab: string; setTab: (key: string) => void; onNoticeAction: (section: "auth" | "logs") => void;
}) {
  const { bloggerCount } = useNotices();
  return (
    <header className="sticky top-0 z-40 mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line/70 py-4 backdrop-blur sm:flex sm:py-5">
      <div className="flex min-w-0 items-center gap-3 sm:shrink-0">
        <img className="h-12 w-12 shrink-0 object-contain" src="/brand/mascot.png" alt="" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight">everyone-content</div>
          <div className="truncate text-xs leading-tight text-muted">{current.name}{current.status === "archived" ? "（已归档）" : ""}</div>
        </div>
      </div>
      <nav className="col-span-2 row-start-2 flex w-fit max-w-full min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-ink/[0.06] p-1" aria-label="工作台导航">{TABS.map(([key, label]) => (
        <PillTab key={key} active={tab === key} dot={key === "bloggers" ? bloggerCount : undefined} onClick={() => setTab(key)}>{label}</PillTab>
      ))}</nav>
      <NoticeMenu onAction={onNoticeAction} />
    </header>
  );
}

export default function App() {
  const [tab, setTab] = useState("monitor"), [accounts, setAccounts] = useState<Account[] | null>(null);
  const [id, setId] = useState<number | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [first, setFirst] = useState("");
  // 每次点击提醒中的操作都可跳到对应的采集小节。
  const [jump, setJump] = useState<{ section: string } | null>(null);
  const selectAccount = useCallback((selected: number | null) => {
    setId(selected);
    if (selected === null) localStorage.removeItem(ACCOUNT_KEY);
    else localStorage.setItem(ACCOUNT_KEY, String(selected));
  }, []);
  useEffect(() => {
    let active = true;
    api<Account[]>("/api/accounts").then((rows) => {
      if (!active) return;
      const savedId = Number(localStorage.getItem(ACCOUNT_KEY));
      const selected = rows.find(a => a.id === savedId) ?? rows.find(a => a.status === "active") ?? rows[0];
      setAccounts(rows);
      selectAccount(selected?.id ?? null);
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [selectAccount]);
  const current = accounts?.find((a) => a.id === id);
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
    {current && <AccountContext.Provider value={current.id}><PageCacheProvider key={current.id}><NoticesProvider>
      <TopNav current={current} tab={tab} setTab={setTab} onNoticeAction={section => { setJump({ section }); setTab("collect"); }} />
      {error && <div className="mb-4"><Msg tone="error">{error}</Msg></div>}
      <main>
        {current.status === "archived" && tab !== "settings" && <p className="mb-5 text-sm text-warn">当前账号已归档，可查看历史；恢复账号请进入「帐号」。</p>}
        <KeepAlive active={tab === "monitor"}><MonitorPage /></KeepAlive>
        <KeepAlive active={tab === "collection"}><CollectionPage /></KeepAlive>
        <KeepAlive active={tab === "bloggers"}><BloggersPage /></KeepAlive>
        <KeepAlive active={tab === "collect"}><CollectPage current={current} onUpdate={update} jumpTo={jump} /></KeepAlive>
        <KeepAlive active={tab === "settings"}><SettingsPage current={current} accounts={accounts ?? []} onPick={selectAccount} onCreate={create} onDelete={remove} onUpdate={update} /></KeepAlive>
      </main>
    </NoticesProvider></PageCacheProvider></AccountContext.Provider>}
    {!current && error && <div className="mt-6"><Msg tone="error">{error}</Msg></div>}
    {accounts?.length === 0 && <section className="panel mx-auto mt-16 max-w-md">
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
