# Tuska Schedule — Maintenance Guide

A single-page static app for building and sharing your personal festival schedule.
No backend, no database, no login. The app supports **multiple festivals**, chosen
from a dropdown and remembered in the URL (`?f=<id>`). The core files are:

- `index.html` — UI + logic (HTML, CSS and JS all in one file)
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
meaningful together with the matching `?f=`. When you switch festivals from the
dropdown the app reloads to `?f=<new>` **without** the hash, then restores that
festival's own saved picks.

---

## Adding or updating a festival

Two steps, **no code changes needed** as long as the structure and critical rules below
stay intact:

1. Add a `data-<id>.json` file with the line-up (structure below).
2. Add an entry to `festivals.json` pointing at it.

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
   The **number** of acts may change freely.

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
  both. **Legacy hash-only links** (from before multi-festival support, no `?f=`) open
  against the *default* festival and would select the wrong artists — those old links
  are stale anyway. The fix if ever needed: such links should append `?f=tuska2026`.
  Note: the `localStorage` backup is keyed per festival (`festival-picks:<id>`), so
  different festivals' saved selections do **not** collide.

---

## Security note (read before adding new features)

Currently the app only renders **trusted** data (`festivals.json` and the
`data-<id>.json` files), so the `innerHTML` template literals are safe. Act and stage
names are additionally passed through an `esc()` HTML-escaper — both as defence in depth
and so that legitimate special characters render literally (e.g. `Pitch & Match`,
`I <3 Ibiza`).

If you later add **free-form user text** (e.g. a field to name the schedule that is
stored in the URL and travels with the shared link), it **MUST NOT** be inserted into
`innerHTML` as-is — use `textContent` or escape it. Otherwise you create a reflected
XSS: a malicious link could execute code in the browser of whoever opens it.
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
  last-minute corrections); offline falls back to the last cached copy.
- **Everything else** (HTML, icons) uses **cache-first with background refresh** —
  instant load, works with no connection.

When you add a new festival, add its `data-<id>.json` to the `ASSETS` precache list in
`sw.js` so the festival is browsable offline before its first online visit.

### The one ongoing chore: bump the cache version on release

When you deploy any change (new festival data, edited `index.html`, etc.), **increment
the `CACHE` constant at the top of `sw.js`** (e.g. `"tuska-v2"` → `"tuska-v3"`).
Changing the service worker file makes browsers install the new version and purge the
old cache, so users reliably get the update. (Thanks to network-first, `*.json`
changes propagate even without this — but bumping the version is the safe, explicit way
to guarantee the whole app refreshes.)

Note: the service worker requires **HTTPS** (Azure Static Web Apps provides it). It is
silently skipped on `file://`, so opening `index.html` directly still works, just
without offline caching.

## Deployment

The repo is published via the Azure Static Web Apps workflow (`.github/`). A change to
the `main` branch updates the site. All files (`index.html`, `festivals.json`, the
`data-<id>.json` files, the manifest, `sw.js` and the icons) are plain static assets — there is no build step
(`app_location: "/"`, `output_location: "."`). Remember to bump `CACHE` in `sw.js`
when releasing (see "Offline / PWA").
