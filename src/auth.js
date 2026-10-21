/**
 * 无状态会话：HMAC 签名 Cookie（Serverless 没有共享的 PHP Session 存储）
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { setting, settingSet, randomHex } from './settings.js';

const COOKIE = 'cronpro_s';
const FLASH = 'cronpro_f';

async function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = setting('session_secret');
  if (!s) { s = randomHex(32); await settingSet('session_secret', s); }
  return s;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

async function sign(data) {
  return createHmac('sha256', await secret()).update(data).digest('base64url');
}

async function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.', 2);
  const expect = await sign(data);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(unb64(data));
    if (obj.exp && obj.exp < Date.now() / 1000) return null;
    return obj;
  } catch { return null; }
}

const isSecure = (c) => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';

/** 读取会话（未登录时也会有一个只含 csrf 的匿名会话） */
export async function getSession(c) {
  if (c.get('session')) return c.get('session');
  let s = await verify(getCookie(c, COOKIE));
  if (!s) {
    s = { csrf: randomHex(16), exp: Math.floor(Date.now() / 1000) + 86400 };
    await saveSession(c, s);
  }
  c.set('session', s);
  return s;
}

export async function saveSession(c, s, maxAge = null) {
  const age = maxAge ?? (s.exp ? s.exp - Math.floor(Date.now() / 1000) : 86400);
  const data = b64(JSON.stringify(s));
  setCookie(c, COOKIE, `${data}.${await sign(data)}`, { path: '/', httpOnly: true, sameSite: 'Lax', secure: isSecure(c), maxAge: Math.max(60, age) });
  c.set('session', s);
}

export async function login(c, user, remember) {
  const ttl = remember ? 30 * 86400 : 12 * 3600;
  // 绑定密码哈希的片段：修改密码后旧会话自动失效
  await saveSession(c, { u: user, csrf: randomHex(16), exp: Math.floor(Date.now() / 1000) + ttl, pv: setting('admin_pass').slice(-12) }, ttl);
}

export function logout(c) {
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function isLoggedIn(c) {
  const s = await getSession(c);
  return !!s.u && s.pv === setting('admin_pass').slice(-12);
}

export async function csrfToken(c) {
  return (await getSession(c)).csrf;
}

export async function csrfOk(c, form) {
  const s = await getSession(c);
  const t = (form && form._csrf) || c.req.header('x-csrf') || '';
  if (!t || !s.csrf) return false;
  const a = Buffer.from(String(t)), b = Buffer.from(s.csrf);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- 闪存消息（一次性提示） ---------- */
export function flash(c, msg, type = 'ok') {
  const list = c.get('flashOut') || [];
  list.push([type, msg]);
  c.set('flashOut', list);
  setCookie(c, FLASH, b64(JSON.stringify(list)), { path: '/', httpOnly: true, sameSite: 'Lax', secure: isSecure(c), maxAge: 120 });
}

export function takeFlash(c) {
  const raw = getCookie(c, FLASH);
  if (!raw) return [];
  deleteCookie(c, FLASH, { path: '/' });
  try { return JSON.parse(unb64(raw)); } catch { return []; }
}
