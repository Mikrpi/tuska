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

### Ominaisuudet 1, 2, 5, 7 ja 9 (commit `3f533be`)

- [x] **1. Artistihaku/suodatus nimellä** — hakukenttä suodattaa pääaikataulua;
  etsii myös menneiltä päiviltä, tyhjästä hausta oma viesti.
- [x] **2. Kalenterivienti (ICS)** — "Add to calendar (.ics)" -nappi My
  timetable -paneelissa; rakentuu selaimessa ilman backendia, keskiyön yli
  menevät keikat oikealle kalenteripäivälle.
- [x] **5. Kaverivertailu** — eroava jaettu linkki avaa vertailutilan
  (korvasi confirm()-kyselyn): kaverin valinnat katkoviivalla, yhteiset
  "both"-merkinnällä, "Use these picks" / "Done comparing" -napit.
- [x] **7. Aikataulun nimeäminen** — nimi kulkee linkin hashissa (&n=...),
  säilyy festarikohtaisesti; renderöidään vain textContent-kautta
  (XSS-turvallisuus dokumentoitu MAINTENANCE.md:ssä).
- [x] **9. QR-koodi jakamiseen** — oma riippuvuudeton QR-generaattori
  (qr.js, byte mode, ECC M, versiot 1–10), koska offline-periaate estää
  CDN:n; oikeellisuus varmistettu testien itsenäisellä dekooderilla.
  *Suositus: skannaa kerran oikealla puhelimella ennen julkaisua.*

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

### Datan tuontityökalu

- [x] **`scripts/import-data.js`** — muuntaa CSV/TSV-taulukon (otsikkorivi
  `day,stage,start,end,name`, erotin tunnistetaan) `data-<id>.json`-muotoon ja
  numeroi act-id:t automaattisesti. Uudelle festarille kysyy metatiedot
  interaktiivisesti ja rekisteröi sen myös festivals.jsoniin ja sw.js:n
  precache-listaan (CACHE-bumpilla); päivityksessä säilyttää julkaistun
  järjestyksen ja id:t, lisää uudet actit loppuun (`--prune` poistaa
  poistuneet). Ajaa lopuksi validate-data.js:n. Testit: `tests/import.test.js`
  (CI:ssä).

### Ruudukkonäkymä, käyttöohje ja README

- [x] **6. Ruudukkonäkymä** — kolmas näkymä (Grid): lavat sarakkeina, aika
  riveinä, keikat aikajanalle sijoitettuina lohkoina; valinta, törmäys-,
  live- ja vertailumerkinnät sekä "nyt"-viiva kuten muissakin näkymissä.
  Toimii myös kapealla ruudulla: ruudukko vierii omassa paneelissaan ja
  aikapalsta sekä lavaotsikot pysyvät paikallaan (sticky).
- [x] **Käyttöohje loppukäyttäjille** — ?-nappi työkalupalkissa avaa
  "How to use" -dialogin (valinta, linkki tallenteena, vertailu, ICS,
  offline). Staattista sisältöä index.html:ssä, kulkee PWA:n mukana offline.
- [x] **README.md** — esittely, ominaisuudet ja linkit PITCH.md:hen,
  ROADMAP.md:hen ja MAINTENANCE.md:hen; PITCH.md tuotu samalla
  versionhallintaan.

### Deploy-automaatio, päivitysilmoitus ja kuvavienti

- [x] **Cache-version automaattinen leimaus** — Azure-deploy-workflow stampaa
  commitin SHA:n sw.js:n CACHE-vakioon jokaisessa deployssa. Käsin
  ylläpidetty vakio ja PR-tarkistus säilytettiin tietoisesti varalle
  (hostaus ilman workflowta).
- [x] **sw.js:n ASSETS-listan generointi festivals.jsonista** SW:n
  install-vaiheessa — uusi festari päätyy precacheen vaikka listan päivitys
  unohtuisi. Kiinteä lista jäi pohjaksi/varalle, ja tuontityökalu pitää sen
  yhä synkassa.
- [x] **3. PWA-päivitysilmoitus** — pysyvä "App updated — Reload" -palkki,
  kun uusi service worker on asentunut (ei automaattista uudelleenlatausta).
- [x] **11. Kuvan vienti omasta aikataulusta** — "Share as image" -nappi My
  timetablessa: 1080 px leveä pystykuva (PNG) teeman väreillä — festarin ja
  aikataulun nimi, päivät keikkoineen (törmäykset ⚠-merkillä) ja alareunassa
  QR-koodi, josta aikataulun saa auki. Mobiilissa natiivi jakovalikko,
  muuten lataus.

## Tekemättä: ylläpidon helpottaminen

- [ ] **Siivous:** `/workspace/Tuska-copy` (repon ulkopuolinen vanha kopio)
  poistettavaksi, jos ei enää tarpeen.

## Tekemättä: uudet ominaisuudet

- [ ] **4. Lavasuodatin** päiväsuodattimen rinnalle. (Arvo pienentynyt:
  By stage -ryhmittely ja haku kattavat suurimman osan tarpeesta.)
- [ ] **8. FI/EN-kielivalinta** — käyttöliittymä on nyt englanniksi, vaikka
  festarit ovat suomalaisia.
- [ ] **10. Artistilinkit** (Spotify/YouTube-haku tms.) datan valinnaisena
  kenttänä.

## Tiedossa olevat rajoitteet (ei työn alla)

- Julkaistun ohjelman **uudelleenjärjestely act-määrää muuttamatta** jää
  linkkien määrätarkistukselta huomaamatta — uudet actit aina listan loppuun
  (dokumentoitu MAINTENANCE.md:ssä).
- Vanhat hash-only-linkit (ilman `?f=` ja määräetuliitettä) avautuvat
  oletusfestaria vasten; ne ovat joka tapauksessa vanhentuneita.
