import { DateTime } from 'luxon';
import { getTz } from './settings.js';

export const VERSION = '2.0.0';

export const now = () => Math.floor(Date.now() / 1000);

/** HTML 转义 */
export function h(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function dt(ts, tz) {
  return DateTime.fromSeconds(Number(ts) || 0, { zone: tz || getTz() });
}

export function fmtTime(ts, withSec = false) {
  if (!ts) return '—';
  return dt(ts).toFormat(withSec ? 'yyyy-LL-dd HH:mm:ss' : 'yyyy-LL-dd HH:mm');
}

export function fmtRel(ts) {
  if (!ts) return '—';
  const d = Number(ts) - now();
  const a = Math.abs(d);
  let s;
  if (a < 60) s = a + ' 秒';
  else if (a < 3600) s = Math.floor(a / 60) + ' 分钟';
  else if (a < 86400) s = Math.floor(a / 3600) + ' 小时';
  else s = Math.floor(a / 86400) + ' 天';
  return d >= 0 ? s + '后' : s + '前';
}

export function fmtMs(ms) {
  ms = Math.round(Number(ms) || 0);
  return ms >= 1000 ? Math.round(ms / 10) / 100 + ' s' : ms + ' ms';
}

export function numberFormat(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}

export function strimwidth(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** 按 UTF-8 字节截断 */
export function cutBytes(s, n) {
  const b = Buffer.from(String(s ?? ''), 'utf8');
  if (b.length <= n) return String(s ?? '');
  return b.subarray(0, n).toString('utf8').replace(/\uFFFD+$/, '');
}

export function int(v, d = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function parseEmails(s) {
  const out = new Map();
  for (const e of String(s ?? '').split(/[\s,;，；]+/u)) {
    const t = e.trim();
    if (t && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) out.set(t.toLowerCase(), t);
  }
  return [...out.values()];
}

export function isValidTz(tz) {
  try { return DateTime.now().setZone(tz).isValid; } catch { return false; }
}

export function allTimezones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Asia/Shanghai', 'UTC']; }
}

export function codeMatches(code, spec) {
  spec = String(spec ?? '').trim() || '200-399';
  for (const part of spec.split(/[\s,，]+/)) {
    if (!part) continue;
    if (part.includes('-')) {
      const [a, b] = part.split('-', 2).map(Number);
      if (code >= a && code <= b) return true;
    } else if (part.toLowerCase() === '2xx' && code >= 200 && code < 300) return true;
    else if (part.toLowerCase() === '3xx' && code >= 300 && code < 400) return true;
    else if (Number(part) === Number(code)) return true;
  }
  return false;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
