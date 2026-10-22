// Candidate buildings for the next Walk & Talk reels: famous (gv 3), several licensed real photos,
// not used yet. Prints each photo's number + kind and the site count for each concept (for the end card).
// usage: node suggest.mjs [how-many=12] [concept]      e.g. node suggest.mjs 10 Cantilever
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const all = JSON.parse(fs.readFileSync(path.join(HERE, 'cache', 'buildings.json'), 'utf8'));
const count = Number(process.argv[2]) || 12, only = process.argv[3];
const used = new Set();
for (const f of fs.readdirSync(path.join(HERE, 'specs'))) {
  for (const m of fs.readFileSync(path.join(HERE, 'specs', f), 'utf8').matchAll(/"b":\s*"([^"]+)"/g)) used.add(m[1]);
}
const conceptCount = {};
for (const b of all) for (const c of b.concepts || []) conceptCount[c] = (conceptCount[c] || 0) + 1;
const real = (im) => im.license && !/drawing|plan|section|diagram|model|sketch/i.test(im.kind || '') && Math.max(im.w || 0, im.h || 0) >= 1200;
const rows = all
  .filter((b) => b.gv === 3 && !used.has(b.id) && b.images.filter(real).length >= 5 && (!only || (b.concepts || []).includes(only)))
  .sort((a, b) => b.images.filter(real).length - a.images.filter(real).length)
  .slice(0, count);
for (const b of rows) {
  console.log(`\n${b.id} — ${b.name}, ${b.by}, ${b.year}, ${b.place}`);
  console.log(`  site says: "${b.study}"`);
  console.log(`  ideas: ${(b.concepts || []).map((c) => `${c} (${conceptCount[c]} on the site → write "${Math.floor(conceptCount[c] / 10) * 10}+")`).join(' · ')}`);
  console.log('  photos: ' + b.images.map((im, i) => `${i}=${im.kind}${real(im) ? '' : '✗'}`).join('  '));
}
console.log(`\n${rows.length} candidates (✗ = don't use). Look at them: node candidates.mjs <id> …  → out/_candidates/*.jpg`);
