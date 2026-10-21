import bcrypt from 'bcryptjs';
import { all, run, one } from './db.js';
import { h, now, int, clamp, parseEmails, isValidTz, fmtTime, fmtMs, cutBytes, dt } from './util.js';
import { setting, settingSet, randomHex } from './settings.js';
import { CronExpr, jobNextRun } from './cron-expr.js';
import { JOB_COLUMNS, JOB_DEFAULTS, jobGet, jobSave } from './jobs.js';
import { runJobs, tick, expandVars } from './runner.js';
import { sendMail } from './mailer.js';
import { csrfOk, flash, login } from './auth.js';
import { cpUrl, logDetailHtml } from './view.js';
import { pageEdit } from './pages/jobs.js';
import { DateTime } from 'luxon';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function jobFromForm(f) {
  const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(str(f.method)) ? str(f.method) : 'GET';
  const exp = str(f.expires_at);
  let expiresAt = 0;
  if (exp) {
    const d = DateTime.fromISO(exp, { zone: setting('timezone', 'Asia/Shanghai') });
    expiresAt = d.isValid ? Math.floor(d.toSeconds()) : 0;
  }
  return {
    title: str(f.title).slice(0, 120),
    url: str(f.url),
    method,
    headers: str(f.headers),
    body: str(f.body),
    content_type: str(f.content_type),
    timeout: clamp(int(f.timeout, 30), 1, 600),
    cron: str(f.cron).replace(/\s+/g, ' '),
    tz: str(f.tz) || 'Asia/Shanghai',
    enabled: f.enabled ? 1 : 0,
    group_name: str(f.group_name).slice(0, 40),
    expect_codes: str(f.expect_codes) || '200-399',
    keyword: str(f.keyword),
    keyword_mode: str(f.keyword_mode) === 'not_contains' ? 'not_contains' : 'contains',
    max_ms: Math.max(0, int(f.max_ms)),
    auth_user: str(f.auth_user),
    auth_pass: str(f.auth_pass),
    user_agent: str(f.user_agent),
    follow_redirects: f.follow_redirects ? 1 : 0,
    ssl_verify: f.ssl_verify ? 1 : 0,
    retries: clamp(int(f.retries), 0, 5),
    notify_fail: f.notify_fail ? 1 : 0,
    notify_recover: f.notify_recover ? 1 : 0,
    fail_threshold: clamp(int(f.fail_threshold, 1), 1, 100),
    notify_repeat_hours: Math.max(0, int(f.notify_repeat_hours)),
    notify_emails: parseEmails(str(f.notify_emails)).join(', '),
    auto_disable: Math.max(0, int(f.auto_disable)),
    save_body: f.save_body ? 1 : 0,
    expires_at: expiresAt,
    notes: str(f.notes),
  };
}

export function jobValidate(d) {
  const e = [];
  if (!d.title) e.push('请填写任务名称');
  let okUrl = /^https?:\/\//i.test(d.url);
  if (okUrl) { try { new URL(expandVars(d.url)); } catch { okUrl = false; } }
  if (!okUrl) e.push('请输入以 http:// 或 https:// 开头的有效网址');
  if (!CronExpr.isValid(d.cron)) e.push('执行计划（Cron 表达式）无效');
  if (!isValidTz(d.tz)) e.push('时区无效');
  return e;
}

function exportJobs(c, jobs) {
  const out = jobs.map((j) => Object.fromEntries(JOB_COLUMNS.map((k) => [k, j[k]])));
  const name = `cronpro-jobs-${dt(now()).toFormat('yyyyLLdd-HHmmss')}.json`;
  c.header('Content-Disposition', `attachment; filename="${name}"`);
  return c.body(JSON.stringify({ app: 'CronPro', version: '2.0.0', exported_at: dt(now()).toISO(), jobs: out }, null, 2), 200, { 'Content-Type': 'application/json; charset=utf-8' });
}

/** 登录后才能访问的 GET 型 JSON 接口 */
export async function handleGetAction(c, a) {
  const id = int(c.req.query('id'));
  if (a === 'cron_preview') {
    const cron = c.req.query('cron') || '', tz = c.req.query('tz') || 'Asia/Shanghai';
    try {
      const ce = new CronExpr(cron);
      if (!isValidTz(tz)) throw new Error('时区无效');
      const wk = ['日', '一', '二', '三', '四', '五', '六'];
      const list = ce.upcoming(now(), tz, 5).map((t) => { const d = dt(t, tz); return d.toFormat('yyyy-LL-dd HH:mm') + ' 周' + wk[d.weekday % 7]; });
      return c.json({ ok: true, desc: CronExpr.describe(cron), next: list });
    } catch (e) {
      return c.json({ ok: false, error: e.message });
    }
  }
  if (a === 'log_detail') {
    const l = await one('SELECT l.*, j.title FROM logs l LEFT JOIN jobs j ON j.id = l.job_id WHERE l.id = ?', [id]);
    return c.json({ html: l ? logDetailHtml(l) : '<p>记录不存在</p>' });
  }
  if (a === 'status') {
    const rows = await all('SELECT id, enabled, last_ok, last_code, last_ms, last_run, next_run, fail_count FROM jobs');
    return c.json({ now: now(), last_tick: int(setting('last_tick')), jobs: rows });
  }
  return null;
}

/** POST 动作（需 CSRF） */
export async function handlePostAction(c, a) {
  const f = await c.req.parseBody({ all: true });
  if (!(await csrfOk(c, f))) return c.text('请求已过期，请刷新页面后重试。', 400);
  const id = int(c.req.query('id') || f.id);
  const back = c.req.header('referer') || cpUrl('jobs');

  switch (a) {
    case 'save_job': {
      const d = jobFromForm(f);
      const err = jobValidate(d);
      if (err.length) {
        c.set('flashNow', err.map((e) => ['bad', e]));
        return c.html(await pageEdit(c, d));
      }
      const newId = await jobSave(d, id);
      flash(c, id ? '任务已保存' : '任务已创建' + (d.enabled ? '，下次执行：' + fmtTime(jobNextRun(d.cron, d.tz)) : ''));
      return c.redirect(f.after === 'new' ? cpUrl('edit') : cpUrl('job', { id: newId }));
    }
    case 'test': {
      const d = jobFromForm(f);
      const err = jobValidate(d);
      if (err.length) return c.json({ ok: false, error: err.join('；') });
      d.id = id || 0; d.retries = 0;
      const res = await runJobs([d], 'test');
      const r = Object.values(res)[0];
      return c.json({ ok: true, html: logDetailHtml({
        title: d.title + '（测试）', started_at: now(), duration_ms: r.ms, http_code: r.code, ok: r.ok,
        error: r.error, trigger_by: 'test', attempt: 1, req_url: r.url, resp_headers: r.headers,
        resp_body: cutBytes(r.body, 8192), resp_size: r.size, scheduled_at: 0,
      }) });
    }
    case 'run': {
      const job = await jobGet(id);
      if (!job) return c.json({ ok: false, error: '任务不存在' });
      const r = Object.values(await runJobs([job], 'manual'))[0];
      return c.json({ ok: true, result: { ok: r.ok, code: r.code, ms: fmtMs(r.ms), error: r.error } });
    }
    case 'toggle': {
      const job = await jobGet(id);
      if (job) {
        const en = Number(job.enabled) ? 0 : 1;
        await run('UPDATE jobs SET enabled = ?, next_run = ?, fail_count = CASE WHEN ? THEN 0 ELSE fail_count END WHERE id = ?',
          [en, en ? jobNextRun(job.cron, job.tz) : 0, en, id]);
        flash(c, en ? `已启用「${job.title}」` : `已停用「${job.title}」`);
      }
      return c.redirect(back);
    }
    case 'clone': {
      const job = await jobGet(id);
      if (!job) return c.redirect(back);
      const d = Object.fromEntries(JOB_COLUMNS.map((k) => [k, job[k]]));
      d.title += ' (副本)'; d.enabled = 0;
      const nid = await jobSave(d);
      flash(c, '已复制为新任务（默认停用）');
      return c.redirect(cpUrl('edit', { id: nid }));
    }
    case 'delete':
      await run('DELETE FROM jobs WHERE id = ?', [id]);
      await run('DELETE FROM logs WHERE job_id = ?', [id]);
      flash(c, '任务已删除');
      return c.redirect(cpUrl('jobs'));
    case 'bulk': {
      let ids = f['ids[]'] ?? [];
      ids = (Array.isArray(ids) ? ids : [ids]).map((x) => int(x)).filter(Boolean);
      const op = str(f.op);
      if (!ids.length) { flash(c, '请先勾选任务', 'bad'); return c.redirect(back); }
      const ph = ids.map(() => '?').join(',');
      if (op === 'enable') {
        for (const i of ids) { const j = await jobGet(i); if (j) await run('UPDATE jobs SET enabled=1, fail_count=0, next_run=? WHERE id=?', [jobNextRun(j.cron, j.tz), i]); }
        flash(c, `已启用 ${ids.length} 个任务`);
      } else if (op === 'disable') {
        await run(`UPDATE jobs SET enabled=0, next_run=0 WHERE id IN (${ph})`, ids);
        flash(c, `已停用 ${ids.length} 个任务`);
      } else if (op === 'run') {
        const jobs = await all(`SELECT * FROM jobs WHERE id IN (${ph})`, ids);
        const res = Object.values(await runJobs(jobs, 'manual'));
        const ok = res.filter((r) => r.ok).length;
        flash(c, `已执行 ${res.length} 个任务：成功 ${ok}，失败 ${res.length - ok}`, ok === res.length ? 'ok' : 'bad');
      } else if (op === 'delete') {
        await run(`DELETE FROM jobs WHERE id IN (${ph})`, ids);
        await run(`DELETE FROM logs WHERE job_id IN (${ph})`, ids);
        flash(c, `已删除 ${ids.length} 个任务`);
      } else if (op === 'export') {
        return exportJobs(c, await all(`SELECT * FROM jobs WHERE id IN (${ph})`, ids));
      }
      return c.redirect(back);
    }
    case 'clear_logs':
      if (id) {
        await run('DELETE FROM logs WHERE job_id = ?', [id]);
        await run('UPDATE jobs SET total_runs=0, total_fails=0 WHERE id=?', [id]);
      } else {
        await run('DELETE FROM logs');
        await run('UPDATE jobs SET total_runs=0, total_fails=0');
      }
      flash(c, '执行记录已清空');
      return c.redirect(back);
    case 'save_settings': {
      const sec = str(f.section);
      const fields = {
        general: ['site_name', 'timezone', 'max_parallel', 'max_per_tick', 'log_retention_days', 'default_ua', 'status_public', 'status_title', 'base_url', 'block_private'],
        trigger: ['pseudo_cron', 'tick_interval'],
        mail: ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'mail_from', 'mail_from_name', 'default_emails', 'mail_subject_prefix'],
      };
      if (!fields[sec]) return c.redirect(back);
      for (const k of fields[sec]) {
        let v = str(f[k]);
        if (['pseudo_cron', 'status_public', 'block_private'].includes(k)) v = f[k] ? '1' : '0';
        if (k === 'timezone' && !isValidTz(v)) continue;
        if (k === 'default_emails') v = parseEmails(v).join(', ');
        if (k === 'tick_interval') v = Math.max(5, int(v, 30));
        if (k === 'max_parallel') v = clamp(int(v, 5), 1, 30);
        if (k === 'max_per_tick') v = Math.max(1, int(v, 50));
        if (k === 'log_retention_days') v = Math.max(1, int(v, 30));
        await settingSet(k, v);
      }
      if (sec === 'mail' && str(f.smtp_pass) !== '') await settingSet('smtp_pass', str(f.smtp_pass));
      if (sec === 'general') {
        for (const j of await all('SELECT id, cron, tz FROM jobs WHERE enabled = 1')) await run('UPDATE jobs SET next_run=? WHERE id=?', [jobNextRun(j.cron, j.tz), j.id]);
      }
      flash(c, '设置已保存');
      return c.redirect(cpUrl('settings', { tab: sec }));
    }
    case 'mail_test': {
      const to = str(f.to) || setting('default_emails');
      const m = await sendMail(to, setting('mail_subject_prefix', '[CronPro]') + ' 测试邮件',
        `<div style="font-family:sans-serif;padding:20px"><h2 style="color:#2563eb">邮件配置成功 ✓</h2><p>这是来自 <b>${h(setting('site_name'))}</b> 的测试邮件，任务失败时你会收到类似的告警。</p><p style="color:#888">${fmtTime(now(), true)}</p></div>`);
      await run('INSERT INTO mail_log (job_id, sent_at, recipients, subject, ok, error) VALUES (0,?,?,?,?,?)', [now(), String(to), '测试邮件', m.ok ? 1 : 0, m.ok ? '' : m.error]);
      return c.json({ ok: m.ok, error: m.error, debug: m.debug || '' });
    }
    case 'password': {
      const back2 = cpUrl('settings', { tab: 'account' });
      if (!(await bcrypt.compare(str(f.old), normalizeHash(setting('admin_pass'))))) { flash(c, '原密码错误', 'bad'); return c.redirect(back2); }
      if (str(f.new).length < 8 || str(f.new) !== str(f.new2)) { flash(c, '新密码至少 8 位且两次一致', 'bad'); return c.redirect(back2); }
      if (str(f.user)) await settingSet('admin_user', str(f.user));
      await settingSet('admin_pass', await bcrypt.hash(str(f.new), 10));
      await login(c, setting('admin_user'), false); // 当前设备保持登录，其他设备失效
      flash(c, '账号信息已更新');
      return c.redirect(back2);
    }
    case 'regen_key':
      await settingSet('cron_key', randomHex(16));
      flash(c, '触发密钥已重新生成，请同步更新外部定时访问地址');
      return c.redirect(cpUrl('settings', { tab: 'trigger' }));
    case 'tick': {
      const res = await tick('manual');
      if (res.skipped) flash(c, res.skipped, 'bad');
      else flash(c, `调度完成，本次执行了 ${res.ran} 个到点任务`);
      return c.redirect(back);
    }
    case 'export':
      return exportJobs(c, await all('SELECT * FROM jobs ORDER BY id'));
    case 'import': {
      let data = null;
      try { data = JSON.parse(await f.file.text()); } catch {}
      if (!data || !Array.isArray(data.jobs)) { flash(c, '导入失败：文件不是有效的 CronPro 导出文件', 'bad'); return c.redirect(cpUrl('settings', { tab: 'data' })); }
      let n = 0;
      for (const j of data.jobs) {
        const d = {};
        for (const k of JOB_COLUMNS) d[k] = j[k] === undefined || j[k] === null || j[k] === '' ? JOB_DEFAULTS[k] : j[k];
        for (const k of ['timeout', 'enabled', 'follow_redirects', 'ssl_verify', 'retries', 'notify_fail', 'notify_recover', 'fail_threshold', 'notify_repeat_hours', 'auto_disable', 'save_body', 'expires_at', 'max_ms']) d[k] = int(d[k], JOB_DEFAULTS[k]);
        if (j.enabled === undefined) d.enabled = 0;
        if (!d.title || !d.url || !CronExpr.isValid(d.cron) || !isValidTz(d.tz)) continue;
        await jobSave(d); n++;
      }
      flash(c, `已导入 ${n} 个任务`);
      return c.redirect(cpUrl('jobs'));
    }
    case 'add_quick': {
      let url = str(f.url);
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
      let host = url;
      try { host = new URL(url).host; } catch {}
      const d = { ...JOB_DEFAULTS, title: str(f.title) || host, url, cron: str(f.cron) || '*/5 * * * *', tz: setting('timezone', 'Asia/Shanghai') };
      const err = jobValidate(d);
      if (err.length) { err.forEach((e) => flash(c, e, 'bad')); return c.redirect(back); }
      const nid = await jobSave(d);
      flash(c, '任务已创建，下次执行：' + fmtTime(jobNextRun(d.cron, d.tz)));
      return c.redirect(cpUrl('job', { id: nid }));
    }
  }
  return c.redirect(back);
}

/** PHP password_hash 生成的 $2y$ 与 bcryptjs 的 $2a$/$2b$ 算法相同 */
export function normalizeHash(hash) {
  return String(hash || '').replace(/^\$2y\$/, '$2b$');
}
