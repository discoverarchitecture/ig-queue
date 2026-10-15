// Records phone-sized (1080×1920) clips of the live site with Chrome, via CDP
// screencast. Taps show a soft circle so viewers can follow. Each clip writes
// <name>.mp4 plus <name>.json with the time of every tap ("marks").
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const SITE = 'https://findgreatarchitecture.com/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAP_CSS = `.__tap{position:fixed;z-index:99999;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;
  background:rgba(17,17,16,.22);border:2px solid rgba(255,255,255,.95);pointer-events:none;animation:__t .55s ease-out forwards}
  @keyframes __t{0%{transform:scale(.4);opacity:0}30%{transform:scale(1);opacity:1}100%{transform:scale(1.3);opacity:0}}
  ::-webkit-scrollbar{display:none}`;

async function tap(p, target, label) {
  const el = typeof target === 'string' ? p.locator(target).first() : target;
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await p.evaluate(([x, y]) => {
    const d = document.createElement('div'); d.className = '__tap'; d.style.left = x + 'px'; d.style.top = y + 'px';
    document.body.appendChild(d); setTimeout(() => d.remove(), 650);
  }, [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(200);
  if (label) p.mark(label);
  await el.click();
}

async function glide(p, by, ms, sel) {
  await p.evaluate(([by, ms, sel]) => new Promise((res) => {
    const el = sel ? document.querySelector(sel) : document.scrollingElement;
    const from = el.scrollTop, t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    (function step(now) { const t = Math.min(1, (now - t0) / ms); el.scrollTop = from + by * ease(t); t < 1 ? requestAnimationFrame(step) : res(); })(t0);
  }), [by, ms, sel || null]);
}

/** Make the next `Surprise me` taps land on these building ids, in order. */
async function rigSurprise(p, ids) {
  await p.evaluate((ids) => {
    const n = window.BUILDINGS.length;
    const queue = ids.map((id) => window.BUILDINGS.findIndex((b) => b.id === id)).filter((i) => i >= 0);
    const real = Math.random;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#surprise, button.go') || !queue.length) return;
      const i = queue.shift();
      Math.random = () => (i + 0.5) / n;
      setTimeout(() => (Math.random = real), 400);
    }, true);
  }, ids);
}

/** Today's first Daily-five question: try each option in a throwaway page and see which one the game marks right. */
async function findRightAnswer(p) {
  // A separate context: the game remembers today's progress in localStorage.
  // After any tap it marks the correct option with class "right".
  const ctx = await p.context().browser().newContext({ viewport: { width: 390, height: 693 } });
  const q = await ctx.newPage();
  await q.goto(p.url(), { waitUntil: 'networkidle' });
  await q.click('#begin'); await q.waitForTimeout(1500);
  await q.locator('button.opt').first().click(); await q.waitForTimeout(600);
  const i = await q.evaluate(() => [...document.querySelectorAll('button.opt')].findIndex((e) => e.classList.contains('right')));
  await ctx.close();
  if (i < 0) throw new Error('could not find the right answer in today\'s Daily five');
  return i;
}

export const CLIPS = {
  /** Home wall → Surprise me ×3 (rigged to photogenic buildings). */
  async surprise(p, { ids = [] } = {}) {
    await rigSurprise(p, ids);
    await sleep(900);
    await glide(p, 500, 1400);
    await sleep(300);
    for (let i = 0; i < Math.max(1, ids.length); i++) {
      await tap(p, p.locator('button:has-text("Surprise me"):visible').last(), `surprise${i + 1}`);
      await sleep(2600);
      await glide(p, 420, 900, '.info');
      await sleep(900);
    }
  },
  /** Type an architect/building into search and let the wall filter. */
  async search(p, { query }) {
    await sleep(700);
    await tap(p, '#q', 'search');
    await p.keyboard.type(query, { delay: 85 });
    p.mark('typed');
    await sleep(1400);
    await glide(p, 900, 3200);
    await sleep(700);
  },
  /** Tap one idea chip in the top bar and scroll the filtered wall. */
  async idea(p, { idea }) {
    await sleep(700);
    await tap(p, p.locator(`button.idea:has-text("${idea}")`), 'idea');
    await sleep(1300);
    await glide(p, 1100, 3400);
    await sleep(600);
  },
  /** Slow scroll of the home wall. */
  async wall(p, { by = 2400, ms = 6500 } = {}) {
    await sleep(800); await glide(p, by, ms); await sleep(500);
  },
  /** Guess the building → Daily five: start, then tap the right answer. */
  async play(p, { answerIndex = 'auto' } = {}) {
    if (answerIndex === 'auto') answerIndex = await findRightAnswer(p);
    await sleep(1400);
    await tap(p, '#begin', 'begin');
    await sleep(3200);
    await tap(p, p.locator('button.opt').nth(answerIndex), 'answer');
    await sleep(2600);
  },
};

export async function recordClip(name, opts, outDir) {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 693 }, deviceScaleFactor: 2.77, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.setDefaultTimeout(240000);
  await p.goto(opts.url || SITE, { waitUntil: 'networkidle', timeout: 240000 });
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: TAP_CSS });
  const marks = [];
  p.mark = (label) => marks.push([label, Date.now() / 1000]);
  await sleep(800);
  const dir = path.join(outDir, `${name}_frames`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(dir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push([file, f.metadata.timestamp]);
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920 });
  await CLIPS[opts.clip](p, opts);
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await b.close();
  const list = frames.map(([f, t], i) => `file '${f}'\nduration ${Math.max(0.001, (i + 1 < frames.length ? frames[i + 1][1] : t1) - t).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1)[0]}'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  const mp4 = path.join(outDir, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', mp4]);
  fs.rmSync(dir, { recursive: true, force: true });
  const f0 = frames[0][1];
  const meta = { duration: +(t1 - f0).toFixed(3), marks: Object.fromEntries(marks.map(([l, t]) => [l, +(t - f0).toFixed(3)])) };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(meta));
  return { file: mp4, ...meta };
}
