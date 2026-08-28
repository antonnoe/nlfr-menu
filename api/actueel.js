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
// Cache: stale-while-revalidate op de drie headers.
//
// HOE HET ANTWOORD TOT STAND KOMT (sinds de cache-miss-ingreep). Deze route
// stelt het antwoord NIET meer standaard zelf samen. De cron bakt elke 15
// minuten het volledige object voor onder actueel:snapshot:v1; hier wordt dat
// alleen gelezen (één KV-round-trip). Ontbreekt de snapshot of is hij ouder dan
// SNAPSHOT_MAX_LEEFTIJD_S, dan stelt de route hem alsnog zelf samen — via
// dezelfde bouwAntwoord() als de cron, dus functioneel identiek aan het oude
// gedrag — en schrijft het resultaat weg als nieuwe snapshot.
// Bewust GEEN lock bij gelijktijdige missers: twee keer bakken mag.

import { bouwAntwoord, snapshotBruikbaar } from "../lib/antwoord.js";
import { getJSON, setJSON } from "../lib/store.js";
import {
  FEED_MAX_AGE_S,
  FEED_SWR_S,
  BROWSER_MAX_AGE_S,
  KEY_ACTUEEL_SNAPSHOT,
  SNAPSHOT_TTL_S,
} from "../lib/config.js";

// Allowlist-model van antonnoe/nlfr-berichten (api/berichten.js e.a.), maar dan
// mét subdomeinen: IF-Mobiel wordt als iframe ingebed en stuurt straks
// mobiel.nederlanders.fr als Origin mee (bij een fetch uit een iframe is de
// Origin die van de iframe zelf, niet die van de omliggende pagina). Een vaste
// lijst met alleen de kale en www-vorm zou daar opnieuw op stuklopen.
const EIGEN_DOMEINEN = [
  "nederlanders.fr",
  "cafeclaude.fr",
  "infofrankrijk.com",
  "nedergids.nl",
];

// Eigen deploys/previews: alléén als subdomein, nooit het kale platformdomein.
const EIGEN_DEPLOYS = ["vercel.app", "claudeusercontent.com"];

function toegestaan(origin) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  // De punt in "." + d is wat telt: zo matcht kwaadnederlanders.fr niet mee.
  return EIGEN_DOMEINEN.some((d) => h === d || h.endsWith("." + d))
      || EIGEN_DEPLOYS.some((d) => h.endsWith("." + d));
}

function cors(req, res) {
  const o = req.headers.origin;
  if (o && toegestaan(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const nu = Date.now();

  // 1) Voorgebakken antwoord. getJSON() slikt zowel "geen KV geconfigureerd"
  //    als een KV-storing en geeft dan null — precies de graceful degradation
  //    die deze route altijd al had.
  const snapshot = await getJSON(KEY_ACTUEEL_SNAPSHOT);
  let antwoord = null;
  let herkomst = "snapshot";

  if (snapshotBruikbaar(snapshot, nu)) {
    antwoord = snapshot;
  } else {
    // 2) Terugval: zelf samenstellen (live feeds + KV), zoals voorheen.
    herkomst = snapshot ? "vers-verouderd" : "vers-ontbrekend";
    antwoord = await bouwAntwoord({ nu });
    // En meteen wegschrijven, zodat de volgende bezoeker hem wél voorgebakken
    // krijgt. Mislukt dat (geen KV, storing), dan antwoorden we gewoon door.
    try {
      await setJSON(KEY_ACTUEEL_SNAPSHOT, antwoord, SNAPSHOT_TTL_S);
    } catch {
      herkomst += "-nietbewaard";
    }
  }

  // Diagnose bij het meten: kwam dit antwoord uit de snapshot of is het ter
  // plekke gebakken? Verandert niets aan de inhoud van de pagina.
  res.setHeader("X-Actueel-Herkomst", herkomst);

  const swr = `public, s-maxage=${FEED_MAX_AGE_S}, stale-while-revalidate=${FEED_SWR_S}`;
  res.setHeader(
    "Cache-Control",
    `public, max-age=${BROWSER_MAX_AGE_S}, s-maxage=${FEED_MAX_AGE_S}, stale-while-revalidate=${FEED_SWR_S}`
  );
  res.setHeader("CDN-Cache-Control", swr);
  res.setHeader("Vercel-CDN-Cache-Control", swr);
  res.status(200).json(antwoord);
}
