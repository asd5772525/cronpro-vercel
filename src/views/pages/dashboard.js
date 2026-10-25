import { all, one } from '../../lib/db.js';
import { h, now, fmtMs, fmtRel, fmtTime, strimwidth, dt } from '../../lib/util.js';
import { mailConfig } from '../../lib/settings.js';
import { CronExpr } from '../../lib/cron-expr.js';
import { layout, cpUrl, actUrl, csrfField, icon, chartHours } from '../layout.js';

export async function pageDashboard(c) {
  const t = now();
  const start = t - (t % 3600) - 23 * 3600;
  const [cnt, s24, hourly, upcoming, fails, events] = await Promise.all([
    one('SELECT COUNT(*) n, SUM(enabled) en, SUM(CASE WHEN enabled=1 AND last_ok=0 THEN 1 ELSE 0 END) bad FROM jobs'),
    one('SELECT COUNT(*) n, SUM(ok) ok, AVG(duration_ms) avgms FROM logs WHERE started_at > ?', [t - 86400]),
    all('SELECT CAST((started_at - ?) / 3600 AS INTEGER) AS b, SUM(ok) ok, COUNT(*) - SUM(ok) fail FROM logs WHERE started_at >= ? GROUP BY b', [start, start]),
    all('SELECT id, title, cron, next_run, url FROM jobs WHERE enabled=1 AND next_run>0 ORDER BY next_run LIMIT 8'),
    all('SELECT l.id, l.job_id, l.started_at, l.http_code, l.error, j.title FROM logs l JOIN jobs j ON j.id=l.job_id WHERE l.ok=0 ORDER BY l.id DESC LIMIT 8'),
    all('SELECT * FROM events ORDER BY id DESC LIMIT 5'),
  ]);
  const rate = Number(s24.n) ? Math.round(Number(s24.ok) / Number(s24.n) * 1000) / 10 : null;
  const buckets = {};
  const keys = [];
  for (let i = 0; i < 24; i++) { const k = dt(start + i * 3600).toFormat('LL-dd HH'); keys.push(k); buckets[k] = { ok: 0, fail: 0 }; }
  for (const r of hourly) { const k = keys[Number(r.b)]; if (k) buckets[k] = { ok: Number(r.ok), fail: Number(r.fail) }; }
  const mailOk = !!mailConfig().smtp_host;
  const bad = Number(cnt.bad) || 0;

  const html = `
<div class="page-head">
  <div><h1>概览</h1><p class="muted">按 Cron 计划访问你登记的网址，失败时邮件通知。</p></div>
  <div class="actions">
    <form method="post" action="${actUrl('tick')}">${await csrfField(c)}<button class="btn">${icon('pulse')}立即调度</button></form>
    <a class="btn primary" href="${cpUrl('edit')}">${icon('plus')}新建任务</a>
  </div>
</div>
${mailOk ? '' : `<div class="flash warn">还没有配置发件邮箱，任务失败时无法发送通知。<a href="${cpUrl('settings', { tab: 'mail' })}">去配置 →</a></div>`}
<form class="quick card" method="post" action="${actUrl('add_quick')}">
  ${await csrfField(c)}
  <strong>快速添加</strong>
  <input name="url" placeholder="https://example.com/cron.php" required>
  <select name="cron">
    <option value="* * * * *">每分钟</option><option value="*/5 * * * *" selected>每 5 分钟</option><option value="*/15 * * * *">每 15 分钟</option>
    <option value="*/30 * * * *">每 30 分钟</option><option value="0 * * * *">每小时</option><option value="0 3 * * *">每天 03:00</option>
  </select>
  <button class="btn primary">添加</button>
</form>
<div class="stats">
  <div class="stat"><span>任务总数</span><b>${Number(cnt.n)}</b><small>${Number(cnt.en) || 0} 个启用中</small></div>
  <div class="stat ${bad ? 'bad' : ''}"><span>当前失败</span><b>${bad}</b><small>${bad ? '需要关注' : '一切正常'}</small></div>
  <div class="stat"><span>24 小时执行</span><b>${Number(s24.n)}</b><small>平均 ${fmtMs(s24.avgms)}</small></div>
  <div class="stat ${rate !== null && rate < 95 ? 'bad' : 'ok'}"><span>24 小时成功率</span><b>${rate === null ? '—' : rate + '%'}</b><small>${Number(s24.n) - (Number(s24.ok) || 0)} 次失败</small></div>
</div>
<div class="card">
  <div class="card-head"><h2>最近 24 小时</h2><span class="legend"><i class="g"></i>成功 <i class="r"></i>失败</span></div>
  ${chartHours(buckets)}
</div>
<div class="grid2">
  <div class="card">
    <div class="card-head"><h2>即将执行</h2><a href="${cpUrl('jobs')}">全部任务</a></div>
    ${upcoming.length ? '' : '<div class="empty">暂无启用的任务</div>'}
    <ul class="rows">
    ${upcoming.map((u) => `<li><a href="${cpUrl('job', { id: u.id })}"><b>${h(u.title)}</b><small>${h(CronExpr.describe(u.cron))}</small></a>
        <span class="cd" data-at="${Number(u.next_run)}">${fmtRel(u.next_run)}</span></li>`).join('')}
    </ul>
  </div>
  <div class="card">
    <div class="card-head"><h2>最近失败</h2><a href="${cpUrl('logs', { status: 'fail' })}">查看全部</a></div>
    ${fails.length ? '' : '<div class="empty">没有失败记录 🎉</div>'}
    <ul class="rows">
    ${fails.map((f) => `<li><a href="#" data-log="${Number(f.id)}"><b>${h(f.title)}</b><small class="err">${h(strimwidth(f.error, 70))}</small></a>
        <span class="muted">${fmtRel(f.started_at)}</span></li>`).join('')}
    </ul>
  </div>
</div>
${events.length ? `<div class="card"><div class="card-head"><h2>系统事件</h2></div><ul class="rows">
  ${events.map((e) => `<li><span>${h(e.msg)}</span><span class="muted">${fmtTime(e.at)}</span></li>`).join('')}
</ul></div>` : ''}`;
  return layout(c, '概览', 'dashboard', html);
}
