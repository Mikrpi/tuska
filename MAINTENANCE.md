# Tuska Schedule — Maintenance Guide

A single-page static app for building and sharing your personal festival schedule.
No backend, no database, no login. The whole app is just two files:

- `index.html` — UI + logic (HTML, CSS and JS all in one file)
- `data.json` — the festival line-up (the only file you need to update each year)

The selection is stored in the **URL hash** (`#s=…`), which never leaves the browser
(it is not sent to the server). Sharing the link = sharing the schedule.

---

## Yearly update (e.g. 2026 → 2027)

**Recreating `data.json` is enough — no code changes are needed**, as long as the
structure and the critical rules below stay intact.

### `data.json` structure

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

6. **Act `start`/`end`** in `HH:MM`, 24-hour. Assumption: sets don't cross midnight
   (even the latest acts end ~23:55). If a set ever crosses midnight, the time logic
   would need a code change.

The `festival` field is automatically applied to the page and browser tab title.

---

## Clock-dependent features

The app compares the current moment to the festival schedule (`new Date()`):

- **Past days are hidden by default** in both the main schedule and "My timetable".
  The "Show past days (N)" button reveals them in both views at once.
- **When the whole event is over**, all days are shown by default (the button is hidden).
- **"My timetable"** dims acts that are already over, marks the one playing right now
  with a `NOW` badge, and draws a "now HH:MM" line at the current position.
- The view refreshes automatically once a minute.

### Testing at a different point in time

Add `?now=` and an ISO timestamp to the URL to see how the app looks at any moment:

```
index.html?now=2027-06-26T20:30
```

Useful for checking the past/live/upcoming states before the festival. Without the
parameter, the browser's real clock is used.

---

## Known limitations

- **Old shared links don't carry over between years.** The hash has no year identifier,
  so a 2026 link opened against 2027 data selects the wrong artists (it won't crash,
  but the result is meaningless). This is expected — old links are stale anyway.
  If desired, a year identifier could be added to the hash (e.g. `#y=2027&s=…`) to
  ignore links from the wrong year — a small code change, not required.

---

## Security note (read before adding new features)

Currently the app only renders **trusted** data (`data.json`), so the `innerHTML`
template literals are safe.

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

## Deployment

The repo is published via the Azure Static Web Apps workflow (`.github/`). A change to
the `main` branch updates the site. `data.json` and `index.html` are static files —
there is no build step (`app_location: "/"`, `output_location: "."`).
