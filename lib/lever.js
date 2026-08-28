// De routemechaniek die /api/actueel, /api/actueel-tekst en /api/actueel-archief delen.
// ---------------------------------------------------------------------------
// De drie routes doen exact hetzelfde, alleen met een ander deel van het
// antwoord: CORS afhandelen, de voorgebakken levering uit KV lezen, en bij een
// ontbrekende of verouderde snapshot het volledige antwoord alsnog samenstellen
// (live feeds + KV), splitsen, ALLE DRIE de leveringen wegschrijven en het
// gevraagde deel antwoorden. Dat "alle drie wegschrijven" is bewust: wie de ene
// route mist, warmt meteen ook de andere twee op, zodat die de feeds niet nóg
// een keer hoeven op te halen — én de drie dragen dan hetzelfde bakmoment.
//
// Eén module, zodat de cacheheaders en het terugvalgedrag van de drie routes
// niet uit elkaar kunnen lopen.

import { bouwAntwoord, snapshotBruikbaar } from "./antwoord.js";
import { splitsAntwoord } from "./levering.js";
import { getJSON, setJSON } from "./store.js";
import {
  FEED_MAX_AGE_S,
  FEED_SWR_S,
  BROWSER_MAX_AGE_S,
  KEY_ACTUEEL_SNAPSHOT,
  KEY_ACTUEEL_TEKST_SNAPSHOT,
  KEY_ACTUEEL_ARCHIEF_SNAPSHOT,
  SNAPSHOT_TTL_S,
} from "./config.js";

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

export function toegestaan(origin) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  // De punt in "." + d is wat telt: zo matcht kwaadnederlanders.fr niet mee.
  return EIGEN_DOMEINEN.some((d) => h === d || h.endsWith("." + d))
      || EIGEN_DEPLOYS.some((d) => h.endsWith("." + d));
}

export function cors(req, res) {
  const o = req.headers.origin;
  if (o && toegestaan(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

// De tekst- en archieflevering hebben geen `tegels`, dus de vormtoets van
// snapshotBruikbaar past er niet op. Voor de leeftijdstoets doet hij dat wél;
// daarom krijgt hij hier een object mee dat aan de vormeis voldoet.
function leeftijdBruikbaar(snapshot, nu) {
  return snapshotBruikbaar({ ...snapshot, tegels: [] }, nu);
}
function tekstSnapshotBruikbaar(snapshot, nu) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (!snapshot.artikelen || typeof snapshot.artikelen !== "object") return false;
  return leeftijdBruikbaar(snapshot, nu);
}
function archiefSnapshotBruikbaar(snapshot, nu) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (!Array.isArray(snapshot.artikelen)) return false;
  if (!snapshot.teksten || typeof snapshot.teksten !== "object") return false;
  return leeftijdBruikbaar(snapshot, nu);
}

const SOORTEN = {
  compact: {
    sleutel: KEY_ACTUEEL_SNAPSHOT,
    bruikbaar: snapshotBruikbaar,
    kies: (leveringen) => leveringen.compact,
  },
  tekst: {
    sleutel: KEY_ACTUEEL_TEKST_SNAPSHOT,
    bruikbaar: tekstSnapshotBruikbaar,
    kies: (leveringen) => leveringen.tekst,
  },
  archief: {
    sleutel: KEY_ACTUEEL_ARCHIEF_SNAPSHOT,
    bruikbaar: archiefSnapshotBruikbaar,
    kies: (leveringen) => leveringen.archief,
  },
};

// Handelt één verzoek af. `soort` is "compact", "tekst" of "archief".
export async function lever(req, res, soort) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const { sleutel, bruikbaar, kies } = SOORTEN[soort];
  const nu = Date.now();

  // 1) Voorgebakken levering. getJSON() slikt zowel "geen KV geconfigureerd"
  //    als een KV-storing en geeft dan null — de graceful degradation die deze
  //    routes altijd al hadden.
  const snapshot = await getJSON(sleutel);
  let antwoord = null;
  let herkomst = "snapshot";

  if (bruikbaar(snapshot, nu)) {
    antwoord = snapshot;
  } else {
    // 2) Terugval: het volledige antwoord zelf samenstellen en splitsen.
    herkomst = snapshot ? "vers-verouderd" : "vers-ontbrekend";
    const leveringen = splitsAntwoord(await bouwAntwoord({ nu }));
    antwoord = kies(leveringen);
    // Alle drie wegschrijven: de andere routes hebben dan niets meer te doen,
    // en de drie leveringen dragen hetzelfde bakmoment.
    try {
      await setJSON(KEY_ACTUEEL_SNAPSHOT, leveringen.compact, SNAPSHOT_TTL_S);
      await setJSON(KEY_ACTUEEL_TEKST_SNAPSHOT, leveringen.tekst, SNAPSHOT_TTL_S);
      await setJSON(KEY_ACTUEEL_ARCHIEF_SNAPSHOT, leveringen.archief, SNAPSHOT_TTL_S);
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
  return res.status(200).json(antwoord);
}
