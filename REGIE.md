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
