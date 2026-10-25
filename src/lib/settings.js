import { all, run, one } from './db.js';

let cache = null;

export const DEFAULTS = {
  site_name: 'CronPro 定时任务', timezone: 'Asia/Shanghai',
  pseudo_cron: '1', tick_interval: '30', max_parallel: '5', max_per_tick: '50',
  log_retention_days: '30', smtp_host: '', smtp_port: '465',
  smtp_secure: 'ssl', smtp_user: '', smtp_pass: '', mail_from: '', mail_from_name: 'CronPro',
  default_emails: '', status_public: '0', status_title: '服务状态',
  default_ua: 'CronPro/2.0 (+https://github.com/)', mail_subject_prefix: '[CronPro]',
  block_private: '1',
};

/** 每个请求开始时调用，刷新设置缓存 */
export async function loadSettings() {
  const rows = await all('SELECT k, v FROM settings');
  cache = {};
  for (const r of rows) cache[r.k] = r.v;
  return cache;
}

export function setting(k, d = '') {
  if (!cache) return k in DEFAULTS ? DEFAULTS[k] : d;
  return k in cache ? cache[k] : (k in DEFAULTS ? DEFAULTS[k] : d);
}

export function allSettings() {
  return { ...DEFAULTS, ...(cache || {}) };
}

export async function settingSet(k, v) {
  await run('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)', [k, String(v ?? '')]);
  if (cache) cache[k] = String(v ?? '');
}

export function getTz() {
  return (cache && cache.timezone) || 'Asia/Shanghai';
}

export function isInstalled() {
  return !!(cache && cache.admin_pass);
}

/** SMTP 密码优先使用环境变量，避免明文进数据库 */
export function mailConfig() {
  const s = allSettings();
  return {
    ...s,
    smtp_host: process.env.SMTP_HOST || s.smtp_host,
    smtp_port: process.env.SMTP_PORT || s.smtp_port,
    smtp_secure: process.env.SMTP_SECURE || s.smtp_secure,
    smtp_user: process.env.SMTP_USER || s.smtp_user,
    smtp_pass: process.env.SMTP_PASS || s.smtp_pass,
    mail_from: process.env.MAIL_FROM || s.mail_from,
  };
}

export async function cronKey() {
  let k = setting('cron_key');
  if (!k) {
    k = randomHex(16);
    await settingSet('cron_key', k);
  }
  return k;
}

export function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function event(kind, msg) {
  try { await run('INSERT INTO events (at, kind, msg) VALUES (?,?,?)', [Math.floor(Date.now() / 1000), kind, msg]); } catch {}
}

export { one };
