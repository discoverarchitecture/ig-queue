# ig-queue

Hands-off Instagram publishing for [@findgreatarchitecture](https://www.instagram.com/findgreatarchitecture/),
with a light approval step every 3 days.

**Dashboard:** https://findgreatarchitecture.com/ig-queue/

## How it works

```
~/FindGreatArchitecture/queue/<post>/      you drop reel.mp4 + caption.txt (+ cover.jpg)
        │  local/sync.mjs (launchd, every 30 min)
        ▼
media branch (orphan, force-pushed)        only unpublished posts, no history
        │  tick.yml (GitHub Actions, every 30 min)
        ▼
state/queue.json                           batches, slots, statuses
        │  pages.yml
        ▼
findgreatarchitecture.com/ig-queue/       dashboard + /m/<post>/reel.mp4 for Instagram to fetch
```

- **Every 3 days at 18:00 IST** a batch is planned: the next 6 posts (folder-name order) fill the
  slots for the following 3 days at **12:00 and 19:00 US Eastern**.
- You **approve / skip / edit captions** on the dashboard. Decisions land in `state/decisions.json`.
- Approved posts publish at their slot via the official Instagram API (Instagram Login).
  Anything unapproved at its slot goes back to the queue.
- Reminders: the scheduler @mentions you on the notifications issue (GitHub email + app push)
  when a batch is ready and again if it's still unapproved after 20 h.
- Comments, DMs and post insights sync into `data/*.enc`, encrypted with `FGA_KEY`; the dashboard
  decrypts them in your browser.

## Post folder format

```
queue/
  002-villa-savoye/
    reel.mp4       required, < 95 MB, 9:16
    caption.txt    required, ≤ 2200 chars, ≤ 30 hashtags
    cover.jpg      optional; otherwise the frame at 1 s is used
```

Folder names set the posting order; use letters, numbers, `-`, `_`, `.` only.
Loosely named files are fine if there's exactly one of each type (`*.mp4`, `*.jpg`, `*.txt`).
Published folders are moved to `~/FindGreatArchitecture/posted/`.

## Secrets (repo → Settings → Secrets and variables → Actions)

| Name | What |
| --- | --- |
| `IG_TOKEN` | Long-lived Instagram User token (expires ~60 days — refresh before then) |
| `FGA_KEY` | 32 random bytes, base64 — encrypts inbox/analytics; also pasted into dashboard Settings |

The Instagram token is never stored in the repo.

## Can't be automated (Instagram API limits)

Pinning posts, the AI-info label, renaming original audio, and editing the bio link — do these in the app.
