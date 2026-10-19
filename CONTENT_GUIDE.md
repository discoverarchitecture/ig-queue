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
