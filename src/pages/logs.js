import { all, scalar } from '../db.js';
import { h, fmtTime, int } from '../util.js';
import { setting } from '../settings.js';
import { layout, actUrl, csrfField, pager } from '../view.js';
import { logsTable } from './jobs.js';

export async function pageLogs(c) {
  const page = Math.max(1, int(c.req.query('pg'), 1)), per = 50;
  const status = c.req.query('status') || '', job = int(c.req.query('job')), trig = c.req.query('trig') || '';
  const w = ['1=1'], args = [];
  if (status === 'fail') w.push('l.ok = 0');
  if (status === 'ok') w.push('l.ok = 1');
  if (job) { w.push('l.job_id = ?'); args.push(job); }
  if (trig) { w.push('l.trigger_by = ?'); args.push(trig); }
  const where = w.join(' AND ');
  const [total, logs, jobs] = await Promise.all([
    scalar(`SELECT COUNT(*) FROM logs l WHERE ${where}`, args),
    all(`SELECT l.*, j.title FROM logs l LEFT JOIN jobs j ON j.id = l.job_id WHERE ${where} ORDER BY l.id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, args),
    all('SELECT id, title FROM jobs ORDER BY title'),
  ]);
  const s = (a, b) => (String(a) === String(b) ? 'selected' : '');
  const html = `
<div class="page-head"><div><h1>执行记录</h1><p class="muted">保留最近 ${int(setting('log_retention_days', 30))} 天，点击任一行查看响应详情</p></div>
  <div class="actions"><form method="post" action="${actUrl('clear_logs')}">${await csrfField(c)}<button class="btn ghost" data-confirm="清空全部执行记录？">清空全部</button></form></div></div>
<form class="filters" method="get">
  <input type="hidden" name="p" value="logs">
  <select name="job" onchange="this.form.submit()"><option value="">全部任务</option>${jobs.map((jj) => `<option value="${jj.id}" ${s(job, jj.id)}>${h(jj.title)}</option>`).join('')}</select>
  <select name="status" onchange="this.form.submit()"><option value="">全部结果</option><option value="ok" ${s(status, 'ok')}>成功</option><option value="fail" ${s(status, 'fail')}>失败</option></select>
  <select name="trig" onchange="this.form.submit()"><option value="">全部触发方式</option>${Object.entries({ auto: '定时', manual: '手动', api: 'API' }).map(([k, v]) => `<option value="${k}" ${s(trig, k)}>${v}</option>`).join('')}</select>
</form>
<div class="card flush">${logsTable(logs, true)}${pager(Number(total), per, page, 'logs', { status, job: job || '', trig })}</div>`;
  return layout(c, '执行记录', 'logs', html);
}

export async function pageMails(c) {
  const rows = await all('SELECT m.*, j.title FROM mail_log m LEFT JOIN jobs j ON j.id = m.job_id ORDER BY m.id DESC LIMIT 200');
  const html = `
<div class="page-head"><div><h1>通知记录</h1><p class="muted">最近 200 封告警 / 恢复 / 测试邮件</p></div></div>
<div class="card flush">
${!rows.length ? '<div class="empty">还没有发送过邮件</div>' : `<table class="tbl"><thead><tr><th>时间</th><th>主题</th><th class="hide-sm">收件人</th><th>状态</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td class="nowrap">${fmtTime(r.sent_at, true)}</td><td>${h(r.subject)}</td><td class="hide-sm mono ell">${h(r.recipients)}</td>
    <td>${Number(r.ok) ? '<span class="badge ok">已发送</span>' : `<span class="badge bad" title="${h(r.error)}">失败</span><small class="err block">${h(r.error)}</small>`}</td></tr>`).join('')}
</tbody></table>`}
</div>`;
  return layout(c, '通知记录', 'mails', html);
}
