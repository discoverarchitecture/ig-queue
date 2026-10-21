# Find Great Architecture — Instagram/YouTube reels (this repo)

Goal: send people to findgreatarchitecture.com. Three reels a day (09:00 / 13:00 / 19:00 US Eastern), mirrored to YouTube Shorts.

**Making content?** Read `CONTENT_GUIDE.md` §1b "Runbook — making a Walk & Talk reel" and follow it step by step. The tools are in `studio/`:
`suggest.mjs` (pick a building) → `candidates.mjs` (look at photos) → write `specs/dia-<slug>.json` → `check-spec.mjs` → `render.mjs` → `ship.mjs`.

Rules that are not negotiable: the picture must show what the line says; facts only from the site's own record (`studio/cache/buildings.json`); every reel ends on
the spoken sign-off (the studio adds it); caption has ≤ 5 hashtags, a "Photos:" credits line (added by the studio) and a link-in-bio call to action; global (not India-first) audience.

Never print, paste or commit secrets (tokens live in `~/.fga_*` and `~/FindGreatArchitecture/.yt-*.json`). This repo is public. Do not run two renders at once (memory).
Do not edit `scripts/tick.mjs`, `local/sync.mjs` or `config.json` unless asked — they run the live posting schedule.
