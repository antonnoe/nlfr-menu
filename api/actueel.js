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

// Zelfde allowlist-model als antonnoe/nlfr-berichten (api/berichten.js e.a.):
// eigen domeinen met naam, plus de eigen *.vercel.app-previews/deploys.
const TOEGESTAAN = [
  "https://www.nederlanders.fr",
  "https://nederlanders.fr",
  "https://cafeclaude.fr",
  "https://www.cafeclaude.fr",
  "https://infofrankrijk.com",
  "https://www.infofrankrijk.com",
  "https://nedergids.nl",
  "https://www.nedergids.nl",
];

function cors(req, res) {
  const o = req.headers.origin;
  if (o && (TOEGESTAAN.includes(o) || /^https:\/\/[a-z0-9-]+\.(vercel\.app|claudeusercontent\.com)$/i.test(o))) {
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
