# Nieuwsselectie (vervanger van Feedspot)

Ingericht op 7 november 2026. Twaalf jaar lang pinde de redactie elke dag met de hand Nederlandstalig nieuws over Frankrijk in een Feedspot-pinboard, dat via een FeedWind-widget in de sidebar van Nederlanders.fr stond. Deze module neemt het scannen over; de redactie houdt het laatste woord.

## De cyclus

1. **Scannen** (`/api/selectie-cron`, elk uur op minuut 37). Bronnen: NOS en VRT rechtstreeks, de rest van de Nederlandse en Vlaamse pers via Google News (NL en BE), oranje en rode weerwaarschuwingen via MeteoAlarm, en de overheidsberichten die `/actueel` al live heeft. Zie `lib/selectie/bronnen.js`.
2. **Voorstel** (Sonnet, `lib/selectie/model.js`). Per bericht: categorie, score 0 tot 100, één zin reden, de PEIL-parameters die het raakt, en een eventueel gat in PEIL. Het model kiest alleen uit parameters die een voorselectie op trefwoorden heeft voorgelegd; een verzonnen id wordt weggegooid.
3. **Go of no-go** (`/selectie`, achter de login van `/review`). De redactie kan de categorie aanpassen.
4. **Publiceren** (`/api/selectie-feed`, JSON of `?format=rss`; leesbaar blok op `/sidebar-nieuws`). Alleen go-berichten van de laatste zeven dagen; weerwaarschuwingen tot ze verlopen.
5. **Leren**. Elke beslissing blijft bewaard (`selectie:besluit:*`, zonder TTL). De laatste 25 go's en 25 no-go's gaan bij elke ronde als voorbeelden mee naar het model.

## Categorieën

Algemeen nieuws, Ondernemersnieuws, Reisnieuws, Meteo, Wet- en regelgeving.

## PEIL

Een bericht kan een parameter **raken** (het gaat over het onderwerp; dat is een verwijzing en mag automatisch) of **mogelijk gewijzigd** melden (het bericht noemt een andere waarde). Het tweede is altijd een vraag aan de redactie: PEIL wordt nooit vanuit deze module aangepast. Een **gat** is een bedrag of regel die lezers raakt zonder parameter in PEIL.

In de sidebar staat onder een bericht dat PEIL raakt: "Raakt PEIL: <parameter> · Reken het na in <tool>". De tools komen uit het veld `tools` van PEIL; een parameter zonder tool levert alleen de naam op.

## Wat het bewust niet doet

- Het raakt `/actueel`, de reviewtool, de persketen en de dagelijkse brief niet: eigen bronnen, eigen sleutels (`selectie:*`), eigen cron. Alleen-lezen op de overheidsvoorraad.
- Het vermomt zich niet. AD, NU.nl, de Volkskrant, RTL, NRC en HLN weigeren een eerlijk geïdentificeerde lezer (HTTP 403); hun berichten komen via Google News, met de redactie als bronnaam. Zo deed Feedspot het ook.
- Het linkt in de sidebar naar het originele artikel, zoals Feedspot. In de dagelijkse brief blijft de regel dat er geen perslinks in staan; die brief gebruikt deze feed niet.

## Controle

- `GET /api/selectie-feed?status=1`: tellingen en de laatste ronde (geen inhoud, openbaar).
- `GET /api/selectie-cron?diagnose=1` met `Authorization: Bearer <CRON_SECRET>`: alles ophalen en naast PEIL leggen, zonder modelaanroep en zonder te schrijven.
- Model wisselen zonder code: `SELECTIE_AI_MODEL` in Vercel (standaard `claude-sonnet-5-5`).

## In de NING-sidebar

Vervang de FeedWind-iframe door:

```html
<iframe id="nlfr-nieuws" src="https://nlfr-menu.vercel.app/sidebar-nieuws" height="600" width="100%" scrolling="no" frameborder="0" title="Nieuws over Frankrijk"></iframe>
```

De pagina meldt zijn hoogte met `postMessage({nlfrNieuwsHeight})`; het script van de zijbalk zet het iframe op die hoogte (alleen berichten van `https://nlfr-menu.vercel.app`). De volledige zijbalkcode staat in de projectmap van Nedergids (`nedergids-zijbalk/zijbalk-nlfr-met-nedergids.html`).

Kiezen gebeurt op `/selectie`, bereikbaar via de knop "Zijbalknieuws kiezen" op `/review`.

Zolang er nog niets is goedgekeurd, toont het blok "Op dit moment geen geselecteerd nieuws". `?voorbeeld=1` toont de opmaak met vaste voorbeeldberichten.

## Tool in het groene vak (20-11-2026)

Per bericht kiest het model hooguit één tool uit de modulecatalogus van Infopoche (`https://infopoche.fr/modules.json`, repo antonnoe/if-mobiel; geen tweede lijst hier). Alleen modules die af zijn, zichtbaar en een https-adres hebben (`toolCatalogus` in `lib/selectie/kern.js`); de link gaat naar het uitlegartikel op Infofrankrijk als de module `artikel` heeft, anders naar de tool. Een id die niet in de lijst staat, wordt weggegooid. De catalogus staat 6 uur in KV (`selectie:tools-cache`); niet bereikbaar = geen tools, de ronde gaat door (zie `tools` in het rondejournaal). De zijbalk toont "Handig hierbij: <tool> →", behalve als dezelfde tool al in de PEIL-regel staat. Berichten die al een oordeel hadden vóór 20-11, krijgen geen tool.
