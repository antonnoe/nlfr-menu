# Onderzoek — "Nu actueel" zelf aan- en uitzetten vanuit het tandwiel

Status: **onderzoek**. Er is in deze commit geen enkele regel functionele code
gewijzigd; alleen dit document is toegevoegd. Alles hieronder is vastgesteld uit
de code in deze repo (`index.html`, `actueel.json`, `api/`, `lib/`,
`embedcode-ning.html`), niet uit aannames.

Aanleiding: de knop **"Bosbranden in Frankrijk"** is buiten het brandseizoen
niet relevant en moet er dan uit, in het voorjaar weer terug. Er komen meer
knoppen bij, dus dit moet een beheerfunctie worden, geen eenmalige ingreep.

---

## 1. Wat zit er nu achter het tandwiel

**Bevestigd: het zijn precies de vijf Ning-snelkoppelingen die Anton noemt, en
verder niets.**

De keten in `index.html`:

| Wat | Waar |
| --- | --- |
| Het tandwiel zelf | `index.html:343` — `<button class="admin" id="adminbtn" aria-label="Beheer">` met een SVG-tandwiel |
| Zichtbaarheid | `index.html:522` — `adminBtn.classList.toggle("show", isAdmin)`; zonder `isAdmin` staat de knop er niet |
| Klik | `index.html:688` — `adminBtn.addEventListener("click", … open("admin", this))` |
| Inhoud | `index.html:566-568` — `build("admin")` schrijft één regel HTML in de lade |
| De links | `index.html:461` — `ADMIN_LINKS` |
| Opmaak | `index.html:148-151` — `.adminlinks` |

`ADMIN_LINKS` is letterlijk:

```js
var ADMIN_LINKS = [
  ["Dashboard",        U("/main/dashboard")],
  ["Tags",             U("/page/tags")],
  ["Standaard teksten",U("/page/standard-berichten")],
  ["Bestandsbeheer",   U("/main/filemanager/list")],
  ["Mijn pagina's",    U("/page/page/listForContributor")]
];
```

En de opbouw van de lade:

```js
if (target === "admin") {
  drawer.innerHTML = '<div class="adminlinks"><span class="h">Beheer</span>'
    + ADMIN_LINKS.map(function(l){ return link(l[1], l[0], ""); }).join('')
    + '</div>';
  return;
}
```

### Hoe die lade is opgebouwd — past een paneel erin?

Belangrijk voor de vraag "erin of ernaast": **er is maar één lade.** Het element
`#drawer` wordt gedeeld door álle knoppen in het menu — de vijf uitklapmenu's,
"Onderwerpen", "Mijn NLFR", "Nu actueel" én het tandwiel. `build(target)` gooit
de inhoud weg en zet er nieuwe HTML in; `open()`/`closeAll()` regelt welke knop
actief is. Er is geen aparte admin-lade die apart onderhouden moet worden.

De opmaak is een simpele flexrij die afbreekt over meerdere regels:

```css
.adminlinks { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
```

En de hoogte regelt zichzelf: `report()` (`index.html:637 e.v.`) meet de
werkelijke kaarthoogte en meldt die met `postMessage({nlfrMenuHeight})` aan de
Ning-pagina, die het iframe meegroeit. Er zit ook al een vangnet in voor het
geval de moederpagina de hoogte níét overneemt (`.noresize` → interne scroll).

**Conclusie punt 1:** technisch past een beheerpaneel prima ín die lade — het is
één `innerHTML`-tak erbij in `build()`, de hoogtesync doet de rest, en er hoeft
geen nieuw paneel-mechanisme gebouwd te worden. Dat het tóch niet mijn advies is,
komt niet door de lade maar door de beveiliging; zie punt 2 en het bouwvoorstel.

---

## 2. Hoe wordt de beheerder nu herkend — en is dat genoeg?

### Hoe het werkt

Het menu draait op `nlfr-menu.vercel.app` in een iframe op
`www.nederlanders.fr`. Dat is **cross-origin**, dus het menu kan `ning.*` van de
moederpagina niet zelf lezen. De overdracht gaat zo:

1. `embedcode-ning.html` draait óp nederlanders.fr en leest daar
   `window.ning.CurrentProfile`;
2. het stuurt `{id, profileUrl}` het iframe in met
   `postMessage({nlfrProfile: p}, ORIGIN)`;
3. `index.html:757-761` accepteert dat bericht **alleen** als
   `e.origin === "https://www.nederlanders.fr"`;
4. `setProfile()` (`index.html:394-399`) doet de hele beoordeling in één regel:

```js
isAdmin = !!(p && p.id === ADMIN_ID);
```

met, drie regels hoger in hetzelfde bestand, publiek leesbaar:

```js
var ADMIN_ID = "3pjypz5h1ilpc";
```

Terzijde, feitelijk: `index.html:392` probeert daarnaast nog rechtstreeks
`window.parent.ning.CurrentProfile` te lezen. Sinds de verhuizing naar Vercel is
dat cross-origin en gooit die toegang altijd een fout, die door de `try/catch`
wordt opgevangen (`cp = null`). Het is dode code uit de Ning-tijd — onschadelijk,
maar het is niet de route waarlangs beheer wordt herkend.

### Is dat signaal vervalsbaar vanaf de client?

**Ja, triviaal, en op drie onafhankelijke manieren.**

1. **De beheer-ID is publiek.** `ADMIN_ID` staat gewoon in de broncode van een
   openbare pagina. Iedereen die "view source" doet op
   `https://nlfr-menu.vercel.app/` kent hem. Het is geen geheim en kan er ook
   geen worden: de vergelijking gebeurt in de browser.
2. **De vergelijking gebeurt in de browser.** `isAdmin` is een JavaScript-
   variabele in het iframe. Met de ontwikkelaarsconsole is die in één regel op
   `true` te zetten. De `e.origin`-controle beschermt tegen een *vreemde*
   moederpagina die profielberichten instuurt, maar niet tegen de bezoeker zelf.
3. **En dat doet er het minst toe**, want een aanvaller heeft het menu helemaal
   niet nodig. Een schrijf-eindpunt is gewoon een URL. `curl -X POST
   https://nlfr-menu.vercel.app/api/… -d '{"id":"3pjypz5h1ilpc"}'` gaat volledig
   buiten de browser, buiten het iframe en buiten Ning om. Alles wat de client
   meestuurt is per definitie door de client te verzinnen.

De kern: **Ning geeft niets af dat de server kan narekenen.**
`ning.CurrentProfile` is een JavaScript-object in de pagina van de bezoeker, geen
ondertekend token en geen sessie die `nlfr-menu.vercel.app` kan verifiëren. De
Vercel-server heeft geen enkele manier om vast te stellen dat een inkomend
verzoek werkelijk van een ingelogde Ning-beheerder komt. Wat het menu vandaag
doet is dan ook precies goed beschreven in de README: *"dit stuurt alleen de
zichtbaarheid van beheer-snelkoppelingen, geen rechten."*

### Oordeel

> **De Ning-context kan níét als enige beveiliging dienen voor een schrijfactie.
> Er is een tweede, server-side controleerbare sleutel nodig.**

Zonder die sleutel kan iedere bezoeker die de broncode leest de knoppen in de
lade van de hele site aan- en uitzetten. De `isAdmin`-check blijft nuttig, maar
uitsluitend als *cosmetiek*: hij bepaalt of het tandwiel zichtbaar is. Hij mag
nooit de poort zijn.

Dat is geen nieuw patroon voor deze repo: `/review` doet het al zo. `api/review.js`
vergelijkt een geheim uit de querystring met de env-var `REVIEW_TOKEN`, met
`crypto.timingSafeEqual` en een lengtecheck vooraf. Dat is precies het model dat
hier hoort, en het is al bewezen in productie.

---

## 3. Waar kan de instelling wonen

Het menubestand is statisch (Vercel publiceert `index.html` ongewijzigd), en de
Ning-kopie in Bestandsbeheer al helemaal — daar kan niets bewaard worden. De app
heeft wél KV: `lib/store.js` praat rechtstreeks met de Upstash REST-API via
`fetch` (geen extra npm-pakket), met `getJSON` / `setJSON` / `del` / `listJSON`,
en degradeert netjes als KV niet is ingesteld (lezen geeft leeg terug, schrijven
gooit een zichtbare fout).

### Aanbevolen route

**Scheiding: `actueel.json` blijft de inhoud, KV bewaart alleen de stand.**

Dat is bewust. `actueel.json` is Antons redactiebestand — titel, tooltip, href,
volgorde — en dat blijft hij bewerken op GitHub zoals nu, met versiegeschiedenis
en revert. Wat er via het paneel verandert is uitsluitend *aan of uit*. Die twee
door elkaar halen (het hele bestand in KV zetten) zou de versiegeschiedenis van
de inhoud weggooien en van elke tekstwijziging een beheerhandeling maken.

**KV-sleutel:** `nlfr:menu:actueel:zicht`, **zonder TTL** (`setJSON` zonder derde
argument — de stand moet permanent blijven staan, anders staan de knoppen na 48
uur vanzelf weer aan).

**Waarde: een uit-lijst, geen aan-lijst.**

```json
{ "uit": ["bosbranden"], "gewijzigd": "2026-08-26T10:00:00.000Z" }
```

Waarom een uit-lijst: een knop die Anton later aan `actueel.json` toevoegt en
die nog nergens in KV voorkomt, staat dan **vanzelf aan**. Bij een aan-lijst zou
elke nieuwe knop onzichtbaar zijn tot iemand hem in het paneel aanvinkt — precies
de stille fout die je niet wilt. Dit is dezelfde "bij twijfel alles tonen"-regel
als in punt 4, maar dan op dataniveau.

**Voorwaarde: elk item in `actueel.json` krijgt een `id`.**

```json
{ "id": "bosbranden", "titel": "Bosbranden in Frankrijk", "tekst": "…", "href": "…", "live": true }
```

Zonder stabiele sleutel zou de uit-lijst op de titel moeten matchen, en dan
springt een uitgezette knop weer aan zodra Anton de tekst verandert. `id` is het
enige veld dat hij niet mag hergebruiken; de rest blijft vrij bewerkbaar.

### Het eindpunt

Eén route, `api/menu-actueel.js`, met twee methodes:

**`GET /api/menu-actueel`** — leest `actueel.json` van de deployment, leest de
uit-lijst uit KV, filtert, en geeft **exact de vorm terug die `index.html` al
verwacht**: `{ "kaarten": [...] }`. Daardoor verandert er in de menucode niets
aan de verwerking — alleen de URL waar hij hem vandaan haalt.

- Publiek, geen sleutel. Wat eruit komt is toch al openbaar (het staat op de site).
- `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=600`.
  Zie punt 4 voor de motivering van die 60.
- Faalt KV, dan geeft de route **alle** kaarten terug in plaats van een fout.
  Een kapotte KV mag nooit knoppen laten verdwijnen.

**`POST /api/menu-actueel`** — body `{ "uit": ["bosbranden"] }`, beveiligd met een
server-side sleutel volgens het oordeel bij punt 2:

- nieuwe env-var **`MENU_BEHEER_TOKEN`**, bewust los van `REVIEW_TOKEN`, zodat een
  gedeelde reviewlink geen schrijfrecht op het menu geeft;
- controle met dezelfde `leesToken`/`tokenGeldig`-aanpak als `api/review.js`
  (lengtecheck vooraf, dan `crypto.timingSafeEqual`, en logregels die nooit
  waarden bevatten);
- schrijft met `setJSON(KEY, {uit, gewijzigd}, /* geen TTL */)`;
- valideert de body: alleen strings, alleen id's die in `actueel.json` bestaan
  (onbekende id's worden stil genegeerd, niet opgeslagen — anders groeit de lijst
  vol met resten van verwijderde knoppen).

### Wat ik niet aanraad, en waarom

- **De instelling in `actueel.json` zelf** (een veld `zichtbaar: false`). Dan is
  elke aan/uit-actie weer een GitHub-commit plus een deploy van ± 1 minuut —
  precies wat Anton níét meer wil.
- **De GitHub-API laten schrijven vanuit het paneel.** Werkt, maar vraagt een
  token met schrijfrecht op de repo in een env-var, veroorzaakt een deploy per
  klik, en maakt van een seizoensschakelaar een commitgeschiedenis. Te zwaar.
- **Alles in KV** (inhoud én stand). Kost de versiegeschiedenis van de teksten.

---

## 4. Wat kost het bij openen

### Het goede nieuws vooraf: het kost nu al niets bij openen

Dit is de belangrijkste vondst van dit punt. `laadActueel()` wordt **niet**
aangeroepen bij het openen van de lade, maar direct bij het laden van het menu:

```js
// ---- "Nu actueel" alvast ophalen ----
laadActueel();                      // index.html:794
```

De ophaalronde loopt dus parallel aan het opbouwen van het menu, seconden vóór
de bezoeker op "Nu actueel" klikt. Bij openen staat het antwoord er al
(`build("actueel")` leest alleen de variabele `ACTUEEL`). Alleen wie binnen een
paar honderd milliseconden na het laden klikt, ziet even *"wordt geladen…"*.

Dat verandert door dit voorstel niet: de aanroep blijft op dezelfde plek staan,
alleen het adres wordt `/api/menu-actueel` in plaats van `/actueel.json`.

### Wat de wijziging feitelijk kost

Van een statisch bestand op de CDN naar een serverless functie. Schatting, niet
gemeten (zie "Wat ik niet heb kunnen vaststellen"):

| Situatie | Extra tijd t.o.v. nu |
| --- | --- |
| CDN-treffer binnen `s-maxage` (verreweg de meeste bezoeken) | ~0 ms — de CDN levert het antwoord, de functie draait niet |
| Verlopen cache, warme functie | ± 30-80 ms (één Upstash-heenreis, zelfde regio) |
| Koude start | ± 200-600 ms bovenop het vorige |

Met `stale-while-revalidate=600` valt zelfs die koude start meestal niet op de
bezoeker: de CDN levert de oude waarde meteen en ververst op de achtergrond. En
omdat het geheel al vóór de klik loopt, is de merkbare vertraging **bij openen in
de normale situatie nul**.

### Cacheduur: 60 seconden

`s-maxage=60`, niet de 300 van de feedroutes. Reden: Anton zet een knop uit en
wil kunnen controleren dát hij uit is. Eén minuut sluit aan bij wat hij al kent
("Vercel publiceert automatisch; na ± 1 minuut staat het live"). Vijf minuten
zou hem laten twijfelen of het paneel wel gewerkt heeft.

De `cache: "no-store"` die nu in `laadActueel()` staat, blijft staan: die schakelt
alleen de *browsercache* uit, niet de CDN. Zo ziet een bezoeker die de pagina
herlaadt de nieuwe stand binnen die minuut.

### De randvoorwaarde: nooit een lege of half opgebouwde lade

Hier zit een **echt gat in de huidige code** dat het bouwwerk moet dichten. Nu
geldt:

```js
.then(klaar, function(){ klaar(null); });
// en in klaar():  ACTUEEL = (j && typeof j === "object") ? j : { kaarten: [] };
```

Mislukken beide ophaalpogingen, dan wordt `ACTUEEL` gezet op `{kaarten: []}` en
toont de lade *"op dit moment niets bijzonders"*. Dat is vandaag al een lege lade
na een storing — precies wat niet mag. Bovendien heeft de `fetch` **geen
time-out**: een trage of hangende verbinding laat de lade oneindig op *"wordt
geladen…"* staan.

Voorstel voor `laadActueel()` — vier trappen, en de laatste toont altijd alles:

1. **`GET /api/menu-actueel`** met een `AbortController`-time-out van 2500 ms.
   Lukt dit, dan is dat de waarheid; sla het antwoord op als momentopname
   (`localStorage`, in `try/catch`) met een tijdstempel.
2. **Laatst bekende stand** uit die momentopname. Let op: het menu draait als
   iframe op een ander domein, dus dit is *third-party storage*. Safari blokkeert
   dat, Chrome partitioneert het. De opslag mag dus nóóit een voorwaarde zijn —
   alleen een meevaller. `actueel.html` doet dit al goed voorgedaan met
   `sessionStorage` in `try/catch` (`function load(k, def){ try{…} catch(e){ return def; } }`).
3. **`GET /actueel.json`** (relatief) en daarna de vaste Vercel-URL — de twee
   trappen die er nu al zijn. Dit statische bestand bevat **alle** kaarten, zonder
   filter. Dat is exact de gevraagde regel: *bij twijfel alle knoppen.*
4. **Alles faalt** → de lade toont niets nieuws maar ook niets leegs; er wordt geen
   `{kaarten: []}` gezet. Praktisch: laat `ACTUEEL` in dat geval de laatst bekende
   of de statische lijst houden.

Eén onderscheid dat het paneel moet respecteren: **een geslaagd antwoord waarin
Anton werkelijk álles heeft uitgezet is geen storing.** Dan hoort de bestaande
tekst *"op dit moment niets bijzonders"* te verschijnen — dat is een afgemaakte
mededeling, geen halve lade. Alleen het *falen* van een ophaalronde valt terug op
"alles tonen". In de code is dat verschil eenvoudig te maken: onderscheid
"antwoord ontvangen en geldig" van "geen antwoord".

---

## 5. Wat is er per knop telbaar

Vooraf, en dit hoort erbij: **de badge "Nieuws 8" bestaat niet in deze repo.**
`renderTabs()` in `actueel.html:425-431` zet alleen een icoon en een label op de
tabs, zonder aantal. Wat er wél is, is een telling *per tegel*:

```js
var telling = t.plat ? esc(t.meta||"") : meerv((t.artikelen||[]).length);   // actueel.html:405
function meerv(n){ return n+" "+(n===1?"artikel":"artikelen"); }            // actueel.html:279
```

Dat levert teksten als "8 artikelen" op de tegelkop op. Dát is waarschijnlijk wat
Anton heeft gezien. De bron van het getal — `artikelen.length` uit
`/api/actueel` — is precies de bron die ook een badge zou voeden, dus de gedachte
klopt; alleen zou de badge zelf nieuw zijn, niet hergebruikt.

Per knop, expliciet:

### Laatste nieuwsbrief — **NEE**

`href` wijst naar `https://nlfr-nieuwsbrief.vercel.app/api/nieuwsbrief`, een
302-doorverwijzing naar de webversie van de laatst verzonden Laposta-nieuwsbrief
(README, "Nu actueel bijwerken"). Er is één nieuwsbrief; er valt niets te tellen.
Een getal als "aantal nieuwsbrieven sinds uw laatste bezoek" zou per bezoeker
bijgehouden moeten worden, en dat kan het menu niet betrouwbaar (third-party
storage, zie punt 4). **Geen badge.**

### Bosbranden in Frankrijk — **JA**

`/api/actueel` levert een tegel met `id: "pers-bosbranden"`:

```js
export const PERS_TEGELS = ["bosbranden", "verkeer", "landelijk", "regionaal"];   // lib/config.js:557
tegels.push({ soort: "pers", id: `pers-${groep}`, …, artikelen: lijst.map(…) });  // lib/tegels.js:303-311
```

De indeling gebeurt automatisch op `BOSBRAND_WOORDEN` (`lib/config.js:546`).
**Telling = `artikelen.length` van de tegel `pers-bosbranden`** — het aantal live
perssyntheses over natuurbranden (eerste 48 uur; daarna schuiven ze naar de
archieftegel, wat voor een badge juist gewenst is).

Waardevol neveneffect voor Antons eigenlijke probleem: is er niets, dan wordt de
tegel **helemaal niet aangemaakt** (`if (!lijst || !lijst.length) continue;`).
Het getal is buiten het brandseizoen dus vanzelf 0. Dat maakt een automatische
variant denkbaar ("verberg bij 0"), maar Anton heeft om handmatige controle
gevraagd en die krijgt hij; dit is hooguit een latere optie, geen onderdeel van
het voorstel.

### Frankrijknieuws — **JA**

Deze knop wijst naar `/page/actueel-frankrijknieuws`, de pagina die `/actueel`
inbedt. **Telling = het totaal aantal live artikelen**, dus de som van
`artikelen.length` over alle tegels met `soort !== "archief"`. Dat is precies wat
de bezoeker op de pagina aantreft. Alternatief zou "aantal hot-tegels"
(`t.hot === true`) zijn, maar dat getal is te klein en te schokkerig om
informatief te zijn; mijn advies is het totaal.

### Nederlandse verenigingen in Frankrijk (verenigingen-kalender) — **JA**

Er zijn zelfs twee automatische getallen:

- **`agenda[]`** uit `/api/actueel` — activiteiten in de komende 14 dagen, opgehaald
  door `haalAgenda()` uit `https://antonnoe.github.io/verenigingen-kalender/data/verenigingen.json`
  (`lib/config.js:526-528`, `AGENDA_DAGEN = 14`). `actueel.html` toont dat al als
  `data.agenda.length + " activiteiten"`.
- de tegel **`verenigingen`** — nieuwsberichten uit
  `…/data/nieuws.json`, venster 30 dagen (`bronnen.json`, `lib/tegels.js:388-413`).

Omdat de knop over de *kalender* gaat: **telling = `agenda.length`**, het aantal
activiteiten in de komende twee weken. Dat is het getal met betekenis voor de
bezoeker.

### Lift- en transportcentrale — **NEE**, met voorbehoud

In deze repo bestaat er geen telbare bron voor. De naam komt alleen voor als
gewone Ning-link: `["Vervoershub", U("/page/lift-en-transportcentrale")]`
(`index.html:429`) en `["🚚 Vervoershub", U("/group/vervoerspagina")]`
(`index.html:471`). Er staat **geen feed in `bronnen.json`** en er is geen API die
er iets over teruggeeft. **Geen badge**, want een getal verzinnen is erger dan
geen getal.

Het voorbehoud, eerlijk: ik heb **niet kunnen controleren** of Ning voor die groep
of die pagina een RSS-feed aanbiedt — de netwerktoegang van deze sessie is
geblokkeerd (zie hieronder). Bestaat zo'n feed wél, dan is een badge alsnog
mogelijk langs de bestaande weg: bron toevoegen aan `bronnen.json` met een eigen
`thema`, en `assembleerTegels` maakt er een tegel met `artikelen.length` van.
Dat is dan nieuw werk, geen hergebruik.

### Samenvatting

| Knop | Badge | Bron van het getal |
| --- | --- | --- |
| Laatste nieuwsbrief | **nee** | geen — één nieuwsbrief, niets te tellen |
| Bosbranden in Frankrijk | **ja** | `/api/actueel` → tegel `pers-bosbranden` → `artikelen.length` |
| Frankrijknieuws | **ja** | `/api/actueel` → som `artikelen.length`, tegels met `soort !== "archief"` |
| NL-verenigingen in Frankrijk | **ja** | `/api/actueel` → `agenda.length` (activiteiten komende 14 dagen) |
| Lift- en transportcentrale | **nee** | geen bron aanwezig; Ning-RSS niet verifieerbaar in deze sessie |

### Hoe de badges opgehaald worden (belangrijk voor punt 4)

De tellingen komen uit `/api/actueel`, en dat is een aanzienlijk zwaardere route
dan `/api/menu-actueel` (alle feeds ophalen, parseren, clusteren). Die mag de
lade nooit ophouden.

**Advies: een tweede, niet-blokkerende ophaalronde.** De lade rendert meteen met
de knoppen uit `/api/menu-actueel`; daarna wordt `/api/actueel` opgehaald en
worden de getallen er achteraf bij gezet. Lukt dat niet of duurt het te lang, dan
blijven de knoppen gewoon staan zonder badge. Zo is een badge altijd toegift,
nooit voorwaarde — en blijft de regel "nooit een lege of half opgebouwde lade"
overeind. `/api/actueel` heeft al `s-maxage=300` met SWR, dus in de praktijk is
het een CDN-treffer.

Praktisch punt: `/api/actueel` bevat al een CORS-allowlist die
`*.nederlanders.fr` en `*.vercel.app` toestaat (`api/actueel.js`, `toegestaan()`),
dus het menu mag die route aanroepen zonder wijziging.

---

## Bouwvoorstel

### Waar het paneel komt

**Een eigen pagina, `/beheer-menu`, geopend vanuit het tandwiel in een nieuw
tabblad** — niet inline in de lade.

Dat is een afweging, dus de reden staat erbij. Inline in de lade zou technisch
werken (punt 1). Maar het paneel moet een geheime sleutel gebruiken (punt 2), en
die sleutel moet ergens blijven staan, anders moet Anton hem bij elke klik
opnieuw intikken. Het menu draait als iframe op een ander domein dan
nederlanders.fr, en opslag in zo'n iframe is *third-party storage*: Safari
blokkeert die, Chrome partitioneert die. Een inline paneel zou dus juist voor
Anton (die dit een paar keer per jaar op zijn telefoon wil doen) onbetrouwbaar
worden. Een eigen pagina op `nlfr-menu.vercel.app` staat top-level, heeft geen van
die beperkingen, biedt ruimte voor de groeiende lijst knoppen, en volgt exact het
patroon van `/review` dat al werkt.

Het tandwiel houdt dus zijn functie: daar zit de ingang. In de lade komt één
knop erbij, bovenaan, vóór de bestaande snelkoppelingen:

> **⚙ Nu actueel beheren** → opent `/beheer-menu` in een nieuw tabblad

De sleutel zit in de link (`/beheer-menu?sleutel=…`), zoals bij `/review?token=…`,
zodat Anton één bladwijzer heeft. De link is alleen zichtbaar als `isAdmin` — maar
dat is, nogmaals, cosmetiek; de beveiliging zit in de POST.

### Hoe het is afgeschermd

Volgens het oordeel bij punt 2: **een server-side te controleren sleutel, niet de
Ning-context.**

- Nieuwe env-var **`MENU_BEHEER_TOKEN`** in Vercel, los van `REVIEW_TOKEN`.
- `POST /api/menu-actueel` controleert die met de `leesToken` + `tokenGeldig`-
  aanpak uit `api/review.js`: lengtecheck vooraf, dan `crypto.timingSafeEqual`,
  en logregels zonder waarden.
- `GET /api/menu-actueel` blijft publiek — de uitkomst staat toch al op de site.
- `isAdmin` bepaalt uitsluitend of het tandwiel en de link zichtbaar zijn. Nooit
  meer dan dat, en dat hoort als comment bij de code te staan zodat het later niet
  per ongeluk als beveiliging wordt hergebruikt.

### Welke bestanden geraakt worden

| Bestand | Nieuw/wijziging | Wat |
| --- | --- | --- |
| `actueel.json` | wijziging (data) | `id` per item toevoegen (`nieuwsbrief`, `bosbranden`, `frankrijknieuws`); `_uitleg` bijwerken met de regel dat `id` niet gewijzigd mag worden |
| `lib/menu-actueel.js` | **nieuw** | pure functies: `pasZichtbaarheidToe(kaarten, uit)`, `schoonUitLijst(body, kaarten)`. Bewust apart van de route, zodat `node --test` ze kan testen |
| `api/menu-actueel.js` | **nieuw** | `GET` (samenvoegen + cachekoppen) en `POST` (tokencheck + `setJSON` zonder TTL) |
| `beheer-menu.html` | **nieuw** | het paneel: schakelaar per knop, opslaan, bevestiging, "laatst gewijzigd op" |
| `index.html` | wijziging | `ACTUEEL_URL` → `/api/menu-actueel`; `laadActueel()` krijgt de vier-traps terugval + `AbortController`-time-out + momentopname; `ADMIN_LINKS`-lade krijgt de beheerknop bovenaan; niet-blokkerende badge-ophaalronde |
| `lib/config.js` | wijziging | `KEY_MENU_ZICHT = "nlfr:menu:actueel:zicht"` en de cacheconstanten voor deze route, bij de bestaande sleutels |
| `.env.example` | wijziging | `MENU_BEHEER_TOKEN=` met uitleg |
| `README.md` | wijziging | beheerinstructie: wat het paneel doet, wat `actueel.json` blijft doen, en dat `id` vast is |
| `test/menu-actueel.test.mjs` | **nieuw** | zie hieronder |

Buiten schot blijven: `embedcode-ning.html` (hoeft niet aangepast, dus niets
handmatig op Ning over te nemen), `api/actueel.js`, `api/cron.js`, `api/review.js`,
`bronnen.json`.

### Welke tests erbij horen

Alle bestaande tests zijn `node:test`-tests op pure functies in `lib/`; geen
enkele test raakt `index.html`. Daar blijf ik bij — vandaar dat de logica in
`lib/menu-actueel.js` komt en niet in de route.

`test/menu-actueel.test.mjs`:

1. een `id` op de uit-lijst verdwijnt uit `kaarten`, de rest blijft, in dezelfde volgorde;
2. een lege uit-lijst geeft alle kaarten terug;
3. **een onbekend `id` in de uit-lijst wordt genegeerd** (geen fout, geen verdwenen knop);
4. **een kaart zonder `id` wordt nooit verborgen** — de standaardstand is aan;
5. een corrupt of ontbrekend KV-document (`null`, `{}`, `{uit: "bosbranden"}`) geeft **alle** kaarten terug;
6. staat álles op de uit-lijst, dan komt er een lege lijst uit — een expliciete keuze wordt gerespecteerd en niet stilletjes teruggedraaid;
7. `schoonUitLijst` weigert niet-strings, ontdubbelt, en laat alleen id's door die in `actueel.json` bestaan;
8. tokencheck: te kort, te lang, goede lengte maar verkeerde waarde → geweigerd; juiste waarde → toegelaten; ontbrekende env-var → geweigerd (nooit "leeg is goed").

Wat `node --test` **niet** kan afdekken, en dus met de hand moet:

- de terugval in `laadActueel()`. Checklist: in devtools `/api/menu-actueel`
  blokkeren en herladen → alle knoppen moeten verschijnen; de route vertragen tot
  boven 2500 ms → alle knoppen moeten verschijnen; KV-env-vars leeghalen → alle
  knoppen moeten verschijnen;
- de hoogtesync na het toevoegen van de beheerknop (lade openen op mobiel en
  breed, controleren dat het iframe meegroeit en de knop niet wegvalt);
- het paneel op een telefoon, want daar gaat Anton het gebruiken.

### Advies over de bestaande snelkoppelingen

**Behouden, maar onder de nieuwe beheerknop.**

Anton zegt dat hij ze niet gebruikt, en dat geloof ik. Toch is weghalen hier de
verkeerde besparing:

- **Bestandsbeheer is de nooduitgang.** Daar staat de Ning-kopie van het menu, en
  de README houdt `/nlfr-menu-2` uitdrukkelijk aan als noodfallback voor als
  Vercel of Ning het laat afweten. Juist op zo'n dag wil je die link niet gaan
  zoeken.
- **Ze kosten vrijwel niets.** `.adminlinks` is een enkele flexrij die afbreekt;
  vijf pillen erbij is één regel scherm in een lade die alleen de beheerder ziet.
- **Weghalen is onomkeerbaar in gebruik, terugzetten kost een deploy** — precies
  het soort tussenstap dat deze hele opdracht wil vermijden.

Concreet: de lade wordt

```
Beheer   [⚙ Nu actueel beheren]   ·   Dashboard  Tags  Standaard teksten  Bestandsbeheer  Mijn pagina's
```

met de beheerknop visueel zwaarder (gevulde stijl, zoals `.fill` in de onderbalk)
en de vijf oude als lichte pillen erachter. Blijkt na een seizoen dat hij de vijf
werkelijk nooit aanraakt, dan is schrappen alsnog een wijziging van één regel.

---

## Wat ik niet heb kunnen vaststellen

Eerlijk en volledig:

1. **Geen enkele live meting.** De uitgaande netwerktoegang van deze sessie is
   door de proxy geblokkeerd (403 op CONNECT voor `antonnoe.github.io`, en de
   WebFetch-route geeft `EGRESS_BLOCKED`). Ik heb dus niets kunnen ophalen van
   `antonnoe.github.io`, `nederlanders.fr`, `nlfr-menu.vercel.app` of
   `nlfr-nieuwsbrief.vercel.app`. Alle uitspraken over de gegevensbronnen komen
   uit de code die ze inleest, niet uit hun huidige inhoud.
2. **De getallen in punt 5 zijn structureel vastgesteld, niet numeriek.** Ik weet
   uit `lib/tegels.js` en `lib/feeds.js` dát er een telbaar veld is en welk veld
   dat is; ik weet niet hoeveel er vandaag in staat. Of `agenda.length` in de
   praktijk een prettig getal oplevert (2? 40?) is een kwestie van één keer kijken
   zodra dit gebouwd wordt.
3. **Of Ning een feed heeft voor de Lift- en transportcentrale** — zie punt 5. Niet
   te controleren zonder netwerktoegang. Het antwoord "nee" geldt voor deze repo;
   het is geen uitspraak over wat Ning zou kunnen leveren.
4. **De prestatiecijfers in punt 4 zijn schattingen**, gebaseerd op de aard van de
   aanroepen (CDN-treffer, Upstash-heenreis, Vercel-koude-start) en niet op een
   meting van deze deployment.
5. **De badge "Nieuws 8" heb ik niet teruggevonden.** In `actueel.html` staat geen
   telling op de tabs, alleen op de tegelkoppen ("8 artikelen"). Mogelijk komt
   Antons herinnering daarvandaan, of uit IF-Mobiel, dat een aparte repo is
   waar ik geen toegang toe heb. De bron van het getal is hoe dan ook dezelfde.
6. **Of `ADMIN_ID` nog de juiste is.** Dat de waarde `3pjypz5h1ilpc` in het
   bestand staat, is zeker; dat die vandaag bij Antons Ning-profiel hoort, kon ik
   niet nagaan. Voor dit voorstel maakt het niets uit — de beveiliging hangt er
   niet aan.
