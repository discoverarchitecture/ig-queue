// Builds the GitHub Pages site: the dashboard (docs/) plus media for posts.
// Covers ship for every queued post (dashboard previews); videos only for
// posts in a batch, so the site stays small and Instagram can fetch them.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON } from './lib.mjs';

const OUT = path.join(ROOT, '_site');
const MEDIA = path.join(ROOT, 'media');
const WITH_VIDEO = ['scheduled', 'approved', 'publishing', 'failed'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'docs'), OUT, { recursive: true });

const Q = readJSON('state/queue.json', { posts: {} });
let covers = 0, videos = 0;
if (fs.existsSync(MEDIA)) {
  for (const id of fs.readdirSync(MEDIA)) {
    const src = path.join(MEDIA, id);
    if (id.startsWith('.') || !fs.statSync(src).isDirectory()) continue;
    const dst = path.join(OUT, 'm', id);
    fs.mkdirSync(dst, { recursive: true });
    if (fs.existsSync(path.join(src, 'cover.jpg'))) { fs.copyFileSync(path.join(src, 'cover.jpg'), path.join(dst, 'cover.jpg')); covers++; }
    if (WITH_VIDEO.includes(Q.posts[id]?.status) && fs.existsSync(path.join(src, 'reel.mp4'))) {
      fs.copyFileSync(path.join(src, 'reel.mp4'), path.join(dst, 'reel.mp4'));
      videos++;
    }
  }
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`site built: ${covers} cover(s), ${videos} video(s)`);
