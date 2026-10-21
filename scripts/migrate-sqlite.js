/**
 * 把 PHP 版 CronPro 的 data/cronpro.sqlite 迁移到 Turso（或本地 data/local.db）
 *
 * 用法：
 *   TURSO_DATABASE_URL=libsql://xxx.turso.io TURSO_AUTH_TOKEN=xxx \
 *   node scripts/migrate-sqlite.js /path/to/old/data/cronpro.sqlite [--force]
 *
 * 说明：
 *  - 任务、执行记录、通知记录、系统事件、设置全部迁移，任务 ID 保持不变
 *  - 管理员账号密码沿用（PHP 的 bcrypt 哈希可直接校验）
 *  - 不迁移 SMTP 密码（请改用 Vercel 环境变量 SMTP_PASS）和登录失败计数
 */
import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureSchema, db } from '../src/db.js';

const src = process.argv[2];
const force = process.argv.includes('--force');
if (!src || !existsSync(src)) {
  console.error('用法：node scripts/migrate-sqlite.js /path/to/cronpro.sqlite [--force]');
  process.exit(1);
}

const SKIP_SETTINGS = /^(smtp_pass|login_fail_.*|login_lock_.*|last_tick|last_tick_source|tick_lock|session_secret|last_cleanup)$/;

const from = createClient({ url: 'file:' + resolve(src) });
await ensureSchema();
const to = db();

const existing = (await to.execute('SELECT COUNT(*) FROM jobs')).rows[0][0];
if (Number(existing) > 0 && !force) {
  console.error(`目标数据库已有 ${existing} 个任务。如确定要覆盖，请加 --force`);
  process.exit(1);
}

async function copyTable(table, filter = () => true) {
  const rows = (await from.execute(`SELECT * FROM ${table}`)).rows.filter(filter);
  const targetCols = new Set((await to.execute(`PRAGMA table_info(${table})`)).rows.map((r) => r.name));
  if (force) await to.execute(`DELETE FROM ${table}`);
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((r) => {
      const cols = Object.keys(r).filter((k) => targetCols.has(k));
      return { sql: `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, args: cols.map((k) => r[k]) };
    });
    await to.batch(batch, 'write');
    n += batch.length;
  }
  console.log(`  ${table}: ${n} 行`);
}

console.log('开始迁移…');
await copyTable('settings', (r) => !SKIP_SETTINGS.test(r.k));
await copyTable('jobs');
await copyTable('logs');
await copyTable('mail_log');
await copyTable('events');
// 迁移后重新计算下次执行时间
const { jobNextRun } = await import('../src/cron-expr.js');
const jobs = (await to.execute('SELECT id, cron, tz, enabled FROM jobs')).rows;
for (const j of jobs) await to.execute({ sql: 'UPDATE jobs SET next_run = ? WHERE id = ?', args: [Number(j.enabled) ? jobNextRun(j.cron, j.tz) : 0, j.id] });
console.log('完成！请用原来的管理员账号登录，并在 Vercel 环境变量中设置 SMTP_PASS。');
