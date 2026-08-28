// GET /api/actueel — Nederlandstalige nieuwspagina, opgebouwd uit THEMA-TEGELS.
// ---------------------------------------------------------------------------
// Alles is NL tot de laatste stap. Elke tegel is thematisch en klapt uit:
//   tegel (bullets) -> artikelen (titel + summary) -> volledige NL-tekst ->
//   "Bronnen" (pers: de Franse originelen; overige: de ene eigen/overheidsbron).
// Tegels (in volgorde):
//   1) pers   — gepubliceerde redactiesyntheses (KV), gegroepeerd tot
//               bosbranden / landelijk / regionaal.
//   2) overheid — NL-samenvattingen (KV, direct live), per thema, één bron elk.
//   3) infofrankrijk — eigen publicatie (live feed): titel + summary + link.
//   4) verenigingen — NL-verenigingsnieuws (live feed).
// Daarnaast los: agenda (komende 2 weken) en de bron-statusbalk.
//
// DEZE ROUTE IS DE COMPACTE LEVERING. Per artikel ontbreken `tekst` en de
// volledige `bronnen`-array; daarvoor in de plaats staan `bronMeta` (naam en
// datum van de eerste bron, de onderregel) en `bronAantal` (het getal op de
// knop "Bronnen (n)"). De rest haalt de pagina bij /api/actueel-tekst. Zie
// lib/levering.js voor het waarom en de precieze vorm.
//
// HOE HET ANTWOORD TOT STAND KOMT. De cron bakt elke 15 minuten beide
// leveringen voor; hier wordt de compacte alleen gelezen (één KV-round-trip).
// Ontbreekt de snapshot of is hij ouder dan SNAPSHOT_MAX_LEEFTIJD_S, dan stelt
// de route het volledige antwoord alsnog zelf samen, splitst het, schrijft
// BEIDE leveringen weg en antwoordt met de compacte helft. Bewust geen lock bij
// gelijktijdige missers: twee keer bakken mag. Zie lib/lever.js.

import { lever } from "../lib/lever.js";

export default async function handler(req, res) {
  return lever(req, res, "compact");
}
