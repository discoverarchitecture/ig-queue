// Quick stills of a spec's pictures (no voice, no video): node preview.mjs specs/<id>.json → out/<id>/preview.jpg
// Use it to frame `focus` / `fit` shots before the long Dia render.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const scenes = spec.scenes.filter((s) => s.type === 'photo' && s.src).map((s, i) => ({ ...s, img: pathToFileURL(path.resolve(HERE, s.src)).href, start: i * 3, dur: 3, label: s.label || undefined }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
await page.goto(pathToFileURL(path.join(HERE, 'stage.html')).href);
await page.evaluate((sp) => window.load(sp), { scenes, captions: [], talk: true });
const shots = [];
for (const s of scenes) { await page.evaluate((t) => window.seek(t), s.start + 1.5); shots.push((await page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64')); }
const rp = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await rp.setContent(`<body style="margin:12px;display:flex;flex-wrap:wrap;gap:10px;width:1576px">` + shots.map((b, i) => `<div style="position:relative"><img src="data:image/jpeg;base64,${b}" style="width:300px;display:block"><div style="position:absolute;inset:0 39px;border-left:1px dashed red;border-right:1px dashed red"></div><b style="position:absolute;top:4px;left:8px;color:#fff;background:#000;padding:2px 6px">${i + 1}</b></div>`).join(''));
fs.mkdirSync(path.join(HERE, 'out', spec.id), { recursive: true });
await rp.screenshot({ path: path.join(HERE, 'out', spec.id, 'preview.jpg'), fullPage: true, type: 'jpeg', quality: 82 });
await browser.close();
console.log('out/' + spec.id + '/preview.jpg');
