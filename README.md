# Festival Schedule

A single-page web app for building and sharing a personal festival schedule:
tap the artists you want to see, get overlap warnings, share the result as a
link or QR code, and use it offline on the festival grounds.

**No backend, no database, no login, no build step.** The whole app is static
files; a visitor's selection lives in the page URL (and a `localStorage`
backup) and never leaves their browser.

## Features

- Personal timetable with overlap (clash) warnings and a live "NOW" marker
- Three schedule views: by stage, by time, and a grid (stages × time; wide screens)
- Share via link, native share sheet or QR code — opening a friend's link
  starts a comparison instead of overwriting your own picks
- Calendar export (`.ics`), artist search, schedule naming
- Image export: a shareable PNG of your timetable with a QR code that opens it
- Installable PWA that works offline, with an in-app "App updated — Reload"
  notice; supports multiple festivals with per-festival colour themes
- In-app help: the “?” button in the toolbar

## Documentation

- [PITCH.md](PITCH.md) — why this exists, pitched for festival organizers (in Finnish)
- [ROADMAP.md](ROADMAP.md) — what's done and what's planned (in Finnish)
- [MAINTENANCE.md](MAINTENANCE.md) — how to add or update a festival, the
  critical data rules, offline/PWA notes, security notes and deployment

## Development

Plain HTML/CSS/JS in `index.html` plus a small vendored QR generator (`qr.js`).
No dependencies to install. Checks (also run in CI on every push and PR):

```sh
node scripts/validate-data.js     # festival data + sw.js precache list
node tests/selection.test.js      # share-link logic (extracted from index.html)
node tests/import.test.js         # data import tool
```

New festival line-ups are imported with:

```sh
node scripts/import-data.js <festival-id> lineup.csv
```

See [MAINTENANCE.md](MAINTENANCE.md) for the details, including the one
ongoing chore: bump the `CACHE` constant in `sw.js` when releasing.

## Deployment

Published via Azure Static Web Apps (workflow in `.github/`): a change to the
`main` branch updates the site as-is — every file is a plain static asset.
