import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, AccountContext, type Account } from "./api";
import { Badge, Msg, PillTab } from "./components/Common";
import CollectionPage from "./pages/Collection";
import SettingsPage from "./pages/Settings";
import MonitorPage from "./pages/Monitor";
import { KeepAlive, PageCacheProvider } from "./components/PageCache";
import RulesMenu from "./components/RulesMenu";
const TABS = [["monitor", "数据监控"], ["collection", "指数采集"], ["settings", "设置"]];
const ACCOUNT_KEY = "everyone-content-selected-account";

/** 顶栏账号下拉:切换与新建同面板,面板挂 body 避开顶栏横向滚动裁剪(同 RulesMenu) */
function AccountSelect({ accounts, current, onPick, onCreate }: {
  accounts: Account[]; current: Account | null; onPick: (id: number) => void; onCreate: (name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(""), [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!btnRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    setOpen(true);
  };
  const submit = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    if (await onCreate(draft)) { setDraft(""); setOpen(false); }
    setBusy(false);
  };
  return <div className="shrink-0">
    <button ref={btnRef} type="button" className="field field-caret flex w-44 items-center text-left" aria-label="当前运营账号" aria-expanded={open} onClick={toggle}>
      <span className={`truncate ${current ? "" : "text-muted"}`}>{current ? current.name + (current.status === "archived" ? "（已归档）" : "") : "选择账号"}</span>
    </button>
    {open && createPortal(
      <div ref={panelRef} className="fixed z-50 w-64 rounded-xl border border-line bg-card p-2 shadow-lg" style={{ top: pos?.top, right: pos?.right }}>
        <div className="flex items-center gap-2 border-b border-line pb-2">
          <input className="field min-w-0 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="输入账号名称" aria-label="新账号名称" maxLength={80}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit(); }} />
          <button type="button" className="btn-sm shrink-0" disabled={!draft.trim() || busy} onClick={() => void submit()}>{busy ? "创建中…" : "＋ 添加"}</button>
        </div>
        <div className="max-h-72 overflow-auto pt-1">
          {accounts.map((a) => (
            <button type="button" key={a.id} aria-label={`切换到 ${a.name}`} onClick={() => { onPick(a.id); setOpen(false); }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm transition ${a.id === current?.id ? "bg-brand/10 font-medium text-brand" : "hover:bg-canvas"}`}>
              <span className="truncate">{a.name}</span>
              {a.status === "archived" && <Badge tone="gray">已归档</Badge>}
            </button>
          ))}
          {!accounts.length && <p className="px-2 py-1 text-sm text-muted">创建第一个账号开始使用。</p>}
        </div>
      </div>, document.body)}
  </div>;
}

export default function App() {
  const [tab, setTab] = useState("monitor"), [accounts, setAccounts] = useState<Account[] | null>(null);
  const [id, setId] = useState<number | null>(() => Number(localStorage.getItem(ACCOUNT_KEY)) || null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
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
  const create = async (name: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setError("");
    try { const a = await api<Account>("/api/accounts", { method: "POST", body: JSON.stringify({ name }) }); setAccounts((rows) => [...(rows ?? []), a]); selectAccount(a.id); setTab("settings"); return true; }
    catch (e) { setError(String(e)); return false; } finally { setBusy(false); }
  };
  const update = (a: Account) => setAccounts((rows) => rows?.map((old) => old.id === a.id ? a : old) ?? null);
  return <div className="mx-auto min-h-screen max-w-7xl px-4 pb-16 sm:px-6">
    <header className="sticky top-0 z-40 mb-6 border-b border-line/70 py-4 backdrop-blur sm:py-5">
      <div className="flex items-center gap-4 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-3"><img className="h-12 w-12 shrink-0 object-contain" src="/brand/mascot.png" alt="" aria-hidden="true" /><div className="text-lg font-semibold">everyone-content</div></div>
        {current && <nav className="flex shrink-0 items-center gap-0.5 rounded-full bg-ink/[0.06] p-1" aria-label="工作台导航">{TABS.map(([key, label]) => <PillTab key={key} active={tab === key} onClick={() => setTab(key)}>{label}</PillTab>)}</nav>}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <RulesMenu />
          {accounts && <AccountSelect accounts={accounts} current={current ?? null} onPick={selectAccount} onCreate={create} />}
        </div>
      </div>
    </header>
    {error && <div className="mb-4"><Msg tone="error">{error}</Msg></div>}
    {current && <AccountContext.Provider value={current.id}><PageCacheProvider key={current.id}><main>
      {current.status === "archived" && tab !== "settings" && <p className="mb-5 text-sm text-warn">当前账号已归档，可查看历史；恢复账号请进入设置。</p>}
      <KeepAlive active={tab === "monitor"}><MonitorPage /></KeepAlive>
      <KeepAlive active={tab === "collection"}><CollectionPage account={current} /></KeepAlive>
      <KeepAlive active={tab === "settings"}><SettingsPage current={current} onUpdate={update} /></KeepAlive>
    </main></PageCacheProvider></AccountContext.Provider>}
    {accounts === null && !error && <p className="text-sm text-muted">正在加载账号…</p>}
  </div>;
}
