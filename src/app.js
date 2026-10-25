/**
 * CronPro — Vercel 版在线定时任务平台（参照 cron-job.org）
 * 路由兼容 PHP 版：/index.php /cron.php /trigger.php /status.php 仍可访问。
 */
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { waitUntil } from '@vercel/functions';
import { timingSafeEqual } from 'node:crypto';
import { ensureSchema, dbConfigError, run, one } from './lib/db.js';
import { loadSettings, setting, settingSet, isInstalled, DEFAULTS, cronKey } from './lib/settings.js';
import { getSession, login, logout, isLoggedIn, csrfOk, flash } from './lib/auth.js';
import { tick, tickIfDue, runJobs } from './core/runner.js';
import { jobGet, jobSave, JOB_DEFAULTS } from './core/jobs.js';
import { fmtMs, now, dt, int } from './lib/util.js';
import { cpUrl } from './views/layout.js';
import { authPage, messagePage } from './views/pages/auth.js';
import { pageDashboard } from './views/pages/dashboard.js';
import { pageJobs, pageEdit, pageJob } from './views/pages/jobs.js';
import { pageLogs, pageMails } from './views/pages/logs.js';
import { pageSettings } from './views/pages/settings.js';
import { pageStatus } from './views/pages/status.js';
import { handleGetAction, handlePostAction, normalizeHash } from './core/actions.js';

const app = new Hono();

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};
const clientIp = (c) => (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.req.header('x-real-ip') || 'unknown';

/** 在响应发出后继续执行（Vercel waitUntil；本地开发直接异步执行） */
function background(promise) {
  const p = promise.catch((e) => console.error('[cronpro] background tick failed:', e));
  try { waitUntil(p); } catch { /* 非 Vercel 环境 */ }
}

// 全局：数据库与设置
app.use('*', async (c, next) => {
  const err = dbConfigError();
  if (err) return c.html(messagePage(err), 500);
  await ensureSchema();
  await loadSettings();
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  await next();
});

/* ---------------- 外部触发：/cron ---------------- */
async function cronHandler(c) {
  if (!isInstalled()) return c.text('CronPro 尚未安装', 503);
  const auth = c.req.header('authorization') || '';
  const isVercelCron = process.env.CRON_SECRET && safeEq(auth, `Bearer ${process.env.CRON_SECRET}`);
  const key = c.req.query('key') || '';
  if (!isVercelCron && !safeEq(key, await cronKey())) return c.text('密钥错误', 403);
  c.header('Cache-Control', 'no-store');

  const jobId = int(c.req.query('job'));
  let res;
  if (jobId) {
    const job = await jobGet(jobId);
    if (!job) return c.text('任务不存在\n', 404);
    res = await runJobs([job], 'api');
  } else {
    const r = await tick(isVercelCron ? 'vercel' : 'url');
    res = r.results ?? { info: r.skipped };
    background(heartbeat(res));
  }
  if (c.req.query('format') === 'json') {
    const out = Object.entries(res).map(([id, r]) => (typeof r === 'object'
      ? { id: Number(id), title: r.title, ok: !!r.ok, code: r.code, ms: r.ms, error: r.error } : { info: r }));
    return c.json({ time: dt(now()).toISO(), results: out });
  }
  const lines = [`[${dt(now()).toFormat('yyyy-LL-dd HH:mm:ss')}] CronPro`];
  if (!Object.keys(res).length) lines.push('当前没有到点的任务');
  for (const [id, r] of Object.entries(res)) {
    if (typeof r !== 'object') { lines.push(String(r)); continue; }
    lines.push(`#${id} ${r.title}  ${r.ok ? 'OK' : 'FAIL'}  HTTP ${r.code}  ${fmtMs(r.ms)}${r.error ? '  ' + r.error : ''}`);
  }
  return c.text(lines.join('\n') + '\n');
}
/** 停跳报警：每次调度完成后 ping 外部监控（healthchecks.io 等），长时间没收到 ping 由监控方报警 */
async function heartbeat(res) {
  const url = process.env.HEARTBEAT_URL;
  if (!url) return;
  const failed = Object.values(res).some((r) => typeof r === 'object' && !r.ok);
  const target = failed && process.env.HEARTBEAT_FAIL_ON_JOB_ERROR === '1' ? url.replace(/\/$/, '') + '/fail' : url;
  try { await fetch(target, { signal: AbortSignal.timeout(5000) }); } catch { /* 忽略监控自身的故障 */ }
}
app.get('/cron', cronHandler);
app.get('/cron.php', cronHandler);
app.get('/api/cron', cronHandler);

/* ---------------- 访问触发：/trigger ---------------- */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
async function triggerHandler(c) {
  if (isInstalled() && setting('pseudo_cron', '1') === '1') background(tickIfDue('visit'));
  const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Access-Control-Allow-Origin': '*' };
  if (c.req.query('js') !== undefined) return c.body('/* cronpro */', 200, { ...headers, 'Content-Type': 'application/javascript; charset=utf-8' });
  return c.body(GIF, 200, { ...headers, 'Content-Type': 'image/gif' });
}
app.get('/trigger', triggerHandler);
app.get('/trigger.php', triggerHandler);

/* ---------------- 状态页 ---------------- */
async function statusHandler(c) {
  if (!isInstalled() || setting('status_public') !== '1') return c.text('Not Found', 404);
  if (setting('pseudo_cron', '1') === '1') background(tickIfDue('visit'));
  return c.html(await pageStatus());
}
app.get('/status', statusHandler);
app.get('/status.php', statusHandler);

/* ---------------- 后台 ---------------- */
async function adminHandler(c) {
  const p = c.req.query('p') || 'dashboard';
  const a = c.req.query('a') || '';
  const method = c.req.method;

  // 安装
  if (!isInstalled()) {
    let err = '';
    if (method === 'POST') {
      const f = await c.req.parseBody();
      const u = String(f.user || '').trim(), pw = String(f.pass || ''), pw2 = String(f.pass2 || '');
      if (!(await csrfOk(c, f))) err = '请求已过期，请刷新页面后重试';
      else if (process.env.SETUP_TOKEN && !safeEq(f.setup_token, process.env.SETUP_TOKEN)) err = '安装口令错误';
      else if (!u || pw.length < 8) err = '用户名不能为空，密码至少 8 位';
      else if (pw !== pw2) err = '两次输入的密码不一致';
      else {
        for (const [k, v] of Object.entries(DEFAULTS)) await settingSet(k, v);
        await settingSet('site_name', String(f.site || '').trim() || 'CronPro 定时任务');
        await settingSet('default_emails', String(f.email || '').trim());
        await settingSet('admin_user', u);
        await settingSet('admin_pass', await bcrypt.hash(pw, 10));
        await settingSet('base_url', new URL(c.req.url).origin + '/');
        await settingSet('installed_at', now());
        await cronKey();
        await jobSave({ ...JOB_DEFAULTS, title: '示例：每 5 分钟访问百度', url: 'https://www.baidu.com/', enabled: 0, group_name: '示例', retries: 0, notes: '这是一个示例任务，默认停用，可编辑后启用。' });
        await login(c, u, false);
        flash(c, '安装完成！先到「系统设置 → 触发方式」配置外部定时访问，再到「邮件通知」配置 SMTP。');
        return c.redirect(cpUrl('dashboard'));
      }
    } else await getSession(c);
    return c.html(await authPage(c, '安装 CronPro', err, true));
  }

  if (p === 'logout') { logout(c); return c.redirect(cpUrl('login')); }

  if (p === 'login') {
    let err = '';
    if (method === 'POST') {
      const f = await c.req.parseBody();
      const ip = clientIp(c);
      const rec = (await one('SELECT * FROM login_attempts WHERE ip = ?', [ip])) || { fails: 0, lock_until: 0 };
      if (!(await csrfOk(c, f))) err = '请求已过期，请刷新页面后重试';
      else if (Number(rec.lock_until) > now()) err = `尝试次数过多，请 ${Math.ceil((rec.lock_until - now()) / 60)} 分钟后再试`;
      else if (String(f.user || '') === setting('admin_user') && (await bcrypt.compare(String(f.pass || ''), normalizeHash(setting('admin_pass'))))) {
        await run('DELETE FROM login_attempts WHERE ip = ?', [ip]);
        await login(c, setting('admin_user'), !!f.remember);
        await settingSet('base_url', new URL(c.req.url).origin + '/');
        return c.redirect(cpUrl('dashboard'));
      } else {
        const fails = Number(rec.fails) + 1;
        const lock = fails >= 5 ? now() + 600 : 0;
        await run('INSERT OR REPLACE INTO login_attempts (ip, fails, lock_until, updated_at) VALUES (?,?,?,?)', [ip, lock ? 0 : fails, lock, now()]);
        err = '用户名或密码错误';
      }
    } else await getSession(c);
    if (setting('pseudo_cron', '1') === '1') background(tickIfDue('visit'));
    return c.html(await authPage(c, '登录', err, false));
  }

  if (!(await isLoggedIn(c))) {
    if (a) return c.json({ ok: false, error: '登录已过期，请刷新页面' }, 401);
    return c.redirect(cpUrl('login'));
  }

  if (a) {
    if (method === 'GET') {
      const r = await handleGetAction(c, a);
      if (r) return r;
      return c.redirect(cpUrl('dashboard'));
    }
    return handlePostAction(c, a);
  }

  let html;
  switch (p) {
    case 'jobs': html = await pageJobs(c); break;
    case 'edit': html = await pageEdit(c); break;
    case 'job': html = await pageJob(c); break;
    case 'logs': html = await pageLogs(c); break;
    case 'mails': html = await pageMails(c); break;
    case 'settings': html = await pageSettings(c); break;
    default: html = await pageDashboard(c);
  }
  if (html === null) { flash(c, '任务不存在', 'bad'); return c.redirect(cpUrl('jobs')); }
  if (setting('pseudo_cron', '1') === '1') background(tickIfDue('visit'));
  return c.html(html);
}
app.all('/', adminHandler);
app.all('/index.php', adminHandler);
app.all('/api', adminHandler);

app.notFound((c) => c.text('Not Found', 404));
app.onError((e, c) => {
  console.error('[cronpro]', e);
  return c.html(messagePage('服务器错误：' + (e.message || e)), 500);
});

export default app;
