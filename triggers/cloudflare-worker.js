/**
 * CronPro 备用触发器（Cloudflare Workers，免费）
 *
 * 1. Cloudflare Dashboard → Workers & Pages → 新建 Worker，粘贴本文件
 * 2. Settings → Variables：添加 CRONPRO_URL = 后台「系统设置 → 触发方式」复制的完整地址（含 /cron?key=...）
 * 3. Settings → Triggers → Cron Triggers：添加 * * * * *
 *
 * 与 cron-job.org 同时开启也不会重复执行：CronPro 使用数据库锁认领任务。
 */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ping(env));
  },
  // 直接访问 Worker 地址可手动测试
  async fetch(request, env) {
    return new Response(await ping(env), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

async function ping(env) {
  try {
    const res = await fetch(env.CRONPRO_URL, {
      headers: { 'User-Agent': 'CronPro-CF-Trigger' },
      signal: AbortSignal.timeout(55000),
    });
    return `${res.status}\n${await res.text()}`;
  } catch (e) {
    return `error: ${e.message}`;
  }
}
