#!/usr/bin/env bash
# Kokoaa julkaistavan sivuston omaan hakemistoonsa. Deploy-workflow ajaa tämän
# ja julkaisee vain tuloshakemiston, ei koko repoa. Toimii myös paikallisesti:
#
#   scripts/build-site.sh _site            # kokoa
#   scripts/build-site.sh _site abc12345   # kokoa ja leimaa CACHE = "tuska-abc12345"
#
# - Mukaan tulevat versionhallinnassa olevat tiedostot. Pois jäävät testit,
#   skriptit, dokumentaatio (*.md) ja pistetiedostot (.github, .gitignore …).
#   Ei kopiota eikä muunnosta enempää: sovellus on edelleen sellaisenaan
#   julkaistavia staattisia tiedostoja.
# - Valinnainen toinen argumentti leimaa sw.js:n CACHE-version (deployssa
#   commitin SHA) tuloshakemiston kopioon. Repon sw.js ei muutu.
# - Lopuksi tarkistetaan, että jokainen sw.js:n ASSETS-tiedosto on mukana:
#   puuttuva tiedosto kaataisi service workerin koko precachen.
set -euo pipefail

OUT="${1:?usage: build-site.sh <out-dir> [cache-tag]}"
TAG="${2:-}"
cd "$(dirname "$0")/.."

rm -rf "$OUT"
mkdir -p "$OUT"

count=0
while IFS= read -r -d '' f; do
  case "$f" in
    .*|*/.*|tests/*|scripts/*|*.md) continue ;;
  esac
  mkdir -p "$OUT/$(dirname "$f")"
  cp "$f" "$OUT/$f"
  count=$((count + 1))
done < <(git ls-files -z)
echo "Copied $count file(s) to $OUT"

if [ -n "$TAG" ]; then
  sed -i.bak "s/^const CACHE = \"[^\"]*\";/const CACHE = \"tuska-$TAG\";/" "$OUT/sw.js"
  rm -f "$OUT/sw.js.bak"
  # sed ei epäonnistu, vaikka mikään rivi ei osuisi (esim. jos vakion muotoilu
  # muuttuu) — silloin deploy lähtisi hiljaa vanhalla cache-versiolla.
  if ! grep -q "^const CACHE = \"tuska-$TAG\";" "$OUT/sw.js"; then
    echo "ERROR: could not stamp CACHE in $OUT/sw.js" >&2
    exit 1
  fi
  echo "Stamped CACHE = \"tuska-$TAG\" in $OUT/sw.js"
fi

missing=0
while IFS= read -r asset; do
  if [ ! -e "$OUT/${asset#./}" ]; then
    echo "ERROR: sw.js ASSETS lists $asset but it is not in $OUT (not committed?)" >&2
    missing=1
  fi
done < <(sed -n '/^const ASSETS = \[/,/^\];/p' "$OUT/sw.js" | grep -oE '"\./[^"]*"' | tr -d '"')
[ "$missing" -eq 0 ] || exit 1
echo "All sw.js ASSETS present."
