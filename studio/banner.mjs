// YouTube channel banner (2560×1440): a light wall of building photos like the site's home
// page, with the wordmark, tagline and address on a white panel inside YouTube's
// all-devices safe area (1546×423, centred). Only public-domain / CC0 photos, so the
// banner needs no on-image credits. usage: node banner.mjs → ~/FindGreatArchitecture/brand/
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = 'https://findgreatarchitecture.com/';
const OUT = path.join(os.homedir(), 'FindGreatArchitecture', 'brand');
fs.mkdirSync(OUT, { recursive: true });
const B = JSON.parse(fs.readFileSync(path.join(HERE, 'cache', 'buildings.json'), 'utf8'));

const picks = [];
const seen = new Set();
for (const b of B) {
  // Only the main wall photo: it is the one checked by eye to show the building (site rule).
  const i = 0, im0 = (b.images || [])[0];
  if (!im0 || !/^(CC0|Public domain)/i.test(im0.license || '') || /drawing|plan|model/i.test(im0.kind || '') || seen.has(b.id)) continue;
  seen.add(b.id);
  picks.push({ id: b.id, src: b.images[i].src, w: b.images[i].w, h: b.images[i].h, license: b.images[i].license });
  if (picks.length >= 110) break;
}

async function local(url) {
  const dir = path.join(HERE, 'cache', 'img');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + path.extname(new URL(url).pathname));
  for (let n = 1; !fs.existsSync(f); n++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(r.status);
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    } catch (e) { if (n >= 3) return null; }
  }
  return pathToFileURL(f).href;
}
for (const p of picks) p.file = await local(new URL(p.src, SITE).href);
const imgs = picks.filter((p) => p.file);

// Masonry: 11 columns; each column takes photos until it overflows the banner.
const COLS = 11, GAP = 14, W = 2560, H = 1440, colW = (W - GAP * (COLS + 1)) / COLS;
let k = 0;
const columns = Array.from({ length: COLS }, (_, c) => {
  let y = -[60, 180, 20, 240, 110, 0, 200, 70, 150, 30, 190][c]; // staggered starts, like the wall
  const items = [];
  while (y < H) {
    const p = imgs[k++ % imgs.length];
    const h = Math.round(colW * Math.min(1.35, Math.max(0.7, p.h / p.w)));
    items.push(`<img src="${p.file}" style="height:${h}px">`);
    y += h + GAP;
  }
  return `<div class="col" style="margin-top:${-[60, 180, 20, 240, 110, 0, 200, 70, 150, 30, 190][c]}px">${items.join('')}</div>`;
}).join('');

const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(HERE, 'fonts', 'fonts.css')).href}">
<style>
*{margin:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;background:#FFFFFF;position:relative}
.wall{position:absolute;inset:0;display:flex;gap:${GAP}px;padding:0 ${GAP}px}
.col{flex:1;display:flex;flex-direction:column;gap:${GAP}px}
.col img{width:100%;object-fit:cover;display:block}
.veil{position:absolute;inset:0;background:radial-gradient(ellipse 1150px 430px at 50% 50%, rgba(255,255,255,.92) 0%, rgba(255,255,255,.55) 58%, rgba(255,255,255,0) 100%)}
.panel{position:absolute;left:50%;top:50%;width:1500px;height:380px;transform:translate(-50%,-50%);background:#FFFFFF;border-radius:18px;
  box-shadow:0 18px 60px rgba(17,17,16,.16);display:flex;align-items:center;gap:64px;padding:0 84px}
.mark{font:900 128px/.84 'Big Shoulders Display';text-transform:uppercase;color:#111110;letter-spacing:-.005em;white-space:nowrap}
.mark .accent{color:#DA3A26}
.rule{width:2px;align-self:stretch;margin:84px 0;background:#E6E4DF}
.side{display:flex;flex-direction:column;gap:22px}
.tag{font:600 46px/1.2 'Barlow';color:#111110}
.url{font:600 34px 'Barlow Condensed';letter-spacing:.04em;color:#5D5C57}
</style>
<div class="wall">${columns}</div><div class="veil"></div>
<div class="panel"><div class="mark">Find great<br><span class="accent">Architecture.</span></div><div class="rule"></div>
<div class="side"><div class="tag">Built by architects,<br>for architects.</div><div class="url">findgreatarchitecture.com</div></div></div>`;
const htmlFile = path.join(HERE, 'cache', 'banner.html');
fs.writeFileSync(htmlFile, html);
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
await p.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 300000 });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: path.join(OUT, 'youtube-banner.jpg'), type: 'jpeg', quality: 90 });
await b.close();
fs.writeFileSync(path.join(OUT, 'youtube-banner-photos.json'), JSON.stringify(imgs.map(({ id, license }) => ({ id, license })), null, 1));
console.log('banner saved', path.join(OUT, 'youtube-banner.jpg'), '·', imgs.length, 'public-domain/CC0 photos');
