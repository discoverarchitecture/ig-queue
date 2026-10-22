// Renders one reel from a spec: node render.mjs specs/<id>.json [--fresh]
// Output: out/<id>/reel.mp4 (1080×1920, 30 fps, ~-14 LUFS), cover.jpg, caption.txt
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recordClip, SITE } from './record.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const specPath = process.argv[2];
const FRESH = process.argv.includes('--fresh');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const OUT = path.join(HERE, 'out', spec.id);
const WORK = path.join(HERE, 'cache', 'work', spec.id);
const CLIPS = path.join(HERE, 'cache', 'clips');
for (const d of [OUT, WORK, CLIPS]) fs.mkdirSync(d, { recursive: true });
const log = (...a) => console.log(`[${spec.id}]`, ...a);
const probe = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

// ---- building data from the live site (cached daily) ----------------------
async function buildings() {
  const f = path.join(HERE, 'cache', 'buildings.json');
  if (!fs.existsSync(f) || Date.now() - fs.statSync(f).mtimeMs > 864e5) {
    const txt = await (await fetch(SITE + 'data/buildings.js')).text();
    fs.writeFileSync(f, txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
  }
  return Object.fromEntries(JSON.parse(fs.readFileSync(f, 'utf8')).map((b) => [b.id, b]));
}
function pickImage(b, i) {
  if (i != null && b.images?.[i]?.license) return b.images[i]; // i = photo number on the site (0-based)
  const imgs = (b.images || []).filter((x) => x.license && !/drawing/i.test(x.kind || '') && !/\.svg$/.test(x.src));
  return imgs.find((x) => x.h > x.w && /exterior/i.test(x.kind || '')) || imgs.find((x) => /exterior/i.test(x.kind || '')) || imgs[0];
}
const cityOf = (b) => (b.place || '').split(',')[0].trim();

// ---- voice -----------------------------------------------------------------
// Speakers: the guide is the house voice (female); in Walk & Talk reels a curious friend (male) asks.
const VOICES = { guide: 'af_heart', friend: 'am_michael' };
// `"tts": "dia"` in a spec voices the whole conversation with Dia (studio/dia.py) instead of line by line.
const DIA_PY = path.join(os.homedir(), 'FindGreatArchitecture', '.dia-venv', 'bin', 'python');
function voice(scenes) {
  const dia = spec.tts === 'dia';
  // Walk & Talk friend: male or female (the guide is always female); unset = a fixed 50/50 pick from the reel id
  const cast = `${spec.friend || (parseInt(crypto.createHash('sha1').update(spec.id).digest('hex').slice(0, 2), 16) % 2 ? 'female' : 'male')}-friend`;
  const lines = scenes.flatMap((s) => (s.lines || []).map((l) => dia
    ? { id: l.id, text: l.say, who: l.who, scene: s.key, engine: 'dia', cast }
    : { id: l.id, text: l.say, voice: VOICES[l.who] || VOICES.guide, speed: spec.voiceSpeed || 1 }));
  if (!lines.length) return {};
  const hash = crypto.createHash('sha1').update(JSON.stringify(lines)).digest('hex').slice(0, 10);
  const dir = path.join(WORK, 'vo-' + hash);
  if (FRESH || !fs.existsSync(path.join(dir, 'done'))) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lines.json'), JSON.stringify(lines));
    log('voicing', lines.length, 'lines');
    if (dia) { log('voicing with Dia,', cast); execFileSync(DIA_PY, [path.join(HERE, 'dia.py'), path.join(dir, 'lines.json'), dir], { stdio: ['ignore', 'inherit', 'inherit'], timeout: 60 * 60e3, env: { ...process.env, DIA_CAST: cast, PYTHONUNBUFFERED: '1' } }); }
    else execFileSync('node', [path.join(HERE, 'voice.mjs'), path.join(dir, 'lines.json'), dir], { stdio: ['ignore', 'ignore', 'inherit'] });
    for (const l of lines) // trim the model's leading/trailing silence
      ff(['-i', `${dir}/${l.id}.wav`, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,aresample=48000', `${dir}/${l.id}.t.wav`]);
    fs.writeFileSync(path.join(dir, 'done'), '');
  }
  const vc = path.join(dir, 'voice-check.json');
  if (fs.existsSync(vc)) fs.copyFileSync(vc, path.join(OUT, 'voice-check.json')); else fs.rmSync(path.join(OUT, 'voice-check.json'), { force: true });
  return Object.fromEntries(lines.map((l) => [l.id, { file: `${dir}/${l.id}.t.wav`, len: probe(`${dir}/${l.id}.t.wav`) }]));
}

// ---- music bed (placeholder, synthesised) ----------------------------------
function music(total, kind) {
  const f = path.join(WORK, `music-${kind}.wav`);
  // A-minor-ish pad; "pulse" adds a soft kick at 100 bpm for silent reels.
  const chord = (fs) => fs.map((h, i) => `0.05*sin(2*PI*${h}*t)*(0.65+0.35*sin(2*PI*${0.07 + i * 0.03}*t))`).join('+');
  const am = chord([110, 164.81, 220, 261.63, 329.63, 493.88]), fmaj = chord([87.31, 130.81, 174.61, 220, 261.63, 392]);
  let expr = `if(lt(mod(t,9.6),4.8),${am},${fmaj})`;
  if (kind === 'pulse') expr += `+0.55*sin(2*PI*52*mod(t,0.6))*exp(-14*mod(t,0.6))+0.04*(random(0)-0.5)*exp(-40*mod(t+0.3,0.6))`;
  ff(['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${(total + 1).toFixed(2)}`, '-af',
    `lowpass=f=2400,aecho=0.8:0.6:70|140:0.35|0.25,afade=t=in:d=0.8,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2`, '-ac', '1', f]);
  return f;
}

// ---- main ------------------------------------------------------------------
const B = await buildings();
const scenes = spec.scenes.map((s, i) => ({ ...s, key: `s${String(i).padStart(2, '0')}` }));
// House rule: every reel ends on the end card with this spoken sign-off (no on-screen caption — the card shows it).
export const SIGNOFF = 'Find Great Architecture dot com. A website built by architects, for architects.';
if (scenes.at(-1)?.type !== 'end') scenes.push({ type: 'end', dur: 3, key: `s${String(scenes.length).padStart(2, '0')}` });
const endScene = scenes.at(-1);
endScene.noCaption = true; endScene.voDelay = 0.5;
if (spec.format === 'talk') endScene.talk = [{ who: 'friend', text: spec.outro || 'Where do I find more like this?' }, { who: 'guide', text: SIGNOFF }];
else endScene.vo = SIGNOFF;
// Every scene's speech as a list of lines: a Walk & Talk exchange, or the single narration line.
for (const s of scenes) s.lines = (s.talk ? s.talk.map((l, n) => ({ id: `${s.key}_${n}`, who: l.who === 'friend' ? 'friend' : 'guide', say: l.text })) : s.vo ? [{ id: s.key, who: 'guide', say: s.vo }] : [])
  .map((l) => ({ ...l, text: l.say.replace(/\s*\([^)]*\)\s*/g, ' ').trim() })); // "(laughs)" is voiced, never shown
const silentStyle = !scenes.some((s) => s.lines.length && s.type !== 'end');

/** Download once into cache/img (with retries) so slow networks don't stall rendering. */
async function localImage(url) {
  const dir = path.join(HERE, 'cache', 'img');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + path.extname(new URL(url).pathname));
  for (let attempt = 1; !fs.existsSync(f); attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(f + '.part', Buffer.from(await r.arrayBuffer()));
      fs.renameSync(f + '.part', f);
    } catch (e) { if (attempt >= 4) throw new Error(`could not download ${url}: ${e.message}`); log(`retrying image (${e.message})`); }
  }
  return pathToFileURL(f).href;
}

for (const s of scenes) {
  if (s.b) {
    const b = B[s.b];
    if (!b) throw new Error(`unknown building id: ${s.b}`);
    const im = pickImage(b, s.i);
    s.img = await localImage(new URL(im.src, SITE).href);
    const who = im.credit.replace(/\s+/g, ' ').replace(/\s*\(based on copyright claims\)\.?/i, '').trim();
    s.credit = `${who.length > 48 ? who.slice(0, 46) + '…' : who} · ${im.license}`;
    s.creditFull = `${b.name} – ${im.credit.replace(/\s+/g, ' ').trim()} (${im.license})`;
    if (s.label !== false) s.label = { name: s.label?.name || b.name, meta: s.label?.meta || `${b.by} · <b>${b.year}</b> · ${cityOf(b)}` };
    else delete s.label;
  }
}

const VO = voice(scenes);
for (const s of scenes) {
  if (s.type === 'site') {
    const opts = { clip: s.clip, ...(s.args || {}) };
    const name = s.clip + '-' + crypto.createHash('sha1').update(JSON.stringify(opts)).digest('hex').slice(0, 8);
    const meta = path.join(CLIPS, name + '.json');
    if (FRESH || !fs.existsSync(meta)) { log('recording site clip', s.clip); await recordClip(name, opts, CLIPS); }
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    s.video = pathToFileURL(path.join(CLIPS, name + '.mp4')).href;
    if (s.fromMark) s.clipStart = Math.max(0, m.marks[s.fromMark] - (s.lead ?? 0.8));
    s.dur = s.dur || m.duration - (s.clipStart || 0);
  }
  let at = s.voDelay ?? 0.15;
  for (const l of s.lines) { l.at = at; l.len = VO[l.id].len; at += l.len + (s.talk ? 0.18 : 0); }
  if (s.lines.length) s.dur = Math.max(s.dur || 0, at + 0.35);
}
let t = 0;
for (const s of scenes) { s.start = +t.toFixed(3); t += s.dur; }
const total = +t.toFixed(3);

// captions: each voiced line split into short chunks, timed by character count
const captions = [];
for (const s of scenes) if (s.talk && !s.noCaption) {
  s.lines.forEach((l, n) => {
    const next = s.lines[n + 1];
    captions.push({ t0: +(s.start + l.at).toFixed(3), t1: +(next ? s.start + next.at : s.start + s.dur).toFixed(3), speak: +l.len.toFixed(3), text: l.text, who: l.who, scene: s.key });
  });
}
for (const s of scenes) if (s.vo && !s.talk && !s.noCaption) {
  const t0 = s.start + (s.voDelay ?? 0.15), len = VO[s.key].len;
  const ws = s.vo.split(/\s+/), chunks = [];
  for (let i = 0; i < ws.length;) { let n = Math.min(5, ws.length - i); if (ws.length - i - n === 1) n++; chunks.push(ws.slice(i, i + n).join(' ')); i += n; }
  const totalChars = chunks.reduce((a, c) => a + c.length + 2, 0);
  let at = t0;
  for (const c of chunks) { const d = len * (c.length + 2) / totalChars; captions.push({ t0: +at.toFixed(3), t1: +(at + d).toFixed(3), text: c }); at += d; }
}
log(`timeline ${total.toFixed(1)}s:`, scenes.map((s) => `${s.type}${s.b ? ':' + s.b : s.clip ? ':' + s.clip : ''} ${s.dur.toFixed(1)}s`).join(' | '));

// ---- frames → video -----------------------------------------------------------
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
page.setDefaultTimeout(300000);
await page.goto(pathToFileURL(path.join(HERE, 'stage.html')).href, { waitUntil: 'load' });
await page.evaluate((sp) => window.load(sp), { scenes, captions, talk: spec.format === 'talk' });
const silent = path.join(WORK, 'video.mp4');
const enc = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent], { stdio: ['pipe', 'inherit', 'inherit'] });
const frames = Math.round(total * FPS);
// Review sheet: one frame per scene, taken mid-line, shown next to what is being said.
const reviewAt = new Map(scenes.map((s, i) => {
  const l = s.lines.at(-1);
  const mid = l ? s.start + l.at + l.len * 0.7 : s.start + s.dur * 0.6;
  return [Math.min(frames - 1, Math.round(mid * FPS)), i];
}));
const reviewShots = [];
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate((tt) => window.seek(tt), f / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
  if (reviewAt.has(f)) reviewShots[reviewAt.get(f)] = buf.toString('base64');
  if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
  if (f % 150 === 0) log(`frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
enc.stdin.end();
await new Promise((r) => enc.on('close', r));
// cover: render the chosen moment as a still
await page.evaluate((tt) => window.seek(tt), spec.coverAt ?? 1.0);
await page.evaluate(() => { document.getElementById('cap').innerHTML = ''; });
await page.screenshot({ type: 'jpeg', quality: 92, path: path.join(OUT, 'cover.jpg') });
const escH = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cells = scenes.map((s, i) => `<figure><img src="data:image/jpeg;base64,${reviewShots[i] || ''}"><figcaption><b>${i + 1}</b> ${escH(s.type)}${s.b ? ` · ${escH(s.b)} #${s.i ?? 'auto'}` : ''}${s.clip ? ` · ${escH(s.clip)}` : ''} · ${s.dur.toFixed(1)}s
  <p>${s.lines.length ? s.lines.map((l) => (l.who === 'friend' ? '🙋 ' : '🔊 ') + '“' + escH(l.text) + '”').join('<br>') : s.title ? '🅣 ' + escH(s.title) : ''}</p></figcaption></figure>`).join('');
const rp = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await rp.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:20px;width:1560px;font:15px system-ui,sans-serif}h1{font-size:22px;margin:0 0 12px}
  .g{display:flex;flex-wrap:wrap;gap:14px}figure{margin:0;width:290px}img{width:290px;height:516px;object-fit:cover;display:block;border-radius:8px;background:#111}
  figcaption{margin-top:6px;color:#555}b{color:#DA3A26;font-size:18px}p{margin:4px 0 0;color:#111;font-size:15px;line-height:1.35}</style>
  <h1>${escH(spec.id)} — does each picture show what's being said?</h1><div class="g">${cells}</div>`);
await rp.screenshot({ path: path.join(OUT, 'review.jpg'), fullPage: true, type: 'jpeg', quality: 82 });
await browser.close();

// ---- audio -----------------------------------------------------------------
const voiced = scenes.flatMap((s) => s.lines.map((l) => ({ file: VO[l.id].file, at: s.start + l.at })));
const bed = music(total, spec.music || (silentStyle ? 'pulse' : 'pad'));
// Silent-style reels play the music up front and duck it under the spoken sign-off.
const vol = silentStyle ? `'if(lt(t,${endScene.start.toFixed(2)}),0.9,0.3)'` : '0.32';
const inputs = ['-i', bed], chains = [`[0:a]volume=${vol}:eval=frame[m]`];
voiced.forEach((v, i) => {
  inputs.push('-i', v.file);
  const d = Math.round(v.at * 1000);
  chains.push(`[${i + 1}:a]adelay=${d}|${d}[v${i}]`);
});
const mixIn = '[m]' + voiced.map((_, i) => `[v${i}]`).join('');
const audio = path.join(WORK, 'audio.wav');
ff([...inputs, '-filter_complex', chains.join(';') + `;${mixIn}amix=inputs=${voiced.length + 1}:normalize=0:duration=first,atrim=0:${total},loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[a]`,
  '-map', '[a]', '-ac', '2', audio]);
ff(['-i', silent, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', path.join(OUT, 'reel.mp4')]);

// ---- caption ---------------------------------------------------------------
let caption = spec.caption.trim();
const TAGLINE = 'findgreatarchitecture.com — a website built by architects, for architects.';
if (!caption.includes('built by architects')) caption = caption.replace(/\n\n(#\S+(?:\s+#\S+)*)\s*$/, `\n\n${TAGLINE}\n\n$1`);
const credits = [...new Set(scenes.filter((s) => s.creditFull).map((s) => s.creditFull))];
if (credits.length && !/^Photos?:/m.test(caption)) caption += `\n\nPhotos: ${credits.join('; ')}`;
if (scenes.some((s) => s.type === 'site')) caption += credits.length ? '' : '\n\nPhotos: building photos shown are credited on each building\'s page on findgreatarchitecture.com.';
fs.writeFileSync(path.join(OUT, 'caption.txt'), caption + '\n');
log(`done: ${path.join(OUT, 'reel.mp4')} · ${probe(path.join(OUT, 'reel.mp4')).toFixed(1)}s · ${(fs.statSync(path.join(OUT, 'reel.mp4')).size / 1e6).toFixed(1)} MB · render ${((Date.now() - t0) / 1000).toFixed(0)}s`);
