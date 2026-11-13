import { useCallback, useState } from "react";
import { useApi, type Account } from "../api";
import { Page } from "../components/Layout";
import StrategyEditor from "../components/StrategyEditor";
import CollectionRules from "../components/CollectionRules";
import ExcludeKeywords from "../components/ExcludeKeywords";
import CollectionSchedule from "../components/CollectionSchedule";
import IndexAuthorization from "../components/IndexAuthorization";
import { ConfirmBtn, Msg, Tag, type Tone } from "../components/Common";
import { KeepAlive, useCachedLoad } from "../components/PageCache";
import Pager, { usePaged } from "../components/Pager";

interface Source { id: number; kind: string; source_key: string; name: string; status: string; note: string }
interface Sources { keywords: Source[] }
const SECTIONS = [["account", "账号资料"], ["sources", "关键词"], ["rules", "采集设置"], ["strategy", "账号画像"]];
const srcStatus = (s: string): { label: string; tone: Tone } =>
  s === "ready" ? { label: "已启用", tone: "success" } : { label: "已暂停", tone: "fade" };

export default function SettingsPage({ current, onUpdate }: { current: Account; onUpdate: (account: Account) => void }) {
  const api = useApi();
  const [section, setSection] = useState("account");
  const [name, setName] = useState(current.name), [url, setUrl] = useState(current.profile_url);
  const [src, setSrc] = useState<Sources>({ keywords: [] });
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const archived = current.status === "archived";
  const keywordPage = usePaged(src.keywords);
  const load = useCallback(async () => { setSrc(await api<Sources>("/api/sources")); }, [api]);
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
        <p className="text-xs leading-6 text-muted">账号是独立的内容运营空间。关键词、采集规则、订阅及结果各自隔离；数据来自本账号已授权的抖音指数。</p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => save({ name, profile_url: url })}>保存资料</button>
          {archived
            ? <button className="btn" disabled={busy} onClick={() => save({ status: "active" })}>恢复账号</button>
            : <ConfirmBtn size="md" label="归档账号" confirmLabel="确认归档" disabled={busy} onConfirm={() => save({ status: "archived" })} />}
        </div>
      </section></KeepAlive>
      <KeepAlive active={section === "sources"}>
        <section className="panel space-y-5">
          <h2 className="font-display text-xl">关键词筛选</h2>
          {/* 采集词与排除词两块镜像排列：标签+计数 → 说明 → 输入行 → 列表 */}
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="source-keyword">采集关键词<span className="ml-2 text-xs font-normal text-muted">{src.keywords.length} 个</span></label>
            <p className="text-xs leading-6 text-muted" id="source-keyword-hint">启用抖音指数后用于话题和视频查询，未启用时仅匹配已有的公开作品。</p>
            <div className="flex gap-2"><input id="source-keyword" className="field flex-1" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例如：效率工具、职场技能、日常生活" aria-label="新增关键词" maxLength={80} disabled={archived} /><button className="btn-primary shrink-0" disabled={archived || busy || !keyword.trim()} onClick={() => action(async () => { await api("/api/keywords", { method: "POST", body: JSON.stringify({ keyword }) }); setKeyword(""); })}>添加</button></div>
            <div className="space-y-2">{keywordPage.slice.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                <span className="text-sm">{s.name}{s.note && <span className="ml-3 text-xs text-muted">{s.note}</span>}</span>
                <div className="flex items-center gap-2">{sourceRowActions(s)}</div>
              </div>
            ))}{!src.keywords.length && <p className="text-sm text-muted">尚未添加</p>}</div>
            <Pager {...keywordPage} />
          </div>
          <ExcludeKeywords disabled={archived} />
        </section>
      </KeepAlive>
      <KeepAlive active={section === "rules"}>
        {/* 采集设置各部分合用一个容器：一级标题「采集设置」，各部分为二级标题 */}
        <section className="panel space-y-6">
          <h2 className="font-display text-xl">采集设置</h2>
          <IndexAuthorization disabled={archived} />
          <CollectionSchedule account={current} onSaved={onUpdate} />
          <CollectionRules account={current} onSaved={async value => { onUpdate(value); }} />
        </section>
      </KeepAlive>
      <KeepAlive active={section === "strategy"}><StrategyEditor disabled={archived} /></KeepAlive>
      {msg && <Msg tone={msg.ok ? "ok" : "error"}>{msg.text}</Msg>}
    </div>
  </Page>;
}
