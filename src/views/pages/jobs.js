import { all, one, scalar } from '../../lib/db.js';
import { h, now, fmtMs, fmtRel, fmtTime, strimwidth, dt, int } from '../../lib/util.js';
import { setting, cronKey } from '../../lib/settings.js';
import { CronExpr } from '../../lib/cron-expr.js';
import { JOB_DEFAULTS, jobGet } from '../../core/jobs.js';
import { layout, cpUrl, actUrl, csrfField, icon, statusBadge, historyStrip, chartLatency, codePill, triggerLabel, pager } from '../layout.js';

const sel = (a, b) => (String(a) === String(b) ? 'selected' : '');
const chk = (v) => (Number(v) ? 'checked' : '');

/* ---------------- 任务列表 ---------------- */
export async function pageJobs(c) {
  const q = c.req.query('q') || '', g = c.req.query('g') || '', s = c.req.query('s') || '';
  const where = [], args = [];
  if (q) { where.push('(title LIKE ? OR url LIKE ? OR notes LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (g) { where.push('group_name = ?'); args.push(g); }
  if (s === 'fail') where.push('enabled = 1 AND last_ok = 0');
  if (s === 'ok') where.push('enabled = 1 AND last_ok = 1');
  if (s === 'off') where.push('enabled = 0');
  const jobs = await all(`SELECT * FROM jobs${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY group_name, enabled DESC, id DESC`, args);
  const groups = await all("SELECT group_name, COUNT(*) n FROM jobs WHERE group_name != '' GROUP BY group_name ORDER BY group_name");
  const hist = {};
  if (jobs.length) {
    // 一次查询取每个任务最近 20 条（窗口函数），替代原来的 N+1 查询
    const ids = jobs.map((j) => Number(j.id));
    const rows = await all(`SELECT * FROM (SELECT job_id, ok, http_code, duration_ms, started_at, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY id DESC) rn
      FROM logs WHERE job_id IN (${ids.map(() => '?').join(',')})) WHERE rn <= 20 ORDER BY job_id, rn`, ids);
    for (const r of rows) (hist[r.job_id] ||= []).push(r);
  }
  let body;
  if (!jobs.length) {
    body = `<div class="card empty big"><img src="/assets/logo.svg" alt="" width="56"><p>还没有任务。添加一个网址，CronPro 会按计划替你访问它。</p><a class="btn primary" href="${cpUrl('edit')}">新建任务</a></div>`;
  } else {
    let lastGroup = null;
    const trs = jobs.map((j) => {
      let grp = '';
      if (j.group_name !== lastGroup && g === '' && groups.length) {
        lastGroup = j.group_name;
        grp = `<tr class="grp"><td colspan="7">${j.group_name !== '' ? h(j.group_name) : '未分组'}</td></tr>`;
      }
      return `${grp}<tr class="${Number(j.enabled) ? '' : 'dim'}" data-job="${Number(j.id)}">
        <td class="ck"><input type="checkbox" name="ids[]" value="${Number(j.id)}"></td>
        <td class="tt"><a href="${cpUrl('job', { id: j.id })}"><b>${h(j.title)}</b></a>
          <small class="mono"><em class="m">${h(j.method)}</em>${h(strimwidth(j.url, 60))}</small></td>
        <td><span class="sched" title="${h(j.cron)}">${h(CronExpr.describe(j.cron))}</span></td>
        <td class="st">${statusBadge(j)}</td>
        <td class="hide-sm">${historyStrip(hist[j.id] || [], 20)}</td>
        <td class="when"><small>上次 ${Number(j.last_run) ? fmtRel(j.last_run) + ' · ' + fmtMs(j.last_ms) : '—'}</small>
          <small>下次 ${Number(j.enabled) && Number(j.next_run) ? `<span class="cd" data-at="${Number(j.next_run)}">${fmtRel(j.next_run)}</span>` : '—'}</small></td>
        <td class="r ops">
          <button type="button" class="ib" data-run="${Number(j.id)}" title="立即执行">${icon('play')}</button>
          <a class="ib" href="${cpUrl('edit', { id: j.id })}" title="编辑">${icon('edit')}</a>
          <button type="button" class="ib" data-post="${actUrl('toggle', { id: j.id })}" title="${Number(j.enabled) ? '停用' : '启用'}">${Number(j.enabled) ? icon('pause') : icon('pulse')}</button>
        </td>
      </tr>`;
    }).join('');
    body = `<form method="post" action="${actUrl('bulk')}" id="bulkForm">
  ${await csrfField(c)}
  <div class="bulkbar" hidden><span><b id="selCount">0</b> 个已选</span>
    <button name="op" value="run" class="btn sm">${icon('play')}执行</button>
    <button name="op" value="enable" class="btn sm">启用</button>
    <button name="op" value="disable" class="btn sm">停用</button>
    <button name="op" value="export" class="btn sm">导出</button>
    <button name="op" value="delete" class="btn sm danger" data-confirm="确定删除选中的任务及其记录？">删除</button>
  </div>
  <div class="card flush">
  <table class="tbl jobs">
    <thead><tr><th class="ck"><input type="checkbox" id="ckAll"></th><th>任务</th><th>计划</th><th>状态</th><th class="hide-sm">最近 20 次</th><th>上次 / 下次</th><th class="r">操作</th></tr></thead>
    <tbody>${trs}</tbody>
  </table>
  </div>
</form>`;
  }
  const segs = { '': '全部', ok: '正常', fail: '失败', off: '已停用' };
  const html = `
<div class="page-head">
  <div><h1>定时任务</h1><p class="muted">共 ${jobs.length} 个任务</p></div>
  <div class="actions"><a class="btn primary" href="${cpUrl('edit')}">${icon('plus')}新建任务</a></div>
</div>
<form class="filters" method="get">
  <input type="hidden" name="p" value="jobs">
  <input name="q" value="${h(q)}" placeholder="搜索名称、网址或备注">
  <select name="g" onchange="this.form.submit()"><option value="">全部分组</option>
    ${groups.map((gr) => `<option value="${h(gr.group_name)}" ${sel(g, gr.group_name)}>${h(gr.group_name)} (${gr.n})</option>`).join('')}
  </select>
  <div class="seg">
    ${Object.entries(segs).map(([k, v]) => `<a class="${s === k ? 'on' : ''}" href="${cpUrl('jobs', { q, g, s: k })}">${v}</a>`).join('')}
  </div>
</form>
${body}`;
  return layout(c, '定时任务', 'jobs', html);
}

/* ---------------- 编辑任务 ---------------- */
export async function pageEdit(c, refill = null) {
  const id = int(c.req.query('id'));
  const job = id ? await jobGet(id) : null;
  if (id && !job) return null;
  let j = job ? { ...job } : { ...JOB_DEFAULTS, tz: setting('timezone', 'Asia/Shanghai') };
  if (refill) j = { ...j, ...refill }; // 校验失败回填
  const groups = (await all("SELECT DISTINCT group_name FROM jobs WHERE group_name != ''")).map((r) => r.group_name);
  const tzs = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];
  if (!tzs.includes(j.tz)) tzs.push(j.tz);
  const expires = Number(j.expires_at) ? dt(j.expires_at).toFormat("yyyy-LL-dd'T'HH:mm") : '';
  const html = `
<div class="page-head">
  <div><a class="back" href="${job ? cpUrl('job', { id }) : cpUrl('jobs')}">← 返回</a><h1>${job ? '编辑任务' : '新建任务'}</h1></div>
</div>
<form method="post" action="${actUrl('save_job', { id: id || '' })}" class="jobform" id="jobForm">
  ${await csrfField(c)}
  <div class="tabs" role="tablist">
    <button type="button" class="on" data-tab="t-basic">常规</button>
    <button type="button" data-tab="t-sched">执行计划</button>
    <button type="button" data-tab="t-notify">失败通知</button>
    <button type="button" data-tab="t-adv">高级</button>
  </div>

  <section class="card tab-pane on" id="t-basic">
    <label>任务名称<input name="title" value="${h(j.title)}" required placeholder="例如：网站定时清理缓存"></label>
    <label>访问网址 <small>支持变量 {timestamp} {date} {datetime} {rand}</small>
      <div class="url-row"><select name="method">${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => `<option ${sel(j.method, m)}>${m}</option>`).join('')}</select>
      <input name="url" value="${h(j.url)}" required placeholder="https://example.com/task.php?key=xxx"></div></label>
    <div class="row2">
      <label>分组<input name="group_name" value="${h(j.group_name)}" list="groups" placeholder="可选"><datalist id="groups">${groups.map((gr) => `<option value="${h(gr)}">`).join('')}</datalist></label>
      <label>超时（秒）<input type="number" name="timeout" min="1" max="600" value="${int(j.timeout, 30)}"><small>Vercel 上单次调度最长约 50 秒</small></label>
    </div>
    <label class="switch"><input type="checkbox" name="enabled" value="1" ${chk(j.enabled)}><i></i> 启用此任务</label>
    <label>备注<textarea name="notes" rows="2" placeholder="可选">${h(j.notes)}</textarea></label>
  </section>

  <section class="card tab-pane" id="t-sched">
    <div class="sched-modes seg">
      <a data-mode="minutes">每隔 N 分钟</a><a data-mode="hourly">每小时</a><a data-mode="daily">每天</a><a data-mode="weekly">每周</a><a data-mode="monthly">每月</a><a data-mode="custom">自定义</a>
    </div>
    <div class="sched-body">
      <div data-pane="minutes">每 <select id="sMin">${[1, 2, 3, 5, 10, 15, 20, 30].map((n) => `<option value="${n}">${n}</option>`).join('')}</select> 分钟执行一次</div>
      <div data-pane="hourly">每 <select id="sHourEvery">${[1, 2, 3, 4, 6, 8, 12].map((n) => `<option value="${n}">${n}</option>`).join('')}</select> 小时，在第 <input type="number" id="sHourMin" min="0" max="59" value="0" class="w60"> 分钟执行</div>
      <div data-pane="daily">每天在 <input id="sDailyTimes" value="03:00" class="w200" placeholder="03:00, 15:30"> 执行 <small class="muted">多个时间用逗号分隔（分钟需相同）</small></div>
      <div data-pane="weekly"><div class="days" id="sWeekDays">${[[1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [0, '日']].map(([k, v]) => `<label><input type="checkbox" value="${k}" ${k === 1 ? 'checked' : ''}><span>周${v}</span></label>`).join('')}</div>
        时间 <input type="time" id="sWeekTime" value="09:00"></div>
      <div data-pane="monthly">每月 <input id="sMonthDays" value="1" class="w120" placeholder="1,15"> 日的 <input type="time" id="sMonthTime" value="00:00"> 执行</div>
      <div data-pane="custom"><small class="muted">格式：分 时 日 月 周，例如 <code>30 8 * * 1-5</code> = 工作日 08:30；也支持 @hourly @daily 等</small></div>
    </div>
    <div class="row2">
      <label>Cron 表达式<input name="cron" id="cronInput" class="mono" value="${h(j.cron)}" required></label>
      <label>时区<select name="tz" id="tzInput">${tzs.map((t) => `<option ${sel(j.tz, t)}>${h(t)}</option>`).join('')}</select></label>
    </div>
    <div class="preview" id="cronPreview"><b>—</b><ol></ol></div>
    <label>到期时间 <small>到期后自动停用，留空表示长期有效</small><input type="datetime-local" name="expires_at" value="${expires}"></label>
  </section>

  <section class="card tab-pane" id="t-notify">
    <label>通知邮箱 <small>多个用逗号分隔；留空则使用系统默认（${h(setting('default_emails') || '未设置')}）</small>
      <input name="notify_emails" value="${h(j.notify_emails)}" placeholder="ops@example.com, me@example.com"></label>
    <label class="switch"><input type="checkbox" name="notify_fail" value="1" ${chk(j.notify_fail)}><i></i> 执行失败时发送邮件</label>
    <div class="row3">
      <label>连续失败几次后通知<input type="number" name="fail_threshold" min="1" max="100" value="${int(j.fail_threshold, 1)}"></label>
      <label>持续失败时每隔几小时再提醒<input type="number" name="notify_repeat_hours" min="0" value="${int(j.notify_repeat_hours)}"><small>0 = 只提醒一次</small></label>
      <label>连续失败几次后自动停用<input type="number" name="auto_disable" min="0" value="${int(j.auto_disable)}"><small>0 = 不自动停用</small></label>
    </div>
    <label class="switch"><input type="checkbox" name="notify_recover" value="1" ${chk(j.notify_recover)}><i></i> 失败后恢复正常时发送邮件</label>
  </section>

  <section class="card tab-pane" id="t-adv">
    <h3>成功判定</h3>
    <div class="row3">
      <label>期望状态码<input name="expect_codes" value="${h(j.expect_codes)}" placeholder="200-399"><small>如 200-299,301,302</small></label>
      <label>失败重试次数<input type="number" name="retries" min="0" max="5" value="${int(j.retries)}"></label>
      <label>响应时间上限（毫秒）<input type="number" name="max_ms" min="0" value="${int(j.max_ms)}"><small>0 = 不限制</small></label>
    </div>
    <div class="row2">
      <label>关键字检查<select name="keyword_mode"><option value="contains" ${sel(j.keyword_mode, 'contains')}>响应必须包含</option><option value="not_contains" ${sel(j.keyword_mode, 'not_contains')}>响应不能包含</option></select></label>
      <label>关键字<input name="keyword" value="${h(j.keyword)}" placeholder="留空不检查，例如 success"></label>
    </div>
    <h3>请求</h3>
    <label>自定义请求头 <small>每行一个，如 Authorization: Bearer xxx</small><textarea name="headers" rows="3" class="mono">${h(j.headers)}</textarea></label>
    <div class="row2">
      <label>Content-Type<input name="content_type" value="${h(j.content_type)}" list="ctypes" placeholder="POST/PUT 时使用"><datalist id="ctypes"><option value="application/json"><option value="application/x-www-form-urlencoded"><option value="text/plain"></datalist></label>
      <label>User-Agent<input name="user_agent" value="${h(j.user_agent)}" placeholder="${h(setting('default_ua'))}"></label>
    </div>
    <label>请求体<textarea name="body" rows="4" class="mono" placeholder='{"action":"cleanup"}'>${h(j.body)}</textarea></label>
    <div class="row2">
      <label>HTTP 认证用户名<input name="auth_user" value="${h(j.auth_user)}" autocomplete="off"></label>
      <label>HTTP 认证密码<input type="password" name="auth_pass" value="${h(j.auth_pass)}" autocomplete="new-password"></label>
    </div>
    <label class="switch"><input type="checkbox" name="follow_redirects" value="1" ${chk(j.follow_redirects)}><i></i> 跟随重定向</label>
    <label class="switch"><input type="checkbox" name="ssl_verify" value="1" ${chk(j.ssl_verify)}><i></i> 校验 SSL 证书</label>
    <label class="switch"><input type="checkbox" name="save_body" value="1" ${chk(j.save_body)}><i></i> 保存响应内容到执行记录</label>
  </section>

  <div class="formbar">
    <button type="button" class="btn" id="testBtn">${icon('play')}测试运行</button>
    <span class="sp"></span>
    ${job ? '' : '<button class="btn" name="after" value="new">保存并继续添加</button>'}
    <button class="btn primary">保存任务</button>
  </div>
</form>`;
  return layout(c, job ? '编辑任务' : '新建任务', 'jobs', html);
}

/* ---------------- 任务详情 ---------------- */
export async function pageJob(c) {
  const id = int(c.req.query('id'));
  const j = await jobGet(id);
  if (!j) return null;
  const page = Math.max(1, int(c.req.query('pg'), 1)), per = 30;
  const only = c.req.query('only') || '';
  const where = 'job_id = ?' + (only === 'fail' ? ' AND ok = 0' : '');
  const t = now();
  const [total, logs, recent, ...ups] = await Promise.all([
    scalar(`SELECT COUNT(*) FROM logs WHERE ${where}`, [id]),
    all(`SELECT * FROM logs WHERE ${where} ORDER BY id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, [id]),
    all('SELECT ok, duration_ms, started_at, http_code FROM logs WHERE job_id = ? ORDER BY id DESC LIMIT 60', [id]),
    ...[1, 7, 30].map((d) => one('SELECT COUNT(*) n, SUM(ok) ok, AVG(duration_ms) a FROM logs WHERE job_id = ? AND started_at > ?', [id, t - d * 86400])),
  ]);
  let next = [];
  try { next = new CronExpr(j.cron).upcoming(t, j.tz, 5); } catch {}
  const base = new URL(c.req.url).origin;
  const key = await cronKey();
  const html = `
<div class="page-head">
  <div><a class="back" href="${cpUrl('jobs')}">← 全部任务</a>
    <h1>${h(j.title)} ${statusBadge(j)}</h1>
    <p class="mono muted"><em class="m">${h(j.method)}</em> ${h(j.url)}</p></div>
  <div class="actions">
    <button class="btn primary" data-run="${id}" data-reload="1">${icon('play')}立即执行</button>
    <a class="btn" href="${cpUrl('edit', { id })}">${icon('edit')}编辑</a>
    <button class="btn" data-post="${actUrl('toggle', { id })}">${Number(j.enabled) ? icon('pause') + '停用' : icon('pulse') + '启用'}</button>
    <button class="btn" data-post="${actUrl('clone', { id })}">${icon('copy')}复制</button>
    <button class="btn danger" data-post="${actUrl('delete', { id })}" data-confirm="确定删除该任务及全部执行记录？">${icon('trash')}</button>
  </div>
</div>
${Number(j.enabled) && Number(j.last_ok) === 0 ? `<div class="flash bad">最近一次失败：${h(j.last_error)}（已连续失败 ${Number(j.fail_count)} 次）</div>` : ''}
<div class="stats">
  ${[1, 7, 30].map((d, i) => { const u = ups[i]; const n = Number(u.n); return `<div class="stat ${n && Number(u.ok) / n < 0.95 ? 'bad' : ''}"><span>${d} 天可用率</span><b>${n ? Math.round(Number(u.ok) / n * 10000) / 100 + '%' : '—'}</b><small>${n} 次 · 平均 ${fmtMs(u.a)}</small></div>`; }).join('')}
  <div class="stat"><span>下次执行</span><b class="sm">${Number(j.enabled) && Number(j.next_run) ? `<span class="cd" data-at="${Number(j.next_run)}">${fmtRel(j.next_run)}</span>` : '—'}</b><small>${h(CronExpr.describe(j.cron))}</small></div>
</div>
<div class="grid2 wide-left">
  <div class="card">
    <div class="card-head"><h2>响应时间</h2><span class="muted">最近 60 次</span></div>
    ${chartLatency(recent)}
    ${historyStrip(recent, 60)}
  </div>
  <div class="card">
    <div class="card-head"><h2>任务信息</h2></div>
    <dl class="kv">
      <dt>Cron</dt><dd class="mono">${h(j.cron)} <span class="muted">${h(j.tz)}</span></dd>
      <dt>接下来</dt><dd>${next.map((x) => `<div>${dt(x, j.tz).toFormat('LL-dd HH:mm')}</div>`).join('')}</dd>
      <dt>判定</dt><dd>状态码 ${h(j.expect_codes)}${j.keyword ? '，' + (j.keyword_mode === 'contains' ? '需包含' : '不能包含') + '「' + h(j.keyword) + '」' : ''}${Number(j.max_ms) ? '，≤ ' + Number(j.max_ms) + ' ms' : ''}</dd>
      <dt>通知</dt><dd>${Number(j.notify_fail) ? `连续失败 ${Number(j.fail_threshold)} 次后发送至 ${h(j.notify_emails || setting('default_emails') || '（未设置邮箱）')}` : '不通知'}</dd>
      <dt>累计</dt><dd>${Number(j.total_runs)} 次，失败 ${Number(j.total_fails)} 次</dd>
      ${Number(j.expires_at) ? `<dt>到期</dt><dd>${fmtTime(j.expires_at)}</dd>` : ''}
      ${j.notes ? `<dt>备注</dt><dd>${h(j.notes).replace(/\n/g, '<br>')}</dd>` : ''}
      <dt>API</dt><dd><button type="button" class="btn sm" data-copy="${h(`${base}/cron?key=${key}&job=${id}`)}">复制单任务触发地址</button></dd>
    </dl>
  </div>
</div>
<div class="card flush">
  <div class="card-head pad"><h2>执行记录</h2>
    <div class="seg sm"><a class="${only === '' ? 'on' : ''}" href="${cpUrl('job', { id })}">全部</a><a class="${only === 'fail' ? 'on' : ''}" href="${cpUrl('job', { id, only: 'fail' })}">仅失败</a></div>
    <form method="post" action="${actUrl('clear_logs', { id })}">${await csrfField(c)}<button class="btn sm ghost" data-confirm="清空该任务全部执行记录？">清空记录</button></form>
  </div>
  ${logsTable(logs, false)}${pager(Number(total), per, page, 'job', { id, only })}
</div>`;
  return layout(c, j.title, 'jobs', html);
}

export function logsTable(logs, showJob) {
  if (!logs.length) return '<div class="empty">暂无执行记录</div>';
  return `<table class="tbl logs">
  <thead><tr><th>时间</th>${showJob ? '<th>任务</th>' : ''}<th>结果</th><th>耗时</th><th class="hide-sm">触发</th><th>说明</th></tr></thead>
  <tbody>
  ${logs.map((l) => `<tr data-log="${Number(l.id)}" class="click">
      <td class="nowrap">${fmtTime(l.started_at, true)}</td>
      ${showJob ? `<td>${h(l.title ?? '#' + l.job_id)}</td>` : ''}
      <td>${codePill(l.http_code, l.ok)}</td>
      <td class="nowrap">${fmtMs(l.duration_ms)}</td>
      <td class="hide-sm"><span class="tag">${triggerLabel(l.trigger_by)}${Number(l.attempt) > 1 ? ' #' + Number(l.attempt) : ''}</span></td>
      <td class="${Number(l.ok) ? 'muted' : 'err'} ell">${Number(l.ok) ? (Number(l.resp_size) || 0).toLocaleString('en-US') + ' 字节' : h(l.error)}</td>
    </tr>`).join('')}
  </tbody>
</table>`;
}
