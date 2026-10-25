import { one, run, db } from '../lib/db.js';
import { jobNextRun } from '../lib/cron-expr.js';
import { now } from '../lib/util.js';

export const JOB_COLUMNS = ['title', 'url', 'method', 'headers', 'body', 'content_type', 'timeout', 'cron', 'tz', 'enabled', 'group_name',
  'expect_codes', 'keyword', 'keyword_mode', 'max_ms', 'auth_user', 'auth_pass', 'user_agent', 'follow_redirects',
  'ssl_verify', 'retries', 'notify_fail', 'notify_recover', 'fail_threshold', 'notify_repeat_hours', 'notify_emails',
  'auto_disable', 'save_body', 'expires_at', 'notes'];

export const JOB_DEFAULTS = {
  title: '', url: '', method: 'GET', headers: '', body: '', content_type: '', timeout: 30,
  cron: '*/5 * * * *', tz: 'Asia/Shanghai', enabled: 1, group_name: '', expect_codes: '200-399',
  keyword: '', keyword_mode: 'contains', max_ms: 0, auth_user: '', auth_pass: '', user_agent: '',
  follow_redirects: 1, ssl_verify: 1, retries: 1, notify_fail: 1, notify_recover: 1, fail_threshold: 1,
  notify_repeat_hours: 0, notify_emails: '', auto_disable: 0, save_body: 1, expires_at: 0, notes: '',
};

export function jobGet(id) {
  return one('SELECT * FROM jobs WHERE id = ?', [Number(id) || 0]);
}

export async function jobSave(d, id = 0) {
  const vals = {};
  for (const c of JOB_COLUMNS) vals[c] = d[c] ?? JOB_DEFAULTS[c];
  vals.next_run = vals.enabled ? jobNextRun(vals.cron, vals.tz) : 0;
  vals.updated_at = now();
  if (id) {
    const keys = Object.keys(vals);
    await run(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => vals[k]), id]);
    return id;
  }
  vals.created_at = now();
  const keys = Object.keys(vals);
  const r = await db().execute({ sql: `INSERT INTO jobs (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, args: keys.map((k) => vals[k]) });
  return Number(r.lastInsertRowid);
}
