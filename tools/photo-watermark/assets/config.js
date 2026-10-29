/**
 * 站点配置 —— 部署后只需要改这一个文件。
 *
 * 地点解析有两种模式，二选一（两个都填时以 workerUrl 为准）：
 *
 *   A. Cloudflare Worker 代理
 *      key 只存在 Worker 的加密变量里，前端源码拿不到，别人无法盗用。
 *      填 workerUrl，tdtKey 留空。
 *
 *   B. 浏览器直连天地图（当前默认）
 *      天地图网关带 CORS 头，可以直连，不需要任何后端。
 *      但 key 会以明文出现在这个文件里 —— 别人打开页面就能看到，
 *      只能靠天地图的「浏览器端 key + 域名白名单」挡住其他网站直接复用。
 *      填 tdtKey，workerUrl 留空。
 *
 * ⚠️ 重要：*.workers.dev 在国内被 SNI 阻断，实测访问一直超时。
 *    所以不要把 workers.dev 地址填进 workerUrl —— 除非你给 Worker 绑了自有域名
 *    （如 https://geo.yourdomain.com），否则国内访客一个都解析不出地点。
 *
 * 注意：同一个 key 不能同时用于两种模式。模式 A 要求白名单留空，
 * 模式 B 要求填域名，两者互相冲突。想并存就去控制台建两个应用、用两个 key。
 */
window.PW_CONFIG = {
  // ---- 模式 A ----
  // 只能填自有域名，例：'https://geo.yourdomain.com'（末尾不要带斜杠）
  // ❌ 不要填 *.workers.dev —— 国内访问不通
  // 原来的地址（已停用）：https://photo-watermark.2869891956.workers.dev
  workerUrl: '',

  // ---- 模式 B ----
  // 申请时类型选「浏览器端」，域名白名单填 zhiming2008.github.io
  // 本地测试临时再加上 localhost，测完删掉
  tdtKey: 'b696d99a0a1023ef371ef13c51793930'
};
