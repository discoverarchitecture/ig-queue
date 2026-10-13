// Runs on the Mac every 30 min (launchd): pushes ~/FindGreatArchitecture/queue
// to the `media` branch as a single orphan commit (so old videos never pile up
// in git history), after archiving already-published posts to ../posted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG, ROOT, readJSON } from '../scripts/lib.mjs';

const BASE = path.join(os.homedir(), 'FindGreatArchitecture');
const QUEUE = path.join(BASE, 'queue');
const POSTED = path.join(BASE, 'posted');
const GIT_DIR = path.join(BASE, '.media-git');
const GH = fs.existsSync('/opt/homebrew/bin/gh') ? '/opt/homebrew/bin/gh' : 'gh';
const MAX_VIDEO = 95 * 1024 * 1024; // GitHub rejects files over 100 MB
const SETTLE_MS = 2 * 60e3;          // skip folders still being copied into

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const macNotify = (msg) => {
  try { execFileSync('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "Instagram queue"`]); } catch {}
};
const mgit = (...args) => execFileSync('git', [
  `--git-dir=${GIT_DIR}`, `--work-tree=${QUEUE}`,
  '-c', 'credential.helper=', '-c', `credential.helper=!${GH} auth git-credential`,
  '-c', 'user.name=fga-sync', '-c', 'user.email=fga-sync@users.noreply.github.com',
  ...args,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Accept loosely-named files: one .mp4 → reel.mp4, one .jpg/.jpeg → cover.jpg, one .txt → caption.txt. */
function normalize(dir) {
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
  for (const [want, re] of [['reel.mp4', /\.mp4$/i], ['cover.jpg', /\.jpe?g$/i], ['caption.txt', /\.txt$/i]]) {
    if (files.includes(want)) continue;
    const hits = files.filter((f) => re.test(f));
    if (hits.length === 1) fs.renameSync(path.join(dir, hits[0]), path.join(dir, want));
  }
}

function validate(id) {
  const dir = path.join(QUEUE, id);
  normalize(dir);
  const problems = [];
  const st = (f) => { try { return fs.statSync(path.join(dir, f)); } catch { return null; } };
  const reel = st('reel.mp4'), cap = st('caption.txt'), cover = st('cover.jpg');
  if (!reel) problems.push('missing reel.mp4');
  else if (reel.size > MAX_VIDEO) problems.push('reel.mp4 is over 95 MB');
  if (!cap) problems.push('missing caption.txt');
  else {
    const text = fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8').trim();
    if ([...text].length > 2200) problems.push(`caption is ${[...text].length} chars (max 2200)`);
    if ((text.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) problems.push('caption has more than 30 hashtags');
    if ((text.match(/@[\w.]+/g) || []).length > 20) problems.push('caption has more than 20 @mentions');
  }
  const fresh = [reel, cap, cover].some((s) => s && Date.now() - s.mtimeMs < SETTLE_MS);
  return { problems, fresh };
}

function syncMedia() {
  fs.mkdirSync(QUEUE, { recursive: true });
  fs.mkdirSync(POSTED, { recursive: true });
  try { execFileSync('git', ['-C', ROOT, 'pull', '--ff-only', '-q'], { stdio: 'pipe' }); }
  catch (e) { log('could not pull main (using local state):', e.message.split('\n')[0]); }
  const Q = readJSON('state/queue.json', { posts: {} });

  const ids = fs.readdirSync(QUEUE).filter((f) => !f.startsWith('.') && fs.statSync(path.join(QUEUE, f)).isDirectory()).sort();
  const keep = [];
  const bad = [];
  for (const id of ids) {
    if (Q.posts[id]?.status === 'published') {
      let dst = path.join(POSTED, id);
      if (fs.existsSync(dst)) dst += `-${Date.now()}`;
      fs.renameSync(path.join(QUEUE, id), dst);
      log('archived published post', id);
      continue;
    }
    if (!/^[\w.-]+$/.test(id)) { bad.push(`${id}: folder name may only use letters, numbers, - _ .`); continue; }
    const v = validate(id);
    if (v.fresh) { log('still copying, skipping for now:', id); continue; }
    if (v.problems.length) { bad.push(`${id}: ${v.problems.join(', ')}`); continue; }
    keep.push(id);
  }
  if (bad.length) { log('needs fixing:\n  ' + bad.join('\n  ')); macNotify(`${bad.length} queue folder(s) need fixing — see sync.log`); }

  // Posts already in a batch must stay on the branch; fill the rest in name order.
  const active = keep.filter((id) => ['scheduled', 'approved', 'publishing', 'failed'].includes(Q.posts[id]?.status));
  const selected = [...active, ...keep.filter((id) => !active.includes(id))].slice(0, Math.max(CONFIG.maxQueued, active.length));

  if (!fs.existsSync(GIT_DIR)) {
    execFileSync('git', ['init', '-q', '--bare', GIT_DIR]);
    mgit('remote', 'add', 'origin', `https://github.com/${CONFIG.repo}.git`);
  }
  fs.rmSync(path.join(GIT_DIR, 'index'), { force: true });
  const files = selected.flatMap((id) => ['reel.mp4', 'caption.txt', 'cover.jpg']
    .filter((f) => fs.existsSync(path.join(QUEUE, id, f))).map((f) => `${id}/${f}`));
  if (files.length) mgit('add', '-f', '--', ...files);
  const tree = mgit('write-tree');
  let current = '';
  try { current = mgit('rev-parse', 'refs/heads/media^{tree}'); } catch {}
  if (tree === current) { log(`media branch up to date (${selected.length} post(s))`); return; }

  const commit = mgit('commit-tree', tree, '-m', `media sync: ${selected.length} post(s)`);
  mgit('push', '-q', '-f', 'origin', `${commit}:refs/heads/media`);
  mgit('update-ref', 'refs/heads/media', commit);
  try { mgit('reflog', 'expire', '--expire=now', '--all'); mgit('gc', '-q', '--prune=now'); } catch {}
  log(`pushed ${selected.length} post(s) to media branch`);
  try { execFileSync(GH, ['workflow', 'run', 'tick.yml', '-R', CONFIG.repo, '--ref', 'main'], { stdio: 'pipe' }); }
  catch (e) { log('could not trigger tick:', e.message.split('\n')[0]); }
  macNotify(`Synced ${selected.length} post(s) to the Instagram queue`);
}

try { syncMedia(); } catch (e) { log('sync failed:', e.message); macNotify('Instagram queue sync failed — see sync.log'); process.exitCode = 1; }
