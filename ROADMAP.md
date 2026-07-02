# Roadmap

Kehityssuunnitelma (laadittu 2.7.2026). Kaksi ensimmäistä osiota on toteutettu,
loput odottavat priorisointijärjestyksessä. Päivitä tätä tiedostoa, kun kohtia
valmistuu tai järjestys muuttuu.

## Tehty

### Korjaukset (commit `2a7ac30`)

- [x] **Jaettu linkki ei ylikirjoita omia valintoja kysymättä** — jos linkin
  valinta eroaa tallennetusta, sovellus kysyy kumpi pidetään; tyhjän valinnan
  linkki ei koskaan pyyhi omia valintoja.
- [x] **Ohjelmamuutos ei riko linkkejä hiljaa** — jakokoodissa on actien määrä
  (`#s=<määrä>.<maski>`); eri ohjelmaversion linkki hylätään ilmoituksella sen
  sijaan, että valitsisi väärät artistit. Vanhat etuliitteettömät koodit
  (linkit ja localStorage-varmuuskopiot) kelpaavat yhä.
- [x] **Virheenkäsittely käynnistykseen** — datan latausvirhe näyttää viestin ja
  Retry-napin tyhjän sivun sijaan; service worker rekisteröidään silti.
- [x] **Service worker ei tallenna virhevastauksia** — vain 2xx-vastaukset
  välimuistiin; virhesivu ei voi korvata toimivaa offline-kopiota (CACHE v9).
- [x] **Saavutettavuus** — artistirivit toimivat näppäimistöllä ja
  ruudunlukijalla (role/tabindex/aria-pressed/aria-label, fokuksen palautus),
  suodatin- ja välilehtinapeilla aria-pressed, toast on aria-live-alue,
  näkyvä fokusrengas.

### Validaattori, testit ja CI (commit `494c6dd`)

- [x] **`scripts/validate-data.js`** — tarkistaa festivals.jsonin, kaikki
  datatiedostot (MAINTENANCE.md:n kriittiset säännöt, saman lavan
  päällekkäisyydet, orpo-datatiedostot) ja sw.js:n precache-listan.
- [x] **`tests/selection.test.js`** — 20 yksikkötestiä jakolinkkilogiikalle;
  ajaa index.html:stä irrotettua koodia vm-hiekkalaatikossa.
- [x] **`scripts/check-cache-bump.sh`** — PR kaatuu, jos app-tiedostot
  muuttuvat ilman sw.js:n CACHE-vakion nostoa.
- [x] **`.github/workflows/validate.yml`** — ajaa kaikki kolme pusheissa
  mainiin ja PR:issä.

## Tekemättä: ylläpidon helpottaminen

- [ ] **Datan tuontityökalu** — skripti, joka muuntaa CSV:n/taulukon
  `data-<id>.json`-muotoon ja numeroi act-id:t automaattisesti. Poistaa
  työläimmän vaiheen (ohjelman naputtelu käsin PDF:stä) ja id-sääntöjen
  rikkomisen riskin.
- [ ] **Cache-version automaattinen leimaus** — workflow stampaa versionumeron
  (esim. git-SHA) sw.js:ään deployssa, jolloin käsin bumppaus jää kokonaan
  pois. Kevyempi vaihtoehto (CI-varoitus) on jo tehty.
- [ ] **sw.js:n ASSETS-listan generointi festivals.jsonista** SW:n
  install-vaiheessa — yksi käsin synkattava lista vähemmän.
- [ ] **README.md** — lyhyt esittely ja linkit MAINTENANCE.md:hen ja
  PITCH.md:hen. (Huom: PITCH.md on yhä versionhallinnan ulkopuolella.)
- [ ] **Siivous:** `/workspace/Tuska-copy` (repon ulkopuolinen vanha kopio)
  poistettavaksi, jos ei enää tarpeen.

## Tekemättä: uudet ominaisuudet

Suuri hyöty, pieni työ:

- [ ] **1. Artistihaku/suodatus nimellä** — isoissa ohjelmissa (Ruisrock,
  99 actia) selaaminen on työlästä.
- [ ] **2. Kalenterivienti (ICS)** — "Lataa omat kalenteriin" -nappi; toimii
  ilman backendia, puhelimen kalenteri hoitaa muistutukset.
- [ ] **3. PWA-päivitysilmoitus** — "Uusi versio saatavilla" -toast, kun uusi
  service worker on asentunut.
- [ ] **4. Lavasuodatin** päiväsuodattimen rinnalle.

Suuri hyöty, keskikokoinen työ:

- [ ] **5. Kaverivertailu** — kaverin linkki avautuu vertailutilassa: omat ja
  kaverin valinnat rinnakkain, yhteiset korostettuna. Korvaa samalla
  nykyisen confirm()-kyselyn tyylikkäämmällä ratkaisulla.
- [ ] **6. Ruudukkonäkymä** — klassinen festariaikataulu (lavat sarakkeina,
  aika riveinä) kolmanneksi näkymäksi; clashbar-aikajana on jo puoliksi tätä.
- [ ] **7. Aikataulun nimeäminen** ("Mikon lauantai") linkkiin mukaan —
  HUOM: MAINTENANCE.md:n XSS-varoitus, vapaa teksti vain textContent-kautta.
- [ ] **8. FI/EN-kielivalinta** — käyttöliittymä on nyt englanniksi, vaikka
  festarit ovat suomalaisia.

Isommat / myöhemmin:

- [ ] **9. QR-koodi jakamiseen** — kätevä festarilla kasvokkain.
- [ ] **10. Artistilinkit** (Spotify/YouTube-haku tms.) datan valinnaisena
  kenttänä.
- [ ] **11. Kuvan vienti omasta aikataulusta** — someen jakoon; korvaa
  nykyisen kuvakaappauskäytännön.

## Tiedossa olevat rajoitteet (ei työn alla)

- Julkaistun ohjelman **uudelleenjärjestely act-määrää muuttamatta** jää
  linkkien määrätarkistukselta huomaamatta — uudet actit aina listan loppuun
  (dokumentoitu MAINTENANCE.md:ssä).
- Vanhat hash-only-linkit (ilman `?f=` ja määräetuliitettä) avautuvat
  oletusfestaria vasten; ne ovat joka tapauksessa vanhentuneita.
