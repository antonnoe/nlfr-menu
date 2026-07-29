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

## Eenmalige installatie (uitgevoerd 29-07-2026)

1. Repo aangemaakt, `index.html` toegevoegd.
2. Vercel → Add New Project → deze repo geïmporteerd → Deploy (geen instellingen
   nodig; statisch bestand).
3. Op nederlanders.fr de oude embedcode vervangen door `embedcode-ning.html`
   met de echte Vercel-URL ingevuld.
4. De oude Ning-pagina `/nlfr-menu-2` blijft voorlopig staan als noodfallback.
