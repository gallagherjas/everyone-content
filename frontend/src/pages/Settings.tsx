import { useState } from "react";
import { useApi, type Account } from "../api";
import { Page } from "../components/Layout";
import StrategyEditor from "../components/StrategyEditor";
import WritingCorpusEditor from "../components/WritingCorpus";
import CollectionSchedule from "../components/CollectionSchedule";
import PlatformAuthorization from "../components/PlatformAuthorization";
import { ConfirmBtn, Msg } from "../components/Common";
import { KeepAlive } from "../components/PageCache";

const SECTIONS = [["account", "账号资料"], ["strategy", "账号画像"], ["rules", "采集设置"], ["writing", "写作语料"]];

export default function SettingsPage({ current, onUpdate }: { current: Account; onUpdate: (account: Account) => void }) {
  const api = useApi();
  const [section, setSection] = useState("account");
  const [name, setName] = useState(current.name), [url, setUrl] = useState(current.profile_url);
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

  return <Page head="账号设置" items={SECTIONS.map(([key, label]) => ({ key, label }))} active={section} onPick={key => { setSection(key); setMsg(null); }}>
    <div className="space-y-5">
      {archived && <Msg tone="error">此账号已归档，数据只读。可在账号资料中恢复。</Msg>}
      <KeepAlive active={section === "account"}><section className="panel space-y-5">
        <h2 className="font-semibold text-xl">账号资料</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">账号名称<input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
          <label className="block text-sm">抖音主页<input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.douyin.com/user/…（可选）" /></label>
        </div>
        <p className="text-xs leading-6 text-muted">账号是独立的内容运营空间。关键词、采集规则、订阅及结果各自隔离；数据来自本账号已授权的抖音指数。</p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => save({ name, profile_url: url })}>保存资料</button>
          {archived
            ? <button className="btn" disabled={busy} onClick={() => save({ status: "active" })}>恢复账号</button>
            : <ConfirmBtn size="md" label="归档账号" confirmLabel="确认归档" disabled={busy} onConfirm={() => save({ status: "archived" })} />}
        </div>
      </section></KeepAlive>
      <KeepAlive active={section === "rules"}>
        {/* 采集设置合一个容器：平台连接与各来源定时；指数筛选参数在指数采集页 */}
        <section className="panel space-y-6">
          <h2 className="font-semibold text-xl">采集设置</h2>
          <PlatformAuthorization disabled={archived} />
          <CollectionSchedule account={current} onSaved={onUpdate} />
        </section>
      </KeepAlive>
      <KeepAlive active={section === "strategy"}><StrategyEditor disabled={archived} /></KeepAlive>
      <KeepAlive active={section === "writing"}><WritingCorpusEditor account={current} /></KeepAlive>
      {msg && <Msg tone={msg.ok ? "ok" : "error"}>{msg.text}</Msg>}
    </div>
  </Page>;
}
