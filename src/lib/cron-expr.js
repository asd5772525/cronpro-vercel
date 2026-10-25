/**
 * 标准 5 段 Cron 表达式解析器：分 时 日 月 周
 * 支持 * , - / 、月份/星期英文缩写、@hourly @daily @weekly @monthly @yearly
 * 时区计算基于 luxon，正确处理夏令时。
 */
import { DateTime } from 'luxon';

const MACROS = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
};
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const NAMES = {
  3: { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 },
  4: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 },
};
const isDigits = (s) => /^\d+$/.test(s);

export class CronExpr {
  constructor(expr) {
    expr = String(expr ?? '').replace(/\s+/g, ' ').trim();
    const low = expr.toLowerCase();
    if (MACROS[low]) expr = MACROS[low];
    const parts = expr.split(' ');
    if (parts.length !== 5) throw new Error('Cron 表达式必须是 5 段：分 时 日 月 周');
    this.fields = parts.map((p, i) => this.parseField(p.toUpperCase(), i));
    this.domStar = parts[2] === '*' || parts[2] === '?';
    this.dowStar = parts[4] === '*' || parts[4] === '?';
    if (this.fields[4].has(7)) { this.fields[4].add(0); this.fields[4].delete(7); }
  }

  static isValid(expr) {
    try { new CronExpr(expr); return true; } catch { return false; }
  }

  parseField(s, idx) {
    const [min, max] = RANGES[idx];
    if (NAMES[idx]) for (const [k, v] of Object.entries(NAMES[idx])) s = s.split(k).join(String(v));
    const set = new Set();
    for (let chunk of s.split(',')) {
      if (chunk === '') throw new Error('Cron 字段为空');
      let step = 1;
      if (chunk.includes('/')) {
        const [c, st] = chunk.split('/', 2);
        if (!isDigits(st) || Number(st) < 1) throw new Error(`步长无效：${st}`);
        step = Number(st); chunk = c;
      }
      let a, b;
      if (chunk === '*' || chunk === '?') { a = min; b = max; }
      else if (chunk.includes('-')) {
        const [x, y] = chunk.split('-', 2);
        if (!isDigits(x) || !isDigits(y)) throw new Error(`范围无效：${chunk}`);
        a = Number(x); b = Number(y);
      } else {
        if (!isDigits(chunk)) throw new Error(`取值无效：${chunk}`);
        a = Number(chunk); b = step > 1 ? max : a;
      }
      if (a < min || b > max || a > b) throw new Error(`取值超出范围 ${min}-${max}：${chunk}`);
      for (let v = a; v <= b; v += step) set.add(v);
    }
    return set;
  }

  dayMatches(d) {
    const dom = this.fields[2].has(d.day);
    const dow = this.fields[4].has(d.weekday % 7); // luxon: 1=周一 … 7=周日
    if (this.domStar && this.dowStar) return true;
    if (this.domStar) return dow;
    if (this.dowStar) return dom;
    return dom || dow; // 与 Vixie cron 一致
  }

  /** 返回严格晚于 after（秒级时间戳）的下一次执行时间戳 */
  next(after, tz = 'Asia/Shanghai') {
    let d = DateTime.fromSeconds(Math.floor(after / 60) * 60 + 60, { zone: tz || 'Asia/Shanghai' });
    if (!d.isValid) d = DateTime.fromSeconds(Math.floor(after / 60) * 60 + 60, { zone: 'UTC' });
    for (let i = 0; i < 200000; i++) {
      if (!this.fields[3].has(d.month)) { d = d.plus({ months: 1 }).startOf('month'); continue; }
      if (!this.dayMatches(d)) { d = d.plus({ days: 1 }).startOf('day'); continue; }
      if (!this.fields[1].has(d.hour)) { d = d.startOf('hour').plus({ hours: 1 }); continue; }
      if (!this.fields[0].has(d.minute)) { d = d.plus({ minutes: 1 }); continue; }
      return Math.floor(d.toSeconds());
    }
    return null;
  }

  upcoming(after, tz, n = 5) {
    const out = []; let t = after;
    for (let i = 0; i < n; i++) {
      t = this.next(t, tz);
      if (t === null) break;
      out.push(t);
    }
    return out;
  }

  /** 人类可读的中文描述（覆盖常见情况） */
  static describe(expr) {
    const e = String(expr ?? '').trim().toLowerCase();
    const map = { '@yearly': '每年 1 月 1 日 00:00', '@annually': '每年 1 月 1 日 00:00', '@monthly': '每月 1 日 00:00',
      '@weekly': '每周日 00:00', '@daily': '每天 00:00', '@midnight': '每天 00:00', '@hourly': '每小时整点' };
    if (map[e]) return map[e];
    const p = String(expr).trim().split(/\s+/);
    if (p.length !== 5) return expr;
    const [mi, h, dom, mon, dow] = p;
    const wk = ['日', '一', '二', '三', '四', '五', '六', '日'];
    const pad = (n) => String(n).padStart(2, '0');
    let m;
    if (mi === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') return '每分钟';
    if ((m = mi.match(/^\*\/(\d+)$/)) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `每 ${m[1]} 分钟`;
    if (isDigits(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `每小时第 ${mi} 分`;
    if (isDigits(mi) && (m = h.match(/^\*\/(\d+)$/)) && dom === '*' && mon === '*' && dow === '*') return `每 ${m[1]} 小时（第 ${mi} 分）`;
    if (isDigits(mi) && /^[\d,]+$/.test(h) && mon === '*') {
      const t = h.split(',').map((hh) => `${pad(hh)}:${pad(mi)}`).join('、');
      if (dom === '*' && dow === '*') return `每天 ${t}`;
      if (dom === '*' && dow === '1-5') return `工作日 ${t}`;
      if (dom === '*' && /^[\d,]+$/.test(dow)) return '每' + dow.split(',').map((x) => '周' + wk[Number(x)]).join('、') + ` ${t}`;
      if (dow === '*' && /^[\d,]+$/.test(dom)) return `每月 ${dom.replace(/,/g, '、')} 日 ${t}`;
    }
    return expr;
  }
}

export function jobNextRun(cron, tz, after = null) {
  try {
    const n = new CronExpr(cron).next(after ?? Math.floor(Date.now() / 1000), tz);
    return n || 0;
  } catch { return 0; }
}
