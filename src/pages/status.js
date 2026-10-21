/* 公共状态页：展示各任务近 30 天可用率（不暴露网址） */
import { all } from '../db.js';
import { h, now, dt, fmtTime } from '../util.js';
import { setting } from '../settings.js';
import { head } from '../view.js';

export async function pageStatus() {
  const jobs = await all('SELECT id, title, group_name, last_ok, enabled FROM jobs WHERE enabled = 1 ORDER BY group_name, title');
  const since = Math.floor(dt(now()).startOf('day').toSeconds()) - 29 * 86400;
  const rows = await all('SELECT job_id, CAST((started_at - ?) / 86400 AS INTEGER) d, COUNT(*) n, SUM(ok) ok FROM logs WHERE started_at >= ? GROUP BY job_id, d', [since, since]);
  const byJob = {};
  for (const r of rows) (byJob[r.job_id] ||= []).push(r);
  let allOk = true;
  for (const j of jobs) {
    const days = Array(30).fill(null);
    let n = 0, ok = 0;
    for (const r of byJob[j.id] || []) {
      const d = Number(r.d);
      if (d >= 0 && d < 30) days[d] = { n: Number(r.n), ok: Number(r.ok) };
      n += Number(r.n); ok += Number(r.ok);
    }
    j.days = days;
    j.uptime = n ? Math.round(ok / n * 10000) / 100 : null;
    if (Number(j.last_ok) === 0) allOk = false;
  }
  const title = setting('status_title', '服务状态');
  return `${head(title).replace('</head>', '<meta http-equiv="refresh" content="120"></head>')}<body class="status-page">
<div class="sp-wrap">
  <header><img src="/assets/logo.svg" alt="" width="40"><h1>${h(title)}</h1></header>
  <div class="sp-banner ${allOk ? 'ok' : 'bad'}">${allOk ? '所有服务运行正常' : '部分服务出现异常'}<small>更新于 ${fmtTime(now())}</small></div>
  <div class="card">
  ${jobs.length ? '' : '<div class="empty">暂无公开的服务</div>'}
  ${jobs.map((j) => `<div class="sp-item">
      <div class="sp-top"><b>${h(j.title)}</b><span>${j.uptime === null ? '—' : j.uptime + '%'} <i class="dot ${Number(j.last_ok) === 0 ? 'bad' : 'ok'}"></i></span></div>
      <div class="strip days">${j.days.map((d, i) => {
        const cls = d === null ? 'e' : d.ok === d.n ? 'g' : d.ok / d.n >= 0.9 ? 'y' : 'r';
        const tip = dt(since + i * 86400).toFormat('LL-dd') + (d ? ` · ${Math.round(d.ok / d.n * 1000) / 10}% (${d.n} 次)` : ' · 无数据');
        return `<i class="${cls}" title="${h(tip)}"></i>`;
      }).join('')}</div>
      <div class="sp-axis"><span>30 天前</span><span>今天</span></div>
    </div>`).join('')}
  </div>
  <p class="muted center">Powered by CronPro</p>
</div>
</body></html>`;
}
