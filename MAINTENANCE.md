# Tuska Schedule — Maintenance Guide

A single-page static app for building and sharing your personal festival schedule.
No backend, no database, no login. The app supports **multiple festivals**, chosen
from a dropdown and remembered in the URL (`?f=<id>`). The core files are:

- `index.html` — UI + logic (HTML, CSS and JS all in one file)
- `qr.js` — small in-house QR code generator for the share dialog (offline, no CDN;
  verified by `tests/qr.test.js`, which decodes its output back independently)
- `festivals.json` — the registry of available festivals (`id`, `name`, `data` path)
- `data-<id>.json` — one line-up file per festival (the files you update each year)

Plus the PWA/offline support files (rarely touched — see "Offline / PWA" below):

- `manifest.webmanifest` — install metadata (name, icons, colors)
- `sw.js` — service worker (offline caching)
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — app icons

The active festival is stored in the **URL query** (`?f=<id>`); the selection is stored
in the **URL hash** (`#s=…`), which never leaves the browser (it is not sent to the
server). A full link (`?f=…#s=…`) shares both which festival and which acts. The
selection is also mirrored to **`localStorage`** (key `festival-picks:<id>`, per
festival) as a backup, and the last-used festival to `festival-active`, so both survive
opening the app without a link (e.g. from a home-screen icon).

The selection hash is a bitmask over **one festival's** `acts` array, so it is only
meaningful together with the matching `?f=`. The code starts with a line-up
identifier — the act count and a **fingerprint** of the ordered (day, name) list
(`#s=<count>-<fingerprint>.<mask>`, e.g. `#s=60-1x9kq3a.QQAI…`). If acts are added,
removed or reordered after a link was made, the fingerprint no longer matches and
the app rejects the code with a notice instead of silently selecting the wrong
artists. Time and stage changes (and name capitalisation) don't affect the
fingerprint, so links survive ordinary schedule updates. Older codes are still
accepted: `<count>.<mask>` (count check only) and prefix-less `<mask>` (no check).

The **localStorage backup stores the picks by name** as well
(`{"v":2,"code":…,"picks":[{day,name,stage,start},…]}`), so a visitor's *own*
picks survive any line-up change: on load they are re-matched to the current acts
by day + name (case-insensitive; for an artist with two sets on the same day, the
nearest start time). Picks whose act is gone are dropped with a notice naming
them. A replacement act in the same time slot never inherits a pick. Old
backups (a bare code string) are still read; one that no longer fits the line-up
can't be re-matched and is reported as not restorable.
When you switch festivals from the dropdown the app reloads to `?f=<new>` **without**
the hash, then restores that festival's own saved picks.

The hash can also carry an optional **schedule name** (`&n=<url-encoded name>`,
e.g. `#s=60.QQAI…&n=Mikon%20lauantai`) — free-form user text, see the security
note below. The name is stored per festival in `localStorage`
(`festival-name:<id>`) and shown in the share sheet, the QR dialog and the
compare bar.

Opening a **shared link never silently overwrites your own saved picks** — both
on a full page load and when a link is pasted into an already-open tab (which
only changes the hash, no reload): if the link's selection differs from the
localStorage backup, the app opens **compare
mode** — your picks stay active, the friend's picks are shown alongside (dashed
in the schedule, tagged `friend`/`both` in My timetable) until you press "Use
these picks" or "Done comparing". Compare mode lives in memory only: the URL is
immediately rewritten to your own selection, so sharing or reloading during a
comparison uses your picks. A link with an empty selection is ignored in favor
of your own.

---

## Adding or updating a festival

The easiest way is the **import tool**, which does all the steps below in one go:

```
node scripts/import-data.js <festival-id> lineup.csv
```

The input is a table with a header row `day,stage,start,end,name` (any column
order; tab-, semicolon- or comma-separated — detected automatically, so pasting
from a spreadsheet works; times accept both `14:30` and `14.30`):

```csv
day,stage,start,end,name
fri,Karhu Main Stage,14:30,15:25,Some Band
fri,Kvlt Stage,00:00,01:00,Night Act
```

For a **new festival** it asks the name, info URL and each day's label and gate
times interactively, then writes `data-<id>.json` with correctly numbered act
ids, registers the festival in `festivals.json` **and** in the `sw.js` ASSETS
precache list (bumping `CACHE`), and finishes by running `validate-data.js`.

For an **existing festival** (schedule change) it preserves the published act
order and ids — changed times/stages are updated in place, new acts are appended
to the end (critical rule 1 below), and acts missing from the input are kept
unless you pass `--prune`. Pruning removes them and moves every later act to a
new id. It reports when the act list changes (acts added, removed or moved), since
that invalidates already-shared links: the app rejects them with a notice, and
visitors' own saved picks are re-matched by name. `--dry-run` shows what would
happen without writing anything.

Doing the same **by hand** is two steps, no code changes needed as long as the
structure and critical rules below stay intact:

1. Add a `data-<id>.json` file with the line-up (structure below).
2. Add an entry to `festivals.json` pointing at it.

Then run `node scripts/validate-data.js` — it checks every critical rule below plus
the `sw.js` precache list, so you don't have to verify them by hand (see
"Validation, tests and CI").

```json
// festivals.json — first entry is the default for new visitors
{
  "festivals": [
    { "id": "hellsinki2026", "name": "Hellsinki Metal Festival 2026", "data": "data-hellsinki2026.json" },
    { "id": "tuska2026",     "name": "Tuska 2026",                    "data": "data-tuska2026.json" }
  ]
}
```

The festival `id` is the stable key used in `?f=` and in `localStorage` — keep it
unique and don't rename it later (renaming orphans saved picks). Remember to add new
data files to the precache list in `sw.js` (see "Offline / PWA").

The optional `theme` field selects a colour palette. Built-in themes: `steel`
(dark, cold blue — **default**, lives in `:root`), `blackened` (dark, oxblood) and
`summer` (light, sea/sand — daylight-readable), the latter two defined as
`:root[data-theme="…"]` blocks in `index.html`. Omitting `theme` (or naming one with no
matching block) falls back to `steel`. To add a palette, copy a theme block, rename the
`data-theme` selector, and adjust the CSS custom properties; selecting that festival
re-skins the whole app and updates the browser `theme-color`.

### `data-<id>.json` structure

```json
{
  "festival": "Tuska 2027",
  "infoUrl": "https://tuska.fi",
  "stages": ["Karhu Main Stage", "Radio City Stage", "Nordic Energy Stage", "Kvlt Stage"],
  "days": [
    { "id": "fri", "label": "Friday 25.6.2027", "gatesOpen": "14:00", "gatesClose": "01:00" }
  ],
  "acts": [
    { "id": 0, "name": "Some Band", "day": "fri", "stage": "Karhu Main Stage", "start": "14:30", "end": "15:25" }
  ]
}
```

### Critical rules (do not deviate from these)

1. **`acts[].id` = the array index: `0, 1, 2, … N-1`, contiguous.**
   The shareable hash is a bitmask where bit `id` = whether that act is selected.
   If the numbering has gaps or does not start at zero, shared links break.
   The line-up may change freely — links made against a different act list are
   detected (via the line-up fingerprint in the hash) and rejected with a notice
   rather than selecting the wrong artists, and visitors' own picks are re-matched
   by name. Still, every such change invalidates all shared links, so prefer
   **appending new acts at the end** over reshuffling a published line-up, and
   keep a cancelled act in place (don't `--prune`) if old links matter more than
   a tidy list.

2. **Each day's `label` must contain a date in `d.m.yyyy` format** (e.g. `"Friday 25.6.2027"`).
   The past/live/upcoming logic parses the date from here. Don't change the format.

3. **`stages` must list exactly the stage names used by the acts.**
   A stage missing from the list → those acts won't appear in the "By stage" view
   (they still show in the "By time" view). Update the list if the stages change.

4. **`days[].id`** and each act's **`day`** must reference the same identifiers.

5. **`gatesOpen` / `gatesClose`** present on every day. Used to compute the day's
   time window, including nights that run past midnight (e.g. `gatesClose: "01:00"`).

6. **Act `start`/`end`** in `HH:MM`, 24-hour. Sets that cross midnight are supported:
   use the real clock time (e.g. `"start": "00:00", "end": "01:00"`). Any time before
   **12:00** is treated as belonging to that festival night's early hours (i.e. the
   following calendar day), so it sorts and computes its live/past status correctly.
   Consequently no act may legitimately start before noon — fine for evening festivals.

The `festival` field is automatically applied to the page and browser tab title.

---

## Clock-dependent features

The app compares the current moment to the festival schedule (`new Date()`):

- **Past days are hidden by default** in both the main schedule and "My timetable".
  The "Show past days (N)" button reveals them in both views at once.
- **When the whole event is over**, all days are shown by default (the button is hidden).
- **"My timetable"** dims acts that are already over, marks the one playing right now
  with a `NOW` badge, and draws a "now HH:MM" line at the current position.
- A floating **"● Now"** button (mobile only) appears while the event is running and
  jumps the schedule to the current day / live act.
- The view refreshes automatically once a minute.

## Mobile layout

On narrow screens (≤ 640px) the two desktop columns collapse into a **bottom tab bar**
("Schedule" / "My timetable (N)") that switches between them one at a time; on wider
screens both columns show side by side as before. Sharing uses the native share sheet
(`navigator.share`) when available, falling back to clipboard. These are CSS/JS view
behaviors only — they don't affect the festival data or the shared link format.

The third schedule view, **Grid** (stages as columns, time as rows), works on
all screen sizes: on narrow screens the grid scrolls inside its own pane (both
directions) with the time gutter and stage headers pinned in place, and stage
columns get a minimum width. The **"?" help button** in the toolbar opens a
short in-app how-to dialog; its content is static, trusted markup in `index.html`
(see the security note before adding any user-carried text to it).

### Testing at a different point in time

Add `?now=` and an ISO timestamp to the URL to see how the app looks at any moment:

```
index.html?now=2027-06-26T20:30
```

Useful for checking the past/live/upcoming states before the festival. Without the
parameter, the browser's real clock is used.

---

## Known limitations

- **A shared link is only meaningful with its `?f=`.** The selection hash is a bitmask
  over one festival's `acts`, so `?f=` and `#s=` belong together. Modern links carry
  both, plus the line-up fingerprint that detects a changed line-up. **Legacy hash-only links**
  (from before multi-festival support, no `?f=`, no count prefix) open against the
  *default* festival and would select the wrong artists — those old links are stale
  anyway, and they carry no count so the mismatch cannot be detected. The fix if ever
  needed: such links should append `?f=tuska2026`.
  Note: the `localStorage` backup is keyed per festival (`festival-picks:<id>`), so
  different festivals' saved selections do **not** collide.
- **Links made before the fingerprint** (`#s=<count>.<mask>`, all 2026 festivals)
  only carry the act count: for them, a line-up change that keeps the count (e.g.
  `--prune` + an added act, or a reorder) still goes undetected. Links made since
  carry the fingerprint and are always checked.
- **A renamed act invalidates shared links** (the name is part of the fingerprint),
  and a visitor's own pick of it is dropped with a notice — a spelling fix and a
  replacement act are indistinguishable, so the app plays safe.

---

## Security note (read before adding new features)

The `innerHTML` template literals only render **trusted** data (`festivals.json` and
the `data-<id>.json` files). Act and stage names are additionally passed through an
`esc()` HTML-escaper — both as defence in depth and so that legitimate special
characters render literally (e.g. `Pitch & Match`, `I <3 Ibiza`).

The app **does** carry one piece of free-form user text: the **schedule name**
(`&n=` in the URL hash, the `#schedName` input). It is deliberately only ever
rendered via `textContent` (compare bar, toast, QR dialog title) or as an input
`value` — **never via `innerHTML`**. Keep it that way, and treat any new
user-text feature the same: inserting URL-carried text into `innerHTML` creates a
reflected XSS where a malicious link executes code in the browser of whoever opens
it. In compare mode the friend/both badges are fixed words for the same reason —
do not "improve" them by injecting the friend's name into the list markup.
`document.title = text`, on the other hand, is safe (the title does not execute code).

The risk on this static page is low (no cookies, no backend), but it rises
significantly if the app is moved to an origin that hosts other valuable material.
In that case it's also recommended to isolate the origin on its own subdomain and add
a Content-Security-Policy header.

---

## Offline / PWA

The app is an installable PWA and works offline (useful when the festival grounds
have poor signal). A service worker (`sw.js`) caches the app shell and data:

- **All `*.json`** (`festivals.json` and the `data-<id>.json` files) use a
  **network-first** strategy — online visitors always get the latest line-up (including
  last-minute corrections); offline falls back to the last cached copy. If the
  network doesn't answer within **3 seconds** (`NET_TIMEOUT_MS`) and a cached copy
  exists, the cached copy is used right away and the request finishes in the
  background, refreshing the cache for next time. A connection that looks alive but
  delivers nothing (common on festival grounds) must not stall startup. The page
  shows "Loading schedule…" meanwhile (and a "still loading" hint after 8 s).
- **Opening the app** (a navigation to the app's root or `index.html`) always gets the
  cached **app shell regardless of the query string**. The page URL always carries
  `?f=…` (and sometimes `?now=…`), so without this, offline opening would only work
  for the exact URL once loaded online — switching festivals or opening a friend's
  link offline would fail. The shell is cached under `./` (never a redirected response).
- **Everything else** (`qr.js`, icons) uses **cache-first with background refresh** —
  instant load, works with no connection.
- Only **successful (2xx) responses** are cached — an error page from the server can
  never replace a working offline copy.

These paths are covered by `tests/sw.test.js`.

The install-time precache list is **generated from `festivals.json`**: the service
worker fetches the registry during install and adds every festival's data file
**individually and fault-tolerantly** on top of the static core list — a data file
that is listed in the registry but missing from the deploy (404) is skipped
instead of failing the whole install. The hand-maintained `ASSETS` array in
`sw.js` remains as the base (precached all-or-nothing, and used alone if the
registry fetch fails at install time), and the import tool still keeps it in
sync — but a festival missing from `ASSETS` is no longer invisible offline.

When a **new version** of the app has installed in the background, it stays
**waiting** (no `skipWaiting()` at install) and the page shows a persistent
**"App updated — Reload"** bar (wired in `init()`'s service-worker registration).
The old version keeps running untouched until the user clicks **Reload**, which
posts a `SKIP_WAITING` message to the waiting worker and reloads the page on
`controllerchange` — so the page never runs old JS against the new version's
cache, and is never reloaded automatically.

### Cache version on release: stamped automatically

The Azure deploy workflow (`.github/workflows/azure-static-web-apps-*.yml`)
**stamps the `CACHE` constant in `sw.js` with the commit SHA on every deploy**
(`scripts/build-site.sh _site <sha>`, applied to the deployed copy only), so
production users always get a fresh cache without anyone remembering to bump the
version by hand.

The manual mechanism is deliberately kept as a fallback for hosting the app
without that workflow: the `CACHE` constant in the repo (e.g. `"tuska-v19"`) still
works exactly as before, and the PR check (`scripts/check-cache-bump.sh`) still
asks for a bump when app-shell files change. (Thanks to network-first, `*.json`
changes propagate even without any of this.)

Note: the service worker requires **HTTPS** (Azure Static Web Apps provides it). It is
silently skipped on `file://`, so opening `index.html` directly still works, just
without offline caching.

## Validation, tests and CI

The checks below run in GitHub Actions (`.github/workflows/validate.yml`) as the
**first job of the deploy workflow**, on every push to `main` and every pull
request — the deploy job only runs if they all pass, so broken data or a failing
test never reaches production. All of them also run locally with plain Node, no
dependencies to install:

- **`node scripts/validate-data.js`** — validates `festivals.json`, every
  `data-<id>.json` (all the "Critical rules" above: contiguous ids, date in the day
  label, stage/day references, gate times, HH:MM times, start-before-end across
  midnight, plus same-stage overlaps and orphan data files) and the `sw.js` ASSETS
  precache list. Run this after every data edit.
- **`node tests/selection.test.js`** — unit tests for the share-link
  encode/decode/restore logic, the line-up fingerprint and re-matching own picks
  after a line-up change. The app script is extracted straight from
  `index.html` and run in a sandbox, so the tests exercise the shipped code.
  Run this after changing the selection/URL logic in `index.html`.
- **`node tests/import.test.js`** — unit tests for the import tool's parsing,
  merging (act id stability, moved-id reporting) and registration helpers. Run
  this after changing `scripts/import-data.js`.
- **`node tests/qr.test.js`** — decodes `qr.js` output with an independent reader.
- **`node tests/sw.test.js`** — runs `sw.js` in a sandbox with fake caches, network
  and timers: offline navigation with any query, JSON timeout/fallback, what gets
  cached, install. Run this after changing `sw.js`.
- **`bash scripts/build-site.sh _site`** — assembles the deployable site (see
  "Deployment") and checks that every `sw.js` ASSETS file is part of it.
- **`scripts/check-cache-bump.sh <base-ref>`** (pull requests only in CI) — fails
  the PR if app-shell files (`index.html`, `sw.js`, manifest, icons) changed
  without bumping the `CACHE` constant in `sw.js`. A `*.json`-only change passes
  with a note, since the service worker fetches JSON network-first anyway.

## Deployment

The repo is published via the Azure Static Web Apps workflow (`.github/`). A change to
the `main` branch updates the site once the validation job has passed. All app files
(`index.html`, `qr.js`, `festivals.json`, the `data-<id>.json` files, the manifest,
`sw.js` and the icons) are plain static assets — nothing is compiled.
`scripts/build-site.sh _site <tag>` only **assembles** them: it copies the committed
files except `tests/`, `scripts/`, `*.md` and dotfiles into `_site`, stamps `CACHE`
in the copied `sw.js`, and fails if a file in the `sw.js` ASSETS list is missing.
The workflow deploys `_site` as-is (`app_location: "_site"`, `skip_app_build: true`).
A new asset file at the repo root (or in a new folder) is included automatically.
When hosting without this workflow, run the script without a tag and bump `CACHE` in
`sw.js` by hand (see "Offline / PWA").
