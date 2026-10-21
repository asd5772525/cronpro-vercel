import nodemailer from 'nodemailer';
import { mailConfig } from './settings.js';
import { parseEmails } from './util.js';

/** 发送 HTML 邮件，返回 { ok, error, debug } */
export async function sendMail(to, subject, html) {
  const cfg = mailConfig();
  const list = Array.isArray(to) ? to : parseEmails(to);
  if (!list.length) return { ok: false, error: '没有有效的收件邮箱' };
  if (!cfg.smtp_host) return { ok: false, error: '未配置 SMTP 服务器' };

  let from = String(cfg.mail_from || cfg.smtp_user || '').trim();
  // 账号只填了 QQ 号等纯用户名时，按 SMTP 服务器域名补全
  if (from && !from.includes('@') && cfg.smtp_host) {
    let dom = cfg.smtp_host.toLowerCase().replace(/^(smtp|smtps|mail)\./, '');
    if (dom === 'exmail.qq.com') dom = 'qq.com';
    from += '@' + dom;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) return { ok: false, error: '发件邮箱无效，请在「发件邮箱」填写完整地址，如 12345@qq.com' };

  const debug = [];
  const port = parseInt(cfg.smtp_port, 10) || 465;
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: cfg.smtp_secure === 'ssl',
    requireTLS: cfg.smtp_secure === 'tls',
    ignoreTLS: cfg.smtp_secure === 'none',
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    logger: {
      level: () => {},
      trace: () => {}, debug: (o, m) => debug.push(String(m ?? o)), info: (o, m) => debug.push(String(m ?? o)),
      warn: (o, m) => debug.push(String(m ?? o)), error: (o, m) => debug.push(String(m ?? o)), fatal: () => {},
    },
  });
  const text = html
    .replace(/<\/td>\s*<td[^>]*>/gi, '：')
    .replace(/<br\s*\/?>|<\/p>|<\/tr>|<\/h\d>|<\/pre>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
  try {
    await transporter.sendMail({
      from: { name: cfg.mail_from_name || 'CronPro', address: from },
      to: list.join(', '),
      subject,
      text,
      html,
      headers: { 'X-Mailer': 'CronPro' },
    });
    return { ok: true, error: '', debug: debug.join('\n') };
  } catch (e) {
    return { ok: false, error: e.message || String(e), debug: debug.join('\n') };
  } finally {
    transporter.close();
  }
}
