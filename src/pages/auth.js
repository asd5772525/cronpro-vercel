import { h } from '../util.js';
import { setting } from '../settings.js';
import { head, csrfField } from '../view.js';

export async function authPage(c, title, err, install) {
  return `${head(`${title} · CronPro`)}<body class="auth">
<div class="auth-art" aria-hidden="true">
  <div class="clock"><i class="hand h"></i><i class="hand m"></i><i class="hand s"></i><b></b></div>
  <h2>让网址按时被访问</h2>
  <p>Cron 表达式调度 · 并发请求 · 失败重试 · 邮件告警</p>
</div>
<form class="auth-card" method="post" autocomplete="off">
  ${await csrfField(c)}
  <img src="/assets/logo.svg" alt="" class="auth-logo">
  <h1>${install ? '欢迎使用 CronPro' : h(setting('site_name', 'CronPro'))}</h1>
  <p class="muted">${install ? '创建管理员账号，30 秒完成安装' : '登录管理后台'}</p>
  ${err ? `<div class="flash bad">${h(err)}</div>` : ''}
  ${install ? `<label>站点名称<input name="site" value="CronPro 定时任务"></label>
  ${process.env.SETUP_TOKEN ? '<label>安装口令 <small>（环境变量 SETUP_TOKEN）</small><input name="setup_token" type="password" required></label>' : ''}` : ''}
  <label>用户名<input name="user" required value="${install ? 'admin' : ''}" autofocus></label>
  <label>密码<input type="password" name="pass" required></label>
  ${install ? `<label>确认密码<input type="password" name="pass2" required></label>
    <label>默认告警邮箱 <small>（可稍后修改，多个用逗号分隔）</small><input name="email" type="text" placeholder="you@example.com"></label>
    <button class="btn primary block">完成安装</button>` : `<label class="check"><input type="checkbox" name="remember" value="1"> 30 天内保持登录</label>
    <button class="btn primary block">登录</button>`}
</form>
<script>
(function(){var c=document.querySelector('.clock');if(!c)return;function t(){var d=new Date(),s=d.getSeconds(),m=d.getMinutes()+s/60,h=d.getHours()%12+m/60;
c.querySelector('.s').style.transform='rotate('+s*6+'deg)';c.querySelector('.m').style.transform='rotate('+m*6+'deg)';c.querySelector('.h').style.transform='rotate('+h*30+'deg)';}t();setInterval(t,1000);})();
</script>
</body></html>`;
}

export function messagePage(msg) {
  return `${head('CronPro')}<body><p style="font:16px sans-serif;padding:40px;max-width:720px;line-height:1.7">${h(msg)}</p></body></html>`;
}
