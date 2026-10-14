// Contact sheet of every photo of the given buildings, numbered as on the site,
// so each voiceover line can be matched to the photo that actually shows it.
// usage: node candidates.mjs <building-id> [...] → out/_candidates/<ids>.jpg
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from './record.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ids = process.argv.slice(2);
const B = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, 'cache', 'buildings.json'), 'utf8')).map((b) => [b.id, b]));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rows = ids.map((id) => {
  const b = B[id];
  if (!b) throw new Error('unknown id ' + id);
  const cells = b.images.map((im, i) => `<figure><img src="${new URL(im.src, SITE).href}"><figcaption><b>${i}</b> ${esc(im.kind || '')} ${im.w > im.h ? '▭' : '▯'}${im.license ? '' : ' ⚠ no licence'}<br>${esc((im.caption || '').replace(/^\w+ · /, '').slice(0, 60))}</figcaption></figure>`).join('');
  return `<h2>${esc(b.name)} <small>${esc(id)}</small></h2><div class="row">${cells}</div>`;
}).join('');
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:16px;font:14px Barlow,system-ui,sans-serif;background:#fff;width:1568px}
h2{margin:14px 0 6px;font-size:20px}small{color:#888;font-weight:400}.row{display:flex;flex-wrap:wrap;gap:8px}
figure{margin:0;width:300px}img{width:300px;height:220px;object-fit:cover;display:block;background:#eee}figcaption{font-size:12px;line-height:1.3;margin-top:3px}b{font-size:16px;color:#DA3A26}</style>${rows}`;
const out = path.join(HERE, 'out', '_candidates');
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.setContent(html, { waitUntil: 'networkidle' });
const file = path.join(out, ids.join('+').slice(0, 120) + '.jpg');
await p.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 80 });
await b.close();
console.log(file);
