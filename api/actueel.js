// GET /api/actueel — geaggregeerde live feed.
// ---------------------------------------------------------------------------
// - Haalt alle actieve bronnen op, parseert en normaliseert ze (lib/feeds).
// - Bepaalt hot-clusters (>= 3 onafhankelijke bronnen) via lib/cluster.
// - Leest gepubliceerde syntheses uit KV en zet die bovenaan.
// - Overige items chronologisch per thema.
// Cache: stale-while-revalidate. We zetten Cache-Control ÉN CDN-Cache-Control
// ÉN Vercel-CDN-Cache-Control, omdat Vercel de standaardheader voor edge-cache
// negeert.

import { haalAlleItems } from "../lib/feeds.js";
import { bepaalHot } from "../lib/cluster.js";
import { listJSON } from "../lib/store.js";
import {
  FEED_MAX_AGE_S,
  FEED_SWR_S,
  SCAN_PUBLICATIE,
  REDACTIE_LABEL,
} from "../lib/config.js";

export default async function handler(req, res) {
  const nu = Date.now();
  const nuIso = new Date(nu).toISOString();

  let items = [];
  let bronStatus = [];
  try {
    ({ items, bronStatus } = await haalAlleItems(nu));
  } catch (e) {
    // Zelfs als het aggregeren volledig faalt, geven we een leeg-maar-geldig
    // antwoord terug zodat de pagina niet breekt.
    items = [];
    bronStatus = [];
  }

  const { hot } = bepaalHot(items, nu);

  // Hot-items niet nog eens in de "overige" lijst tonen.
  const hotUrls = new Set(hot.flatMap((c) => c.items.map((i) => i.url)));
  const overige = items.filter((i) => !hotUrls.has(i.url));

  // Overige chronologisch per thema.
  const perThema = new Map();
  for (const item of overige) {
    if (!perThema.has(item.thema)) perThema.set(item.thema, []);
    perThema.get(item.thema).push(item);
  }
  const themas = [...perThema.entries()]
    .map(([thema, lijst]) => ({
      thema,
      items: lijst.sort(
        (a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0)
      ),
    }))
    .sort((a, b) => a.thema.localeCompare(b.thema));

  // Gepubliceerde syntheses (bovenaan). Nieuwste eerst.
  let publicaties = await listJSON(SCAN_PUBLICATIE);
  publicaties = publicaties
    .filter((p) => p && p.gepubliceerd)
    .sort(
      (a, b) =>
        (Date.parse(b.gepubliceerdOp) || 0) - (Date.parse(a.gepubliceerdOp) || 0)
    )
    .map((p) => ({
      id: p.id,
      tekst: p.tekst,
      bronnen: p.bronnen || [],
      label: REDACTIE_LABEL,
      gepubliceerdOp: p.gepubliceerdOp,
    }));

  const antwoord = {
    bijgewerkt: nuIso,
    publicaties,
    hot: hot.map((c) => ({
      sleutel: c.sleutel,
      aantalBronnen: c.aantalBronnen,
      bronnen: c.bronnen,
      laatste: c.laatste,
      items: c.items,
    })),
    themas,
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
