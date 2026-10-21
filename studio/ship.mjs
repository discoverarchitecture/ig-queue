// Puts a rendered Walk & Talk reel into the posting queue with the right folder name.
// usage: node ship.mjs dia-<slug> [--sync]
// Refuses if the render is missing or the caption breaks a hard rule. --sync then waits for the
// 2-minute settle time and uploads (otherwise the Mac's 30-minute sync job picks it up).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(os.homedir(), 'FindGreatArchitecture');
const id = process.argv[2];
if (!id) { console.error('usage: node ship.mjs dia-<slug> [--sync]'); process.exit(2); }
const out = path.join(HERE, 'out', id);
const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'specs', id + '.json'), 'utf8'));
const die = (m) => { console.error('ship: ' + m); process.exit(1); };

for (const f of ['reel.mp4', 'cover.jpg', 'caption.txt']) if (!fs.existsSync(path.join(out, f))) die(`${out}/${f} is missing — render first`);
if (fs.statSync(path.join(out, 'reel.mp4')).mtimeMs < fs.statSync(path.join(HERE, 'specs', id + '.json')).mtimeMs) die('the spec is newer than the render — re-render first');
if (fs.statSync(path.join(out, 'reel.mp4')).size > 95 * 1024 * 1024) die('reel is over 95 MB');
const cap = fs.readFileSync(path.join(out, 'caption.txt'), 'utf8').trim();
const tags = (cap.match(/#[\p{L}\p{N}_]+/gu) || []).length;
if (tags > 5) die(`caption has ${tags} hashtags (max 5)`);
if (!/^Photos?:/m.test(cap)) die('caption has no "Photos:" credits line');
if (!/link in (the )?bio/i.test(cap)) die('caption has no link-in-bio line');
if ([...cap].length > 2200) die('caption is over 2,200 characters');
const q = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'state', 'queue.json'), 'utf8'));

// next free number across the queue, the archive and everything the scheduler has seen
const used = [...fs.readdirSync(path.join(BASE, 'queue')), ...fs.readdirSync(path.join(BASE, 'posted')), ...Object.keys(q.posts)];
const slug = id.replace(/^dia-/, '');
if (used.some((n) => n.replace(/^\d+-[a-z]+-/, '') === slug)) die(`"${slug}" is already queued or posted`);
const next = String(Math.max(0, ...used.map((n) => parseInt(n, 10)).filter(Number.isFinite)) + 1).padStart(3, '0');
const name = `${next}-${spec.pillar}-${slug}`;

const tmp = path.join(BASE, 'queue', '.tmp-' + name);
fs.mkdirSync(tmp, { recursive: true });
for (const f of ['reel.mp4', 'cover.jpg', 'caption.txt']) fs.copyFileSync(path.join(out, f), path.join(tmp, f));
fs.renameSync(tmp, path.join(BASE, 'queue', name)); // atomic: the sync job never sees a half-copied folder
console.log('queued as ' + name);

if (process.argv.includes('--sync')) {
  const reel = path.join(BASE, 'queue', name, 'reel.mp4');
  while (Date.now() - fs.statSync(reel).mtimeMs < 125e3) await new Promise((r) => setTimeout(r, 5000));
  console.log(execFileSync('node', [path.join(HERE, '..', 'local', 'sync.mjs')], { encoding: 'utf8', timeout: 20 * 60e3 }).trim().split('\n').slice(-3).join('\n'));
} else console.log('uploads within 30 minutes, or run: node local/sync.mjs');
