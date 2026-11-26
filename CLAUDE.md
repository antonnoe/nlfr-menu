# Vaste regels voor Claude Code in nlfr-menu

Eigenaar: Anton Noë. Hij is geen programmeur en beslist; werk zelfstandig door en vraag alleen door als een verkeerde aanname het resultaat onbruikbaar maakt. Schrijf in gewoon Nederlands, zakelijk, met komma's in plaats van lange streepjes.

## Werkwijze

- Werk op een eigen branch, nooit rechtstreeks op main (de ruleset eist de check `npm test`).
- Zelf mergen naar main: open de PR, wacht tot `npm test` groen is, merge dan zelf. Beleg nooit een merge- of tussenstap bij Anton.
- Is mergen technisch geblokkeerd (bijvoorbeeld omdat een menselijke review wordt afgedwongen), omzeil dat dan niet. Meld het in één regel bovenaan het rapport, met de PR-link.
- Wijzig geen instellingen, sleutels of environmentvariabelen. Zet geen geheimen in code of in het rapport.
- Klein en gericht: geen opruiming of herschrijving buiten de opdracht.

## Verificatie hoort in de taak

- Draai `npm ci` en `npm test` lokaal vóór de push. Rood betekent niet opleveren.
- Raakt de taak een pagina of API-route, controleer dan de preview of live URL en noem wat je gezien hebt.
- Harde gegevens (bedragen, datums, tarieven, wetsartikelen) alleen opnemen als ze tegen de primaire bron zijn gecontroleerd. Ontbreekt die, laat het getal weg en meld dat.
- Een hypothese heet hypothese, wat niet werkt heet kapot, wat niet getest is heet ongetest.

## Rapportvorm

Kort, in deze volgorde, geen herhaling van stappen:

1. Resultaat in één of twee zinnen, met PR-link en of het in main staat.
2. Gecontroleerd: wat is getest of gezien, en hoe (testuitslag, URL).
3. Niet gecontroleerd of open: eerlijk benoemd, met reden.
4. Eventuele beslissing voor Anton, als A of B met advies.

## Vaste afspraken voor dit project

- Principes: zo eenvoudig mogelijk, gebruikers niet opsluiten in beperkte vrijheid, toekomstbestendig (geen breekbare tokens of afhankelijkheden zonder noodzaak).
- Ontwerp, opmaak en inhoudskeuzes: eerst een voorstel of mock-up voorleggen, pas na akkoord bouwen.
- Het regie-logboek staat in `REGIE.md`; werk het bij als de taak daar thuishoort.

## 26 november 2026: één redactietool

- `/redactie` (redactie.html) is het enige beheerscherm, mobiel, drie tabs (Vandaag, Niet geplaatst, Meer). De nieuwsmotor is Nieuwsvoorziening (nieuws.infofrankrijk.com) en publiceert zelf; de beheerder grijpt alleen in.
- Koppeling: `api/redactie-nv.js` (achter de inlog) roept `https://nieuws.infofrankrijk.com/api/redactie` aan met de sleutel uit de omgevingsvariabele `NV_REDACTIE_SECRET` (Vercel-project van nlfr-menu; gelijk aan de CRON_SECRET van Nieuwsvoorziening). Logica en meldingen in `lib/redactie-nv.js`. Ontbreekt de variabele of is de motor onbereikbaar, dan toont het scherm een melding en werken Café Jeudi, PEIL en Bronnen gewoon.
- Café Jeudi aanpassen gaat via `api/redactie-banner.js` (sessie in plaats van BANNER_TOKEN); `/api/banner` blijft ongewijzigd, ook voor het menu.
- Gearchiveerd in `archief/` (niet verwijderd): review.html, regie.html, banner-beheer.html, selectie.html en de vorige redactie.html (`redactie-oud.html`). `/review`, `/regie`, `/banner-beheer`, `/selectie` en `/archief/*` sturen via vercel.json door naar `/redactie` (`/archief` zelf is archief.html en blijft staan). De API's (`api/review.js`, `api/selectie.js`, `api/regie.js`, `api/banner.js`) blijven bestaan: de nieuwe tool en de crons gebruiken ze. Tests die de gearchiveerde HTML lezen wijzen naar `archief/`.
- Niet aanraken: index.html (behalve ADMIN_LINKS), /api/actueel*, /api/banner (lezen), de crons, actueel.html.
