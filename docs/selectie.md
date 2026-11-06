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
<iframe src="https://nlfr-menu.vercel.app/sidebar-nieuws" height="900" width="100%" class="fw-iframe" scrolling="no" frameborder="0"></iframe>
```

Zolang er nog niets is goedgekeurd, toont het blok "Op dit moment geen geselecteerd nieuws". `?voorbeeld=1` toont de opmaak met vaste voorbeeldberichten.
