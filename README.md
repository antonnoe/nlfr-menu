# NLFR hoofdmenu

Het hoofdmenu van Nederlanders.fr, gehost op Vercel en op de site geladen via
een iframe. Voorheen stond dit menu als bestand op Ning zelf; het is verplaatst
omdat Ning-storingen (29-07-2026) het menu meermaals onbruikbaar maakten en de
Ning-editor code beschadigt bij opslaan.

## Bestanden

- `index.html` — het complete menu (HTML + CSS + JS in één bestand). Vercel
  publiceert dit als statische site.
- `lib/banner.js` — de Café Jeudi-banner: standaardwaarden, validatie, de
  datumlogica en de opmaak. Gedeeld door `index.html`, `/banner-beheer` en
  `/api/banner`, zodat het voorbeeld in de beheerpagina niet kan gaan
  afwijken van wat de bezoeker ziet.
- `banner.json` — de startwaarde van de banner. Wordt gebruikt zolang er niets
  in KV staat.
- `banner-beheer.html` — de beheerpagina van de banner (`/banner-beheer`).
- `api/banner.js` — `GET` (publiek) en `POST` (met `BANNER_TOKEN`).
- `actueel.json` — de inhoud van de knop **"Nu actueel"** in de strip (één
  compacte rij linkjes). Het menu haalt dit bestand live op; je past het los
  aan, zonder `index.html` aan te raken. Zie "'Nu actueel' bijwerken" hieronder.
- `embedcode-ning.html` — de code die op nederlanders.fr in de tekst/codemodule
  staat. Staat hier alleen ter referentie/backup; wijzigingen hieraan moeten
  handmatig op Ning worden overgenomen. **De embedcode is bij de herbouw van
  04-09-2026 niet gewijzigd.**

## Menu aanpassen (dagelijks beheer)

Het menu is op 04-09-2026 herbouwd naar het goedgekeurde ontwerp. Van boven naar
beneden: de banner, de kaartkop met de slogan, één bordeaux strip (home, Menu,
zoeken, Plaats bericht, Nu actueel, en voor de beheerder het tandwiel), daaronder
de laden, en daaronder het paneel met vijf kolommen.

1. Open `index.html` op github.com en klik op het potlood (Edit).
2. Alle menu-inhoud staat in het `<script>`-blok, duidelijk gelabeld:
   - `DOORS` — de kolommen Lezen / Meedoen / Vinden / Nieuws
   - `memberGroups` — de kolom Mijn NLFR (ledenmenu)
   - `ADMIN_LINKS` — de beheerlade achter het tandwiel
   - `PERKS` — de teaser voor wie niet is ingelogd
   - `ZUSTERS` — de rij zusterplatforms onderin het paneel
   - `PANEELKNOPPEN` — de knoppen links onderin het paneel
3. Een regel heeft de vorm `["Label", U("/pad-op-nlfr")]` voor interne links of
   `["Label", "https://externe.site/"]` voor externe. Een derde element is het
   `target` (alleen nodig voor het abonnement: `"_top"`). **Er is geen
   accentopmaak meer: alle links hebben hetzelfde gewicht.**
4. Commit ("Commit changes"). Vercel publiceert automatisch; na ± 1 minuut
   staat het live op de site. Ning hoef je niet aan te raken.

Fout gemaakt? Op GitHub: History → vorige versie openen → Revert, of in Vercel:
Deployments → vorige deployment → "Promote to Production".

> **Let op bij het weghalen van een link.** Op desktop is dit iframe de enige
> navigatie: de tabbalk van Ning is alleen voor beheerders zichtbaar. Een link
> die je hier schrapt, is voor bezoekers geen bereikbare pagina meer. De test
> `test/menu.test.mjs` bewaakt daarom de volledige URL-inventaris
> (`test/fixtures/menu-urls-oud.json`); haal je bewust iets weg, pas dan ook
> die lijst aan.

### Wat er bij de herbouw is vervallen

Het "Onderwerpen"-uitklapmenu (`TOPICS`), de drie actiekaarten (`CTAS`), de vijf
losse deurknoppen, de onderbalk en de mobiele uitzonderingen
(`MOBILE_QUICK` / `MOBILE_HIDE` / `TOPICS_MOBILE_MAX`). De unieke items uit
`TOPICS` zijn verhuisd: *Huizen aangeboden* en *Kringloopwinkel* naar
Lezen › Marktplaats, *Correspondentie* naar Lezen › Leren & taal, *Korte
verhalen* naar Lezen › Ontmoeten & cultuur en *Communities Abroad* naar de rij
zusterplatforms. `/page/rubrieken` is vervallen. Dubbele adressen zijn
samengevoegd: de Vervoershub staat alleen nog op
`/page/lift-en-transportcentrale`, de verenigingen alleen op
`/page/nederlandse-verenigingen-in-frankrijk` en de nieuwsbrief alleen op
laposta.nl.

## De banner (Café Jeudi)

Boven het menu staat een banner die je zelf beheert op
**`https://nlfr-menu.vercel.app/banner-beheer`** — ook bereikbaar via het
tandwiel in het menu ("Banner beheren"). Staat de banner uit, dan toont het
menu er geen; gaat het ophalen mis, dan blijft het menu ongestoord.

Wat je kunt instellen: aan/uit, de soort (café, boek of vrij), de titel, een
wekelijks schema (dag + begin- en eindtijd) of een eigen datumtekst, datums om
over te slaan, de kleur van de linkerrand en de knop, het onderschrift, de
knoptekst en -URL, de uitleg achter de `[?]` en een klein icoontje.

De datumregel wordt zelf berekend in Parijse tijd: de eerstvolgende weekdag,
waarbij het op de dag zelf tot de eindtijd nog "vandaag" is. Staat die datum in
de overslaan-lijst, dan schuift hij een week op. Dat levert bijvoorbeeld
"Donderdag 10 september van 18:00 tot +/- 19:30". Zonder weekschema en zonder
eigen datumtekst is er geen datumregel en wordt de knop "Lees meer…", die de
uitleg opent.

Het beheertoken (`BANNER_TOKEN`, zie Env-vars) wordt één keer gevraagd en
daarna in je browser bewaard. Het gaat als `Authorization`-header mee en staat
nooit in de URL of in de menu-HTML.

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
  Zie "Schoolvakanties: tijdzone en vakantienaam" hieronder — daar zitten twee
  valkuilen die allebei live hebben gestaan.
- `/api/cron` — serverless job (Vercel Cron, elke 15 min) die voor nieuwe
  hot-clusters via de Anthropic API één NL-synthese schrijft en als **concept**
  opslaat. Nooit direct live. Model/max_tokens staan in één constante
  (`lib/config.js` → `AI_CONFIG`). Aan het eind van elke ronde **bakt de cron
  beide leveringen voor** en zet ze in KV, en laat hij een **journaal** achter
  (`KEY_CRON_RONDE`) met de telling per stap van de persketen. Zie "De
  persketen meet zichzelf" hieronder.
  `?diagnose=1` meet de keten zonder iets te schrijven en zonder modelaanroep.
- `/review?token=…` — mobielvriendelijke reviewtool. Publiceer / Weg / inline
  bewerken. Concepten verlopen automatisch na `CONCEPT_TTL_S` (nu 36 uur).

### De persketen meet zichzelf

**Aanleiding.** Op 6 september 2026 ontbraken alle perstegels op `/actueel`,
stond de reviewtool op nul concepten en was er sinds **4 september 16:12** geen
concept meer aangemaakt. De inname was gezond: alle feeds kwamen binnen, geen
fouten, geen weigeringen. De cron gaf status 200 in 9,39 seconden. Het draailog
bevatte twintig regels, allemaal `[feeds]`, en daarna niets.

Dat laatste was geen toeval maar het hele probleem: **alle logging in de cron
zat in `lib/feeds.js`**. Clusteren, de tweebronnendrempel, de synthese-aanroep
en het wegschrijven van een concept deden hun werk zwijgend. Een ronde die nul
concepten opleverde was in het log niet te onderscheiden van een ronde die er
twee maakte, en de tellingen die de cron wél berekende stonden alleen in het
HTTP-antwoord — dat Vercel Cron weggooit.

**Wat er nu gebeurt.** `lib/persmeting.js` telt de keten stap voor stap:

| stap | wat er geteld wordt |
| --- | --- |
| `itemsTotaal` | alle feeditems van de ronde |
| `persRuw` | items met regime `pers` |
| `naZeef` | over na de faits-divers- en de sportzeef |
| `binnenVenster` | binnen `HOT_VENSTER_UREN` (het clustervenster) |
| `clusters` | gevormde clusters |
| `bovenDrempel` | clusters met ≥ 2 outlets én ≥ 2 onafhankelijke bronnen |
| `kandidaten` | na de rondelimiet (`MAX_SYNTHESE_PER_RONDE`, ruimte) |
| `beoordeeld` | kandidaten die niet op een blokkade stuitten |
| `syntheseAangeroepen` | daadwerkelijke modelaanroepen |
| `geschreven` | weggeschreven concepten |

Elke teller gaat naar het log, **ook als hij nul is**, plus de regel
`STAP OP NUL: "<stap>" — ervoor stond "<vorige stap>" op <aantal>`. Waar een
kandidaat blijft liggen wordt bij naam genoemd — er ligt al een concept, het is
al gepubliceerd, het is **eerder afgewezen** (met reden en moment), het is een
duplicaat, of het is buitenland zonder Frankrijk-link. Die vijf op één noemer
gooien ("overgeslagen") was precies waardoor niet te zien was of de keten
gezond stilstond of vastliep.

**Waar het terechtkomt.**

- **Draailog** — één regel per stap, elke ronde.
- **KV** (`KEY_CRON_RONDE`, geen TTL) — de tellingen, het moment van het laatste
  concept en per tegel wanneer die voor het laatst gevuld was. Zonder TTL,
  want een journaal dat verloopt maakt juist een gat op het moment dat de cron
  stilvalt.
- **`/review`** — onder een lege conceptlijst staat de gemeten stand. De oude
  zin ("Nieuwe verschijnen zodra een verhaal door 2+ onafhankelijke bronnen
  wordt gemeld") is weg: die beloofde dat het aan het nieuws lag, veertig uur
  lang, terwijl de keten stillag.
- **`/api/actueel`** — het blok `bewaking` (tellingen en tijdstempels, geen
  inhoud), zodat de sonde er zonder token bij kan.

#### Het tokenplafond deelt hij met het denkwerk

`AI_CONFIG.maxTokens` is het plafond voor **denken én antwoord samen**. De
SDK-typen zeggen het met zoveel woorden: adaptief denken *"counts towards your
`max_tokens` limit"*. Op `claude-opus-5` staat adaptief denken **aan** zodra het
veld `thinking` wordt weggelaten; op de vorige generatie betekende weglaten juist
niet denken.

Met `maxTokens: 2000` kreeg het model dus 2000 tokens voor denkwerk plus 150-250
Nederlandse woorden. Gaat dat plafond op een lastig cluster volledig op aan
denken, dan komt er een antwoord terug met `stop_reason: "max_tokens"` en **nul
tekstblokken** — en dat is in `lib/synthese.js` een harde fout. De fout werd in
`api/cron.js` opgevangen en belandde in het antwoord dat niemand leest.

Twee dingen zijn daarom veranderd. Het plafond staat op **8000** (ruim boven
denkwerk op effort `medium` plus de ~400 tokens die 250 Nederlandse woorden
kosten, en laag genoeg om binnen de `maxDuration` van 60 s twee syntheses te
halen — het is een plafond, wat niet gebruikt wordt kost niets). En de fout
noemt zichzelf: welke `stop_reason`, hoeveel outputtokens, of het denkwerk was,
en welke constante je aanpast. `thinking: {type: "adaptive"}` staat nu expliciet
in het verzoek, zodat een latere modelwissel het gedrag niet ongemerkt omdraait.

**Gericht meten op productie:**

```
curl -H "Authorization: Bearer $CRON_SECRET" \
     "https://nlfr-menu.vercel.app/api/cron?diagnose=1"
```

Leest alleen. Geen modelaanroep, geen concept, geen afwijzing, geen
momentopname, en de overheidsstroom blijft buiten schot. Het antwoord bevat
`meting`, `eersteNul`, `duiding` en per kandidaat de koppen, de outlets en de
blokkade.

### Het vijfde tabblad: Uitgelegd

Verzamelt alle **live** artikelen met een redactionele Infofrankrijk-verwijzing,
dwars door tegels en regimes heen. Nieuwste bovenaan, met kop, herkomst, bron en
datum, en de verwijzing als het onderwerp van de kaart in plaats van als
voetnoot.

**Waarom.** Zo'n verwijzing staat in een tegel *onder* de bronnen van een
artikel, dus pas zichtbaar nadat de lezer eerst het artikel en dan de bronnen
heeft uitgeklapt. Gemeten op productie op 5 september 2026: van de 74 lopende
berichten had er **nul** een zichtbare verwijzing, en de enige twee die
bestonden hingen aan archiefberichten. Werk dat met de hand wordt gekozen en dat
vervolgens niemand ziet.

Vier dingen liggen vast in `test/uitgelegd-tab.test.mjs`:

- **Bij nul verwijzingen verdwijnt het tabblad volledig.** Niet grijs, niet leeg
  met een uitleg erin: weg. Een tabblad dat er altijd staat en meestal niets
  toont, leert de lezer het over te slaan.
- **Het archief doet niet mee.** "Live" is de eis, en de archieftegel draagt zijn
  artikelen bovendien in een derde levering die pas wordt opgehaald als de lezer
  hem opent.
- **Artikelen blijven ook in hun eigen tegel staan.** Dit is een tweede ingang,
  geen verhuizing.
- **Geen tegel eromheen.** Op elk ander tabblad is de tegel de groepering; hier
  is het tabblad zelf de groep, en een tegel zou een dichtgeklapte laag
  toevoegen aan precies datgene wat dit tabblad uit de klapjes moest halen.

Kleuren: bordeaux `#800000` als hoofdkleur, flessengroen `#2f6b3a` voor de
verwijzing zelf. De pijltjestoetsen op de tabbalk lezen hun volgorde sindsdien
uit de tabbalk in plaats van uit een vaste lijst — anders zou een tabblad dat
verschijnt en verdwijnt er stilzwijgend buiten vallen.

### De bronnenregel op een telefoon

Zeventien bronnen achter elkaar vullen op een telefoon ongeveer de halve
schermhoogte, pal onder de lijst die de lezer juist wil zien. Onder 600px staat
er daarom één knop, `Bronnen (17)`; daarboven blijft de regel zoals hij was.

Het in- en uitklappen gebeurt in **CSS op de breedte**, niet met een meting in
JavaScript: een gemeten breedte klopt niet meer zodra het venster draait of het
paneel in het iframe van hoogte verandert. De stand wordt niet bewaard — een
bewaarde open stand zou bij het volgende bezoek meteen weer de halve
schermhoogte opeisen.

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
| per artikel `verwijzingen` — het blok "Meer hierover op Infofrankrijk" | — | ✔ (indien gekozen) | ✔ (indien gekozen) |

`bronMeta` en `bronAantal` zijn er omdat de dichte staat die twee dingen wél
toont: `bronMeta` is de onderregel onder een overheids-, Infofrankrijk- of
verenigingsartikel ("Service-Public · 27 augustus"), `bronAantal` is het getal
op de knop "Bronnen (n)". Een perssynthese toont daar de NLFR-byline en gebruikt
`bronMeta` niet. `artikelAantal` staat op **elke** tegel, zodat de kop ("86
artikelen") één bron van waarheid heeft — ook op de archieftegel, waar de
artikelen zelf niet zijn meegestuurd.

`verwijzingen` staat bij de tekst en niet in de compacte levering, omdat het
blok ónder de bronnen staat en dus pas zichtbaar is als de lezer het artikel
openklapt; het veld ontbreekt helemaal als de redactie niets heeft gekozen (zie
"Verwijzen naar Infofrankrijk" hieronder).

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
- **I13** — de redactionele verwijzingen naar Infofrankrijk: elke link staat op
  infofrankrijk.com (dezelfde toets als voor bronlinks), heeft een titel, staat
  niet óók in de bronnenlijst, komt binnen één tegel maar één keer voor, en er
  zijn er hooguit `IF_VERWIJZING_MAX` per bericht. De sonde drukt het aantal
  bovendien af, zodat een keten die stilvalt zichtbaar wordt.

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

### Schoolvakanties: tijdzone en vakantienaam

Twee regels voor `api/schoolvakanties.js`, allebei het gevolg van een fout die
live heeft gestaan.

**1. Reken elke datum in `Europe/Paris`, hard, niet via `TZ`.** De schoolkalender
is een Franse kalender en de dataset zet elke dag op middernacht Parijse tijd —
dat is `22:00Z` in de zomertijd en `23:00Z` in de wintertijd. De Vercel-runtime
staat op UTC, dus `toLocaleDateString("nl-NL")` zónder tijdzone gaf elke datum
een dag te vroeg. Live stond: *"De scholen beginnen weer op 31 augustus; in
Saint Pierre et Miquelon pas op 1 september, in Corse pas op 2 september"* —
juist is 1, 2 en 3 september. `fmtDag()` geeft daarom `timeZone: "Europe/Paris"`
mee. Bewust hardgecodeerd: via de omgevingsvariabele `TZ` zou de uitkomst
afhangen van hoe de server toevallig is ingesteld. En bewust een tijdzone en
geen vaste verschuiving van twee uur: over de zomer-winterovergang klopt die
niet meer.

**2. De vakantienaam moet van hetzelfde record komen als de datums eronder.**
De naam kwam uit het eerste komende record van de hele lijst, en dat kon een
*overzeese* vakantie zijn (de septembervakantie van Polynésie, 12 september)
terwijl de afgedrukte datums die van la Toussaint waren (17 oktober voor zone A,
B, C en Corse). De zin noemde dan een vakantie die in die zones helemaal niet
begint. Nu wordt eerst de eerstvolgende vakantie **van de metropoolzones**
gekozen, en worden alleen de zones genoemd waarvoor dát ook echt de
eerstvolgende vakantie is. Hetzelfde geldt voor een lopende vakantie: naam,
regio's en einddatum komen uit één groep.

`test/schoolvakanties.test.mjs` legt beide vast met een vast recordfixture en
ingevroren datums (28 augustus, 1 en 5 september, 20 oktober 2026). Die tests
draaien op **`TZ=UTC`** — de tijdzone van productie, en de enige waarin fout 1
zichtbaar wordt: op `Europe/Paris` zouden ze groen blijven mét de fout.

### Verwijzen naar Infofrankrijk (en terug: nakijken)

Onder een bericht op `/actueel` kan een verwijzing staan naar een
achtergrondartikel op infofrankrijk.com — een eigen blok onder de bronnen, met
de kop **"Meer hierover op Infofrankrijk"**. Dezelfde koppeling werkt de andere
kant op: een nieuwe aankondiging van Bercy kan betekenen dat fiscale artikelen
op Infofrankrijk nagekeken moeten worden. Eén vraag (*welke IF-artikelen horen
bij dit bericht?*), twee uitgangen: **verwijzen** ziet de lezer, **nakijken** is
een takenlijst in de reviewtool.

**Handmatig, zonder uitzondering.** `api/review.js` is de enige plek die
verwijzingen schrijft, en alleen op een expliciete klik. De cron kiest nooit
zelf; klikt de redactie niets aan, dan komt er geen verwijzing.
`test/verwijzing-route.test.mjs` legt dat vast, inclusief een toets dat
`api/cron.js` de verwijzingssleutel niet eens kent.

**Een verwijzing is geen bron.** De bronnenlijst is attributie: de Franse
originelen waar de synthese op steunt. Een eigen achtergrondartikel is "verder
lezen". Vandaar een apart blok met eigen opmaak, onder de bronnen — en de sonde
(I13) meldt het als een verwijzing tóch in de bronnenlijst opduikt.

**De twee filters** staan in `lib/config.js`:

1. `IF_CATEGORIE_PER_THEMA` koppelt het thema van het bericht (de acht
   overheidsthema's en de vier perstegels) aan Infofrankrijk-categorieën. Dit
   is **handwerk, met opzet**: de categorisering op infofrankrijk.com is niet
   strak genoeg om automatisch af te leiden — onder de fiscale categorieën valt
   ook "Kinderbijslag" en "Juridische bijstand". Bijschaven doe je in die ene
   tabel; de rest van de code kent alleen die tabel. Een zoekveld in de
   reviewtool dekt alles wat de tabel niet dekt.
2. `IF_MAX_LEEFTIJD_MAANDEN` (12): nooit verwijzen naar iets waarvan `modified`
   ouder is dan twaalf maanden. `modified`, niet `date` — dat is de datum die
   zegt *sinds wanneer heb ik hier niet meer naar gekeken*, en dat is precies de
   vraag die de auditkant ook stelt. Zonder bruikbare datum doet een artikel
   niet mee.

Die twaalf-maandengrens is stil — een artikel dat een jaar niet is aangeraakt
verdwijnt vanzelf uit de keuzelijst zonder dat iemand het merkt. De reviewtool
toont daarom ook **"Bijna niet meer verwijsbaar"**: wat er binnen twee maanden
uit valt.

**De index.** `lib/ifindex.js` haalt de artikellijst op uit de openbare
WordPress-REST-API van infofrankrijk.com (`/wp-json/wp/v2/posts`) — id, link,
titel, `modified_gmt` en categorie-id's, ~350 artikelen in vier verzoeken, geen
inloggen. De cron ververst hem hoogstens eens per zes uur
(`IF_INDEX_VERVERS_NA_S`) en zet hem in KV met een TTL van dertig dagen: valt
infofrankrijk.com een dag uit, dan blijft de laatste index staan in plaats van
dat de keuzelijst leeg raakt. Een mislukte verversing maakt de cronronde niet
rood; de reden staat in de cronuitvoer onder `ifIndex`.

> **`modified_gmt`, niet `modified`.** WordPress levert `modified` in de
> tijdzone van de site, zónder aanduiding: `"2026-08-23T14:29:45"` parseert in
> Node (UTC) twee uur te vroeg. Dezelfde valkuil als bij de schoolvakanties
> hierboven, met dezelfde gevolgen.

**In de reviewtool** staat onder elke gepubliceerde synthese en elk
overheidsbericht het blok *Infofrankrijk*: de al gekozen verwijzingen (met een
kruisje om ze weg te halen) en de knop "Infofrankrijk erbij zoeken". De
kandidaten staan **oudste wijziging bovenaan** — dat is tegelijk de auditvolgorde
en de reden om de bovenste kritisch te bekijken voordat je ernaar verwijst. Er
worden er tien getoond, met "toon alle …" eronder. Per regel twee knoppen:
*Verwijzen* (de lezer ziet het) en *Nakijken* (alleen de redactie).

**Opslag en zichtbaarheid.** Verwijzingen staan onder
`actueel:verwijzing:<artikel-id>` — bewust náást het bericht en niet erin, zodat
een cron-ronde die het record herschrijft de keuze van de redactie niet kan
overschrijven. TTL gelijk aan de langstlevende records (28 dagen). De auditlijst
staat onder `actueel:nakijken:<if-id>` en verloopt **niet**: die wordt afgevinkt,
niet uitgezeten. Een nieuwe verwijzing verschijnt op de pagina zodra de
eerstvolgende cronronde de leveringen opnieuw bakt (hoogstens vijftien minuten);
de reviewtool zegt dat er ook bij.

**Grenzen die worden afgedwongen.** Hooguit `IF_VERWIJZING_MAX` (3) verwijzingen
per bericht; binnen één tegel verschijnt dezelfde verwijzing maar één keer (vier
bosbrandartikelen met vier keer dezelfde link is ruis — de bovenste houdt hem);
en elke URL moet de bron-URL-toets van Infofrankrijk doorstaan (`lib/bronurl.js`,
de laag die is gebouwd nadat IF-items naar `fonts.googleapis.com` bleken te
wijzen), zowel bij het opslaan als bij het samenstellen van de tegels.

### De uitlegpagina `/uitleg`

De curatie wordt niet altijd door dezelfde persoon gedaan. `uitleg.html` legt in
gewone taal uit wat er vanzelf gebeurt, wat een mens moet doen en hoe de
schermen eruitzien; de knop **?** rechtsboven in de reviewtool opent hem in een
nieuw tabblad. Bewust een pagina op deze site en geen los document: wie invalt
heeft er dan altijd bij gekund, zonder account en zonder link die kwijtraakt.
De pagina staat op `noindex`.

De schermafdrukken in `schermen/` zijn **echt**, gemaakt op 390 × 844 (telefoon)
met verzonnen maar realistische inhoud — nooit met productiedata, want daar
staan namen en bronnen in die morgen anders zijn. Verversen na een wijziging in
de tool:

```bash
npm install --no-save playwright-core     # staat bewust niet in package.json
node scripts/demo-uitleg.mjs &            # namaakproductie op poort 8790
node scripts/schermen.mjs                 # schrijft schermen/*.webp
```

`scripts/schermen.mjs` meet bij elk scherm ook **of de pagina zijwaarts uitloopt
en of elk tikdoel minstens 44 px hoog is** — de maat die de tool aanhoudt. Die
tweede toets bracht vier echte fouten aan het licht die op het oog niet
opvielen. `test/uitleg.test.mjs` bewaakt dat elke afbeelding waarnaar de pagina
verwijst ook bestaat, dat de knop in de tool ernaartoe wijst, en dat de getallen
in de uitleg (36 uur, 14 dagen, twaalf maanden) kloppen met `lib/config.js`.

### Env-vars (in Vercel instellen, zie `.env.example`)

`ANTHROPIC_API_KEY`, `REVIEW_TOKEN`, `BANNER_TOKEN`, `CRON_SECRET`, en een gekoppelde Vercel KV
(`KV_REST_API_URL` / `KV_REST_API_TOKEN`). De feedpagina werkt ook zonder deze
vars; alleen de AI-synthese, de reviewtool en het opslaan van de banner hebben
ze nodig. Zonder KV valt `/api/banner` terug op `banner.json` uit de repo.

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
live artikelen over hetzelfde verhaal (I5, **buiten de verenigingentegel** —
zie hieronder), datums binnen een plausibel venster,
`actueel.json` geldige JSON, geen uitgezette bron die tóch items levert, en
artikel-id's aanwezig en uniek. Wat bewust *niet* getoetst wordt (en waarom)
staat in `scripts/sonde.mjs` zelf.

Sinds 6 september 2026 staan er twee invarianten bij die naar het **ontbreken**
van inhoud kijken in plaats van naar de vorm ervan. Ze bestaan omdat de sonde
groen was terwijl alle perstegels ontbraken: elke bestaande toets keek naar wat
er stond, en `I1` gaat pas af als de héle pagina leeg is — zeven gevulde
overheidstegels hielden dat getal ruim boven nul.

- **I14 — lege tegel.** Een tegel die de afgelopen `TEGEL_VULLING_VENSTER_DAGEN`
  (7) dagen nog gevuld was en nu op nul staat of helemaal uit de levering
  verdwenen is. "Normaal gevuld" is hier **gemeten**, niet aangenomen: het
  cronjournaal houdt per tegel bij wanneer die voor het laatst iets bevatte.
  Een handmatige lijst met verwachte tegels zou verouderen zodra er een tegel
  bijkomt of wegvalt; deze regel niet.
- **I15 — persketen.** Meer dan `CONCEPT_STILTE_MAX_UREN` (24) uur geen concept
  aangemaakt, **terwijl er persartikelen door de zeef komen**. Die tweede helft
  maakt de toets bruikbaar: een nacht zonder Frans nieuws dat twee kranten
  haalt is legitiem nul. De melding noemt de stap die op nul staat en het
  aantal ervóór. Ontbreekt het bewakingsblok, dan is dát de bevinding — dan
  schrijft de cron zijn journaal niet meer weg en is de bewaking blind.

Handmatig draaien met de gevonden links erbij: *Run workflow* → vink
**toon_links** aan, en vul eventueel **toon_filter** met een stuk van een titel
om één item na te trekken.

#### Waarom de verenigingentegel buiten I5 valt

Van 3 tot en met 6 september 2026 was de sonde elke dag rood, en elke dag op
dezelfde bevinding: *"Zondag 1 november – Kerkdienst (Kerk+YouTube)" ≈ "Zondag
18 oktober – Kerkdienst (Kerk+YouTube)"*. Beide uit de verenigingenagenda, beide
terecht op de pagina.

Dat is geen bevinding maar een eigenschap van de bron. Een agenda bestaat uit
**terugkerende** activiteiten: dezelfde kerkdienst, dezelfde koffieochtend,
dezelfde taalles, met alleen een andere datum. Die lijken per definitie op
elkaar. I5 bestaat om te voorkomen dat de **redactie** hetzelfde nieuws twee
keer publiceert, en die vraag speelt niet bij een feed die buiten de
publicatiepoort om rechtstreeks op de pagina komt.

De tegel valt aan **beide** kanten van een paar weg, niet alleen als eerste van
de twee. Overheidsberichten blijven wél meedoen: twee bijna gelijke berichten
uit die stroom horen door `dedupOverheid()` te zijn opgevangen, dus daar ís een
treffer een bevinding.

Een sonde die permanent rood staat bewaakt niets: de volgende echte bevinding
verdwijnt in de ruis die er elke dag al stond. Dat gold meteen voor I14 en I15,
die er juist zijn omdat de persketen veertig uur onzichtbaar stil kon liggen.

### Het beheertoken bewaren, en wat er op mobiel misging

**Opslagvorm.** Het token staat als kale tekenreeks in `localStorage` onder
`nlfr_review_token`, weggeschreven door een script op de pagina zelf.
`/banner-beheer` doet hetzelfde met een eigen sleutel.

**Wat er misging.** Op desktop werkte het; op mobiel moest het token bij elk
bezoek opnieuw worden ingevoerd, terwijl het scherm zei *"Het beheertoken is in
deze browser bewaard."* Die zin stond er zodra het token in het **geheugen**
zat. Het wegschrijven zag er zo uit:

```js
try { localStorage.setItem(TOKENSLEUTEL, t); } catch(e){}
```

Een lege catch. Weigert de browser te schrijven, dan gebeurde er niets en zei de
pagina dat het gelukt was. Juist die onwaarheid maakte het onvindbaar: er was
geen zichtbaar verschil tussen bewaard en weggegooid.

**Wat er nu gebeurt.** De opslaglaag controleert zichzelf:

1. **Terugleen.** Een schrijfactie geldt pas als geslaagd wanneer hetzelfde
   eruit komt als erin ging. Dat vangt ook de browsers die niet gooien maar de
   waarde stil laten vallen.
2. **Terugval op `sessionStorage`** als `localStorage` niet werkt — die
   overleeft het sluiten van het tabblad niet, maar wel het navigeren binnen het
   bezoek. De pagina zegt dat er dan ook bij.
3. **De fout bij naam.** `QuotaExceededError` (privémodus op iOS),
   `SecurityError` (geblokkeerde site-gegevens), of "schrijft niets weg". Op een
   telefoon is er geen ontwikkelaarsgereedschap; de diagnose staat daarom op de
   pagina zelf, in overtikbare vorm.
4. **Een baken.** Bij elk bezoek wordt `nlfr_review_baken` weggeschreven. Dat
   beantwoordt de vraag die het token alleen niet kan beantwoorden: staat het
   baken er nog maar het token niet, dan is het token gericht verdwenen; is
   alles weg terwijl de opslag verder werkt, dan heeft de browser de
   site-gegevens opgeruimd.
5. **De ingebedde context.** Staat `/review` in een kader binnen een andere
   pagina, dan houden mobiele browsers die opslag apart van dezelfde site op
   zichzelf, of weigeren hem. De pagina herkent dat (`window.top !==
   window.self`) en zegt het.

**Wat er bewaard is, en wat er verstuurd wordt.** Op 6 september bleek bij een
tweede bezoek een token van 32 tekens te vertrekken terwijl er 22 was
opgeslagen. Er wordt dus wél iets bewaard en meegestuurd, maar niet wat erin
ging — en met alleen *"er ging een token van 32 tekens mee"* is niet te zien
welke kant je op moet zoeken.

Bij het opslaan wordt daarom de **vorm** van het token vastgelegd onder
`nlfr_review_tokenvorm`: lengte plus een korte, niet-omkeerbare vingerafdruk.
Bij een volgend bezoek wordt het teruggelezen token daarmee vergeleken.

- Verschillen ze → `token-veranderd`. Geen verlopen token maar een **andere
  waarde op die plek**: een oude snelkoppeling met `?token=…` (die overschrijft
  het bewaarde token bij élk bezoek), autovullen bij het opslaan, of iets anders
  dat over deze sleutel heen schrijft.
- Komen ze overeen maar klopt de lengte niet met wat je hebt geplakt → dan stond
  er bij het **opslaan** al iets anders in het veld.

**Nooit het token zelf.** Deze waarden gaan het scherm op en de KV-ring in, en
een verkeerd token kan van alles zijn — een wachtwoord uit een kluis
bijvoorbeeld. Voor de vraag *"is dit hetzelfde token als toen"* is een hash
genoeg, en meer is te veel.

**De melding blijft staan, en gaat ook naar de server.** Op Android verscheen de
diagnose en verdween hij binnen een fractie van een seconde: te snel om te
lezen, te snel voor een schermafdruk. Twee dingen zijn daarom veranderd.

1. **Hij verdwijnt niet meer vanzelf.** Wat er eenmaal stond, blijft staan tot de
   lezer op **Sluiten** tikt. Een poging tot verbergen wordt geteld
   (`zouVerbergen`) en gaat mee in de melding — het gedrag wegnemen zonder het
   te tellen zou de vraag *waarom* hij knipperde onbeantwoord laten.
2. **Elke melding gaat mee met het beheertoken naar KV** (`KEY_OPSLAGMELDING`,
   een ring van twaalf, TTL dertig dagen) en is in `/review` na te lezen op een
   groot scherm. Mét het token en niet zonder: dat token wordt tóch elk bezoek
   ingetikt, en een open schrijfroute zou een vreemde in staat stellen de ring
   vol te duwen en de metingen eruit te drukken. De melding vertrekt pas ná een
   geslaagde `GET`, niet ernaast — twee verzoeken tegelijk met hetzelfde token
   betekende dat een 401 op de één het antwoord van de ander als verouderd
   weggooide.

**Het oordeel** (`lib/opslagmelding.js`) staat **per toestel**. De ring bevat de
meldingen van elke browser die `/review` opent: de telefoon die onderzocht wordt
én de desktop waarop het resultaat wordt gelezen. Die op één hoop beoordelen
keek naar de nieuwste melding, en dat is bijna altijd de desktop waarop je zit
te lezen.

| code | wat het betekent | wat helpt |
| --- | --- | --- |
| `opslag-werkt` | De browser schrijft weg én vindt het bij een volgend bezoek terug. | Niets. Dit toestel mankeert niets — al zegt het niets over een browser die tussendoor helemaal wordt afgesloten. |
| `schrijven-mislukt` | De browser weigert weg te schrijven. | Een servercookie lost dit **niet** op; er is geen plek om iets te bewaren. |
| `gewist-tussen-bezoeken` | Het token wordt weggeschreven **én teruggelezen**, maar bij elk volgend bezoek is álles weg. | Een opruiming achteraf: de instelling die sitegegevens wist bij het afsluiten. In Samsung Internet: Instellingen → Persoonlijke browsegegevens → Persoonlijke gegevens verwijderen bij afsluiten. |
| `eerste-bezoek` | Deze browser is hier één keer geweest. | Nog een keer `/review` openen op ditzelfde toestel. |

`opslag-werkt` ontbrak aanvankelijk, en dat was de ergste omissie: een toestel
waar alles goed ging viel door naar "onbekend", en dan stond er *"open /review
nog een keer"* tegen iemand die het al zes keer had gedaan.

Het oordeel hangt aan het **gemeten gedrag**, niet aan de naam van de browser:
een user-agent is een zelfverklaring en kan liegen. Die naam noemt wél het
toestel erbij (`Chrome op Android`, `Chrome op Windows`) — zonder platform heten
een telefoon en een desktop allebei "Chrome", en dan staan er twee identieke
regels boven twee heel verschillende metingen.

**Waar het staat.** Onderaan `/review`, ónder het redactiewerk, achter één regel
`Opslagmeldingen (n)` die je zelf openklapt. Het oordeel per toestel staat
meteen zichtbaar; de kaarten met user-agent-strings zitten erachter. Ze stonden
eerst pal boven Concepten, en dat is ontwikkelaarsgereedschap in een
productiegereedschap.

**Welke vorm blijft op mobiel wél staan.** Voor het geval dat het schrijven
*slaagt* maar de waarde later verdwijnt, is de duurzamere vorm een cookie die de
**server** zet (`Set-Cookie`, `HttpOnly; Secure; SameSite=Lax`): iOS Safari kapt
opslag die door een script is gezet — `localStorage` én `document.cookie` — af na
zeven dagen zonder interactie met de site, en die grens geldt niet voor een
door de server gezette cookie. Dat is nog niet gebouwd: eerst moet de diagnose
hierboven uitwijzen of het schrijven mislukt (dan helpt een cookie niet) of pas
later wordt opgeruimd (dan wel).

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
