// Checks a Walk & Talk spec BEFORE the 7-minute Dia render, against the failures we have actually hit.
// usage: node check-spec.mjs specs/<id>.json        exit 1 = fix the listed errors first
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) { console.error('usage: node check-spec.mjs specs/<id>.json'); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const B = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, 'cache', 'buildings.json'), 'utf8')).map((b) => [b.id, b]));
const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const words = (t) => t.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

// ---- header ---------------------------------------------------------------
if (spec.format !== 'talk' || spec.pillar !== 'talk' || spec.tts !== 'dia') err('header must have "format":"talk", "pillar":"talk", "tts":"dia"');
if (!/^dia-[a-z0-9-]+$/.test(spec.id || '')) err('"id" must look like dia-<building-slug>');
if (spec.friend && !['male', 'female'].includes(spec.friend)) err('"friend" must be "male" or "female" (or leave it out)');
if (spec.voiceSpeed) warn('"voiceSpeed" is ignored by Dia — remove it');
if (typeof spec.coverAt !== 'number') warn('add "coverAt": 1.4 (seconds into the reel for the cover frame)');

const scenes = spec.scenes || [];
const photos = scenes.filter((s) => s.type === 'photo');
const end = scenes.at(-1);
if (scenes.some((s) => s.type !== 'photo' && s.type !== 'end')) err('Walk & Talk uses only "photo" scenes and one final "end" scene');
if (!end || end.type !== 'end') err('the last scene must be {"type":"end","line":"…","accent":[…],"dur":3}');
if (photos.length < 4 || photos.length > 5) err(`use 4–5 photo scenes (one question per photo); found ${photos.length}`);

// ---- the lines ------------------------------------------------------------
const lines = [];
photos.forEach((s, i) => {
  const where = `scene ${i + 1}`;
  const b = B[s.b];
  if (!b) { err(`${where}: unknown building "${s.b}" (ids are in cache/buildings.json)`); return; }
  const im = b.images[s.i];
  if (!im) err(`${where}: ${s.b} has no photo #${s.i} (0–${b.images.length - 1})`);
  else {
    if (!im.license) err(`${where}: ${s.b}#${s.i} has no licence — pick another photo`);
    if (/drawing|plan|section|diagram|model|sketch/i.test(im.kind || '')) warn(`${where}: ${s.b}#${s.i} is a ${im.kind} — use real photos`);
    if (im.w && im.h && Math.max(im.w, im.h) < 1200) warn(`${where}: ${s.b}#${s.i} is small (${im.w}×${im.h}) and may look soft`);
  }
  if (!Array.isArray(s.talk) || !s.talk.length) { err(`${where}: needs "talk":[{who,text}]`); return; }
  s.talk.forEach((l) => lines.push({ ...l, scene: i }));
  if (i === 0) {
    if (s.talk.length !== 1 || s.talk[0].who !== 'friend') err('scene 1 must be exactly ONE friend line (the hook question, spoken in the first second)');
    if (s.label !== false) err('scene 1 needs "label": false (no title over the hook)');
    if (!s.fill) warn('scene 1 should have "fill": true and "move": "in" (full-screen striking photo)');
    if (s.voDelay === undefined) warn('scene 1 should have "voDelay": 0.05');
  } else if (i === 1) {
    if (s.talk.length !== 1 || s.talk[0].who !== 'guide') warn('scene 2 is normally ONE guide line naming the building');
  } else {
    if (s.talk[0].who !== 'friend' || s.talk[1]?.who !== 'guide') err(`${where}: expected friend question then guide answer`);
    if (!s.label || !s.label.name || !s.label.meta) err(`${where}: needs "label":{"name":"…","meta":"…"} naming the idea shown`);
  }
});
if (end && end.type === 'end' && !/site|more|\d/i.test(end.line || '')) warn('end "line" should point to the site: e.g. "345 buildings lit from above on the site"');

// the site grows every day: counts on the end card and in the caption must be rounded DOWN to ten with a "+"
for (const [where, txt] of [['end line', end?.line || ''], ['caption', spec.caption || '']]) {
  for (const m of txt.matchAll(/\b(\d{2,4})(\+?)\s+(?:more\s+)?(?:\w+\s+){0,3}?(buildings|courtyards?|houses)\b/gi)) {
    if (!m[2] && Number(m[1]) % 10 !== 0) warn(`${where}: "${m[0]}" — write counts rounded down to ten with "+", e.g. "${Math.floor(m[1] / 10) * 10}+"`);
  }
}

// ---- line rules -----------------------------------------------------------
let chars = 0, laughs = 0;
lines.forEach((l, k) => {
  const w = words(l.text), sentences = l.text.replace(/\([^)]*\)/g, '').split(/[.!?]+\s/).filter((x) => x.trim()).length;
  chars += l.text.replace(/\([^)]*\)/g, '').length;
  laughs += (l.text.match(/\(laughs\)/g) || []).length;
  if (!['friend', 'guide'].includes(l.who)) err(`line "${l.text.slice(0, 30)}…": "who" must be friend or guide`);
  const tags = l.text.match(/\([^)]*\)/g) || [];
  if (tags.some((t) => t !== '(laughs)')) err(`"${l.text.slice(0, 30)}…": the only voice tag allowed is (laughs)`);
  if (/[#*_\[\]{}<>]/.test(l.text.replace(/\([^)]*\)/g, ''))) err(`"${l.text.slice(0, 30)}…": plain words only — no symbols`);
  if (/\b\d{1,3}(,\d{3})+\b|\b\d{4,}\b/.test(l.text.replace(/\bc\.?\s?\d{3,4}\b/, ''))) warn(`"${l.text.slice(0, 30)}…": write big numbers as words ("two thousand"), Dia reads digits badly`);
  if (l.who === 'friend' && w.length > 14) err(`friend line is ${w.length} words (max 14): "${l.text}"`);
  if (l.who === 'guide' && (w.length > 26 || sentences > 2)) err(`guide line is ${w.length} words / ${sentences} sentences (max 26 / 2): "${l.text}"`);
  if (l.who === 'friend' && !/[?!]$|\.$/.test(l.text.trim())) warn(`friend line has no end punctuation: "${l.text}"`);
  // Dia swaps voices when a line repeats the neighbouring line's words (hit on the Pantheon: "Two thousand years?")
  const prev = lines[k - 1];
  if (prev && prev.who !== l.who) {
    const a = norm(prev.text), b = norm(l.text);
    const grams = (x) => new Set(x.slice(0, -2).map((_, i) => x.slice(i, i + 3).join(' ')));
    const ga = grams(a);
    if ([...grams(b)].some((g) => ga.has(g))) err(`"${l.text}" repeats 3+ words from the line before it — Dia then speaks it in the other voice. Reword it.`);
    if (a.length >= 2 && b.length >= 2 && a.slice(-2).join(' ') === b.slice(0, 2).join(' ')) err(`"${l.text}" starts with the last words of the previous line — reword`);
  }
});
if (laughs > 1) err(`${laughs} (laughs) — use at most one per reel`);
if (chars < 330 || chars > 560) warn(`${chars} spoken characters: aim for 330–560 (≈ 25–33 s with the sign-off)`);
if (lines.filter((l) => l.who === 'friend').length < 3) warn('fewer than 3 friend questions — one per photo');

// ---- picture = words: facts must come from the site's own record -------------
const mainB = B[photos[0]?.b];
if (mainB) {
  const body = lines.map((l) => l.text).join(' ');
  const years = [...body.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((m) => m[1]);
  for (const y of years) if (String(mainB.year) !== y && !String(mainB.year).includes(y)) warn(`year ${y} is not the site's year for ${mainB.name} (${mainB.year}) — check it`);
}

// ---- caption --------------------------------------------------------------
const cap = spec.caption || '';
const tags = cap.match(/#[\p{L}\p{N}_]+/gu) || [];
if (!cap) err('"caption" missing');
else {
  const first = cap.split('\n')[0];
  if (!/\?|…|\.\.\./.test(first)) warn('caption line 1 should be the hook question (the first line is all people see)');
  if (tags.length < 3 || tags.length > 5) err(`caption has ${tags.length} hashtags (3–5 allowed, hard max 5)`);
  if (!/link in bio/i.test(cap)) err('caption needs a "→ link in bio" call to action');
  if (!/→/.test(cap)) warn('use "Explore it and N more … → link in bio"');
  const beforeTags = cap.split('\n').filter((x) => x.trim() && !x.trim().startsWith('#')).at(-1) || '';
  if (!/\?\s*$/.test(beforeTags)) err('the last sentence before the hashtags must be a question to the viewer (drives comments)');
  if (/findgreatarchitecture\.com\s*[—-]/i.test(cap) || /^Photos?:/m.test(cap)) warn('do NOT write the tagline or the "Photos:" credits line — the studio adds both');
  if (cap.length > 1200) warn('caption is long; keep it under ~600 characters');
}

// ---- report ---------------------------------------------------------------
console.log(`${spec.id}: ${photos.length} photos, ${lines.length} lines, ${chars} spoken chars, ${tags.length} hashtags`);
for (const w of warns) console.log('  warn  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
if (errors.length) { console.log(`\n${errors.length} error(s): fix, then re-run.`); process.exit(1); }
console.log('OK — safe to render: node render.mjs ' + file);
