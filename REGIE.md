# Regie-logboek nlfr-menu

## Nieuwsselectie, vervanger van Feedspot (7 november 2026)

Doel: de handmatige Feedspot-pinboard (via FeedWind in de NLFR-sidebar) vervangen door een cyclus waarin de AI scant en voorstelt, de redactie go of no-go geeft en goedgekeurd nieuws in de sidebar komt, gekoppeld aan PEIL en de tools.

### Besluiten van de opdrachtgever
- B1. AI scant, biedt aan met suggesties, de redactie geeft go/no-go, pas daarna geplaatst.
- B2. Vijf categorieën: Algemeen nieuws, Ondernemersnieuws, Reisnieuws, Meteo, Wet- en regelgeving.
- B3. De Nederlandse en Belgische pers blijft een bron.
- B4. Cyclus nieuws, PEIL, tools: een bericht dat een parameter raakt verwijst naar die parameter en de tools. "Raakt" mag automatisch; een gewijzigde waarde is een vraag aan de redactie; PEIL wordt nooit automatisch aangepast.
- B5. Elke beslissing blijft bewaard en dient als lesmateriaal voor de AI.

### Taken
| Taak | Status |
|---|---|
| Bronnen, voorselectie PEIL, modeloordeel, opslag (`lib/selectie/`, `/api/selectie-cron`) | gebouwd, gekeurd |
| Go/no-go-scherm `/selectie` achter de login | gebouwd, gekeurd (alleen code; inloggen niet getest door keurders) |
| Openbare feed `/api/selectie-feed` en sidebarblok `/sidebar-nieuws` | gebouwd, gekeurd op preview |
| Samenvoegen in main (PR #65) | wacht op de opdrachtgever: samenvoegen zonder menselijke review is voor de agent geblokkeerd |

### Keuring
- Eisenkeurder: E1 tot en met E11 en B1 tot en met B5 geslaagd. Vijf bevindingen, alle vijf hersteld in ronde 1: tijdsbudget (meteo parallel, eerst opslaan dan beoordelen, modellimiet 28 s), strikte lijsten bij een KV-storing, geschiedenis bij terugdraaien, twee batches per ronde, "mogelijk gewijzigd" zichtbaar als "wordt nagelopen" voor lezers.
- Reiskeurder: acht bevindingen. Hersteld: Go zonder eerst een categorie te kiezen, Ongedaan in de melding, datum bij recent beslist, filterknoppen op de telefoon zonder horizontaal scrollen, PEIL-regel met link naar het register en een duidelijke toollink, grotere en donkerdere bron en datum, begrijpelijke lege toestand. Bewust niet: de score blijft zichtbaar voor de redactie; de categorie van een goedgekeurd bericht wijzigen gaat via terugdraaien.
- Herstelrondes: 1.

## Herstelronde onzichtbare fouten (20 november 2026, op PR 78)

Besluit opdrachtgever: eerst de onzichtbare fouten, geen nieuwe knoppen of indeling op /redactie (die volgt na een goedgekeurde mock-up).
- Tekstverlies: wat in het tekstvak van een synthese staat (`tekstEdit` in redactie.html) wordt nooit teruggezet door tekenen of laden; "OK, plaatsen" publiceert de tekst uit het vak; cursor en focus blijven bij hertekenen. Na een klik is er geen volledige herlaadbeurt meer: de lijst "Gekozen vandaag" ververst pas als je hem opent.
- Rubriek is nooit verplicht: zonder AI-rubriek staat er vooraf een standaard (`standaardRubriek`: algemeen, overheid regelgeving, meteo), in pagina en server.
- Overheid achter een poort (`lib/overheidpoort.js`): een overheidsbericht is alleen live met modelscore >= `SCORE_DREMPEL` (lib/config.js, 40, ook de waarde van prompt, kandidatenfilter en /redactie via `/api/selectie`) of na plaatsing door de redactie. Nieuwe berichten krijgen `poort.status` "wacht"; zonder score of eronder komen ze als kandidaat op /redactie. De cron toetst ook wat al live stond (doc zonder veld `poort`) en haalt het eraf; bij een opslagstoring wijzigt de poort niets. Alleen Caribisch Nederland (`nlOverheidUitgesloten`) blijft hard uitgesloten; `NL_OVERHEID_DOEL` is vervallen; DG Trésor staat niet meer in bronnen.json. Een go van de redactie op een bericht van vóór de poort blijft staan.
- Weg blijft weg: `verwijder-overheid` en de poort zetten `KEY_AFGEWEZEN` (28 dagen); de cron slaat zulke berichten over.
- Opslag (`lib/store.js`): index per soort (gesorteerde verzameling `ix:<voorvoegsel>`, bijgehouden door setJSON en del), lezen met `sindsUren`; oude sleutels worden eenmalig (daarna elke 24 uur, met NX) uit één volledige scan opgenomen, niets verplaatst of gewist; verlopen sleutels worden bij lezen uit de index gehaald; zonder index-opdrachten valt hij terug op de scan (nu zonder het stille plafond van 50 rondes). Besluiten en historie krijgen een TTL van 180 dagen (`SEL_BESLUIT_TTL_S`); kandidaten worden alleen nog de laatste 96 uur gelezen (`SEL_LEES_UREN`).
- Leersignaal: een bericht dat alleen op de nieuwspagina, in de nieuwsbrief of Infopoche komt is een go met lege zijbalkkanalen (`elders`), geen no-go; alleen Weg is een no-go.
- Tests: `test/herstel-onzichtbaar.test.mjs`.

## Redactiepagina volgens de goedgekeurde mock-up (20-11-2026)

- `/redactie` is de ene ingang (tandwiel, login en `/selectie` verwijzen ernaar; `/review` blijft als beheerscherm voor Café Jeudi, verwijzingen, bronnen en uitloggen). Alleen wat een beslissing nodig heeft: groepen Meerdere kranten, Overheid waar de AI twijfelt (poort "wacht"), Eén krant; per bericht het voorstel in woorden plus waarom, knoppen Ja, Alleen zijbalk, Nee en "Anders" (vijf plekken aan/uit/kan niet met reden, rubriek vooraf ingevuld, kop en tekst voor een synthese, Plaats zo). Ingeklapt: Al automatisch live vandaag (Haal weg / Terugzetten, nieuwe review-actie `herstel-overheid`; `verwijder-overheid` bewaart het bericht in het afgewezen-merkteken), Door de AI niet voorgesteld (Toch bekijken). Rest van vandaag: nee.
- Ongedaan maken: het besluit gaat pas na 5 seconden naar de server (de kaart toont "Wordt geplaatst", daarna "Opslaan…" en pas na een geslaagd antwoord "Geplaatst"). Gekozen omdat een weggegooide synthese (`weg`) of een gedepubliceerd bericht niet terug te zetten is. Verlaat je de pagina in die 5 s dan waarschuwt de browser; een verborgen tabblad slaat meteen op. Daarna "Wijzig": herstelt het besluit op de server en laat opnieuw kiezen (niet voor een weggegooide synthese). Mislukt opslaan: de kaart komt terug met de melding.
- Reden bij Nee (Niet relevant, Dubbel, Te oud, Buitenland): veld `reden` op het besluit (`go`, `nogo`, `redactie`, of achteraf actie `reden`), in de modelinvoer als "NO-GO titel (reden: ...)". Backward compatible.
- Poort (aanvulling keuring): alleen een expliciete Weg (`redactie.weg`) telt als afgewezen; oude nogo-besluiten zonder dat kenmerk worden genegeerd. De keuze van de redactie gaat voor de score (`redactie.nieuwspagina`); een go van het oude selectiescherm telt ook. verwerkPoort leest het bericht opnieuw vlak voor het schrijven. Een oud bericht dat de poort niet haalt wordt niet meer uit de voorraad gewist (cron, registeropname). Opslagindex: mislukte ZADD zet de marker weg (volgende lezing bouwt opnieuw), opbouw met slot (`ix:bouw`), diagnose schrijft niets.
- `review` actie `bewerk` accepteert ook `kop`.

## Herstelronde 1 na keuring van c55d647 (20-11-2026)

- A: één verzoek volstaat. `/api/review` publiceer neemt `kop` en `selectie` ({kanalen, categorie, elders, reden}) mee en legt het redactiebesluit zelf vast (`lib/selectie/redactie-opslag.js`, ook gebruikt door `/api/selectie` actie redactie); een weggegooide synthese (redactie met `weg`) gaat in hetzelfde verzoek weg. Bij pagehide en verborgen tabblad gaat alles wat wacht direct met `fetch keepalive`. Overheid/publicatie blijven twee verzoeken (besluit, dan verwijder/kanalen); tijdens sluiten is alleen het eerste gegarandeerd (bij Weg zet de cron-poort het via `redactie.weg` alsnog af).
- C: publiceer is idempotent (staat hij al als publicatie, dan alleen kanalen en besluit; antwoord `hervat`); bij een halve poging komt `gepubliceerd:true` terug en de pagina gaat verder als publicatie, Nee ook.
- B: lijst = alles zonder besluit uit 36 uur. D: bericht zonder poortveld met een bestaand redactiebesluit = ok. E: 400 ms geen tikken op de lijst na een besluit. G: geen leeg reden-verzoek; Caribisch Nederland wordt `poort wacht, door uitgesloten` in plaats van gewist; besluiten en historie zonder TTL.
- F: /review is hernoemd naar Beheer met link naar /redactie, maar de dagelijkse functies (Publiceer, Weg, wachtrij, overheidslijst) zijn NIET verwijderd: 13 testbestanden en de verwijzingen/ketenfuncties zitten er verweven in. Apart opruimen is aan te raden.

## Herstelronde 2 (20-11-2026)

- Nee op een publicatie of overheidsbericht, en Ja met kanalen of live zetten, gaat in één verzoek (`/api/selectie` redactie met `weg`, `act`, `live`; depubliceren/verwijderen met bewaard bericht voor Terugzetten). De tikbeveiliging na een besluit is 700 ms.

## Overheidspoort live hersteld, redactieregels in één bestand (20-11-2026)

- Punt 0, overheidspoort live: gemeten op /api/actueel (gebakken 17:07:41) stonden nog Rijksoverheid-berichten (Lingewaard, Evertsen, Participatiewet, DG Digitaliseringsbeleid) live. Uit de logs: de eerste cronronde na de deploy (16:07) brak af op de 60 s van de functie ("Task timed out"); de ronde van 17:07 liep wel af. De tegels van 15:07 telden 62 overheidsartikelen, de baksel van 17:07 nog 13: de poort werkte dus, maar liet 7 Rijksoverheid-berichten door. Gevonden zwakke plekken in de code: (1) een doc zonder poortveld gold als live (`overheidIsLive`, ook in de cron-voorraadtelling), dus alles wat de poort niet (op tijd) toetste bleef zichtbaar; nu alleen `poort.status === "ok"` (fail closed). (2) Hypothese, niet bewezen (de opslag is niet te lezen): de doorgelaten berichten hebben een modelscore van 40 of meer, want de prompt kent geen regel voor Nederlands binnenlands bestuur en prio 2 (uitkeringen) en prio 5 (40-60) vangen ze op; en een bestaand redactiebesluit (nogo zonder Weg) op een doc zonder poortveld hield hem ook live. (3) De cron logde de poortuitkomst niet; nu staat er een regel `[cron] overheidpoort: ok=.. wacht=..` in de logs. Test: `test/redactieregels.test.mjs` (live-scenario).
- Eén regelbestand: `lib/redactieregels.js` (regels met herkomst, vijf plekken, drempel, rubrieken, Café-domeinen, redenen, Frankrijk-woordenlijsten, persbronnen van de selectie, instelbare maxima) plus `docs/redactieregels.md`, in sync getest. config.js, kern.js, feeds.js en bronnen.js lezen het; de dubbele lijsten zijn weg.
- Prompt: kent de vijf plekken (veld `plekken`, oud veld `plek` wordt eruit afgeleid) en zegt dat een los krantenbericht nooit op nieuwspagina, nieuwsbrief of Infopoche komt; `leesModelAntwoord` dwingt dat af.
- Selectiestroom: de zeven (`zeefDoorlaat`) en een maximum per bron (15 nieuwste, Google News 40) vóór het model.
- Leersignaal: voorbeelden met bron, eigen voorstel, gekozen plekken en reden bij Nee; verschillen eerst; 25 per soort, 260 tekens per regel. Het besluit bewaart nu `plekken`.
- Meten: `meting` in GET /api/selectie (berekend uit de besluiten van de laatste 7 dagen, geen aparte teller), regel op /redactie bij minstens 5 besluiten.
- Toetsset: `test/fixtures/redactie-toetsset.json` (31 verzonnen koppen). Drie bekende gaten van de zeven (Bergerac-inbraak, juwelier Toulouse, Ajax-PSV) staan als `bekendGat`.
- Aanvulling PR 79 (20-11-2026): R17 (besluit opdrachtgever): Nederlands binnenlands nieuws en bestuur alleen relevant als het Nederlanders in het buitenland raakt. In de prompt (prio 0) en als vangnet in de poort: een nl-overheid-bericht komt zonder redactiekeuze alleen live met modelscore >= drempel EN een kenmerk uit `NL_BUITENLAND_RAAKT`; de toetsset heeft de zeven berichten van vandaag. Gaten in de zeven gedicht (cambriolage, vol à main armée, interpellé, inbraak, woningoverval, Eredivisie, KNVB), met uitzonderingen zodat dienstverlening over inbraakpreventie in tweede woningen blijft staan. Synthese zonder AI-oordeel: standaard zijbalk en Infofrankrijk (voorstel "zijbalk").
- Herstelronde 1 PR 79 (20-11-2026): R17 geldt ook voor "ok door model" (niet voor plaatsing door de redactie); kenmerken: zorgverzekering erbij, pensioen en verdrag alleen met buitenlandcontext. Voorstel van een synthese wordt in /redactie los afgeleid (meerdere kranten = nieuwspagina mag); het getoonde voorstel (vijf plekken, `ai.plekken`) gaat mee met elk besluit als `voorstelPlekken` en daartegen wordt gemeten en geleerd; een gepubliceerde synthese heeft nieuwspagina in `plekken`. Faits-divers-zeef: termen van 5 tekens of korter op heel woord (`FAITS_DIVERS_KORT`), Franse grensplaatsen tellen als Frankrijk-link, "conseils" en "plan national" in de insluitlijst. /redactie haalt plekken, rubriekslabels, redenen en drempel uit /api/selectie.
- Vervolg PR 79 (20-11-2026): een overheidsbericht dat de poort op wacht zet door R17 krijgt `poort.reden: "r17"`; /redactie stelt dan Nee voor (geen nieuwspagina, nieuwsbrief of Infopoche) met de reden `r17Reden` uit /api/selectie (lib/redactieregels.js `R17_REDEN`), zonder eigen tekst in de pagina. Gekozen voor Nee en niet alleen zijbalk, omdat R17 het bericht niet relevant noemt.
- PR 80 (Codex P2): de R17-markering op een wacht-doc blijft staan als de score ontbreekt (kandidaat uit het venster), herberekend uit kop en samenvatting; test met twee opeenvolgende rondes van verwerkPoort.

## R17 streng en "ok door redactie" zonder keuze (20-11-2026)

- Aanleiding: na PR 79 stonden vijf Rijksoverheid-berichten nog live (Evertsen Rode Zee, Participatiewet, DG Digitaliseringsbeleid, burgemeestersvacature Lingewaard, IBO ouderen). De opslag is niet leesbaar vanaf hier, dus de exacte route per bericht is niet bewezen. Gevonden en gedicht: (1) kenmerk te ruim: "buitenland" op woordbegin liet ook "Buitenlandse Zaken" door, en "ambassade", "belgie", "franse", "over de grens" en "nederlanders in" liepen los; AOW, pensioen en zorgverzekering telden ook zonder buitenlandcontext. (2) "ok door redactie" zonder bewuste keuze (stempels uit een oudere ronde, `poort.keuze` ontbreekt) werd nooit opnieuw getoetst en `verwerkPoort` liet ze ook staan. Nu: alleen een plaatsing in /redactie (`live:true`, zet `poort.keuze:true`), een go-besluit of een go van het oude selectiescherm houdt een bericht vast; de rest wordt als modelbericht getoetst (R17, score).
- R17 nu: door zonder keuze alleen bij expliciet Nederlanders in het buitenland of in Frankrijk, emigr/remigr, expat, Frankrijk, grensregeling, grensarbeid, woonland, verdragsland, kiezers in het buitenland, briefstem; of AOW, pensioen, zorgverzekering, paspoort, rijbewijs, verdrag, belasting, consulair samen met een buitenlandcontext ("in het buitenland", "buiten Nederland", Frankrijk, emigr enz.). Een losse plaats of land (Rode Zee) of een ministerienaam telt niet.
- De cron logt nu per live Rijksoverheid-bericht kop, door, keuze en score (`[cron] overheid ok: ...`), zodat een volgende ronde de oorzaak per bericht laat zien.
- Toetsset: alle vijf staan in `overheid` (verwacht wacht) met samenvattingen die losse woorden bevatten; tests spelen ze als ok door model, score 55 en ok door redactie zonder keuze.
- Bijstelling na keuring (20-11-2026): "in het buitenland", "vanuit het buitenland", "naar het buitenland", "buiten Nederland" en "verdragsgerechtig" tellen op zichzelf; "ambassade" en "consula" tellen met Parijs of Frankrijk in de tekst; "Buitenlandse Zaken" telt nooit. Toetsset: negen berichten die doorkomen (stemmen, erfbelasting, WIA, kinderbijslag, DigiD, studiefinanciering, zorgverzekering verdragsgerechtigden, consulaat en ambassade Parijs) en negen die tegengehouden blijven (waaronder Belastingplan 2027). Het voorstel bij R17 blijft Nee.
