# Stand van zaken — 5 september 2026

Alle getallen hieronder zijn op **2026-09-05 tussen 08:20 en 08:40 UTC** zelf
gemeten: live HTTP-verzoeken op productie, de GitHub-API, de runlogs van
Actions, en een eigen sondeloop. Niets is overgenomen uit eerdere rapporten of
uit commitboodschappen; waar een eerdere bewering afweek van de meting staat dat
er expliciet bij. Feiten en metingen, geen aanbevelingen.

---

## 1. nlfr-menu

### 1.1 Wat er live draait en waar

Productie: **https://nlfr-menu.vercel.app**. Ingesloten als iframe op
`https://www.nederlanders.fr/page/actueel-frankrijknieuws` (EMBED.md).

Gemeten HTTP-status: `/` 200 (62.196 B), `/actueel` 200, `/archief` 200,
`/review` 200, `/banner-beheer` 200, `/api/actueel` 200, `/api/actueel-tekst`
200, `/api/actueel-archief` 200, `/api/banner` 200, `/api/schoolvakanties` 200,
`/index.html` 308 (cleanUrls). `/api/cron` zonder Bearer → **401**;
`POST /api/review` zonder token → **401**.

De live `/` is byte-identiek aan `index.html` op main (62.196 B, na normalisatie
van regeleindes).

**Vercel-cron**: `vercel.json` → `{ "path": "/api/cron", "schedule": "*/15 * * * *" }`,
plus `maxDuration: 60` op `api/*.js`. Actief: om 08:27 UTC droegen alle drie de
leveringen `gebakkenOp: 2026-09-05T08:15:59.189Z` — de ronde van 08:15 is echt
gedraaid.

**GitHub Actions**: vier workflows, alle vier `state=active`.

| Workflow | Trigger | Actief? | Laatste run |
| --- | --- | --- | --- |
| Sonde | `schedule: 20 6 * * *` + dispatch | ja, dagelijks | 2026-09-05 06:37 — **failure** |
| Tests | push naar main, PR, dispatch | ja | 2026-09-04 21:19 — success |
| Meting | alleen `workflow_dispatch` | niet vanzelf | 2026-08-30 |
| Bronnen verkennen | alleen `workflow_dispatch` | niet vanzelf | 2026-08-30 |

Over de laatste 100 runs: Tests 30× success, Sonde 16× success / **6× failure**,
Bronnen verkennen 17× success, Meting 8× success. Daarnaast draait de Copilot
PR-reviewer (23 runs).

### 1.2 Wat af is

- **Testsuite** — `npm ci && npm test` op fc835b5: **406 tests, 406 pass, 0 fail**, 2,5 s.
- **Tests-workflow** — de laatste zes runs op main alle success, laatste 2026-09-04T21:19:59Z.
- **Feedinname** — `bronStatus` in de bake van 08:15:59: **17 van 17 bronnen ok**, nul fouten.
- **Drieledige levering** — compact 40.619 B, tekst 61.950 B, archief 233.993 B; alle drie dezelfde `gebakkenOp`.
- **Overheidsvulling zonder review** — zeven overheidstegels, samen 50 artikelen in de bake van 08:15.
- **Archieftegel als aparte levering** — 86 artikelen, `/api/actueel-archief` 200, `artikelenApart` in de compacte levering.
- **Banner uit KV** — `/api/banner` 200, `aan: true`, `bron: "kv"`, `bijgewerkt: 2026-09-05T08:31:28Z`.
- **Afscherming** — cron 401 zonder `CRON_SECRET`, review-POST 401 zonder `REVIEW_TOKEN` (beide live geverifieerd).

### 1.3 Wat gebouwd is maar niet werkt

**a. Redactionele Infofrankrijk-verwijzingen (72af70f).** De commit zit op main
sinds **2026-08-28 21:54 UTC**, dus acht dagen. De telling die de sonde elke dag
afdrukt, uit de runlogs:

| Datum | 08-28 | 08-29 | 08-30 | 08-31 | 09-01 | 09-02 | 09-03 | 09-04 | 09-05 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| verwijzingen | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 3 | 2 |

Eigen sondeloop op 2026-09-05 08:26 UTC: `Infofrankrijk-verwijzingen: 2 onder 2 artikel(en)`.

Waar die twee staan, gemeten op de leveringen zelf:

- `/api/actueel-tekst` — 74 records, de **lopende** berichten: **0 verwijzingen**.
- `/api/actueel-archief` — 86 records: **2 verwijzingen**, beide op verlopen berichten:
  `archief/pmutel` → `infofrankrijk.com/onderwijs-diplomas/` en
  `archief/3iq3fh` → `infofrankrijk.com/politie-en-veiligheid/`.

Dus: nul op elk van de 74 berichten die nu op de pagina staan; de enige twee die
bestaan hangen aan archiefberichten en zijn pas zichtbaar na de archieftegel
openen én het artikel openklappen.

Waarom er niets komt: `api/review.js` is de enige schrijver en de cron kiest
nooit zelf — een test dwingt af dat `api/cron.js` de verwijzingssleutel niet
kent. Er is dus alleen uitvoer als de redactie in `/review` een verwijzing
aanklikt. Dat wordt nergens afgedwongen: I13 toetst uitsluitend de vórm van
verwijzingen die er al zijn (host, titel, maximum, dubbeling binnen een tegel,
overlap met de bronnenlijst). Het aantal wordt geprint, niet getoetst;
`scripts/sonde.mjs` noemt nul in het commentaar expliciet een geldige uitkomst.

*Correctie op de eerdere lezing:* het is niet drie dagen nul. Het is **zes
achtereenvolgende dagen exact nul** (08-28 t/m 09-02, terwijl de sonde groen
was), gevolgd door drie dagen (09-03 t/m 09-05) met verwijzingen die
**uitsluitend op archiefberichten** zitten.

**b. De sonde is drie dagen rood, om een andere reden.** 09-03, 09-04 en 09-05
alle drie `failure`; laatste groen 2026-09-02T06:46:33Z. De oorzaak is niet de
IF-keten maar **I5 geen-dubbele-titels**:

- 09-05 en 09-04, één bevinding: `"Zondag 1 november – Kerkdienst (Kerk+YouTube)" (verenigingen) ≈ "Zondag 18 oktober – Kerkdienst (Kerk+YouTube)" (verenigingen)`.
- 09-03, twee bevindingen: dezelfde kerkdiensten plus twee NL-overheidsberichten ("Nederland steunt Libanon…" ≈ "Nederland steunt onderzoek…").

I5 vergelijkt kop + tekst met `zelfdeVerhaal()` op de crondrempels. Twee
terugkerende kerkdiensten met een verschillende datum vallen binnen die drempel
en leveren elke dag opnieuw dezelfde bevinding op.

**c. CORS op `/api/actueel`.** Gemeten met `Origin: https://nlfr-m.vercel.app`:
de respons bevat wel `Access-Control-Allow-Methods: GET, OPTIONS`, maar **geen
`Access-Control-Allow-Origin`**. Cross-origin ophalen door JavaScript is daarmee
geblokkeerd. De branch `add-cors-actueel-for-if-mobiel` staat 1 vooruit en 49
achter op main, laatste commit 2026-08-23.

### 1.4 Wat half af is of stilstaat

- **Elf remote branches naast main, nul open pull requests.** Zes staan vooruit op main zonder PR: `add-cors-actueel-for-if-mobiel` (1/49, 08-23), `claude/actueel-cache-miss-perf-vvhmz0` (1/6, 08-30), `claude/nlfr-menu-frankrijknieuws-knop` (1/77, 08-01), `claude/nlfr-menu-steunen-actueel-tzowmf` (1/60, 08-03), `feature/actueel-nl` (2/81, 07-31), `feature/steunen-blok` (1/89, 07-31). De overige vijf staan 0 vooruit.
- **`docs/nu-actueel-beheerpaneel-onderzoek.md`** — het document zegt zelf: "Status: **onderzoek**. Er is in deze commit geen enkele regel functionele code gewijzigd." Sindsdien geen opvolging in de code.
- **Meting en Bronnen verkennen** — beide alleen handmatig; laatste run van beide 2026-08-30, dus zes dagen niet gedraaid.
- **Banner-knop is een dood veld** — KV bevat `knop: { tekst: "ENTREZ", url: "" }`. Met de live record geeft `bannerHTML()` 332 tekens HTML **zonder** `<button id="bnrknop">` en zonder uitlegblok: de opgeslagen knoptekst komt nergens terecht.
- **Gisteren (2026-09-04)** is er gewerkt: zes commits, alle op main, tussen 16:37 en 23:19 — archief in het iframe houden en auto-dark uitzetten, het hoofdmenu herbouwd naar het goedgekeurde ontwerp met Cafe Jeudi-banner, de dubbele kaartkop weg, laadknoppen en tweekolommen op /actueel, een schermafbeelding, en systeemfonts in plaats van Google Fonts.

### 1.5 Openstaande repo-instellingen (geen code)

- **`SONDE_WEBHOOK_URL` is niet gezet.** `GET /repos/antonnoe/nlfr-menu/actions/secrets` geeft een **lege lijst — nul Actions-secrets**; `actions/variables` is eveneens leeg. `scripts/sonde.mjs` slaat de POST daardoor stilzwijgend over. Melding bij rood loopt alleen via de GitHub-mail aan de eigenaar.
- **Geen ruleset en geen branch protection op `main`.** `GET /rulesets` geeft `[]`; `GET /branches/main/protection` geeft **404 "Branch not protected"**. Tests is dus niet blokkerend: er is geen required status check en geen PR-verplichting, precies zoals het commentaar in `tests.yml` al aankondigde. Verder: `default_branch=main`, `allow_auto_merge=false`, `delete_branch_on_merge=false`.

### 1.6 Bekende gaten in de bewaking

- **Geen versheidsinvariant.** I10 vergelijkt de drie `gebakkenOp`-waarden *onderling* en meldt pas bij een spreiding groter dan de croninterval. Geen enkele invariant vergelijkt `gebakkenOp` met de huidige tijd. Een stilgevallen cron die drie onderling consistente, dagenoude snapshots blijft serveren, levert dus groen op. *Ontbrekende invariant: `gebakkenOp` is niet ouder dan N × de croninterval.*
- **Geen invariant op de IF-keten.** I13 toetst alleen bestaande verwijzingen; het aantal wordt afgedrukt maar nooit getoetst. Zes dagen op nul (08-28 t/m 09-02) leverden zes groene runs op. *Ontbrekende invariant: een ondergrens op verwijzingen onder de lopende berichten — nu is nul per definitie groen.*
- **De sonde toetst alleen JSON.** Doelwitten zijn `/api/actueel`, `/api/actueel-tekst`, `/api/actueel-archief` en `/actueel.json`. Niet getoetst: de HTML van `/actueel` en `/archief`, het hoofdmenu `/`, `/api/banner`, `/api/schoolvakanties` en `/review`. *Ontbrekende invariant: de pagina die de lezer werkelijk krijgt, rendert.*
- **De melding komt niet aan.** Met een lege `SONDE_WEBHOOK_URL` is GitHub-mail het enige kanaal. Meetbaar effect: drie opeenvolgende rode runs (09-03, 09-04, 09-05) met dezelfde I5-bevinding, die er op 09-05 nog steeds is.
- **Twee van de drie repo's worden helemaal niet bewaakt.** `nlfr-nieuwsbrief` en `nlfr-m` hebben geen `.github`-map en dus geen workflow, geen CI en geen sonde. *Ontbrekende invariant daar: dat de nieuwsbrief van vandaag daadwerkelijk verstuurd is, en dat `/m` laadt.*

### 1.7 Laatste commit

`fc835b5` — **2026-09-04 23:19** — "Systeemfonts in plaats van Google Fonts, en een compacte nieuwslijst voor de startpagina".

---

## 2. nlfr-nieuwsbrief — alleen wat er staat en hoe het gevoed wordt

Privérepo. Next.js 16 (App Router) + React 19 + TypeScript, `rss-parser` 3.13.0,
draait op Vercel. Productie: **https://nlfr-nieuwsbrief.vercel.app** (`/` 200,
6.296 B).

**Cron staat in `vercel.json`, niet in Actions**: `/api/cron/preview` op
`0 6 * * *`, en `/api/cron/daily` vijf keer — `0 2`, `0 3`, `0 4`, `0 5` en
`0 6 * * *`.

**Live gemeten (08:28 UTC)**: `/api/cron/preview`, `/render`, `/daily` en
`/send` geven alle vier **401** met body `{"fout":"Niet geautoriseerd."}`.
`/api/nieuwsbrief` geeft **302** naar
`https://communities-abroad-c.email-provider.eu/web/0f1aywezl2/h9vwpisjar`;
gevolgd is dat 200 met 51.899 B en de titel **"🔵⚪🔴 Je dagelijkse
Frankrijknieuws — 5 september 2026"**. De nieuwsbrief van vandaag is dus
werkelijk uitgegaan.

**Hoe het gevoed wordt.** Drie feeds: het forum
`nederlanders.fr/profiles/blog/feed?xn_auth=no` (met eigen TLS-afhandeling in
`lib/forum-tls.ts`, omdat die feed een incomplete certificaatketen levert),
`infofrankrijk.com/feed/`, en een Feedspot-pinboard voor Frans nieuws. Fouten
worden per feed apart opgevangen. Renderen gebeurt uit
`template/nieuwsbrief.html`; de campagne gaat via de Laposta v2 REST-API
(`lib/laposta.ts`), die naar de volledige abonneelijst verstuurt.
`/api/nieuwsbrief` leest Laposta read-only, houdt alleen campagnes over die echt
verstuurd zijn én een webversie hebben, sorteert op `delivery_started_iso` en
stuurt door naar de nieuwste (`s-maxage=600`).

**Remmen op verzending.** `/api/cron/send` eist `CRON_SECRET` én de letterlijke
parameter `?bevestig=VERZEND-ECHT`, en heeft een harde rem als de afmeldlink in
de uitgaande HTML ontbreekt. `/api/cron/daily` eist `CRON_SECRET`, kent
`?dryrun=1|html`, en geeft 503 zonder `LAPOSTA_API_KEY`.

**Afwijking tussen README en code.** README regel 53 beschrijft
`/api/cron/preview` als "Geen verzending, geen auth". De route roept
`controleerCronGeheim(request)` aan (`app/api/cron/preview/route.ts:191`) en
geeft live 401. De README is op dat punt onjuist.

Geen `.github`-map: geen workflow, geen CI, geen sonde. Zeventien remote
branches naast main, waarvan één van Dependabot.

**Laatste commit**: `737b986` — **2026-07-29 10:54** — "Fix CDN-caching
/api/nieuwsbrief: zet CDN-Cache-Control i.p.v. alleen Cache-Control". Nul
commits sinds 2026-08-01; hier is gisteren niet aan gewerkt.

---

## 3. De repo achter https://nlfr-m.vercel.app/ — alleen wat er staat en hoe het gevoed wordt

**Welke repo het is: `antonnoe/nlfr-m` (publiek).** Vastgesteld door te meten,
niet door de naam: de opgehaalde live pagina (519.342 B) en
`git cat-file -p HEAD:index.html` uit de repo hebben dezelfde md5
`a45ff434bbca5cb2b5d7010c2b7abc02` — byte-identiek. (Een eerste vergelijking
suggereerde 768 afwijkende regels; dat bleek volledig CRLF-conversie in de
werkkopie en is dus géén verschil.)

De repo bevat vier bestanden: `index.html`, `vercel.json`, `README.md`,
`EMBED.md`. `index.html` is één gebundeld zelfstandig bestand van 519.342 B met
titel "Bundled Page". `vercel.json` doet `cleanUrls` plus twee security-headers
— **geen crons, geen functions**.

**Live**: 200, `Last-Modified: Wed, 02 Sep 2026 13:35:28 GMT`,
`X-Vercel-Cache: HIT`, `Access-Control-Allow-Origin: *`.

**Insluiting**: in de HTML van `https://www.nederlanders.fr/m` (12.668 B) staat
`<iframe id="nlfrM" src="https://nlfr-m.vercel.app/">`, naast een
GTM-iframe. De embedcode staat in `EMBED.md` en is bedoeld voor een mobiele
Ning-pagina.

**Wat het toont** (README): drie schermen met een onderbalk — *Start* (welkom,
twee snelste ingangen, wat er nu speelt), *Berichten* (recente berichten mét de
volledige reactiedraad, omdat de mobiele Ning-weergave reacties weglaat), en
*Actueel* (de nieuwspagina van nlfr-menu als paneel met hoogte-sync).

**Hoe het gevoed wordt** — de URL's uit de bundle, alle gemeten met
`Origin: https://nlfr-m.vercel.app`:

| Bron | Status |
| --- | --- |
| `nlfr-berichten.vercel.app/api/berichten` | 200, 17.406 B, ACAO `https://nlfr-m.vercel.app` |
| `nlfr-berichten.vercel.app/api/reacties` | 400 zonder `?post=` (verwacht), ACAO `https://nlfr-m.vercel.app` |
| `nlfr-berichten.vercel.app/api/tellingen` | 200, 286 B, ACAO `*` |
| `nlfr-nieuwsbrief.vercel.app/api/nieuwsbrief` | 302 naar de nieuwste Laposta-webversie |
| `nlfr-menu.vercel.app/actueel` | 200, 58.338 B, als paneel |
| `www.nederlanders.fr` (`/m`, `/profiles/blog/list`) | ingangen naar de site zelf |

De berichten en reacties komen dus niet uit deze repo maar uit
`antonnoe/nlfr-berichten`, dat de Ning-koppeling verzorgt. Geen `.github`-map,
geen workflow, geen test, geen cron in deze repo.

**Laatste commit**: `14ada17` — **2026-08-05 10:32** — "Add files via upload"
(twee commits in totaal). De frontend staat dus een maand stil, terwijl de
leverancier eronder wél beweegt: `nlfr-berichten` kreeg gisteren nog werk,
`99abbe2` — **2026-09-04 17:00** — "Reactietekst zonder NING-interface: alleen
wat iemand schreef".

---

### Waar gisteren (4 september 2026) aan is gewerkt

| Repo | Commits op 2026-09-04 | Laatste commit |
| --- | --- | --- |
| `nlfr-menu` | 6 (16:37 – 23:19) | `fc835b5`, 2026-09-04 23:19 |
| `nlfr-berichten` (leverancier van `/m`) | 1 (17:00) | `99abbe2`, 2026-09-04 17:00 |
| `nlfr-m` | 0 | `14ada17`, 2026-08-05 10:32 |
| `nlfr-nieuwsbrief` | 0 | `737b986`, 2026-07-29 10:54 |
