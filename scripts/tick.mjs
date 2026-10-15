// Runs every ~30 min in GitHub Actions. Each step is idempotent: state lives in
// state/queue.json (plain) and data/*.enc (encrypted with FGA_KEY), and every
// publish is committed before and after so a crashed run can't double-post.
// The Instagram token only ever comes from the IG_TOKEN Actions secret.
import fs from 'node:fs';
import path from 'node:path';
import {
  CONFIG, ROOT, DAY, HOUR, IG, gh, git, readJSON, writeJSON, readText, writeText,
  encrypt, decrypt, sha256, zonedToUtc, ymdInTz, addDays,
} from './lib.mjs';

const KEY = process.env.FGA_KEY;
const CI = !!process.env.GITHUB_ACTIONS;
const now = new Date();
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const ACTIVE = ['scheduled', 'approved', 'publishing', 'failed'];
// Auto-post mode: planned reels are approved up front; the owner only replies to hold one back.
const INITIAL = CONFIG.autoApprove ? 'approved' : 'scheduled';
const ASK = CONFIG.autoApprove
  ? '\n\nNothing to do unless you want to hold one back: reply `skip <number>` (e.g. `skip 003`).'
  : '\n\n**Reply `approve` (or yes / ok / 👍) to approve all**, or `skip <number>` to hold one back.';

const Q = readJSON('state/queue.json', null) ?? { version: 1, meta: {}, last: {}, batches: [], posts: {}, pool: [] };
let deploy = false;

function save() { writeJSON('state/queue.json', Q); }
function persist(msg) {
  save();
  if (!CI) return;
  git('add', 'state', 'data');
  try { git('diff', '--cached', '--quiet'); return; } catch { /* has changes */ }
  git('-c', 'user.name=fga-bot', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-q', '-m', msg);
  // The scheduler owns state/queue.json and data/*. If someone else pushed meanwhile,
  // take their latest commit and lay our files on top of it (no rebase, no conflicts).
  const OWN = ['state/queue.json', 'data/inbox.enc', 'data/analytics.enc'];
  for (let i = 0; i < 5; i++) {
    try { git('push', '-q', 'origin', 'HEAD:main'); return; } catch (e) {
      log('push rejected, re-applying on latest main:', (e.stderr || e.message).toString().split('\n').filter(Boolean).slice(-1)[0]);
      const mine = Object.fromEntries(OWN.map((f) => [f, readText(f)]));
      try { git('rebase', '--abort'); } catch { /* none in progress */ }
      git('fetch', '-q', 'origin', 'main');
      git('reset', '-q', '--hard', 'origin/main');
      for (const [f, text] of Object.entries(mine)) if (text != null) writeText(f, text);
      git('add', ...OWN.filter((f) => mine[f] != null));
      try { git('diff', '--cached', '--quiet'); return; } catch { /* has changes */ }
      git('-c', 'user.name=fga-bot', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-q', '-m', msg);
    }
  }
  // Give up without publishing anything further; the next run starts from the remote state.
  throw new Error('could not push state');
}

// ---- Notifications (GitHub issue comments → email + GitHub app push) ------
async function notify(text, mention = true) {
  log('notify:', text);
  if (!CI) return;
  if (!Q.meta.notifyIssue) {
    const issue = await gh('POST', `/repos/${CONFIG.repo}/issues`, {
      title: '🔔 Instagram queue notifications',
      body: `The scheduler comments here when a batch needs approval, a slot is missed, or a post goes live.\n\nDashboard: ${CONFIG.siteBase}/`,
    });
    Q.meta.notifyIssue = issue.number;
    save();
  }
  const body = (mention ? `@${CONFIG.githubUser} ` : '') + text + `\n\n→ ${CONFIG.siteBase}/`;
  await gh('POST', `/repos/${CONFIG.repo}/issues/${Q.meta.notifyIssue}/comments`, { body });
}

const fmtSlot = (iso) => {
  const d = new Date(iso);
  const et = d.toLocaleString('en-US', { timeZone: CONFIG.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const ist = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
  return `${et} ET (${ist} IST)`;
};

// ---- 1. Refresh the pool from the media branch ---------------------------
async function refreshPool() {
  const tree = await gh('GET', `/repos/${CONFIG.repo}/git/trees/media?recursive=1`);
  if (!tree) { log('no media branch yet'); return; }
  const folders = {};
  for (const e of tree.tree) {
    const m = e.path.match(/^([^/]+)\/(reel\.mp4|caption\.txt|cover\.jpg)$/);
    if (m) (folders[m[1]] ??= {})[m[2]] = e.sha;
  }
  const present = new Set();
  for (const [id, f] of Object.entries(folders)) {
    if (!f['reel.mp4'] || !f['caption.txt']) continue;
    present.add(id);
    const p = (Q.posts[id] ??= { status: 'pending' });
    if (p.status === 'published') continue;
    p.hasCover = !!f['cover.jpg'];
    if (p.captionSha !== f['caption.txt']) {
      const blob = await gh('GET', `/repos/${CONFIG.repo}/git/blobs/${f['caption.txt']}`);
      p.caption = Buffer.from(blob.content, 'base64').toString('utf8').trim();
      p.captionSha = f['caption.txt'];
    }
  }
  for (const [id, p] of Object.entries(Q.posts)) {
    if (present.has(id) || p.status === 'published') continue;
    if (ACTIVE.includes(p.status)) unslot(id, 'removed from queue folder');
    delete Q.posts[id];
  }
  const pool = Object.keys(Q.posts).filter((id) => Q.posts[id].status === 'pending').sort();
  if (JSON.stringify(pool) !== JSON.stringify(Q.pool)) { Q.pool = pool; deploy = true; }
}

function unslot(id, reason) {
  const p = Q.posts[id];
  for (const b of Q.batches) for (const s of b.slots) if (s.post === id) { s.post = null; s.note = reason; }
  Object.assign(p, { status: 'pending', batch: null, slot: null, captionOverride: null, decidedAt: null, attempts: 0, error: null, container: null });
  deploy = true;
}

// ---- 2. Apply dashboard decisions ---------------------------------------
function applyDecisions() {
  const D = readJSON('state/decisions.json', { posts: {} });
  for (const [id, d] of Object.entries(D.posts || {})) {
    const p = Q.posts[id];
    if (!p || !['scheduled', 'approved'].includes(p.status)) continue;
    if (p.decidedAt && d.at <= p.decidedAt) continue;
    if (d.batch && d.batch !== p.batch) continue; // decision was for an earlier batch
    p.decidedAt = d.at;
    if (d.decision === 'approve') {
      p.status = 'approved';
      p.captionOverride = d.caption && d.caption.trim() !== p.caption ? d.caption.trim() : null;
      log('approved', id);
    } else if (d.decision === 'skip') {
      unslot(id, 'skipped');
      log('skipped', id);
    }
  }
}

// ---- 2b. Approve by commenting on the notifications issue (GitHub app) -----
// Only comments by CONFIG.githubUser count. One command per line:
//   approve            → approve every undecided post in open batches
//   approve <post-id>  → approve one post
//   skip <post-id>     → send one post back to the queue
async function applyCommentCommands() {
  if (!Q.meta.notifyIssue) return;
  const since = Q.meta.lastCommentAt || '1970-01-01T00:00:00Z';
  const comments = await gh('GET', `/repos/${CONFIG.repo}/issues/${Q.meta.notifyIssue}/comments?since=${since}&per_page=100`) || [];
  for (const c of comments) {
    if (c.created_at <= since && c.id <= (Q.meta.lastCommentId || 0)) continue;
    Q.meta.lastCommentAt = c.created_at;
    Q.meta.lastCommentId = c.id;
    if (c.user?.login !== CONFIG.githubUser) continue;
    const done = [];
    // Accept natural replies: "approve", "approved", "yes", "ok", "go", "lgtm", 👍, ✅ approve all;
    // "skip <id>" / "no <id>" / "remove <id>" hold one back.
    const YES = /^(approve[ds]?|approval|yes|yep|ok(ay)?|go( ahead)?|lgtm|looks good|good to go|post( them| all)?|👍|✅)$/u;
    for (const raw of c.body.split('\n')) {
      const line = raw.trim().toLowerCase().replace(/[.!,\s]+$/, '');
      let verb, id;
      const one = line.match(/^(approve[ds]?|yes|ok|skip|no|remove|hold)\s+`?([\w.-]+)`?$/);
      if (one) { verb = /^(skip|no|remove|hold)$/.test(one[1]) ? 'skip' : 'approve'; id = one[2]; }
      else if (YES.test(line)) verb = 'approve';
      else continue;
      // allow "approve 003" as shorthand for the post whose id starts with 003
      if (id && !Q.posts[id]) id = Object.keys(Q.posts).find((k) => k.startsWith(id + '-')) || id;
      const targets = id
        ? [id].filter((x) => ['scheduled', 'approved'].includes(Q.posts[x]?.status))
        : verb === 'approve' ? Object.keys(Q.posts).filter((x) => Q.posts[x].status === 'scheduled') : [];
      for (const x of targets) {
        if (verb === 'approve') { Q.posts[x].status = 'approved'; Q.posts[x].decidedAt = c.created_at; }
        else unslot(x, 'skipped');
        done.push(`${verb === 'approve' ? '✅' : '⏭️'} ${x}`);
      }
    }
    if (done.length) {
      log('comment commands:', done.join(', '));
      await gh('POST', `/repos/${CONFIG.repo}/issues/comments/${c.id}/reactions`, { content: '+1' });
    }
  }
}

// ---- 3. Plan a batch every `batchDays`, anchored to CONFIG.anchor ----------
// Folder names look like `014-architect-tadao-ando`; the second segment is the
// content pillar. Slots rotate through CONFIG.pillars; within a pillar (and for
// folders without one) the lowest folder name goes first.
const pillarOf = (id) => CONFIG.pillars.find((p) => id.split('-')[1] === p) ?? null;
function nextByPillar(pool) {
  if (!pool.length) return null;
  const order = CONFIG.pillars;
  const start = (order.indexOf(Q.meta.lastPillar) + 1) % order.length;
  for (let i = 0; i < order.length; i++) {
    const hit = pool.find((id) => pillarOf(id) === order[(start + i) % order.length]);
    if (hit) {
      const untagged = pool.find((id) => !pillarOf(id));
      return untagged && untagged < hit ? untagged : hit;
    }
  }
  return pool[0];
}

async function planBatch() {
  const period = CONFIG.batchDays * DAY;
  const k = Math.floor((now - Date.parse(CONFIG.anchor)) / period);
  if (k < 0 || Q.batches.some((b) => b.index === k)) return;
  const created = new Date(Date.parse(CONFIG.anchor) + k * period);
  const d0 = ymdInTz(created, CONFIG.timezone);
  const slots = [];
  for (let i = 1; i <= CONFIG.batchDays; i++)
    for (const t of CONFIG.slots) {
      const at = zonedToUtc(addDays(d0, i), t, CONFIG.timezone);
      if (at - now > 2 * HOUR) slots.push({ at: at.toISOString(), post: null });
    }
  const pool = Object.keys(Q.posts).filter((id) => Q.posts[id].status === 'pending').sort();
  const batch = { id: d0, index: k, created: now.toISOString(), slots, remindedAt: null };
  for (const s of slots) {
    const id = nextByPillar(pool);
    if (!id) break;
    pool.splice(pool.indexOf(id), 1);
    s.post = id;
    Q.meta.lastPillar = pillarOf(id) ?? Q.meta.lastPillar;
    Object.assign(Q.posts[id], { status: INITIAL, batch: batch.id, slot: s.at, ...(CONFIG.autoApprove ? { decidedAt: now.toISOString() } : {}) });
  }
  Q.batches.push(batch);
  Q.batches = Q.batches.slice(-20);
  Q.pool = pool;
  deploy = true;
  const filled = slots.filter((s) => s.post);
  persist(`plan batch ${batch.id}`);
  if (!filled.length) await notify(`Batch **${batch.id}** has no posts — the queue is empty. Add reels to \`~/FindGreatArchitecture/queue/\`.`);
  else await notify(`New batch **${batch.id}** ${CONFIG.autoApprove ? 'is scheduled and will post automatically' : 'is ready'} — ${filled.length} post(s):\n\n` +
    filled.map((s) => {
      const p = Q.posts[s.post];
      const cover = p.hasCover ? ` · [cover](${CONFIG.siteBase}/m/${encodeURIComponent(s.post)}/cover.jpg)` : '';
      return `- \`${s.post}\` — ${fmtSlot(s.at)} · [video](${CONFIG.siteBase}/m/${encodeURIComponent(s.post)}/reel.mp4)${cover}\n  > ${(p.caption || '').split('\n')[0].slice(0, 120)}`;
    }).join('\n') +
    (filled.length < slots.length ? `\n\n${slots.length - filled.length} empty slot(s) — the queue is running low.` : '') + ASK);
}

// ---- 3b. Backfill: new reels fill a planned batch's empty future slots ----
async function backfill() {
  const pool = () => Object.keys(Q.posts).filter((id) => Q.posts[id].status === 'pending').sort();
  const added = [];
  for (const b of Q.batches) for (const s of b.slots) {
    if (s.post || Date.parse(s.at) - now < 3 * HOUR) continue;
    const id = nextByPillar(pool());
    if (!id) break;
    s.post = id; delete s.note;
    Q.meta.lastPillar = pillarOf(id) ?? Q.meta.lastPillar;
    Object.assign(Q.posts[id], { status: INITIAL, batch: b.id, slot: s.at, ...(CONFIG.autoApprove ? { decidedAt: now.toISOString() } : {}) });
    added.push(s);
  }
  if (!added.length) return;
  Q.pool = pool(); deploy = true;
  persist(`backfill ${added.length} slot(s)`);
  await notify(`${added.length} new reel(s) added to open slots${CONFIG.autoApprove ? ' — they will post automatically' : ''}:\n\n` + added.map((s) => {
    const p = Q.posts[s.post];
    return `- \`${s.post}\` — ${fmtSlot(s.at)} · [video](https://raw.githubusercontent.com/${CONFIG.repo}/media/${encodeURIComponent(s.post)}/reel.mp4)\n  > ${(p.caption || '').split('\n')[0].slice(0, 120)}`;
  }).join('\n') + ASK);
}

// ---- 4. Missed slots + reminders ----------------------------------------
async function remindersAndMisses() {
  for (const b of Q.batches) {
    const undecided = b.slots.filter((s) => s.post && Q.posts[s.post]?.status === 'scheduled');
    const missed = undecided.filter((s) => Date.parse(s.at) <= now);
    for (const s of missed) unslot(s.post, 'missed — not approved in time');
    if (missed.length) {
      persist(`missed ${missed.length} slot(s) in ${b.id}`);
      await notify(`⚠️ ${missed.length} post(s) in batch **${b.id}** weren't approved before their slot and went back to the queue.`);
    }
    const waiting = undecided.filter((s) => Date.parse(s.at) > now);
    if (waiting.length && !b.remindedAt && now - Date.parse(b.created) > CONFIG.remindAfterHours * HOUR) {
      b.remindedAt = now.toISOString();
      persist(`remind ${b.id}`);
      await notify(`⏰ Reminder: ${waiting.length} post(s) in batch **${b.id}** still need approval. The next one is due ${fmtSlot(waiting[0].at)}. Reply \`approve\` to approve all.`);
    }
  }
}

// ---- 5. Publish ------------------------------------------------------------
async function waitForContainer(ig, id) {
  for (let i = 0; i < 60; i++) {
    const s = await ig.get(`/${id}`, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return s.status_code;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`container ${s.status_code}: ${s.status || ''}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('container still processing after 15 min');
}

async function finishPublished(ig, id, mediaId) {
  const p = Q.posts[id];
  const info = await ig.get(`/${mediaId}`, { fields: 'permalink,timestamp' });
  Object.assign(p, { status: 'published', mediaId, permalink: info.permalink, publishedAt: info.timestamp || now.toISOString(), error: null });
  deploy = true;
  persist(`published ${id}`);
  await notify(`✅ Published **${id}**: ${info.permalink}`, false);
}

// Instagram fetches media straight from the media branch on raw.githubusercontent.com.
// (Its video fetcher returns a bare ERROR for the same file served by GitHub Pages
// on our custom domain; images from Pages work, videos don't.)
const mediaUrl = (id, file) => `https://raw.githubusercontent.com/${CONFIG.repo}/media/${encodeURIComponent(id)}/${file}`;

async function publish(ig, id) {
  const p = Q.posts[id];
  const videoUrl = mediaUrl(id, 'reel.mp4');
  const head = await fetch(videoUrl, { method: 'HEAD' }).catch(() => null);
  if (!head?.ok) {
    log(`video not reachable at ${videoUrl} (${head?.status}); will retry next run`);
    return;
  }
  p.status = 'publishing';
  p.attempts = (p.attempts || 0) + 1;
  p.container = null;
  persist(`publishing ${id} (attempt ${p.attempts})`);
  try {
    const params = { media_type: 'REELS', video_url: videoUrl, caption: p.captionOverride ?? p.caption, share_to_feed: 'true' };
    if (p.hasCover) params.cover_url = mediaUrl(id, 'cover.jpg');
    else params.thumb_offset = String(CONFIG.thumbOffsetMs);
    const c = await ig.post(`/${CONFIG.igUserId}/media`, params);
    p.container = c.id;
    persist(`container ${id}`);
    await waitForContainer(ig, c.id);
    const m = await ig.post(`/${CONFIG.igUserId}/media_publish`, { creation_id: c.id });
    await finishPublished(ig, id, m.id);
  } catch (e) {
    p.status = 'failed';
    p.error = String(e.message).slice(0, 500);
    persist(`failed ${id}`);
    log('publish failed', id, e.message);
    if (p.attempts >= 3) await notify(`❌ Publishing **${id}** failed 3 times: ${p.error}`);
  }
}

/** A previous run died mid-publish: find out what actually happened before retrying. */
async function recover(ig, id) {
  const p = Q.posts[id];
  if (!p.container) { p.status = 'failed'; p.error = 'interrupted before the container was created'; persist(`recover ${id}`); return; }
  try {
    const s = await ig.get(`/${p.container}`, { fields: 'status_code' });
    if (s.status_code === 'PUBLISHED') {
      const recent = await ig.get(`/${CONFIG.igUserId}/media`, { fields: 'id,caption', limit: '10' });
      const head = (p.captionOverride ?? p.caption).slice(0, 60);
      const hit = (recent.data || []).find((m) => (m.caption || '').startsWith(head));
      if (hit) return finishPublished(ig, id, hit.id);
    }
    if (s.status_code === 'FINISHED') {
      const m = await ig.post(`/${CONFIG.igUserId}/media_publish`, { creation_id: p.container });
      return finishPublished(ig, id, m.id);
    }
    if (s.status_code === 'IN_PROGRESS') return;
    p.status = 'failed'; p.error = `container ${s.status_code}`;
  } catch (e) { p.status = 'failed'; p.error = String(e.message).slice(0, 500); }
  persist(`recover ${id}`);
}

async function publishDue(ig) {
  for (const [id, p] of Object.entries(Q.posts)) if (p.status === 'publishing') await recover(ig, id);
  const ready = Object.entries(Q.posts)
    .filter(([, p]) => (p.status === 'approved' || (p.status === 'failed' && (p.attempts || 0) < 3)) && p.slot && Date.parse(p.slot) <= now)
    .sort((a, b) => Date.parse(a[1].slot) - Date.parse(b[1].slot));
  for (const [id, p] of ready) {
    if (now - Date.parse(p.slot) > CONFIG.publishGraceHours * HOUR) {
      const err = p.error;
      unslot(id, 'slot passed without a successful publish');
      persist(`expired ${id}`);
      await notify(`⚠️ **${id}** couldn't be published within ${CONFIG.publishGraceHours}h of its slot and went back to the queue.${err ? ` Last error: ${err}` : ''}`);
      continue;
    }
    await publish(ig, id);
  }
}

// ---- 6. Inbox + analytics (encrypted at rest) ------------------------------
const isDue = (key, hours) => !Q.last[key] || now - Date.parse(Q.last[key]) >= hours * HOUR - 5 * 60e3;

async function syncInbox(ig) {
  const inbox = { comments: [], conversations: [], errors: [] };
  const media = await ig.get(`/${CONFIG.igUserId}/media`, { fields: 'id,caption,permalink,timestamp,comments_count', limit: '25' });
  for (const m of media.data || []) {
    if (!m.comments_count) continue;
    try {
      const c = await ig.get(`/${m.id}/comments`, { fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp}', limit: '50' });
      inbox.comments.push({ media: { id: m.id, permalink: m.permalink, caption: (m.caption || '').slice(0, 80), timestamp: m.timestamp }, items: c.data || [] });
    } catch (e) { inbox.errors.push(e.message); }
  }
  try {
    const conv = await ig.get(`/${CONFIG.igUserId}/conversations`, {
      platform: 'instagram', fields: 'id,updated_time,participants,messages.limit(10){id,message,from,created_time}', limit: '25',
    });
    inbox.conversations = conv.data || [];
  } catch (e) { inbox.errors.push(e.message); }
  const hash = sha256(JSON.stringify(inbox));
  if (hash !== Q.last.inboxHash) {
    writeText('data/inbox.enc', encrypt(JSON.stringify({ updated: now.toISOString(), ...inbox }), KEY));
    Q.last.inboxHash = hash;
  }
  Q.last.inbox = now.toISOString();
}

const REEL_METRICS = 'views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time';
const POST_METRICS = 'views,reach,likes,comments,shares,saved,total_interactions';
const BASIC_METRICS = 'reach,likes,comments,shares,saved';

async function syncAnalytics(ig) {
  const me = await ig.get('/me', { fields: 'followers_count,media_count' });
  const media = await ig.get(`/${CONFIG.igUserId}/media`, { fields: 'id,caption,permalink,timestamp,media_type,media_product_type', limit: '30' });
  const rows = [];
  for (const m of media.data || []) {
    const metrics = {};
    for (const list of [m.media_product_type === 'REELS' ? REEL_METRICS : POST_METRICS, BASIC_METRICS]) {
      try {
        const r = await ig.get(`/${m.id}/insights`, { metric: list });
        for (const x of r.data || []) metrics[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? null;
        delete metrics._error;
        break;
      } catch (e) { metrics._error = e.message; }
    }
    rows.push({ id: m.id, permalink: m.permalink, timestamp: m.timestamp, type: m.media_product_type || m.media_type, caption: (m.caption || '').slice(0, 80), metrics });
  }
  const prev = readText('data/analytics.enc');
  const A = prev ? JSON.parse(decrypt(prev, KEY)) : { snapshots: [] };
  const date = now.toISOString().slice(0, 10);
  A.snapshots = A.snapshots.filter((s) => s.date !== date);
  A.snapshots.push({ date, at: now.toISOString(), followers: me.followers_count, mediaCount: me.media_count, media: rows });
  A.snapshots = A.snapshots.slice(-120);
  writeText('data/analytics.enc', encrypt(JSON.stringify(A), KEY));
  Q.last.analytics = now.toISOString();
}

// ---- main ------------------------------------------------------------------
async function main() {
  if (!KEY) throw new Error('FGA_KEY secret is not set');
  if (!process.env.IG_TOKEN) throw new Error('IG_TOKEN secret is not set');
  const ig = new IG(process.env.IG_TOKEN);

  await refreshPool();
  applyDecisions();
  try { await applyCommentCommands(); } catch (e) { log('comment commands', e.message); }
  persist('sync pool + decisions');
  await planBatch();
  await backfill();
  await remindersAndMisses();
  await publishDue(ig);

  if (isDue('inbox', CONFIG.inboxEveryHours)) { try { await syncInbox(ig); } catch (e) { log('inbox', e.message); } }
  if (isDue('analytics', CONFIG.analyticsEveryHours)) { try { await syncAnalytics(ig); } catch (e) { log('analytics', e.message); } }
  persist('sync inbox + analytics');
  if (deploy) fs.writeFileSync(path.join(ROOT, '.deploy-pages'), now.toISOString());
}

main().catch((e) => { console.error(e); process.exit(1); });
