// Shared helpers for the tick job, site build and local sync.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
export const DAY = 864e5;
export const HOUR = 36e5;

export function readJSON(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}
export function writeJSON(rel, obj) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}
export function readText(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; }
}
export function writeText(rel, s) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}

// ---- Encryption ----------------------------------------------------------
// AES-256-GCM, stored as base64(iv[12] | ciphertext | tag[16]) — the same
// layout WebCrypto produces, so the dashboard can decrypt it in the browser.
function keyBuf(keyB64) {
  const key = Buffer.from(keyB64 || '', 'base64');
  if (key.length !== 32) throw new Error('FGA_KEY must be 32 random bytes, base64-encoded');
  return key;
}
export function encrypt(plain, keyB64) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBuf(keyB64), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64') + '\n';
}
export function decrypt(b64, keyB64) {
  const buf = Buffer.from(b64.trim(), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', keyBuf(keyB64), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8');
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- Time zones ------------------------------------------------------------
function tzOffsetMin(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime()) / 6e4;
}
/** Wall-clock date + time in `tz` → UTC Date (DST-aware). */
export function zonedToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, h, mi);
  let off = tzOffsetMin(new Date(naive), tz);
  off = tzOffsetMin(new Date(naive - off * 6e4), tz);
  return new Date(naive - off * 6e4);
}
export const ymdInTz = (date, tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---- Instagram Graph API (Instagram Login) ------------------------------
export class IG {
  constructor(token) { this.token = token; this.base = `https://graph.instagram.com/${CONFIG.apiVersion}`; }
  async req(method, p, params = {}) {
    const url = new URL(p.startsWith('http') ? p : this.base + p);
    const init = { method, headers: { Authorization: `Bearer ${this.token}` } };
    if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    else init.body = new URLSearchParams(params);
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const e = json.error || {};
      throw new Error(`IG ${method} ${p}: ${e.message || res.status}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}`);
    }
    return json;
  }
  get(p, params) { return this.req('GET', p, params); }
  post(p, params) { return this.req('POST', p, params); }
}

// ---- GitHub REST -----------------------------------------------------------
export async function gh(method, p, body) {
  const res = await fetch(`https://api.github.com${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub ${method} ${p}: ${res.status} ${json.message || ''}`);
  return json;
}

// ---- Git -----------------------------------------------------------------
export function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
