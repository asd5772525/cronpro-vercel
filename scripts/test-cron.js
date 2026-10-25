// Cron 解析器自测：node scripts/test-cron.js
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { CronExpr } from '../src/lib/cron-expr.js';

const at = (s, tz) => Math.floor(DateTime.fromISO(s, { zone: tz }).toSeconds());
const fmt = (t, tz) => DateTime.fromSeconds(t, { zone: tz }).toFormat('yyyy-LL-dd HH:mm');
const cases = [
  ['*/5 * * * *', '2026-10-21T21:38', 'Asia/Shanghai', '2026-10-21 21:40'],
  ['0 */3 * * *', '2026-10-21T21:38', 'Asia/Shanghai', '2026-10-22 00:00'],
  ['30 8 * * 1-5', '2026-10-23T09:00', 'Asia/Shanghai', '2026-10-26 08:30'],
  ['0 0 31 * *', '2026-11-01T00:00', 'UTC', '2026-12-31 00:00'],
  ['0 0 1,15 * 1', '2026-10-02T00:00', 'UTC', '2026-10-05 00:00'], // 日与周都限定时取“或”
  ['@daily', '2026-10-21T23:59', 'UTC', '2026-10-22 00:00'],
  ['30 2 * * *', '2026-03-08T00:00', 'America/New_York', '2026-03-09 02:30'], // 夏令时跳过的时刻
  ['0 9 * * SUN', '2026-10-21T00:00', 'UTC', '2026-10-25 09:00'],
];
for (const [expr, from, tz, want] of cases) {
  const got = fmt(new CronExpr(expr).next(at(from, tz), tz), tz);
  assert.equal(got, want, `${expr} @ ${from} ${tz}`);
}
assert.equal(CronExpr.isValid('61 * * * *'), false);
assert.equal(CronExpr.describe('0 3 * * *'), '每天 03:00');
console.log(`✓ ${cases.length + 2} 项通过`);
