# Meting bronlink-storing — 28 augustus 2026

Deze meting is gedaan **vóór** de fix, op de code zoals die op `main` stond
(commit `8b285b0`). Het meetinstrument staat in `scripts/meet-bronurls.mjs` en
kan herhaald worden.

## Wat is gemeten

Per bron: de live feed opgehaald, geparseerd met de toenmalige parser, en per
item getoetst of de bron-URL een host heeft die bij de geconfigureerde bron
hoort en een niet-leeg pad.

## Wat er gemeten kón worden

De sessie waarin deze meting is gedaan draaide achter een egress-policy die
alleen `infofrankrijk.com` toestond. Alle andere feedhosts en de productie-URL
(`nlfr-menu.vercel.app`) gaven een proxy-403 en waren **niet** meetbaar. Er
waren ook geen KV-credentials beschikbaar, dus de KV-records konden niet
geteld worden.

Dat is een beperking van de meetomgeving, niet van het instrument. Wie
`KV_REST_API_URL` en `KV_REST_API_TOKEN` zet en het script draait, krijgt de
KV-telling er zonder verdere aanpassing bij; vanaf de dagelijkse
Actions-runner zijn ook alle feeds bereikbaar.

## Uitslag — Infofrankrijk (regime `eigen`)

Feed `https://infofrankrijk.com/feed/`, opgehaald 2026-08-28, 10 items.
**3 van de 10 items (30%) hadden een bron-URL die niet bij de bron hoorde.**

| Titel | Datum | Regime | Foute bron-URL |
|---|---|---|---|
| Handleiding voor een woning opgetrokken uit leem | 2026-08-18 | eigen | `https://fonts.googleapis.com` (leeg pad) |
| CAK, vroegpensioen en zorg in Frankrijk | 2026-08-20 | eigen | `https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Mulish:ital,wght@0,400;0,600;0,700;1,400&display=swap` |
| Zorg dat je het voordeel arrest De Ruyter niet misloopt | 2026-08-11 | eigen | `https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Mulish:wght@400;600;700&display=swap` |

De overige 7 items hadden wél een correcte `infofrankrijk.com`-URL.

## Treft dit alleen Infofrankrijk, of breder?

**De fout in de code was niet regime-specifiek.** `leesLink()` in
`lib/feeds.js` werd door álle RSS/Atom-bronnen gebruikt — pers en overheid
net zo goed als Infofrankrijk. Elke bron die artikel-HTML meelevert in
`<content:encoded>` (of `<description>`) waarin een `<link href=…>` voorkomt,
kon dezelfde fout krijgen.

**In de praktijk trof het waarschijnlijk vooral Infofrankrijk**, om een
inhoudelijke reden: de fout treedt alleen op als de meegeleverde artikel-HTML
een `<link href=…>`-element bevat. Dat is ongebruikelijk in een nieuwsfeed,
maar normaal in Infofrankrijk-artikelen, die zelfstandige Divi/WordPress-blokken
met eigen font- en stylesheet-links insluiten. De drie geraakte artikelen zijn
precies de drie met zo'n ingesloten blok.

Of pers- en overheidsfeeds daadwerkelijk óók geraakt waren, is vanuit deze
sessie **niet vast te stellen** — die feeds waren onbereikbaar. Het is dus
gemeten voor `eigen` en beredeneerd voor de rest. De sonde
(`.github/workflows/sonde.yml`) meet dit vanaf nu dagelijks voor alle regimes
op de echte uitvoer, dus als er ergens anders nog iets zit, komt dat binnen een
dag boven water.

## Na de fix

Dezelfde feed, dezelfde 10 items, opnieuw gemeten met de nieuwe parser:
**0 van de 10 fout.** Alle tien wijzen naar een `infofrankrijk.com`-artikel,
waaronder:

    https://infofrankrijk.com/handleiding-voor-een-woning-opgetrokken-uit-leem/

## Wat de sonde daarna op productie vond

De meting hierboven kon alleen de Infofrankrijk-feed zien. De sonde draait vanaf
een GitHub-runner zonder die beperking en toetste dezelfde regels op de echte
uitvoer van `/api/actueel` (±150 artikelen). Dat leverde drie dingen op die de
sessiemeting niet kón zien — twee daarvan waren regressies van de fix zelf.

1. **Franceinfo publiceert onder twee merkdomeinen.** De feed staat op
   `www.francetvinfo.fr`, de artikelen op `www.franceinfo.fr` en op
   regiosubdomeinen als `france3-regions.franceinfo.fr`. De herkomsttoets
   weigerde die en onderdrukte ruim vijftien perslinks. Opgelost met
   `linkDomeinen` op die bron.

2. **Service-Public is verhuisd naar `service-public.gouv.fr`.** De feed staat
   nog op `www.service-public.fr`, de artikel-URL's wijzen naar
   `www.service-public.gouv.fr`. Alle acht Service-Public-items verloren hun
   bronlink. Opgelost met `linkDomeinen` op beide Service-Public-bronnen. Dit is
   een echte verhuizing aan de kant van de Franse overheid, geen fout in deze
   repo — maar wel iets om te weten.

3. **Verenigingsitems dragen de naam van de vereniging.** De aggregaatfeed zet
   per item `ERN Paris`, `LOTgenoten`, `NVLR` of `CMUnf` als bronnaam, niet de
   naam van de geconfigureerde bron. De toets zocht de bronconfiguratie op díé
   naam, vond niets en onderdrukte élke verenigingslink. Opgelost door de
   aggregaatbron op het thema op te zoeken en expliciet mee te geven — in
   `lib/tegels.js` én in de sonde zelf, die dezelfde fout maakte.

Alle drie zijn hersteld en met tests vastgelegd. De sonderun daarna is groen.

## Verificatie op productie

Sonderun op `https://nlfr-menu.vercel.app/api/actueel`, verdict **groen**, met
het item uit de storing erbij gefilterd:

    [infofrankrijk] Handleiding voor een woning opgetrokken uit leem
        artikel-URL: https://infofrankrijk.com/handleiding-voor-een-woning-opgetrokken-uit-leem/
        bron:        https://infofrankrijk.com/handleiding-voor-een-woning-opgetrokken-uit-leem/

Die URL is los opgevraagd en geeft HTTP 200 met
`<title>Handleiding voor een woning opgetrokken uit leem | Infofrankrijk</title>`.
