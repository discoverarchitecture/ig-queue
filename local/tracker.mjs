// Gathers what the "Instagram Control Room" dashboard shows into JSON files:
//   posts.json    every reel: status, slot, batch, link
//   jobs.json     each moving part of the automation and how it's doing
//   awaiting.json what's waiting, and on whom
//   account.json  followers / posts on Instagram
// usage: node local/tracker.mjs <outdir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG } from '../scripts/lib.mjs';

const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });
const HOME = os.homedir();
const GH = fs.existsSync('/opt/homebrew/bin/gh') ? '/opt/homebrew/bin/gh' : 'gh';
const gh = (...a) => execFileSync(GH, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const now = new Date();
const ist = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const et = (iso) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: CONFIG.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4)); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const write = (name, rows) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(rows, null, 1));

const Q = JSON.parse(gh('api', `repos/${CONFIG.repo}/contents/state/queue.json`, '-H', 'Accept: application/vnd.github.raw'));
const pillarOf = (id) => CONFIG.pillars.find((p) => id.split('-')[1] === p) || 'launch';
const queueDir = path.join(HOME, 'FindGreatArchitecture/queue');
const local = fs.existsSync(queueDir) ? fs.readdirSync(queueDir).filter((f) => !f.startsWith('.')) : [];

// ---- posts -------------------------------------------------------------------
const STATUS = { published: 'Published', publishing: 'Publishing', approved: 'Approved', scheduled: 'Needs approval', failed: 'Retrying', pending: 'In queue' };
const ids = [...new Set([...Object.keys(Q.posts), ...local])].sort();
const posts = ids.map((id) => {
  const p = Q.posts[id];
  const status = !p ? 'Uploading' : p.status === 'failed' && (p.attempts || 0) >= 3 ? 'Failed' : STATUS[p.status] || p.status;
  let hook = p?.caption?.split('\n')[0] || '';
  if (!hook) try { hook = fs.readFileSync(path.join(queueDir, id, 'caption.txt'), 'utf8').split('\n')[0]; } catch {}
  const when = p?.publishedAt || p?.slot || '';
  return { post: id, pillar: pillarOf(id), status, hook: hook.slice(0, 110), when_utc: when, when_ist: ist(when), when_et: et(when),
    batch: p?.batch || '', attempts: p?.attempts || 0, error: p?.error || '', link: p?.permalink || '' };
});
write('posts.json', posts);

// ---- jobs ----------------------------------------------------------------------
const runs = JSON.parse(gh('run', 'list', '-R', CONFIG.repo, '--limit', '20', '--json', 'workflowName,createdAt,conclusion,status'));
const lastRun = (wf) => runs.find((r) => r.workflowName === wf);
const tick = lastRun('tick'), pages = lastRun('pages');
const nextTick = (() => { const d = new Date(now); d.setUTCSeconds(0, 0); const m = d.getUTCMinutes(); d.setUTCMinutes(m < 7 ? 7 : m < 37 ? 37 : 67); return d.toISOString(); })();
const period = CONFIG.batchDays * 864e5;
const nextBatch = new Date(Date.parse(CONFIG.anchor) + (Math.floor((now - Date.parse(CONFIG.anchor)) / period) + 1) * period).toISOString();
let agentLoaded = false, agentLine = '';
try { agentLoaded = execFileSync('launchctl', ['list'], { encoding: 'utf8' }).includes('com.findgreatarchitecture.sync'); } catch {}
try { agentLine = fs.readFileSync(path.join(HOME, 'FindGreatArchitecture/sync.log'), 'utf8').trim().split('\n').filter((l) => l.startsWith('[')).at(-1) || ''; } catch {}
const agentAt = agentLine.match(/^\[([^\]]+)\]/)?.[1];
const onGithub = (() => { try { return JSON.parse(gh('api', `repos/${CONFIG.repo}/git/trees/media`)).tree.filter((t) => t.type === 'tree').length; } catch { return null; } })();
const unpublishedLocal = local.filter((id) => Q.posts[id]?.status !== 'published').length + local.filter((id) => Q.posts[id]?.status === 'published').length;
const tokenExpires = Date.parse('2026-10-14T00:00:00Z') + 60 * 864e5;
const daysLeft = Math.round((tokenExpires - now) / 864e5);
const jobs = [
  { job: 'Scheduler', what: 'Plans batches, publishes approved reels, syncs inbox and analytics', state: tick?.conclusion === 'success' ? 'ok' : tick ? 'bad' : 'warn',
    last: tick ? `${ist(tick.createdAt)} (${ago(tick.createdAt)})` : 'never', result: tick ? (tick.conclusion || tick.status) : '—', next: `${ist(nextTick)}, then every 30 min` },
  { job: 'Batch planning', what: 'Fills the next 3 days of slots and asks you to approve', state: 'ok',
    last: Q.batches.at(-1) ? ist(Q.batches.at(-1).created) : '—', result: `${Q.batches.length} batch(es) planned`, next: ist(nextBatch) },
  { job: 'Mac sync', what: 'Uploads new reels from ~/FindGreatArchitecture/queue to GitHub', state: !agentLoaded ? 'bad' : /fail/i.test(agentLine) ? 'warn' : 'ok',
    last: agentAt ? `${ist(agentAt)} (${ago(agentAt)})` : '—', result: agentLine.replace(/^\[[^\]]+\]\s*/, '').split(':')[0].slice(0, 70) || '—', next: 'every 30 min while the Mac is awake' },
  { job: 'Reels on GitHub', what: 'Reels the scheduler can see', state: onGithub === null ? 'warn' : onGithub >= local.length ? 'ok' : 'warn',
    last: '', result: onGithub === null ? 'could not check' : `${onGithub} of ${unpublishedLocal} queue folders`, next: '' },
  { job: 'Web dashboard', what: 'findgreatarchitecture.com/ig-queue', state: pages?.conclusion === 'success' ? 'ok' : 'warn',
    last: pages ? `${ist(pages.createdAt)} (${ago(pages.createdAt)})` : '—', result: pages?.conclusion || '—', next: 'when the queue changes' },
  { job: 'Instagram access token', what: 'Lets the scheduler post; lasts ~60 days', state: daysLeft > 14 ? 'ok' : daysLeft > 3 ? 'warn' : 'bad',
    last: 'set 14 Oct', result: `expires in about ${daysLeft} days`, next: `renew by ${ist(new Date(tokenExpires - 10 * 864e5).toISOString()).split(',').slice(0, 2).join(',')}` },
];
write('jobs.json', jobs);

// ---- awaiting ------------------------------------------------------------------
const issue = `https://github.com/${CONFIG.repo}/issues/${Q.meta.notifyIssue || 1}`;
const awaiting = [];
const needs = posts.filter((p) => p.status === 'Needs approval');
if (needs.length) awaiting.push({ owner: 'You', item: `Approve ${needs.length} reel(s): reply "approve" on the GitHub notification`, due: needs.map((p) => p.when_utc).sort()[0] ? ist(needs.map((p) => p.when_utc).sort()[0]) : '', state: 'Open', link: issue });
for (const r of posts.filter((p) => p.status === 'Retrying')) awaiting.push({ owner: 'Scheduler', item: `Retry publishing ${r.post} (attempt ${r.attempts + 1} of 3)`, due: ist(nextTick), state: 'Running', link: '' });
for (const f of posts.filter((p) => p.status === 'Failed')) awaiting.push({ owner: 'Claude', item: `Fix failed post ${f.post}: ${f.error.slice(0, 80)}`, due: 'Now', state: 'Open', link: '' });
const uploading = posts.filter((p) => p.status === 'Uploading');
if (uploading.length) awaiting.push({ owner: 'Mac sync', item: `Upload ${uploading.length} reel(s) to GitHub: ${uploading.map((p) => p.post.split('-')[0]).join(', ')}`, due: 'Next sync', state: 'Running', link: '' });
const unscheduled = posts.filter((p) => ['In queue', 'Uploading'].includes(p.status)).length;
const upcoming = posts.filter((p) => ['Needs approval', 'Approved'].includes(p.status)).length;
if (unscheduled + upcoming < 12) awaiting.push({ owner: 'Claude', item: `Produce more reels: ${unscheduled + upcoming} left in the pipeline, 6 needed per batch (drafts 006–015 are written)`, due: ist(nextBatch), state: 'Open', link: '' });
awaiting.push({ owner: 'You', item: 'Renew the Instagram token in the Meta app, then update the IG_TOKEN secret', due: ist(new Date(tokenExpires - 10 * 864e5).toISOString()), state: 'Later', link: 'https://developers.facebook.com/apps/2090956828293085/' });
write('awaiting.json', awaiting);

// ---- account -------------------------------------------------------------------
let account = { at: now.toISOString(), followers: null, posts: null };
try {
  const tok = fs.readFileSync(path.join(HOME, '.fga_ig_token'), 'utf8').trim();
  const r = JSON.parse(execFileSync('curl', ['-s', '-m', '20', '-H', `Authorization: Bearer ${tok}`, `https://graph.instagram.com/${CONFIG.apiVersion}/me?fields=followers_count,media_count`], { encoding: 'utf8' }));
  account = { at: now.toISOString(), followers: r.followers_count ?? null, posts: r.media_count ?? null };
} catch {}
write('account.json', [account]);
console.log(`posts ${posts.length} · jobs ${jobs.length} · awaiting ${awaiting.length} · followers ${account.followers} · ig posts ${account.posts}`);
