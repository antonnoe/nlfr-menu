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

import { haalAlleItems, haalAgenda } from "../lib/feeds.js";
import { listJSON } from "../lib/store.js";
import { assembleerTegels } from "../lib/tegels.js";
import {
  FEED_MAX_AGE_S,
  FEED_SWR_S,
  SCAN_PUBLICATIE,
  SCAN_OVERHEID,
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
  const nuIso = new Date(nu).toISOString();

  let items = [];
  let bronStatus = [];
  let agenda = [];
  try {
    [{ items, bronStatus }, { items: agenda }] = await Promise.all([
      haalAlleItems(nu),
      haalAgenda(nu),
    ]);
  } catch {
    items = [];
    bronStatus = [];
    agenda = [];
  }

  // Opgeslagen NL-content ophalen (graceful: zonder KV blijft de rest werken).
  let publicaties = [];
  let overheidDocs = [];
  try {
    [publicaties, overheidDocs] = await Promise.all([
      listJSON(SCAN_PUBLICATIE),
      listJSON(SCAN_OVERHEID),
    ]);
  } catch {
    publicaties = [];
    overheidDocs = [];
  }

  const tegels = assembleerTegels({ publicaties, overheidDocs, items, nu });

  const antwoord = {
    bijgewerkt: nuIso,
    tegels,
    agenda: agenda || [], // activiteiten komende 14 dagen (verenigingen-repo)
    bronStatus,
  };

  const swr = `public, s-maxage=${FEED_MAX_AGE_S}, stale-while-revalidate=${FEED_SWR_S}`;
  res.setHeader(
    "Cache-Control",
    `public, max-age=60, s-maxage=${FEED_MAX_AGE_S}, stale-while-revalidate=${FEED_SWR_S}`
  );
  res.setHeader("CDN-Cache-Control", swr);
  res.setHeader("Vercel-CDN-Cache-Control", swr);
  res.status(200).json(antwoord);
}
