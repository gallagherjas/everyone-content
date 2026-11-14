/** 采集域共用文案：采集页(任务/次数上限)与设置·采集记录共用 */
export const names: Record<string, string> = { index: "抖音指数", douyin: "抖音创作后台", xhs: "小红书创作服务", bili: "B站创作中心" };
export const statuses: Record<string, string> = { ok: "完成", failed: "失败", cached: "复用缓存", running: "处理中", deferred: "等待次数恢复" };
const errors: Record<string, string> = {
  auth_required: "本账号尚未登记指数授权", login_required: "登录已失效，请更新授权", invalid_auth_cookie: "指数授权内容无效",
  auth_file_must_be_private_0600: "授权文件须仅本人可读写（0600）", source_dates_missing: "等待获取来源有效日期",
  service_unavailable: "来源服务不可用，请检查服务连接", transport_error: "来源网络请求失败，请检查代理连接",
  daily_budget_exhausted: "今日采集次数已达上限", tick_budget_exhausted: "本轮采集次数已达上限",
  interval_pending: "等待平台请求间隔，到点后下次采集补上",
};
export const reason = (code: string | null): string | null => (code ? errors[code] ?? code : null);
