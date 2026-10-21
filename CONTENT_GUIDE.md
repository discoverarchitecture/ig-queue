# Content guide — @findgreatarchitecture

**Goal: site visits.** Every reel exists to send people to findgreatarchitecture.com.
Followers are a side effect. Every post is a **reel** — even a single building with one idea.

## 1. Rotation (3 reels a day — 09:00, 13:00, 19:00 US Eastern)

Since 2026-10-20: **09:00 and 13:00 = Walk & Talk, 19:00 = site feature** (`slotPillars` in config.json).
If a slot's pillar has nothing queued, the lowest-numbered reel of any pillar fills it.
The folder name carries the pillar: `NNN-<pillar>-<slug>`, e.g. `015-talk-fallingwater`.

| Pillar | Folder tag | What it is | Example |
| --- | --- | --- | --- |
| Walk & Talk | `talk` | One building, a curious friend (male, `am_michael`) asks, an architecture-loving guide (female, `af_heart`) explains, street-guide tone. 25–33 s. | "Hold on. Is that house sitting on a waterfall?" |
| Site | `site` | A website feature in action — Surprise me, Shuffle, filters, Guess the building | "I let 'Surprise me' pick my next trip" |

Retired (Oct 14–18, kept for the record): `architect`, `list`, `detail` — photo + single voiceover reels held only 2–5 s of watch time.

### Walk & Talk rules
- Spec: `"format": "talk"`, `"pillar": "talk"`; each photo scene has `talk: [{who: friend|guide, text}]`. Studio adds the ending (friend: "Where do I find more like this?" → guide: sign-off).
- **Frame 1 = the friend's question over the most striking photo, voiced within 0.1 s.** No label on the hook.
- **One question per photo:** friend asks about what's on screen → guide answers in ≤ 2 short sentences → cut to the next photo. The question is what keeps people watching.
- Plain words; name one real idea per reel (parametricism, cantilever…) and explain it in one line.
- Subtitles are chat bubbles: friend ink/left, guide red/right; words light up as they are spoken.
- Caption ends with a question to the viewer (comments).

**Show the website whenever possible.** Screen recordings of the site are the product demo:
- *Guess the building* is a site recording: zoom on a detail from the wall → pause → reveal the building page.
- Every non-`site` reel still ends on a 2–3 s screen recording of that building's page or the wall.

## 1b. Runbook — making a Walk & Talk reel (written for Sonnet; follow it step by step)

Content is written by Sonnet from 2026-10-21. The studio checks what a model could get wrong; trust its errors over your judgement.
Run everything from `~/FindGreatArchitecture/ig-queue/studio`. A reel takes about 12 minutes, almost all of it Dia voicing — run the render
in the background and wait for it; never start a second render while one is running (the Mac runs out of memory).

**Steps**
1. **Pick a building:** `node suggest.mjs 10` (or `node suggest.mjs 10 Cantilever`). It lists famous, unused buildings with the photo numbers, the site's own one-line
   summary and each idea's site count. Pick one whose summary has a *visible, surprising* idea.
2. **Look at the photos:** `node candidates.mjs <building-id>` then open `out/_candidates/<id>.jpg`. Choose 4–5 photos, each showing a different thing.
   Photo 1 must be the most striking image (it is full-screen for the first 3 s).
3. **Write the spec** `specs/dia-<slug>.json` from the template below. Facts come ONLY from the site's record (name, architect, year, place, summary, ideas)
   and from what the chosen photos plainly show. Never add a number, material, date or claim you cannot see or read there.
4. **Check it:** `node check-spec.mjs specs/dia-<slug>.json` — fix every ERROR and read every warn. Repeat until "OK".
5. **Render (≈ 8 min, background):** `PYTHONUNBUFFERED=1 node render.mjs specs/dia-<slug>.json`. Look at `out/dia-<slug>/review.jpg`: does each photo show what is
   being said? If a line fails, change the line (not the photo), re-check, re-render — finished voice chunks are cached, so only the changed exchange is re-voiced.
   If it prints `Dia dropped line …`, reword that line (shorter, no repeated words from its neighbours) and re-render.
6. **Queue it:** `node ship.mjs dia-<slug> --sync`. It numbers the folder, checks the caption rules and uploads. The scheduler fills the next free slot by itself
   (slot 09:00 and 13:00 ET = Walk & Talk, 19:00 ET = site feature).
7. **Keep ≥ 6 Walk & Talk reels ahead of the queue** (3 days). Check with `node -e 'const q=require("../state/queue.json");console.log(Object.entries(q.posts).filter(([,p])=>["pending","approved","scheduled"].includes(p.status)).map(([k,p])=>k+" "+p.status).join("\n"))'`.

**Spec template** (copy `specs/dia-pantheon.json` and change it; this is its shape)
```json
{ "id": "dia-<slug>", "pillar": "talk", "format": "talk", "tts": "dia", "friend": "female", "coverAt": 1.4,
  "scenes": [
    { "type": "photo", "b": "<id>", "i": 6, "fill": true, "move": "in", "voDelay": 0.05, "label": false,
      "talk": [ { "who": "friend", "text": "Wait. Is there a hole in that roof?" } ] },
    { "type": "photo", "b": "<id>", "i": 0, "move": "out",
      "talk": [ { "who": "guide", "text": "Yep! That's the Pantheon in Rome, and it's almost two thousand years old." } ] },
    { "type": "photo", "b": "<id>", "i": 3, "move": "up", "label": { "name": "The dome", "meta": "Plain concrete · no steel inside" },
      "talk": [ { "who": "friend", "text": "Seriously? And the dome's still standing?" },
                { "who": "guide",  "text": "Still the biggest dome ever built in plain concrete. No steel inside at all." } ] },
    { "type": "end", "line": "345 buildings lit from above on the site", "accent": ["345"], "dur": 3 }
  ],
  "outro": "No way. Where do I find more like this?",
  "caption": "Hook question? ☔️\n\nTwo-sentence summary with the architect and year.\n\nExplore it and N more <idea> → link in bio\nQuestion for the viewer?\n\n#architecture #<building> #<architect-or-city> #<idea> #designinspiration" }
```
`move` can be `in`, `out`, `left`, `up`. Leave out `friend` for a 50/50 pick, or set `"male"` / `"female"` (mix them across the week). The studio adds the end-card
sign-off, the "Photos:" credits and the site tagline to the caption — never write those yourself.

**How to write the lines (this is what holds people's attention)**
- **Scene 1 = one friend question** that a stranger can't scroll past ("Is that house sitting on a waterfall?"). ≤ 14 words, about what the photo shows.
- **Scene 2 = one guide line** that names the building, the architect or the place and gives the first surprise.
- **Every later photo = friend question → guide answer.** The question points at something visible; the answer is one idea in ≤ 2 short sentences (≤ 26 words).
  Explain any term the first time ("cantilever: concrete trays held at one end only").
- Spoken style: contractions, "Okay, but…", "No way.", "Seriously?". One `(laughs)` at most per reel, on a friend or guide line where something is funny.
- **Never let a line repeat words from the line just before it.** Dia then speaks it in the other speaker's voice (this broke "Two thousand years?" after "…two thousand years old."). The checker catches 3-word overlaps; also avoid echoes by meaning.
- Numbers as words in speech ("two thousand"), digits are fine on the end card and in the caption.
- 4–5 photos, 330–560 spoken characters, ≈ 28–33 s. Plain words only: no emoji, hashtags, brackets or quotes inside a line.
- **Caption:** line 1 = the hook question. Last sentence before the hashtags = a question to the viewer (drives comments). Exactly 5 hashtags. Include "→ link in bio".
- **Globally minded:** audience is worldwide, Western-heavy. Never "in our country"; use place names; no India-first framing.

**If it goes wrong**
| Symptom | Cause | Fix |
| --- | --- | --- |
| `Dia dropped line …` | line too long or echoes its neighbour | shorter / reworded, re-render |
| Out of memory, Mac crawls | two renders at once, or Dia at full precision | wait for the first to finish; `dia.py` already uses bf16 |
| Wrong voice on a line (the verifier retried 4× and still failed) | the line copies the previous line's words | reword the friend line to ask something new |
| `could not download <url>` | photo host is slow | re-run; downloads are cached |
| `ship: spec is newer than the render` | you edited the spec after rendering | re-render |
| Reel is > 35 s | too many words | cut a scene or shorten the guide answers |

**Feature reel (19:00 ET slot)** — a screen recording of the site, silent, 12–16 s. Copy `specs/013-site-filter-by-idea.json` (filter by idea) or
`specs/005-site-surprise-me.json` (Surprise me) and change the ideas/ids/numbers; counts on screen must be real site counts (`node suggest.mjs` prints them).
Folder tag `site`; render with `node render.mjs specs/<id>.json`; queue with `ship.mjs` (it only knows `dia-` talk reels — for a feature reel copy
`out/<id>/{reel.mp4,cover.jpg,caption.txt}` into `~/FindGreatArchitecture/queue/<next-number>-site-<slug>/` through a `.tmp-` folder and rename it).

## 2. Format

- 1080 × 1920, 9:16, MP4, under 95 MB. Two lengths, alternated:
  - **Voiced** 20–35 s — AI voice (**Kokoro `af_heart`**, the female voice from the Fallingwater sample — house voice) + on-screen text + light music bed.
  - **Silent** 7–15 s — text + music only, built to loop.
- **Hook = the most striking frame first.** No logo, no title card, no slow fade-in. The best photo or detail is frame 1.
- One idea per reel. If it needs two, it's two reels.
- Keep text inside the safe zone: nothing important in the top 220 px or bottom 420 px (Instagram UI covers them).

### Picture = words (house rule)
Every voiced line plays over a shot that **shows what the line says**. "Courtyard" → you see the courtyard;
"buried in a hill" → you see the hill. If no photo shows it, rewrite the line to what the photos *do* show —
never narrate over a generic shot. Biography lines ("never studied architecture") go over the work they lead to,
phrased so the picture still fits ("…and made light his only decoration" over the cross of light).
- Pick photos with `node studio/candidates.mjs <building-id> …` (every photo, numbered as on the site).
- Every render writes `review.jpg` — one frame per line with the words under it. Check it before queueing.

### Sign-off (every post)
Every reel ends on the end card with the voice saying **"Find Great Architecture dot com. A website built by
architects, for architects."** — the studio adds it automatically, also to silent reels, and the card shows the
same line. Captions get `findgreatarchitecture.com — a website built by architects, for architects.` above the hashtags.

## 3. Look — match the website

| Token | Value | Use |
| --- | --- | --- |
| Display font | **Big Shoulders Display** 800–900, ALL CAPS | Headlines, building names |
| Body font | **Barlow** 500–600 / **Barlow Condensed** 600 | Small text, architect + year |
| Red | `#DA3A26` | One accent per screen — a word, an underline, the CTA |
| Ink | `#111110` | Text on light |
| Paper | `#F7F7F5` | Light cards / backgrounds |
| Stage | `#1B1B1A` | Dark backgrounds |

Name + architect + year appear as a lower-third the first time a building is shown.

## 4. Voice & tone — curious friend

Plain, punchy, a little opinionated. Explain any term the first time ("cantilever — a beam held up at one end only").

| ✅ Do | ❌ Don't |
| --- | --- |
| "This roof shouldn't stand up. It does." | "An exemplary instance of structural expressionism." |
| "Tadao Ando taught himself architecture from books." | "Born 1941, Osaka, Ando is a Pritzker laureate…" |
| One surprising fact per building | A list of dates |

## 5. Caption template

```
<Hook line — repeats or extends the on-screen claim, ≤125 chars so it shows before "more">

<2–4 short lines: the idea, the surprising fact.>

Explore 2,600+ buildings → link in bio
<A question for comments: "Which one would you live in?">

findgreatarchitecture.com — a website built by architects, for architects.

#architecture #<topic> #<architect or movement> #<place> #designinspiration

Photos: <Building> – <Author> (<licence>); …
```

## 6. Hard rules — enforced automatically

The Mac sync **won't queue** a reel that breaks these (you'll get a Mac notification + details in `sync.log`):

1. **Photo credits** — a credits line naming author + licence for every photo (`Photos: …` / `Credits: …`).
2. **≤ 5 hashtags.**
3. **Link-in-bio CTA** — the caption says "link in bio" or findgreatarchitecture.com.
4. Caption ≤ 2,200 characters; video under 95 MB.

## 7. Sourcing & disclosure

- Photos: Wikimedia Commons (or your own). Use only CC0, CC BY, CC BY-SA or public domain; record author + licence when you pick the photo. Never Pinterest, Google Images or other accounts' posts.
- Site screen recordings are ours — no credit needed; building pages already credit their photos.

## 8. Folder checklist

```
queue/014-architect-tadao-ando/
  reel.mp4        9:16, hook frame first, ends on the site
  cover.jpg       1080×1920, striking frame + building name in Big Shoulders
  caption.txt     template above
```
