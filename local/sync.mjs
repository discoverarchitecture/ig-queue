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
  '-c', 'http.postBuffer=1048576000', // pushes of several reels exceed git's default HTTP buffer
  ...args,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60e3 }).trim();

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
    // Hard rules from CONTENT_GUIDE.md
    if ([...text].length > 2200) problems.push(`caption is ${[...text].length} chars (max 2200)`);
    const tags = (text.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (tags > 5) problems.push(`caption has ${tags} hashtags (max 5)`);
    if ((text.match(/@[\w.]+/g) || []).length > 20) problems.push('caption has more than 20 @mentions');
    if (!/\b(photos?|credits?|images?|footage)\s*[:：]|\bCC[ -]?(BY|0)\b|public domain|©/i.test(text))
      problems.push('no photo credits line (e.g. "Photos: Name (CC BY-SA 4.0); …")');
    if (!/link in (the )?bio|findgreatarchitecture\.com/i.test(text))
      problems.push('no link-in-bio CTA (mention "link in bio" or findgreatarchitecture.com)');
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

  // A reel is finished only when it is on Instagram AND on YouTube; until then its video stays uploaded.
  const finished = (id) => Q.posts[id]?.status === 'published' && (Q.posts[id]?.youtube?.id || (Q.posts[id]?.youtube?.attempts || 0) >= 3);
  const needsYouTube = (id) => Q.posts[id]?.status === 'published' && !finished(id);
  for (const id of fs.existsSync(POSTED) ? fs.readdirSync(POSTED) : []) {
    if (needsYouTube(id) && !fs.existsSync(path.join(QUEUE, id))) {
      fs.renameSync(path.join(POSTED, id), path.join(QUEUE, id));
      log('brought back for YouTube:', id);
    }
  }
  const ids = fs.readdirSync(QUEUE).filter((f) => !f.startsWith('.') && fs.statSync(path.join(QUEUE, f)).isDirectory()).sort();
  const keep = [];
  const bad = [];
  for (const id of ids) {
    if (finished(id)) {
      let dst = path.join(POSTED, id);
      if (fs.existsSync(dst)) dst += `-${Date.now()}`;
      fs.renameSync(path.join(QUEUE, id), dst);
      log('archived published post', id);
      continue;
    }
    if (!/^[\w.-]+$/.test(id)) { bad.push(`${id}: folder name may only use letters, numbers, - _ .`); continue; }
    const v = validate(id);
    // A folder still being written: skip this whole sync rather than push a
    // branch without it (the scheduler would read that as "post removed").
    if (v.fresh) { log('still copying, will sync next run:', id); return; }
    if (v.problems.length) { bad.push(`${id}: ${v.problems.join(', ')}`); continue; }
    keep.push(id);
  }
  if (bad.length) { log('needs fixing:\n  ' + bad.join('\n  ')); macNotify(`${bad.length} queue folder(s) need fixing — see sync.log`); }

  // Posts already in a batch must stay on the branch; fill the rest in name order.
  const active = keep.filter((id) => ['scheduled', 'approved', 'publishing', 'failed'].includes(Q.posts[id]?.status) || needsYouTube(id));
  const selected = [...active, ...keep.filter((id) => !active.includes(id))].slice(0, Math.max(CONFIG.maxQueued, active.length));

  if (!fs.existsSync(GIT_DIR)) {
    execFileSync('git', ['init', '-q', '--bare', GIT_DIR]);
    mgit('remote', 'add', 'origin', `https://github.com/${CONFIG.repo}.git`);
  }
  const filesOf = (id) => ['reel.mp4', 'caption.txt', 'cover.jpg']
    .filter((f) => fs.existsSync(path.join(QUEUE, id, f))).map((f) => `${id}/${f}`);
  const treeOf = (ids) => {
    fs.rmSync(path.join(GIT_DIR, 'index'), { force: true });
    const files = ids.flatMap(filesOf);
    if (files.length) mgit('add', '-f', '--', ...files);
    return mgit('write-tree');
  };
  const current = () => { try { return mgit('rev-parse', 'refs/heads/media^{tree}'); } catch { return ''; } };
  const finalTree = treeOf(selected);
  if (finalTree === current()) { log(`media branch up to date (${selected.length} post(s))`); return; }

  // Push in steps of one post: each push only uploads that post's new files,
  // so a flaky connection never has to carry every reel in one request.
  // The posts already on the branch stay in every step, so nothing disappears mid-way.
  const onBranch = (() => { try { return mgit('ls-tree', '--name-only', 'refs/heads/media').split('\n').filter(Boolean); } catch { return []; } })();
  const steps = [];
  let acc = selected.filter((id) => onBranch.includes(id));
  for (const id of selected.filter((x) => !onBranch.includes(x))) { acc = [...acc, id]; steps.push([...acc]); }
  if (!steps.length || steps.at(-1).length !== selected.length) steps.push(selected);
  for (const ids of steps) {
    const tree = treeOf(ids);
    if (tree === current()) continue;
    const commit = mgit('commit-tree', tree, '-m', `media sync: ${ids.length} post(s)`);
    for (let attempt = 1; ; attempt++) {
      try { mgit('push', '-q', '-f', 'origin', `${commit}:refs/heads/media`); break; }
      catch (e) { if (attempt >= 3) throw e; log(`push failed (attempt ${attempt}), retrying:`, e.message.split('\n')[0]); }
    }
    mgit('update-ref', 'refs/heads/media', commit);
    log(`pushed media branch with ${ids.length} post(s)`);
  }
  try { mgit('reflog', 'expire', '--expire=now', '--all'); mgit('gc', '-q', '--prune=now'); } catch {}
  try { execFileSync(GH, ['workflow', 'run', 'tick.yml', '-R', CONFIG.repo, '--ref', 'main'], { stdio: 'pipe' }); }
  catch (e) { log('could not trigger tick:', e.message.split('\n')[0]); }
  macNotify(`Synced ${selected.length} post(s) to the Instagram queue`);
}

/** GitHub sometimes silently skips scheduled runs for hours. If the scheduler
 *  hasn't started in 40 minutes, start it from here so posts still go out on time. */
function kickSchedulerIfStalled() {
  try {
    const runs = JSON.parse(execFileSync(GH, ['run', 'list', '-R', CONFIG.repo, '--workflow', 'tick.yml', '--limit', '1', '--json', 'createdAt,status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const last = runs[0];
    if (last && (last.status !== 'completed' || Date.now() - Date.parse(last.createdAt) < 40 * 60e3)) return;
    execFileSync(GH, ['workflow', 'run', 'tick.yml', '-R', CONFIG.repo, '--ref', 'main'], { stdio: 'pipe' });
    log(`scheduler stalled (last run ${last ? last.createdAt : 'never'}); started a run`);
  } catch (e) { log('could not check the scheduler:', e.message.split('\n')[0]); }
}

// Check the scheduler first: a slow upload must never delay a post.
kickSchedulerIfStalled();
try { syncMedia(); } catch (e) { log('sync failed:', e.message); macNotify('Instagram queue sync failed — see sync.log'); process.exitCode = 1; }
