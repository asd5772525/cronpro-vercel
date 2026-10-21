import { createClient } from '@libsql/client';

let client = null;
let ready = null;

export function dbConfigError() {
  if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL) {
    return '未配置数据库：请在 Vercel 项目的 Environment Variables 中设置 TURSO_DATABASE_URL 与 TURSO_AUTH_TOKEN（见 README）。Vercel 没有持久磁盘，不能使用本地 SQLite 文件。';
  }
  return '';
}

export function db() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL || 'file:data/local.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
  return client;
}

/** 首次使用时建表（每个实例只执行一次） */
export function ensureSchema() {
  if (!ready) ready = migrate().catch((e) => { ready = null; throw e; });
  return ready;
}

async function migrate() {
  await db().batch([
    `CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`,
    `CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, url TEXT NOT NULL, method TEXT DEFAULT 'GET',
      headers TEXT DEFAULT '', body TEXT DEFAULT '', content_type TEXT DEFAULT '',
      timeout INTEGER DEFAULT 30, cron TEXT DEFAULT '*/5 * * * *', tz TEXT DEFAULT 'Asia/Shanghai',
      enabled INTEGER DEFAULT 1, group_name TEXT DEFAULT '',
      expect_codes TEXT DEFAULT '200-399', keyword TEXT DEFAULT '', keyword_mode TEXT DEFAULT 'contains',
      max_ms INTEGER DEFAULT 0,
      auth_user TEXT DEFAULT '', auth_pass TEXT DEFAULT '', user_agent TEXT DEFAULT '',
      follow_redirects INTEGER DEFAULT 1, ssl_verify INTEGER DEFAULT 1, retries INTEGER DEFAULT 0,
      notify_fail INTEGER DEFAULT 1, notify_recover INTEGER DEFAULT 1, fail_threshold INTEGER DEFAULT 1,
      notify_repeat_hours INTEGER DEFAULT 0, notify_emails TEXT DEFAULT '', auto_disable INTEGER DEFAULT 0,
      save_body INTEGER DEFAULT 1, expires_at INTEGER DEFAULT 0, notes TEXT DEFAULT '',
      next_run INTEGER DEFAULT 0, last_run INTEGER DEFAULT 0, last_ok INTEGER DEFAULT -1,
      last_code INTEGER DEFAULT 0, last_ms INTEGER DEFAULT 0, last_error TEXT DEFAULT '',
      fail_count INTEGER DEFAULT 0, alerted_at INTEGER DEFAULT 0, total_runs INTEGER DEFAULT 0, total_fails INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, started_at INTEGER, scheduled_at INTEGER DEFAULT 0,
      duration_ms INTEGER, http_code INTEGER, ok INTEGER, error TEXT, trigger_by TEXT, attempt INTEGER DEFAULT 1,
      req_url TEXT, resp_headers TEXT, resp_body TEXT, resp_size INTEGER DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_logs_job ON logs(job_id, started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_logs_fail ON logs(ok, id)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_next ON jobs(enabled, next_run)`,
    `CREATE TABLE IF NOT EXISTS mail_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, sent_at INTEGER, recipients TEXT, subject TEXT, ok INTEGER, error TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, msg TEXT)`,
    `CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, lock_until INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0)`,
  ], 'write');
}

/** 便捷查询 */
export async function all(sql, args = []) {
  const r = await db().execute({ sql, args });
  return r.rows.map((row) => ({ ...row }));
}
export async function one(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0] || null;
}
export async function scalar(sql, args = []) {
  const r = await db().execute({ sql, args });
  return r.rows.length ? r.rows[0][0] : null;
}
export async function run(sql, args = []) {
  return db().execute({ sql, args });
}
