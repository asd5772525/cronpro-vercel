import { h, fmtTime, int, allTimezones } from '../util.js';
import { allSettings, setting, cronKey } from '../settings.js';
import { layout, cpUrl, actUrl, csrfField, icon } from '../view.js';
import { scalar } from '../db.js';

export async function pageSettings(c) {
  const tab = c.req.query('tab') || 'general';
  const s = allSettings();
  const base = new URL(c.req.url).origin;
  const key = await cronKey();
  const cf = await csrfField(c);
  const sel = (a, b) => (String(a) === String(b) ? 'selected' : '');
  const envLock = (name) => (process.env[name] ? ' <small class="muted">（已由环境变量 ' + name + ' 覆盖）</small>' : '');
  const tabs = { general: '常规', trigger: '触发方式', mail: '邮件通知', data: '导入导出', account: '账号安全' };
  let body = '';

  if (tab === 'general') {
    body = `<form class="card" method="post" action="${actUrl('save_settings')}">
  ${cf}<input type="hidden" name="section" value="general">
  <div class="row2">
    <label>站点名称<input name="site_name" value="${h(s.site_name)}"></label>
    <label>系统时区<select name="timezone">${allTimezones().map((t) => `<option ${sel(s.timezone, t)}>${h(t)}</option>`).join('')}</select></label>
  </div>
  <label>站点地址 <small>用于邮件中的“查看任务详情”链接</small><input name="base_url" value="${h(s.base_url || base + '/')}"></label>
  <div class="row3">
    <label>同时并发请求数<input type="number" name="max_parallel" min="1" max="30" value="${int(s.max_parallel)}"></label>
    <label>单次调度最多执行<input type="number" name="max_per_tick" min="1" value="${int(s.max_per_tick)}"></label>
    <label>执行记录保留天数<input type="number" name="log_retention_days" min="1" value="${int(s.log_retention_days)}"></label>
  </div>
  <label>默认 User-Agent<input name="default_ua" value="${h(s.default_ua)}"></label>
  <label class="switch"><input type="checkbox" name="block_private" value="1" ${s.block_private === '1' ? 'checked' : ''}><i></i> 拦截内网 / 保留地址（防 SSRF，建议开启）</label>
  <label class="switch"><input type="checkbox" name="status_public" value="1" ${s.status_public === '1' ? 'checked' : ''}><i></i> 开放公共状态页（/status，仅展示任务名称与可用率）</label>
  <label>状态页标题<input name="status_title" value="${h(s.status_title)}"></label>
  <div class="formbar"><span class="sp"></span><button class="btn primary">保存</button></div>
</form>`;
  } else if (tab === 'trigger') {
    const srcMap = { visit: '访问触发', url: '外部 URL', vercel: 'Vercel Cron', manual: '手动' };
    body = `<form class="card" method="post" action="${actUrl('save_settings')}">
  ${cf}<input type="hidden" name="section" value="trigger">
  <h3>① 外部定时访问（推荐，Vercel 免费版必选）</h3>
  <p class="muted">Vercel Hobby 套餐的 Cron 每天只能运行一次。把下面的地址填到 cron-job.org、UptimeRobot、宝塔“访问 URL”等服务，每分钟访问一次即可准点执行。</p>
  <div class="copybox"><code>${h(base)}/cron?key=${h(key)}</code><button type="button" class="btn sm" data-copy="${h(base)}/cron?key=${h(key)}">复制</button></div>
  <h3>② Vercel Cron</h3>
  <p class="muted">项目已在 <code>vercel.json</code> 配置了 <code>/cron</code>。Hobby 套餐默认每天 00:00 (UTC) 兜底一次；Pro 套餐可改成 <code>* * * * *</code> 每分钟执行。需在环境变量中设置 <code>CRON_SECRET</code>。</p>
  <h3>③ 访问触发（伪 Cron）</h3>
  <p class="muted">有人打开后台或状态页时，响应发出后在后台顺带检查到点任务（Vercel waitUntil），不拖慢页面。只能作为补充。</p>
  <label class="switch"><input type="checkbox" name="pseudo_cron" value="1" ${s.pseudo_cron === '1' ? 'checked' : ''}><i></i> 开启访问触发</label>
  <label>最短检查间隔（秒）<input type="number" name="tick_interval" min="5" value="${int(s.tick_interval)}" class="w120"></label>
  <p>把下面这行代码放进你自己网站的任意页面（如页脚），你的网站有访客时也会顺带触发任务：</p>
  <div class="copybox"><code>&lt;script src="${h(base)}/trigger?js=1" async&gt;&lt;/script&gt;</code><button type="button" class="btn sm" data-copy='<script src="${h(base)}/trigger?js=1" async></script>'>复制</button></div>
  <div class="formbar"><span class="sp"></span><button class="btn primary">保存</button></div>
  <p class="muted">最近一次调度：${fmtTime(setting('last_tick'), true)}（来源：${h(srcMap[setting('last_tick_source')] || '—')}）</p>
</form>
<form method="post" action="${actUrl('regen_key')}" class="inline-note">${cf}<button class="btn sm ghost" data-confirm="重新生成后旧地址立即失效，确定？">重新生成触发密钥</button></form>`;
  } else if (tab === 'mail') {
    body = `<form class="card" method="post" action="${actUrl('save_settings')}" id="mailForm">
  ${cf}<input type="hidden" name="section" value="mail">
  <input type="hidden" name="mail_mode" value="smtp">
  <div class="presets"><span class="muted">常用邮箱：</span>
    <a data-smtp="smtp.qq.com|465|ssl">QQ 邮箱</a><a data-smtp="smtp.163.com|465|ssl">163 邮箱</a><a data-smtp="smtp.exmail.qq.com|465|ssl">腾讯企业邮</a>
    <a data-smtp="smtp.aliyun.com|465|ssl">阿里邮箱</a><a data-smtp="smtp.gmail.com|587|tls">Gmail</a><a data-smtp="smtp.office365.com|587|tls">Outlook</a></div>
  <div class="row3">
    <label>SMTP 服务器${envLock('SMTP_HOST')}<input name="smtp_host" value="${h(s.smtp_host)}" placeholder="smtp.qq.com"></label>
    <label>端口${envLock('SMTP_PORT')}<input type="number" name="smtp_port" value="${h(s.smtp_port)}"></label>
    <label>加密${envLock('SMTP_SECURE')}<select name="smtp_secure">${Object.entries({ ssl: 'SSL', tls: 'STARTTLS', none: '无' }).map(([k, v]) => `<option value="${k}" ${sel(s.smtp_secure, k)}>${v}</option>`).join('')}</select></label>
  </div>
  <div class="row2">
    <label>SMTP 账号 <small>建议填完整邮箱</small>${envLock('SMTP_USER')}<input name="smtp_user" value="${h(s.smtp_user)}" autocomplete="off" placeholder="12345@qq.com"></label>
    <label>SMTP 密码 / 授权码 ${process.env.SMTP_PASS ? '<small class="muted">（已使用环境变量 SMTP_PASS，推荐）</small>' : `<small>${s.smtp_pass ? '已保存，留空不修改' : '推荐改用环境变量 SMTP_PASS'}</small>`}<input type="password" name="smtp_pass" autocomplete="new-password" ${process.env.SMTP_PASS ? 'disabled' : ''}></label>
  </div>
  <div class="row2">
    <label>发件邮箱 <small>必须是完整邮箱地址</small>${envLock('MAIL_FROM')}<input name="mail_from" type="email" value="${h(s.mail_from)}" placeholder="如 12345@qq.com，需与 SMTP 账号一致"></label>
    <label>发件人名称<input name="mail_from_name" value="${h(s.mail_from_name)}"></label>
  </div>
  <label>默认告警收件人 <small>任务未单独设置时使用，多个用逗号分隔</small><input name="default_emails" value="${h(s.default_emails)}"></label>
  <label>邮件标题前缀<input name="mail_subject_prefix" value="${h(s.mail_subject_prefix)}"></label>
  <div class="formbar"><span class="sp"></span><button class="btn primary">保存</button></div>
</form>
<div class="card">
  <h3>发送测试邮件</h3><p class="muted">请先保存配置，再发送测试。</p>
  <div class="url-row"><input id="testTo" value="${h(s.default_emails)}" placeholder="收件邮箱"><button class="btn" id="mailTestBtn">${icon('mail')}发送</button></div>
  <pre class="pre" id="mailTestOut" hidden></pre>
</div>`;
  } else if (tab === 'data') {
    const [jobs, logs] = await Promise.all([scalar('SELECT COUNT(*) FROM jobs'), scalar('SELECT COUNT(*) FROM logs')]);
    body = `<div class="card">
  <h3>导出任务</h3><p class="muted">导出全部任务配置为 JSON，可用于备份或迁移。</p>
  <form method="post" action="${actUrl('export')}">${cf}<button class="btn">下载 JSON</button></form>
</div>
<div class="card">
  <h3>导入任务</h3><p class="muted">兼容 PHP 版 CronPro 导出的文件。导入的任务会作为新任务添加，原有任务不受影响。</p>
  <form method="post" enctype="multipart/form-data" action="${actUrl('import')}" class="url-row">${cf}<input type="file" name="file" accept=".json,application/json" required><button class="btn primary">导入</button></form>
</div>
<div class="card">
  <h3>数据库</h3>
  <p class="muted">${process.env.TURSO_DATABASE_URL ? 'Turso (libSQL) 云数据库' : '本地 SQLite 文件 data/local.db（仅用于本地开发）'} · ${jobs} 个任务 · ${logs} 条执行记录</p>
</div>`;
  } else {
    body = `<form class="card" method="post" action="${actUrl('password')}">
  ${cf}
  <label>用户名<input name="user" value="${h(s.admin_user)}"></label>
  <label>原密码<input type="password" name="old" required></label>
  <div class="row2"><label>新密码<input type="password" name="new" required minlength="8"></label><label>确认新密码<input type="password" name="new2" required></label></div>
  <p class="muted">修改密码后，所有已登录的设备都会被登出。</p>
  <div class="formbar"><span class="sp"></span><button class="btn primary">更新</button></div>
</form>`;
  }
  const html = `
<div class="page-head"><div><h1>系统设置</h1></div></div>
<div class="tabs links">
  ${Object.entries(tabs).map(([k, v]) => `<a class="${tab === k ? 'on' : ''}" href="${cpUrl('settings', { tab: k })}">${v}</a>`).join('')}
</div>
${body}`;
  return layout(c, '系统设置', 'settings', html);
}
