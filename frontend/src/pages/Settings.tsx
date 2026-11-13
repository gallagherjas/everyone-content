import { useState } from "react";
import { useApi, type Account } from "../api";
import { Page } from "../components/Layout";
import StrategyEditor from "../components/StrategyEditor";
import WritingCorpusEditor from "../components/WritingCorpus";
import { Badge, ConfirmBtn, Msg } from "../components/Common";
import { KeepAlive } from "../components/PageCache";

const SECTIONS = [["account", "帐号管理"], ["strategy", "账号画像"], ["writing", "写作语料"]];

export default function SettingsPage({ current, accounts, onPick, onCreate, onDelete, onUpdate }: {
  current: Account; accounts: Account[]; onPick: (id: number) => void; onCreate: (name: string) => Promise<boolean>; onDelete: (id: number) => Promise<boolean>; onUpdate: (account: Account) => void;
}) {
  const api = useApi();
  const [section, setSection] = useState("account");
  const [name, setName] = useState(current.name), [url, setUrl] = useState(current.profile_url);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const archived = current.status === "archived";
  const action = async (fn: () => Promise<void | string>, success = "已保存") => {
    if (busy) return; setBusy(true); setMsg(null);
    try { const result = await fn(); setMsg({ ok: true, text: result || success }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };
  const save = (patch: Partial<Account>) => action(async () => {
    const updated = await api<Account>(`/api/accounts/${current.id}`, { method: "PUT", body: JSON.stringify(patch) }); onUpdate(updated);
  });

  return <Page head="帐号" items={SECTIONS.map(([key, label]) => ({ key, label }))} active={section} onPick={key => { setSection(key); setMsg(null); }}>
    <div className="space-y-5">
      {archived && <Msg tone="error">此账号已归档，数据只读。可在帐号管理中恢复。</Msg>}
      <KeepAlive active={section === "account"}><section className="panel space-y-6">
        <h2 className="font-semibold text-xl">帐号管理</h2>
        <div className="space-y-4">
          <h3 className="text-base font-semibold">当前账号</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">账号名称<input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
            <label className="block text-sm">抖音主页<input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.douyin.com/user/…（可选）" /></label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => save({ name, profile_url: url })}>保存资料</button>
            {archived
              ? <button className="btn" disabled={busy} onClick={() => save({ status: "active" })}>恢复账号</button>
              : <ConfirmBtn size="md" label="归档账号" confirmLabel="确认归档" disabled={busy} onConfirm={() => save({ status: "archived" })} />}
          </div>
          <p className="text-xs leading-6 text-muted">账号是独立的内容运营空间。关键词、采集规则、订阅及结果各自隔离；数据来自本账号已授权的抖音指数。</p>
        </div>
        <div className="space-y-4 border-t border-line pt-5">
          <h3 className="text-base font-semibold">全部账号</h3>
          <div className="flex gap-2">
            <input className="field min-w-0 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="新账号名称" aria-label="新账号名称" maxLength={80}
              onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void action(async () => { if (await onCreate(draft)) setDraft(""); }, "已创建并切换到新账号。"); }} />
            <button className="btn-primary shrink-0" disabled={busy || !draft.trim()}
              onClick={() => void action(async () => { if (await onCreate(draft)) setDraft(""); }, "已创建并切换到新账号。")}>新建账号</button>
          </div>
          <div className="space-y-2">
            {accounts.map(a => <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-3">
              <button type="button" aria-label={`切换到 ${a.name}`} disabled={a.id === current.id} onClick={() => onPick(a.id)}
                className={`flex min-w-0 items-center gap-2 rounded-lg text-left text-sm transition ${a.id === current.id ? "font-medium text-brand" : "hover:text-brand"}`}>
                <span className="truncate">{a.name}</span>
                {a.id === current.id && <Badge tone="brand">当前</Badge>}
                {a.status === "archived" && <Badge tone="gray">已归档</Badge>}
              </button>
              <ConfirmBtn label="删除" confirmLabel="确认删除" disabled={busy} onConfirm={() => void action(async () => { await onDelete(a.id); }, "已删除账号及其全部数据。")} />
            </div>)}
            {!accounts.length && <p className="text-sm text-muted">尚无账号。</p>}
          </div>
        </div>
      </section></KeepAlive>
      <KeepAlive active={section === "strategy"}><StrategyEditor disabled={archived} /></KeepAlive>
      <KeepAlive active={section === "writing"}><WritingCorpusEditor account={current} /></KeepAlive>
      {msg && <Msg tone={msg.ok ? "ok" : "error"}>{msg.text}</Msg>}
    </div>
  </Page>;
}
