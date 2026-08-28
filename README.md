# NLFR hoofdmenu

Het hoofdmenu van Nederlanders.fr, gehost op Vercel en op de site geladen via
een iframe. Voorheen stond dit menu als bestand op Ning zelf; het is verplaatst
omdat Ning-storingen (29-07-2026) het menu meermaals onbruikbaar maakten en de
Ning-editor code beschadigt bij opslaan.

## Bestanden

- `index.html` — het complete menu (HTML + CSS + JS in één bestand). Vercel
  publiceert dit als statische site.
- `actueel.json` — de inhoud van de knop **"Nu actueel"** in de onderbalk (één
  compacte rij linkjes). Het menu haalt dit bestand live op; je past het los
  aan, zonder `index.html` aan te raken. Zie "'Nu actueel' bijwerken" hieronder.
- `embedcode-ning.html` — de code die op nederlanders.fr in de tekst/codemodule
  staat. Staat hier alleen ter referentie/backup; wijzigingen hieraan moeten
  handmatig op Ning worden overgenomen.

## Menu aanpassen (dagelijks beheer)

1. Open `index.html` op github.com en klik op het potlood (Edit).
2. Alle menu-inhoud staat in het `<script>`-blok, duidelijk gelabeld:
   - `DOORS` — de uitklapmenu's Lezen / Meedoen / Vinden / Nieuws
   - `TOPICS` — het "Onderwerpen"-uitklapmenu
   - `CTAS` — de drie actiekaarten bovenin "Onderwerpen"
   - `memberGroups` — het ledenmenu (Mijn NLFR)
   - `ADMIN_LINKS` — beheerlinks
   - `bandleft` (onder "Build band") — de knoppenbalk onderin
3. Een regel heeft de vorm `["Label", U("/pad-op-nlfr")]` voor interne links of
   `["Label", "https://externe.site/"]` voor externe. Een derde element `1`
   geeft het item een accentopmaak.
4. Commit ("Commit changes"). Vercel publiceert automatisch; na ± 1 minuut
   staat het live op de site. Ning hoef je niet aan te raken.

Fout gemaakt? Op GitHub: History → vorige versie openen → Revert, of in Vercel:
Deployments → vorige deployment → "Promote to Production".

## "Nu actueel" bijwerken

De knop **"Nu actueel"** in de onderbalk (naast "Diensten") toont bij openen
een compacte rij linkjes en leest die live uit `actueel.json` (naast
`index.html`). Je hoeft de menucode dus niet aan te raken:

1. Open `actueel.json` op github.com en klik op het potlood (Edit).
2. Elk item heeft: `titel` (de zichtbare linktekst), `tekst` (verschijnt als
   tooltip, niet zichtbaar), `href` (de link), optioneel `accent: true`
   (behouden veld) en optioneel `live: true` (dan krijgt de balkknop een
   pulserend stipje). Alle items worden getoond.
3. Commit. Vercel publiceert automatisch; na ± 1 minuut staat het live.

Het eerste item wijst standaard naar `https://nlfr-nieuwsbrief.vercel.app/api/nieuwsbrief`.
Die route (in de aparte repo `nlfr-nieuwsbrief`) stuurt 302 door naar de
webversie van de laatst verzonden Laposta-nieuwsbrief, zodat de link altijd de
nieuwste editie opent zonder handmatig bijwerken.

## Hoe het technisch werkt

- Het iframe op Ning wijst naar de Vercel-URL. Het menu meldt zijn eigen hoogte
  aan de moederpagina via `postMessage({nlfrMenuHeight})`; de embedcode past de
  iframe-hoogte aan.
- Ledenstatus: de embedcode (die op nederlanders.fr draait) leest
  `ning.CurrentProfile` en stuurt `{id, profileUrl}` het iframe in via
  `postMessage({nlfrProfile})`. Het menu accepteert dat bericht uitsluitend
  van `https://www.nederlanders.fr`. Zonder dit bericht toont het menu de
  niet-ingelogde variant.
- Beheer-ID staat in `index.html` als `ADMIN_ID`; dit stuurt alleen de
  zichtbaarheid van beheer-snelkoppelingen, geen rechten.

## Route `/actueel` — live Frankrijknieuws (PR B)

Naast het statische menu draait op dezelfde Vercel-deployment de route
**`/actueel`** (`actueel.html`), bedoeld om via een iframe embed te worden op
`https://www.nederlanders.fr/page/actueel-frankrijknieuws` (embedcode in
`EMBED.md`). Zelfde hoogte-sync als het menu, via
`postMessage({nlfrActueelHeight})`.

### Onderdelen

- `bronnen.json` — de enige toegestane bronnenlijst (RSS/Atom). Los aanpasbaar,
  zonder code. Elke bron heeft o.a. `regime` (`overheid` of `pers`) en `actief`.
- `/api/actueel` — de **compacte levering**: tegels, agenda, bronStatus, en per
  artikel alles wat de DICHTE staat toont — maar zonder `tekst` en zonder de
  volledige `bronnen`-array. **Leest bij voorkeur een voorgebakken antwoord uit
  KV** (zie "Hoe het antwoord tot stand komt" hieronder) en stelt het alleen
  zelf samen als dat ontbreekt. Bij zelf samenstellen: alle actieve bronnen
  ophalen, parseren (RSS 2.0 + Atom), normaliseren en het regime respecteren
  (overheid: titel + samenvatting; pers: alleen titel + bron + datum + link),
  hot-clusters bepalen (≥ 3 onafhankelijke bronnen) en gepubliceerde
  redactiesyntheses bovenaan zetten. Een kapotte feed wordt overgeslagen; de
  rest blijft werken.
- `/api/actueel-tekst` — de **tekst-levering**: per artikel buiten het archief
  de volledige NL-tekst en de volledige bronnenlijst, in één verzoek.
- `/api/actueel-archief` — de **archieflevering**: de artikelen van de
  archieftegel plus hun tekst en bronnen. Zie "De drie leveringen" hieronder.
- `/api/schoolvakanties` — eerstvolgende schoolvakantie per zone, live uit de
  open data van het onderwijsministerie, met vaste link naar service-public.
- `/api/cron` — serverless job (Vercel Cron, elke 15 min) die voor nieuwe
  hot-clusters via de Anthropic API één NL-synthese schrijft en als **concept**
  opslaat. Nooit direct live. Model/max_tokens staan in één constante
  (`lib/config.js` → `AI_CONFIG`). Aan het eind van elke ronde **bakt de cron
  beide leveringen voor** en zet ze in KV.
- `/review?token=…` — mobielvriendelijke reviewtool. Publiceer / Weg / inline
  bewerken. Concepten verlopen automatisch na 48 uur.

### De drie leveringen

De pagina wordt in **drie stukken** geserveerd, elk met een eigen route. Twee
metingen op productie liggen daaraan ten grondslag:

1. Het volledige antwoord was 317.675 bytes (88 kB over de lijn) voor 152
   artikelen; het veld `tekst` was daarvan samen 117.303 bytes en de
   `bronnen`-arrays 114.154 bytes — ruim 70% — terwijl de lezer die pas ziet
   zodra hij een artikel **openklapt**.
2. Van die 152 artikelen zitten er **86 in de tegel "archief"**, die standaard
   **dicht** staat. Die 86 waren 174.180 van de 241.393 bytes van de
   tekst-levering: een lezer die het archief nooit aanraakt, betaalde er wel voor.

| | `/api/actueel` (compact) | `/api/actueel-tekst` | `/api/actueel-archief` |
| --- | --- | --- | --- |
| `bijgewerkt`, `gebakkenOp` | ✔ | ✔ (zelfde bakmoment) | ✔ (zelfde bakmoment) |
| `tegels` met `label`, `soort`, `thema`, `hot` | ✔ | — | — |
| per tegel **`artikelAantal`** — wat de kop toont | ✔ | — | — |
| per tegel **`artikelenApart`** — true op de archieftegel | ✔ | — | — |
| artikelen van de tegels **buiten** het archief | ✔ | — | — |
| artikelen van de **archieftegel** | — (alleen de tegel zelf) | — | ✔ |
| per artikel `id`, `titel`, `summary`, `soort`, `datum`, `url`, `label`, `restDagen` | ✔ | — | ✔ |
| per artikel **`bronMeta`** — `{naam, datum}` van de eerste bron | ✔ | — | ✔ |
| per artikel **`bronAantal`** — het aantal bronnen | ✔ | — | ✔ |
| `agenda`, `bronStatus` | ✔ | — | — |
| per artikel `tekst` en `bronnen`, buiten het archief | — | ✔ | — |
| per artikel `tekst` en `bronnen`, in het archief | — | — | ✔ (`teksten`) |

`bronMeta` en `bronAantal` zijn er omdat de dichte staat die twee dingen wél
toont: `bronMeta` is de onderregel onder een overheids-, Infofrankrijk- of
verenigingsartikel ("Service-Public · 27 augustus"), `bronAantal` is het getal
op de knop "Bronnen (n)". Een perssynthese toont daar de NLFR-byline en gebruikt
`bronMeta` niet. `artikelAantal` staat op **elke** tegel, zodat de kop ("86
artikelen") één bron van waarheid heeft — ook op de archieftegel, waar de
artikelen zelf niet zijn meegestuurd.

De tekst- en archieflevering hangen aan de sleutel **`tegelId/artikelId`**, niet
aan het kale artikel-id: hetzelfde artikel-id kan in twee tegels voorkomen (een
perssynthese die van de live-tegel naar het archief verhuist).

```json
// /api/actueel-tekst
{ "bijgewerkt": "...", "gebakkenOp": "...",
  "artikelen": { "overheid-douane/a1": { "tekst": "...", "bronnen": [ ... ] } } }

// /api/actueel-archief
{ "bijgewerkt": "...", "gebakkenOp": "...", "tegelId": "archief",
  "artikelen": [ { "id": "...", "titel": "...", "bronMeta": {}, "bronAantal": 2 } ],
  "teksten":   { "archief/a1": { "tekst": "...", "bronnen": [ ... ] } } }
```

**Wanneer de pagina welke ophaalt** (`actueel.html`):

| levering | moment |
| --- | --- |
| 1 — compact | meteen; hierop wordt gerenderd |
| 2 — tekst | direct ná de eerste weergave, op de achtergrond |
| 3 — archief | **pas als de lezer de archieftegel opent** |

Levering 3 wordt bewust *niet* meegeladen: dat is precies het verbruik dat de
splitsing weghaalt. Klapt de lezer een artikel open voordat levering 2 binnen
is, dan ziet hij de summary met de regel "Volledige tekst wordt geladen…" en een
niet-aanklikbare "Bronnen (n)" — het aantal is dan al bekend uit `bronAantal`.
Opent hij de archieftegel, dan staat er "Archief wordt geladen…" met de kop al
op het juiste aantal. Zodra een levering binnen is, rendert de pagina opnieuw;
open/dicht-standen en scrollpositie blijven staan. Mislukt levering 2, dan blijft
de summary staan ("De volledige tekst kon niet worden geladen") en probeert de
5-minutenlus het opnieuw; mislukt levering 3, dan zegt de tegel dat, en een
dicht-en-weer-open doet een nieuwe poging. Een lege bak of een knop die niets
doet komt er in geen van de gevallen.

**De sonde toetst alle drie de leveringen.** `scripts/sonde.mjs` haalt ze op en
voegt ze per `tegelId/artikelId` weer samen, zodat de bronlinktoetsen (I3, I4,
I9) en de tekstinvarianten (I5) op dezelfde artikelvorm blijven werken als vóór
de splitsing — de 86 archiefartikelen inbegrepen. Zou hij de derde levering
overslaan, dan zouden die 86 buiten élke invariant vallen. Drie toetsen zijn
erbij gekomen:

- **I10** — de leveringen dekken elkaar: elk artikel heeft een tekst-record.
  Bakmomenten mogen binnen één croninterval uiteenlopen (elke route heeft een
  eigen edge-cache-entry; de ene kan net ververst zijn terwijl de andere nog
  stale wordt geserveerd) — daarboven is het een bevinding.
- **I11** — `bronAantal` en `bronMeta` kloppen met de volledige bronnenlijst.
- **I12** — de archieftegel: `artikelAantal` in de kop klopt met het aantal
  artikelen dat de derde levering bevat, en die levering hoort bij die tegel.

> **Niet te verwarren met `/archief`.** Die pagina toont het duurzame
> regelgevingsregister en draait op `/api/register`. Daar staat de
> archief**tegel** van de nieuwspagina helemaal los van.

### Hoe de leveringen tot stand komen

Deze route stelde het antwoord vroeger bij **elke** cache-miss ter plekke samen:
16 feeds live ophalen plus de verenigingen-agenda, en daarna ~145 losse KV-reads.
De traagste externe site bepaalde de responstijd — gemeten 12,0 tot 12,5 s, tegen
0,06 s bij een cache-hit. Nu is het omgedraaid:

1. **De cron bakt voor.** Aan het eind van elke ronde (elke 15 min) stelt
   `/api/cron` het volledige antwoordobject samen — `bijgewerkt`, `tegels`,
   `agenda`, `bronStatus` — splitst het in de drie leveringen en schrijft die
   weg onder **`actueel:snapshot:v3`** (compact),
   **`actueel:snapshot-tekst:v2`** (tekst) en
   **`actueel:snapshot-archief:v1`** (archief), alle drie met een **TTL van 6
   uur**. Die TTL is ruim langer dan de croninterval: een paar gemiste rondes
   geven dus nog geen lege pagina. Het veld `bijgewerkt` is het **bakmoment**,
   niet de requesttijd; alle drie de leveringen dragen datzelfde moment ook als
   `gebakkenOp`.
2. **Elke route leest haar eigen sleutel** en antwoordt ermee. Dat is één
   KV-round-trip, geen enkele feed.
3. **Ontbreekt de snapshot, of is hij ouder dan 60 minuten**, dan stelt de route
   het volledige antwoord alsnog zelf samen (live feeds + KV) — via dezelfde
   functie als de cron, `lib/antwoord.js` → `bouwAntwoord()`, dus functioneel
   identiek aan het oude gedrag, inclusief `bronStatus` — splitst het, en
   **schrijft alle DRIE de leveringen weg**. Wie de ene route mist, warmt dus
   meteen ook de andere twee op; die hoeven de feeds daarna niet nóg een keer op
   te halen, en de drie dragen hetzelfde bakmoment. Er is bewust **geen lock of wachtrij** bij gelijktijdige missers:
   twee keer bakken mag, dat is de complexiteit niet waard.
4. **Zonder KV** (env-vars niet ingesteld) valt stap 1 en 3 weg: er is geen
   snapshot te lezen en niet te schrijven, en de routes stellen het antwoord elke
   keer zelf samen. De pagina blijft dus werken, precies zoals voorheen.

Na een deploy is in de uitvoer van `/api/cron` te zien of het voorbakken lukt:
het veld `snapshot` bevat `ok`, het bakmoment en het aantal tegels/artikelen, of
`ok:false` met een reden (bijvoorbeeld een document dat de maximale
requestgrootte van Upstash overschrijdt). Mislukt het voorbakken, dan valt
`/api/actueel` vanzelf terug op zelf samenstellen — het gedrag van vóór deze
ingreep — dus de pagina blijft hoe dan ook werken.

De diagnoseheader `X-Actueel-Herkomst` vertelt welk pad is gelopen: `snapshot`,
`vers-ontbrekend`, `vers-verouderd`, of met achtervoegsel `-nietbewaard` als het
wegschrijven mislukte. Hij verandert niets aan de inhoud van de pagina.

`lib/store.js` → `listJSON()` haalt zijn documenten sinds dezelfde ingreep met
**MGET in batches van 100** op in plaats van één GET per sleutel: voor de huidige
voorraad van ~145 documenten zijn dat 5 round-trips naar Upstash in plaats van
147 (gemeten, zie `docs/meting-actueel-cachemiss-2026-08-28.md`).

### Cachevenster

| header | waarde | waarom |
| --- | --- | --- |
| `s-maxage` (CDN) | **900 s** | gelijk aan de croninterval: binnen dat venster bestaat er geen versere versie |
| `stale-while-revalidate` | **86400 s** | een bezoeker krijgt altijd direct de laatst bekende versie; de verse wordt op de achtergrond gemaakt |
| `max-age` (browser) | **120 s** | herbezoek en terugnavigatie binnen twee minuten kosten niets |

Die waarden staan in `lib/config.js` (`FEED_MAX_AGE_S`, `FEED_SWR_S`,
`BROWSER_MAX_AGE_S`). `actueel.html` haalt `/api/actueel` **zonder**
`cache: "no-store"` op, zodat de browser die `max-age` ook echt gebruikt; de
5-minutenlus in de pagina haalt daarna vanzelf een verse versie. De fetch van
`/api/schoolvakanties` staat nog wel op `no-store`.

Meten: `node scripts/meet-actueel.mjs` doet per route drie miss-metingen (met
cache-buster in de querystring, want een nieuwe URL is altijd een edge-miss), de
hit-meting en beide payloadgroottes, plus wat een lezer binnenhaalt in de drie
scenario's (niets aanraken / een artikel openklappen / het archief openen).
Drukt het af als markdown-tabel.

### Env-vars (in Vercel instellen, zie `.env.example`)

`ANTHROPIC_API_KEY`, `REVIEW_TOKEN`, `CRON_SECRET`, en een gekoppelde Vercel KV
(`KV_REST_API_URL` / `KV_REST_API_TOKEN`). De feedpagina werkt ook zonder deze
vars; alleen de AI-synthese en de reviewtool hebben ze nodig.

## Bewaking: tests en sonde (GitHub Actions)

Twee workflows in `.github/workflows/`.

### `tests.yml` — de testsuite

Draait `npm test` bij **elke push naar main** en **elke pull request**. Faalt de
suite, dan is de run rood en mailt GitHub de eigenaar. Hiervoor hing "tests
groen" ervan af of iemand de tests toevallig aanriep.

**Nog te doen om hem écht blokkerend te maken** — een workflow kan zichzelf niet
verplicht stellen, dat is een repo-instelling:

> GitHub → repository **antonnoe/nlfr-menu** → **Settings** → **Rules** →
> **Rulesets** → **New ruleset** → *New branch ruleset* → naam bv. `main
> beschermen`, **Target branches** → *Add target* → `Include default branch` →
> onder **Rules** aanvinken **Require status checks to pass** → *Add checks* →
> zoek **`npm test`** en voeg hem toe → **Create**.
>
> (Het oudere pad werkt ook: **Settings** → **Branches** → **Add branch
> protection rule** → Branch name pattern `main` → *Require status checks to
> pass before merging* → check `npm test`.)

Zonder die instelling is de uitslag wél zichtbaar op de PR, maar houdt hij het
mergen niet tegen.

### `sonde.yml` — invarianten op de live uitvoer

Draait **dagelijks om 06:20 UTC** (en handmatig via *Run workflow*)
`scripts/sonde.mjs` tegen de echte productiedata op
`https://nlfr-menu.vercel.app`. Deterministisch, geen AI-oordeel: bij een
schending eindigt de stap met code 1, de run wordt rood en GitHub mailt zelf.

Getoetst wordt onder meer: elke bronlink hoort bij zijn bron en heeft een
niet-leeg pad, geen asset-hosts, elk artikel heeft minstens één bron, geen twee
live artikelen over hetzelfde verhaal, datums binnen een plausibel venster,
`actueel.json` geldige JSON, geen uitgezette bron die tóch items levert, en
artikel-id's aanwezig en uniek. Wat bewust *niet* getoetst wordt (en waarom)
staat in `scripts/sonde.mjs` zelf.

Handmatig draaien met de gevonden links erbij: *Run workflow* → vink
**toon_links** aan, en vul eventueel **toon_filter** met een stuk van een titel
om één item na te trekken.

### De webhook-secret `SONDE_WEBHOOK_URL`

Aan het eind van elke sonderun gaat er één POST naar de URL in de repo-secret
`SONDE_WEBHOOK_URL`. **Ontbreekt die secret, dan wordt de stap stilzwijgend
overgeslagen** — de bewaking zelf werkt onverminderd, ook zonder webhook.

Aanmaken zodra de Zapier-webhook bestaat:

> GitHub → repository **antonnoe/nlfr-menu** → **Settings** → **Secrets and
> variables** → **Actions** → tabblad **Secrets** → **New repository secret** →
> Name: `SONDE_WEBHOOK_URL`, Secret: de "Catch Hook"-URL van de Zap.

De Zap ontvangt `Content-Type: application/json` met deze body:

```json
{
  "datum": "2026-08-28",
  "verdict": "rood",
  "aantal": 2,
  "bevindingen": "I3 bronlink-herkomst: tegel infofrankrijk · \"Titel\" · bron Infofrankrijk · https://fonts.googleapis.com · leeg pad (alleen de voorpagina van fonts.googleapis.com)\nI4 bron-aanwezig: tegel overheid-praktisch · \"Titel\" heeft geen enkele bron"
}
```

- `datum` — `YYYY-MM-DD`, de dag van de run.
- `verdict` — `"groen"` of `"rood"`.
- `aantal` — aantal bevindingen (`0` bij groen).
- `bevindingen` — leesbare tekst, één bevinding per regel (`\n`); **leeg bij
  groen**.

Bij groen komt er dus ook een POST, met `verdict: "groen"` en lege
`bevindingen`. Een Zap die alleen bij problemen wil mailen, filtert op
`verdict = rood`.

## Eenmalige installatie (uitgevoerd 29-07-2026)

1. Repo aangemaakt, `index.html` toegevoegd.
2. Vercel → Add New Project → deze repo geïmporteerd → Deploy (geen instellingen
   nodig; statisch bestand).
3. Op nederlanders.fr de oude embedcode vervangen door `embedcode-ning.html`
   met de echte Vercel-URL ingevuld.
4. De oude Ning-pagina `/nlfr-menu-2` blijft voorlopig staan als noodfallback.
