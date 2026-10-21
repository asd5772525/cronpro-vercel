/**
 * 任务执行器：找到到点任务 → 并发请求 → 判定结果 → 写日志 → 失败/恢复邮件通知
 * 适配 Serverless：用数据库租约代替文件锁，逐个"认领"任务防止多实例重复执行。
 */
import { Agent, fetch as ufetch } from 'undici';
import dns from 'node:dns/promises';
import net from 'node:net';
import { all, run, one } from './db.js';
import { setting, settingSet, isInstalled, event } from './settings.js';
import { jobGet } from './jobs.js';
import { jobNextRun } from './cron-expr.js';
import { sendMail } from './mailer.js';
import { h, now, fmtMs, fmtTime, codeMatches, cutBytes, parseEmails, sleep, dt } from './util.js';

const MAX_BODY = 1024 * 1024; // 最多读取 1MB 响应用于判定
const agents = { verify: new Agent({ connect: { rejectUnauthorized: true } }), insecure: new Agent({ connect: { rejectUnauthorized: false } }) };
// 单次调度的时间预算（秒），需小于 vercel.json 中的 maxDuration
const BUDGET = Number(process.env.TICK_BUDGET_SECONDS || 50);

/** 伪 Cron：访问页面时调用，按 tick_interval 节流 */
export async function tickIfDue(source = 'visit') {
  if (!isInstalled() || setting('pseudo_cron', '1') !== '1') return null;
  const interval = Math.max(5, Number(setting('tick_interval', '30')) || 30);
  if (now() - Number(setting('last_tick', '0')) < interval) return null;
  return tick(source);
}

async function acquireLock(seconds) {
  await run("INSERT OR IGNORE INTO settings (k, v) VALUES ('tick_lock', '0')");
  const t = now();
  const r = await run("UPDATE settings SET v = ? WHERE k = 'tick_lock' AND CAST(v AS INTEGER) < ?", [String(t + seconds), t]);
  return r.rowsAffected === 1;
}
async function releaseLock() {
  await run("UPDATE settings SET v = '0' WHERE k = 'tick_lock'");
}

/** 立即检查并运行所有到点任务 */
export async function tick(source = 'cron') {
  if (!(await acquireLock(BUDGET + 20))) return { skipped: '已有执行进程在运行' };
  const started = Date.now();
  try {
    const t = now();
    await settingSet('last_tick', t);
    await settingSet('last_tick_source', source);
    const limit = Math.max(1, Number(setting('max_per_tick', '50')) || 50);

    await run('UPDATE jobs SET enabled = 0, next_run = 0 WHERE enabled = 1 AND expires_at > 0 AND expires_at < ?', [t]);

    const due = await all(`SELECT * FROM jobs WHERE enabled = 1 AND next_run > 0 AND next_run <= ? ORDER BY next_run ASC LIMIT ${limit}`, [t]);
    const jobs = [];
    for (const j of due) {
      // 条件更新 = 原子认领；错过多次的只补跑一次
      const r = await run('UPDATE jobs SET next_run = ? WHERE id = ? AND next_run = ?', [jobNextRun(j.cron, j.tz, t), j.id, j.next_run]);
      if (r.rowsAffected === 1) jobs.push({ ...j, _scheduled: Number(j.next_run) });
    }
    const results = jobs.length ? await runJobs(jobs, 'auto', started + BUDGET * 1000) : {};
    await cleanup();
    return { ran: Object.keys(results).length, results };
  } finally {
    await releaseLock();
  }
}

/** 运行指定任务（含重试），返回 { [id]: result } */
export async function runJobs(jobs, trigger = 'auto', deadline = Date.now() + BUDGET * 1000) {
  const parallel = Math.max(1, Number(setting('max_parallel', '5')) || 5);
  const final = {};
  let pending = jobs.map((job) => ({ job, attempt: 1 }));
  while (pending.length) {
    const next = [];
    for (let i = 0; i < pending.length; i += parallel) {
      const chunk = pending.slice(i, i + parallel);
      const res = await Promise.all(chunk.map((it) => request(it.job, deadline)));
      for (let k = 0; k < chunk.length; k++) {
        const { job, attempt } = chunk[k];
        const r = res[k];
        if (trigger !== 'test') await writeLog(job, r, trigger, attempt);
        const canRetry = Date.now() + 5000 < deadline;
        if (!r.ok && attempt <= Number(job.retries || 0) && canRetry) { next.push({ job, attempt: attempt + 1 }); continue; }
        final[job.id] = { ...r, title: job.title, attempts: attempt };
        if (trigger !== 'test') await afterRun(job, r);
      }
    }
    pending = next;
    if (pending.length) await sleep(2000);
  }
  return final;
}

/** URL/请求体支持变量：{timestamp} {date} {datetime} {rand} */
export function expandVars(s) {
  const d = dt(now());
  return String(s ?? '')
    .split('{timestamp}').join(String(now()))
    .split('{date}').join(d.toFormat('yyyy-LL-dd'))
    .split('{datetime}').join(d.toFormat('yyyy-LL-dd HH:mm:ss'))
    .split('{rand}').join(String(100000 + Math.floor(Math.random() * 900000)));
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
}

async function checkTarget(url) {
  if (setting('block_private', '1') !== '1') return '';
  let host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { return '网址无效'; }
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) return `目标 ${host} 解析到内网/保留地址，已拦截（可在系统设置中关闭“拦截内网地址”）`;
  } catch (e) {
    return `DNS 解析失败：${e.code || e.message}`;
  }
  return '';
}

async function request(job, deadline) {
  const method = String(job.method || 'GET').toUpperCase();
  const url = expandVars(job.url);
  const headers = {};
  for (const line of String(job.headers || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (job.content_type && hasBody) headers['Content-Type'] = job.content_type;
  headers['X-Cron-Job'] = String(job.id || 0);
  headers['User-Agent'] = job.user_agent || setting('default_ua', 'CronPro/2.0');
  if (job.auth_user) headers.Authorization = 'Basic ' + Buffer.from(`${job.auth_user}:${job.auth_pass || ''}`).toString('base64');

  const remain = Math.max(1000, deadline - Date.now() - 2000);
  const timeoutMs = Math.min(Math.max(1, Math.min(600, Number(job.timeout) || 30)) * 1000, remain);
  const t0 = performance.now();
  const blocked = await checkTarget(url);
  if (blocked) return { ...judgeErr(blocked, 0), headers: '', body: '', url, size: 0 };

  try {
    const res = await ufetch(url, {
      method,
      headers,
      body: hasBody && job.body ? expandVars(job.body) : undefined,
      redirect: Number(job.follow_redirects) ? 'follow' : 'manual',
      dispatcher: Number(job.ssl_verify) ? agents.verify : agents.insecure,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = '';
    let size = 0;
    if (method !== 'HEAD' && res.body) {
      const chunks = [];
      for await (const c of res.body) {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
        else break;
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    const ms = Math.round(performance.now() - t0);
    const hdr = [`HTTP/1.1 ${res.status} ${res.statusText}`];
    res.headers.forEach((v, k) => hdr.push(`${k}: ${v}`));
    const r = judge(job, res.status, body, ms);
    return { ...r, headers: hdr.join('\n'), body, url: res.url || url, size };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    let msg = e.name === 'TimeoutError' || e.name === 'AbortError' ? `请求超时（${Math.round(timeoutMs / 1000)} 秒）` : (e.cause?.code || e.cause?.message || e.message || String(e));
    return { ...judgeErr('网络错误：' + msg, ms), headers: '', body: '', url, size: 0 };
  }
}

function judgeErr(error, ms) {
  return { ok: 0, code: 0, ms, error };
}

export function judge(job, code, body, ms) {
  if (!codeMatches(code, job.expect_codes)) return { ok: 0, code, ms, error: `HTTP 状态码 ${code} 不在期望范围（${job.expect_codes}）` };
  if (job.keyword) {
    const has = body.toLowerCase().includes(String(job.keyword).toLowerCase());
    if (job.keyword_mode === 'contains' && !has) return { ok: 0, code, ms, error: `响应中未找到关键字「${job.keyword}」` };
    if (job.keyword_mode === 'not_contains' && has) return { ok: 0, code, ms, error: `响应中出现了禁止的关键字「${job.keyword}」` };
  }
  if (Number(job.max_ms) > 0 && ms > Number(job.max_ms)) return { ok: 0, code, ms, error: `响应过慢：${ms} ms，超过上限 ${job.max_ms} ms` };
  return { ok: 1, code, ms, error: '' };
}

async function writeLog(job, r, trigger, attempt) {
  const body = Number(job.save_body) ? cutBytes(r.body, 8192) : '';
  await run(`INSERT INTO logs (job_id, started_at, scheduled_at, duration_ms, http_code, ok, error, trigger_by, attempt, req_url, resp_headers, resp_body, resp_size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    job.id, now() - Math.round(r.ms / 1000), job._scheduled || 0, r.ms, r.code, r.ok,
    r.error, trigger, attempt, r.url, cutBytes(r.headers, 4096), body, r.size,
  ]);
}

/** 更新任务状态 + 通知 */
async function afterRun(job, r) {
  const fresh = await jobGet(job.id);
  if (!fresh) return;
  const t = now();
  const fails = r.ok ? 0 : Number(fresh.fail_count) + 1;
  let enabled = Number(fresh.enabled);
  let alertedAt = Number(fresh.alerted_at);
  const emails = String(fresh.notify_emails || '').trim() || setting('default_emails');

  if (!r.ok) {
    const threshold = Math.max(1, Number(fresh.fail_threshold));
    const repeat = Number(fresh.notify_repeat_hours);
    const should = Number(fresh.notify_fail) && fails >= threshold && (alertedAt === 0 || (repeat > 0 && t - alertedAt >= repeat * 3600));
    const disable = Number(fresh.auto_disable) > 0 && fails >= Number(fresh.auto_disable);
    if (disable) { enabled = 0; await event('disable', `任务 #${fresh.id}「${fresh.title}」连续失败 ${fails} 次，已自动停用`); }
    if (should) { await notify(fresh, r, 'fail', fails, disable, emails); alertedAt = t; }
  } else {
    if (alertedAt > 0 && Number(fresh.notify_recover)) await notify(fresh, r, 'recover', Number(fresh.fail_count), false, emails);
    alertedAt = 0;
  }
  await run(`UPDATE jobs SET last_run=?, last_ok=?, last_code=?, last_ms=?, last_error=?, fail_count=?, alerted_at=?, enabled=?,
    next_run = CASE WHEN ? THEN next_run ELSE 0 END, total_runs = total_runs + 1, total_fails = total_fails + ? WHERE id = ?`,
  [t, r.ok, r.code, r.ms, r.error, fails, alertedAt, enabled, enabled ? 1 : 0, r.ok ? 0 : 1, fresh.id]);
}

export async function notify(job, r, type, fails, disabled, emails) {
  const list = parseEmails(emails);
  if (!list.length) return false;
  const site = setting('site_name', 'CronPro');
  const prefix = setting('mail_subject_prefix', '[CronPro]');
  const base = setting('base_url');
  const link = base ? base.replace(/\/+$/, '') + '/?p=job&id=' + job.id : '';
  const isFail = type === 'fail';
  const subject = isFail ? `${prefix} 任务失败：${job.title}` : `${prefix} 任务已恢复：${job.title}`;
  const color = isFail ? '#d64545' : '#1f9d6b';
  const head = isFail ? '定时任务执行失败' : '定时任务已恢复正常';
  const rows = {
    任务: `#${job.id} ${job.title}`,
    地址: `${job.method} ${job.url}`,
    时间: fmtTime(now(), true),
    'HTTP 状态码': r.code || '无响应',
    耗时: fmtMs(r.ms),
  };
  if (isFail) {
    rows['失败原因'] = r.error;
    rows['连续失败'] = fails + ' 次';
    if (disabled) rows['处理'] = '已达到自动停用阈值，任务已停用';
  } else rows['此前连续失败'] = fails + ' 次';
  const tr = Object.entries(rows).map(([k, v]) => `<tr><td style="padding:8px 12px;color:#667085;white-space:nowrap;border-bottom:1px solid #eef0f3">${h(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef0f3;word-break:break-all">${h(v)}</td></tr>`).join('');
  const snippet = isFail && r.body ? `<p style="margin:18px 0 6px;color:#667085;font-size:13px">响应内容（前 600 字）</p><pre style="background:#f6f7f9;border-radius:8px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-all">${h(String(r.body).slice(0, 600))}</pre>` : '';
  const btn = link ? `<p style="margin-top:20px"><a href="${h(link)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">查看任务详情</a></p>` : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828">`
    + `<div style="border-left:4px solid ${color};padding-left:14px"><div style="font-size:13px;color:#667085">${h(site)}</div><h2 style="margin:4px 0 0;font-size:20px;color:${color}">${head}</h2></div>`
    + `<table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:14px">${tr}</table>${snippet}${btn}`
    + `<p style="margin-top:24px;font-size:12px;color:#98a2b3">此邮件由 CronPro 自动发送。可在任务设置中调整通知规则。</p></div>`;
  const m = await sendMail(list, subject, html);
  await run('INSERT INTO mail_log (job_id, sent_at, recipients, subject, ok, error) VALUES (?,?,?,?,?,?)', [job.id, now(), list.join(', '), subject, m.ok ? 1 : 0, m.ok ? '' : m.error]);
  if (!m.ok) await event('mail', '通知邮件发送失败：' + m.error);
  return m.ok;
}

/** 每天清理一次过期日志 */
export async function cleanup() {
  if (now() - Number(setting('last_cleanup', '0')) < 86400) return;
  await settingSet('last_cleanup', now());
  const days = Math.max(1, Number(setting('log_retention_days', '30')) || 30);
  const cut = now() - days * 86400;
  await run('DELETE FROM logs WHERE started_at < ?', [cut]);
  await run('DELETE FROM mail_log WHERE sent_at < ?', [cut]);
  await run('DELETE FROM events WHERE at < ?', [cut]);
  await run('DELETE FROM login_attempts WHERE updated_at < ?', [now() - 86400]);
}

export { one };
