/* 页面布局与小组件 */
import { h, fmtTime, fmtRel, fmtMs, now, VERSION, dt } from '../lib/util.js';
import { setting, getTz } from '../lib/settings.js';
import { csrfToken, takeFlash } from '../lib/auth.js';

export function cpUrl(p = '', q = {}) {
  const params = new URLSearchParams();
  if (p !== '') params.set('p', p);
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return '/' + (s ? '?' + s : '');
}

export function actUrl(a, q = {}) {
  const params = new URLSearchParams({ a, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])) });
  return '/?' + params.toString();
}

export async function csrfField(c) {
  return `<input type="hidden" name="_csrf" value="${h(await csrfToken(c))}">`;
}

const ICONS = {
  dash: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  log: '<path d="M5 4h11l3 3v13H5z M8 10h8 M8 14h8 M8 18h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  cog: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 4.9-.1-2.8 2-1.6-2-3.4-2.4.8-2.3-1.4L15 2.5h-4l-.6 2.5L8 6.4l-2.4-.8-2 3.4 2 1.6-.1 2.8-1.9 1.6 2 3.4 2.4-.8 2.3 1.4.7 2.5h4l.6-2.5 2.3-1.4 2.4.8 2-3.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  copy: '<path d="M9 9h11v11H9z M5 15H4V4h11v1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  mail: '<path d="M3 6h18v12H3z M3 7l9 6 9-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  out: '<path d="M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  globe: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
};

export const icon = (n) => `<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[n] || ''}</svg>`;

export const THEME_JS = `<script>document.documentElement.dataset.theme = localStorage.getItem('cp-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');</script>`;

export function head(title) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title>
<link rel="icon" href="/assets/logo.svg"><link rel="stylesheet" href="/assets/style.css?v=${VERSION}">
${THEME_JS}
</head>`;
}

/** 后台页面整体布局 */
export async function layout(c, title, active, content) {
  const site = setting('site_name', 'CronPro');
  const nav = { dashboard: ['概览', 'dash'], jobs: ['定时任务', 'list'], logs: ['执行记录', 'log'], mails: ['通知记录', 'mail'], settings: ['系统设置', 'cog'] };
  const last = Number(setting('last_tick', '0'));
  const alive = last && now() - last < Math.max(120, 4 * Number(setting('tick_interval', '30')));
  const flashes = [...takeFlash(c), ...(c.get('flashNow') || [])];
  const srcMap = { visit: '访问触发', url: '外部 URL', vercel: 'Vercel Cron', manual: '手动', api: 'API' };
  return `${head(`${title} · ${site}`)}<body>
<div class="shell">
<aside class="side">
  <a class="brand" href="${cpUrl('dashboard')}"><img src="/assets/logo.svg" alt=""><span>${h(site)}</span></a>
  <nav>
  ${Object.entries(nav).map(([k, v]) => `<a href="${cpUrl(k)}" class="${active === k ? 'on' : ''}">${icon(v[1])}<span>${v[0]}</span></a>`).join('')}
  ${setting('status_public') === '1' ? `<a href="/status" target="_blank">${icon('globe')}<span>状态页</span></a>` : ''}
  </nav>
  <div class="side-foot">
    <div class="heart ${alive ? 'ok' : 'warn'}" title="最近一次调度：${fmtTime(last, true)}（${h(srcMap[setting('last_tick_source')] || setting('last_tick_source'))}）">
      <i></i><span>${alive ? '调度运行中' : '等待触发'}</span><small>${last ? fmtRel(last) : '尚未运行'}</small>
    </div>
    <div class="side-tools">
      <button type="button" class="ghost sm" id="themeBtn" title="切换深色/浅色">◐</button>
      <a class="ghost sm" href="${cpUrl('logout')}" title="退出登录">${icon('out')}</a>
    </div>
  </div>
</aside>
<main class="main">
${flashes.map((f) => `<div class="flash ${h(f[0])}">${h(f[1])}</div>`).join('')}
${content}
<footer class="foot">CronPro v${VERSION} · 当前时间 ${fmtTime(now(), true)}（${h(getTz())}）</footer>
</main></div>
<div class="modal" id="modal"><div class="modal-box"><button class="modal-x" type="button" data-close>×</button><div id="modalBody"></div></div></div>
<script>window.CP = {csrf: ${JSON.stringify(await csrfToken(c))}, now: ${now()}};</script>
<script src="/assets/app.js?v=${VERSION}"></script>
</body></html>`;
}

export function statusBadge(job) {
  if (!Number(job.enabled)) return `<span class="badge off">${icon('pause')}已停用</span>`;
  if (Number(job.last_ok) === -1) return '<span class="badge idle">未运行</span>';
  if (Number(job.last_ok) === 1) return '<span class="badge ok">正常</span>';
  return `<span class="badge bad">失败${Number(job.fail_count) > 1 ? ' ×' + Number(job.fail_count) : ''}</span>`;
}

export function codePill(code, ok) {
  return `<span class="code ${Number(ok) ? 'ok' : 'bad'}">${Number(code) ? Number(code) : 'ERR'}</span>`;
}

/** 执行结果条：最近 N 次，绿/红格 */
export function historyStrip(rows, n = 30) {
  rows = rows.slice(0, n).reverse();
  let s = '<div class="strip">';
  for (let i = rows.length; i < n; i++) s += '<i class="e"></i>';
  for (const r of rows) s += `<i class="${Number(r.ok) ? 'g' : 'r'}" title="${h(fmtTime(r.started_at, true) + ' · ' + (r.http_code || 'ERR') + ' · ' + fmtMs(r.duration_ms))}"></i>`;
  return s + '</div>';
}

/** 24 小时执行量柱状图（成功/失败堆叠） */
export function chartHours(buckets) {
  const w = 720, hgt = 160, pad = 22, top = 10;
  const entries = Object.entries(buckets);
  const n = entries.length;
  let max = 1;
  for (const [, b] of entries) max = Math.max(max, b.ok + b.fail);
  const bw = (w - pad) / n;
  let svg = `<svg class="chart" viewBox="0 -${top} ${w} ${hgt + 22 + top}">`;
  for (let g = 0; g <= 3; g++) {
    const y = hgt - hgt * g / 3;
    svg += `<line x1="${pad}" x2="${w}" y1="${y}" y2="${y}" class="grid"/><text x="0" y="${y + 3}" class="ax">${Math.round(max * g / 3)}</text>`;
  }
  entries.forEach(([label, b], i) => {
    const x = pad + i * bw + 2;
    const hOk = hgt * b.ok / max, hF = hgt * b.fail / max;
    svg += `<g><title>${h(`${label} 成功 ${b.ok} / 失败 ${b.fail}`)}</title>`;
    svg += `<rect class="bar-ok" x="${x}" y="${hgt - hOk}" width="${Math.max(1, bw - 4)}" height="${hOk}" rx="2"/>`;
    if (hF > 0) svg += `<rect class="bar-bad" x="${x}" y="${hgt - hOk - hF}" width="${Math.max(1, bw - 4)}" height="${hF}" rx="2"/>`;
    svg += '</g>';
    if (i % 3 === 0) svg += `<text x="${x + bw / 2 - 8}" y="${hgt + 16}" class="ax">${h(label.slice(-2))}时</text>`;
  });
  return svg + '</svg>';
}

/** 响应时间折线 */
export function chartLatency(rows) {
  rows = [...rows].reverse();
  const n = rows.length;
  if (n < 2) return '<div class="empty sm">数据不足，执行几次后显示响应时间曲线</div>';
  const w = 720, hgt = 140;
  let max = 1;
  for (const r of rows) max = Math.max(max, Number(r.duration_ms));
  const pts = []; let dots = '';
  rows.forEach((r, i) => {
    const x = Math.round(w * i / (n - 1) * 10) / 10;
    const y = Math.round((hgt - (hgt - 8) * r.duration_ms / max) * 10) / 10;
    pts.push(`${x},${y}`);
    if (!Number(r.ok)) dots += `<circle cx="${x}" cy="${y}" r="3.5" class="dot-bad"><title>${h(fmtTime(r.started_at) + ' 失败')}</title></circle>`;
  });
  const line = pts.join(' ');
  return `<svg class="chart" viewBox="0 0 ${w} ${hgt + 4}"><polygon class="area" points="0,${hgt} ${line} ${w},${hgt}"/><polyline class="line" points="${line}"/>${dots}<text x="4" y="12" class="ax">峰值 ${fmtMs(max)}</text></svg>`;
}

export function triggerLabel(t) {
  return { auto: '定时', manual: '手动', api: 'API', test: '测试' }[t] || t;
}

export function logDetailHtml(l) {
  const sched = Number(l.scheduled_at) ? ` <span class="muted">（计划 ${dt(l.scheduled_at).toFormat('HH:mm')}，延迟 ${Math.max(0, l.started_at - l.scheduled_at)} 秒）</span>` : '';
  return `<div class="ld">
  <div class="ld-head ${Number(l.ok) ? 'ok' : 'bad'}">
    <div><small>${h(l.title || '')}</small><h3>${Number(l.ok) ? '执行成功' : '执行失败'}</h3></div>
    ${codePill(l.http_code, l.ok)}
  </div>
  <dl class="kv">
    <dt>开始时间</dt><dd>${fmtTime(l.started_at, true)}${sched}</dd>
    <dt>耗时</dt><dd>${fmtMs(l.duration_ms)}</dd>
    <dt>触发方式</dt><dd>${triggerLabel(l.trigger_by)}${Number(l.attempt) > 1 ? ' · 第 ' + Number(l.attempt) + ' 次重试' : ''}</dd>
    <dt>最终地址</dt><dd class="mono">${h(l.req_url)}</dd>
    <dt>响应大小</dt><dd>${(Number(l.resp_size) || 0).toLocaleString('en-US')} 字节</dd>
    ${l.error ? `<dt>失败原因</dt><dd class="err">${h(l.error)}</dd>` : ''}
  </dl>
  ${l.resp_headers ? `<h4>响应头</h4><pre class="pre">${h(l.resp_headers)}</pre>` : ''}
  <h4>响应内容 <small class="muted">（最多保存 8 KB）</small></h4>
  <pre class="pre">${l.resp_body ? h(l.resp_body) : '<span class="muted">（空或未保存）</span>'}</pre>
</div>`;
}

export function pager(total, per, page, p, q) {
  const pages = Math.ceil(total / per);
  if (pages <= 1) return '';
  let s = '<div class="pager">';
  if (page > 1) s += `<a href="${cpUrl(p, { ...q, pg: page - 1 })}">‹ 上一页</a>`;
  s += `<span>第 ${page} / ${pages} 页，共 ${total} 条</span>`;
  if (page < pages) s += `<a href="${cpUrl(p, { ...q, pg: page + 1 })}">下一页 ›</a>`;
  return s + '</div>';
}
