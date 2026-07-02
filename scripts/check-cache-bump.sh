#!/usr/bin/env bash
# Checks that the CACHE version in sw.js was bumped when deployable files
# changed (see MAINTENANCE.md, "The one ongoing chore"). Meant for CI on
# pull requests, but works locally too:
#
#   scripts/check-cache-bump.sh origin/main
#
# Policy: app-shell changes (index.html, sw.js, manifest, icons) REQUIRE a
# bump — without it returning visitors keep the old cached app. *.json-only
# changes get a note, not a failure: the service worker fetches them
# network-first, so they propagate even without a bump.
set -euo pipefail

BASE="${1:?usage: check-cache-bump.sh <base-ref>, e.g. origin/main}"
cd "$(dirname "$0")/.."

changed=$(git diff --name-only "$BASE"...HEAD)
if [ -z "$changed" ]; then
  echo "No changes vs $BASE."
  exit 0
fi

app_changed=$(echo "$changed" | grep -E '^(index\.html|sw\.js|manifest\.webmanifest|icon-192\.png|icon-512\.png|apple-touch-icon\.png)$' || true)
json_changed=$(echo "$changed" | grep -E '^(festivals\.json|data-.*\.json)$' || true)
bumped=$(git diff "$BASE"...HEAD -- sw.js | grep -c '^+const CACHE' || true)

if [ -n "$app_changed" ] && [ "$bumped" -eq 0 ]; then
  echo "ERROR: app files changed but the CACHE constant in sw.js was not bumped:"
  echo "$app_changed" | sed 's/^/  - /'
  echo "Returning visitors would keep the stale cached app. Bump CACHE in sw.js"
  echo "(e.g. \"tuska-v9\" -> \"tuska-v10\") — see MAINTENANCE.md."
  exit 1
fi

if [ -n "$json_changed" ] && [ "$bumped" -eq 0 ]; then
  echo "NOTE: only *.json changed — network-first delivers those without a bump,"
  echo "but bumping CACHE in sw.js is the explicit, guaranteed way (MAINTENANCE.md)."
fi

echo "Cache version check OK."
