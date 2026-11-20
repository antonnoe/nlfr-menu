# Redactieregels

De regels van de redactie van Nederlanders.fr staan op ÉÉN plek: `lib/redactieregels.js`. Dit document is de leesbare versie; `test/redactieregels.test.mjs` houdt beide gelijk. De prompt van de selectie, /redactie (via /api/selectie), de overheidspoort, de zeven en de tests lezen dat bestand; er is geen tweede lijst. Een nieuwe regel hoort in het bestand en hier.

Alleen regels die al besloten zijn of al in de code stonden. Status: besloten = besluit van de opdrachtgever; code = stond al zo in de code.

## Regels

- **R01** (besloten) Een los krantenbericht (één krant) komt nooit op de nieuwspagina, in de nieuwsbrief of in Infopoche; alleen zijbalk en Infofrankrijk. Herkomst: Huisregel minstens twee kranten (lib/poort.js, README, docs/selectie.md); besluit opdrachtgever.
- **R02** (besloten) Nieuwsbrief en Infopoche volgen de nieuwspagina: ze lezen /api/actueel en kunnen alleen met de nieuwspagina erbij. Herkomst: docs/selectie.md, Vijf plekken per bericht (20-11-2026).
- **R03** (besloten) In de nieuwsbrief staan geen links naar perssites of krantennamen buiten het bronnenblok; persberichten zijn eigen redactionele syntheses. Herkomst: nlfr-nieuwsbrief CLAUDE.md en REGIE.md (besluiten van de opdrachtgever); wordt daar bewaakt, niet in nlfr-menu.
- **R04** (code) Een synthese heeft minstens twee onafhankelijke kranten nodig (MIN_KRANTEN). Herkomst: lib/config.js SYNTHESE_MIN_BRONNEN, lib/poort.js (auteursrecht).
- **R05** (besloten) Een overheidsbericht is alleen live met een modelscore van minstens de drempel (SCORE_DREMPEL, 40) of na plaatsing door de redactie; zonder score of eronder wacht het op /redactie. Zonder poortveld is een bericht niet live. Herkomst: Herstelronde onzichtbare fouten (20-11-2026), besluit opdrachtgever; lib/overheidpoort.js.
- **R06** (besloten) Een bericht dat de redactie met Weg afwees blijft weg (afgewezen-merkteken). Herkomst: Herstelronde onzichtbare fouten (20-11-2026).
- **R07** (besloten) Café Claude alleen bij een kennisdomein: geld, bureaucratie, zorg of wonen; past er geen, dan geen regel. Herkomst: docs/selectie.md, Eén redactiepagina (20-11-2026); lib/selectie/kern.js.
- **R08** (besloten) De vijf plekken zijn nieuwspagina, nieuwsbrief, Infopoche, zijbalk en Infofrankrijk. Herkomst: docs/selectie.md, Vijf plekken per bericht (20-11-2026).
- **R09** (besloten) De rubrieken zijn algemeen nieuws, ondernemersnieuws, reisnieuws, meteo en wet- en regelgeving; de rubriek is nooit verplicht (standaard algemeen, overheid regelgeving, meteo). Herkomst: REGIE.md besluit B2 (7-11-2026); herstelronde onzichtbare fouten.
- **R10** (code) Caribisch Nederland komt nooit live (harde uitsluiting); een Nederlands overheidsbericht moet ook door de relevantiezeef. Herkomst: lib/feeds.js nlOverheidUitgesloten en nlOverheidRelevant (PR 78).
- **R11** (code) De zeven: faits divers, buitenland zonder Frankrijk-link en sport zonder Franse ploeg komen niet door; dit geldt voor de persstroom en nu ook voor de selectiestroom vóór het model. Herkomst: lib/feeds.js (faitsDiversDoorlaat, buitenlandDoorlaat, sportDoorlaat), lib/persmeting.js; selectie: deze ronde.
- **R12** (code) NOS, VRT en NU.nl komen alleen door als het bericht over Frankrijk gaat (Frankrijk-woordenlijst). Herkomst: lib/selectie/bronnen.js, kern.js gaatOverFrankrijk.
- **R13** (code) Per bron hooguit SELECTIE_MAX_PER_BRON nieuwste berichten per ronde naar het model, met uitzonderingen per bron. Herkomst: Opdracht 20-11-2026 (Midi Libre levert 100 per ronde); de getallen zijn een voorstel.
- **R14** (besloten) Een bericht dat alleen op nieuwspagina, nieuwsbrief of Infopoche komt is een go met lege zijbalkkanalen, geen no-go; alleen Weg is een no-go. Herkomst: Herstelronde onzichtbare fouten (20-11-2026).
- **R15** (besloten) Geen ledennamen en geen auteursnamen in de nieuwsbrief. Herkomst: nlfr-nieuwsbrief CLAUDE.md (besluit opdrachtgever); bewaakt in die repo.
- **R16** (besloten) Een artikel staat nooit op twee opeenvolgende dagen in de nieuwsbrief. Herkomst: nlfr-nieuwsbrief CLAUDE.md; bewaakt in die repo.
- **R17** (besloten) Nederlands binnenlands nieuws en bestuur (benoemingen, vacatures, Kamerbrieven, defensie-inzet, binnenlandse regelingen) is alleen relevant als het Nederlanders in Frankrijk of het buitenland raakt (AOW en pensioen, belasting buitenland, zorgverzekering verdragslanden, paspoort, rijbewijs en consulaire zaken, kiezers in het buitenland). De prompt laat zulke berichten onder de drempel scoren en de poort laat een Rijksoverheid-bericht zonder zo'n kenmerk niet live zonder keuze van de redactie. Herkomst: Besluit opdrachtgever 20-11-2026 (Caribisch Nederland en irrelevante Rijksoverheid-berichten).

## De vijf plekken

- Nieuwspagina (`nieuwspagina`): Frankrijknieuws op Nederlanders.fr. Los krantenbericht: mag niet.
- Nieuwsbrief (`nieuwsbrief`): De dagelijkse brief van morgen. Los krantenbericht: mag niet. Volgt de nieuwspagina.
- Infopoche (`infopoche`): De app. Los krantenbericht: mag niet. Volgt de nieuwspagina.
- Zijbalk (`zijbalk`): Het nieuwsblok naast het forum. Los krantenbericht: mag.
- Infofrankrijk (`infofrankrijk`): Het nieuwsblok op Infofrankrijk. Los krantenbericht: mag.

## Rubrieken

- Algemeen nieuws (`algemeen`)
- Ondernemersnieuws (`ondernemers`)
- Reisnieuws (`reizen`)
- Meteo (`meteo`)
- Wet- en regelgeving (`regelgeving`)

## Café Claude

Alleen bij een kennisdomein: geld, bureaucratie, zorg, wonen.

## Waarden

- Drempel (SCORE_DREMPEL): `40`. Eén plek; config.js, prompt, poort, kandidatenfilter en /redactie volgen dit.
- Minimum aantal kranten voor een synthese (MIN_KRANTEN): `2`.
- Selectiestroom: per bron per ronde hooguit `15` nieuwste berichten (SELECTIE_MAX_PER_BRON); uitzonderingen per bron in SELECTIE_MAX_PER_BRON_UITZONDERING (Google News NL en BE: 40, een voorstel).
- Leersignaal: hooguit `25` voorbeelden per soort (go, no-go), eerst de besluiten waarin voorstel en keuze verschilden.
- Meten: de regel op /redactie verschijnt bij minstens `5` besluiten en telt de laatste `7` dagen.

## Zeven, Frankrijk-woordenlijsten en persbronnen

- De zeven (faits divers, sport, buitenland) staan als termlijsten in `lib/config.js` en als functies in `lib/feeds.js`; ze gelden voor de persstroom en sinds 20-11-2026 ook voor de selectiestroom vóór het model (`zeefDoorlaat` in `lib/selectie/kern.js`). De toetsset staat in `test/fixtures/redactie-toetsset.json`.
- De Frankrijk-woordenlijsten (deelwoord en woordbegin) en de persbronnen van de selectie staan in het regelbestand. De twee lijsten zijn niet samengevoegd: ze geven bewust niet dezelfde uitkomst en samenvoegen verandert het gedrag.

## Twijfelgevallen

- R17: de kenmerken van "raakt het buitenland" (`NL_BUITENLAND_RAAKT`) zijn een ruime lijst woordbegins; de IBO-melding over ouderen (20-11) valt er niet onder en blijft een twijfelgeval.
- R03, R15 en R16 worden in nlfr-nieuwsbrief bewaakt, niet in nlfr-menu.
- De getallen bij R13 (15, en 40 voor Google News) zijn een voorstel.
