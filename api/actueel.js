// GET /api/actueel — Nederlandstalige nieuwspagina.
// ---------------------------------------------------------------------------
// Hoofdinhoud is NL:
//   1) persSyntheses  — gepubliceerde redactiesyntheses (KV), nieuwste eerst,
//      met versheids-dot als het cluster nog binnen HOT_VENSTER_UREN valt.
//   2) overheid       — NL-samenvattingen (KV, direct live), per thema gegroepeerd.
//   3) verenigingen   — al NL, rechtstreeks uit de live feed.
// De Franse brontitels staan apart (franseKoppen) en worden op de pagina
// standaard ingeklapt getoond ("Alle Franse koppen").
// Cache: stale-while-revalidate op de drie headers (Vercel negeert de standaard).

import { haalAlleItems, haalAgenda } from "../lib/feeds.js";
import { listJSON } from "../lib/store.js";
import {
  FEED_MAX_AGE_S,
  FEED_SWR_S,
  SCAN_PUBLICATIE,
  SCAN_OVERHEID,
  REDACTIE_LABEL,
  HOT_VENSTER_UREN,
  OVERHEID_THEMAS,
  OVERHEID_THEMA_LABEL,
  MAX_FRANSE_KOPPEN_PER_BRON,
  MAX_NIEUWS_LEEFTIJD_DAGEN,
} from "../lib/config.js";

export default async function handler(req, res) {
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

  // Max leeftijd hoofdweergave: niets ouder dan 7 dagen.
  const maxLeeftijd = MAX_NIEUWS_LEEFTIJD_DAGEN * 24 * 60 * 60 * 1000;
  const versGenoeg = (iso) => {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && nu - t <= maxLeeftijd;
  };

  // ---- 1) Gepubliceerde perssyntheses (KV) --------------------------------
  const versGrens = HOT_VENSTER_UREN * 60 * 60 * 1000;
  let persSyntheses = await listJSON(SCAN_PUBLICATIE);
  persSyntheses = persSyntheses
    .filter((p) => p && p.gepubliceerd)
    // Niets ouder dan 7 dagen (op basis van clusterdatum of publicatietijd).
    .filter((p) => versGenoeg(p.clusterLaatste || p.gepubliceerdOp))
    .sort(
      (a, b) => (Date.parse(b.gepubliceerdOp) || 0) - (Date.parse(a.gepubliceerdOp) || 0)
    )
    .map((p) => ({
      id: p.id,
      tekst: p.tekst,
      bronnen: p.bronnen || [],
      label: REDACTIE_LABEL,
      gepubliceerdOp: p.gepubliceerdOp,
      hot: p.clusterLaatste
        ? nu - (Date.parse(p.clusterLaatste) || 0) < versGrens
        : false,
    }));

  // ---- 2) NL-overheidsberichten (KV), per thema ---------------------------
  const overheidDocs = await listJSON(SCAN_OVERHEID);
  const perThemaOverheid = new Map();
  for (const d of overheidDocs) {
    if (!d || !d.samenvatting) continue;
    if (!versGenoeg(d.datum || d.gepubliceerdOp)) continue; // max 7 dagen
    if (!perThemaOverheid.has(d.thema)) perThemaOverheid.set(d.thema, []);
    perThemaOverheid.get(d.thema).push({
      id: d.id,
      samenvatting: d.samenvatting,
      bron: d.bron,
      url: d.url,
      datum: d.datum,
    });
  }
  const overheid = OVERHEID_THEMAS.filter((t) => perThemaOverheid.has(t)).map((t) => ({
    thema: t,
    label: OVERHEID_THEMA_LABEL[t] || t,
    items: perThemaOverheid
      .get(t)
      .sort((a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0)),
  }));

  // ---- 3) Verenigingen-nieuws (al NL) uit de live feed --------------------
  const verenigingen = items
    .filter((i) => i.thema === "verenigingen")
    .filter((i) => versGenoeg(i.datum)) // max 7 dagen
    .sort((a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0))
    .slice(0, 20);

  // ---- Alle Franse koppen (ingeklapt): de bestaande titelfeed -------------
  // Alle brontitels behalve verenigingen (die hebben hun eigen NL-sectie),
  // per thema, chronologisch, met een volume-cap per bron.
  const koppen = items
    .filter((i) => i.thema !== "verenigingen")
    .sort((a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0));
  const bronTeller = new Map();
  const gecapt = koppen.filter((i) => {
    const n = bronTeller.get(i.bron) || 0;
    if (n >= MAX_FRANSE_KOPPEN_PER_BRON) return false;
    bronTeller.set(i.bron, n + 1);
    return true;
  });
  const perThemaKoppen = new Map();
  for (const i of gecapt) {
    if (!perThemaKoppen.has(i.thema)) perThemaKoppen.set(i.thema, []);
    perThemaKoppen.get(i.thema).push({ titel: i.titel, url: i.url, bron: i.bron, datum: i.datum });
  }
  const franseKoppen = [...perThemaKoppen.entries()]
    .map(([thema, lijst]) => ({ thema, items: lijst }))
    .sort((a, b) => a.thema.localeCompare(b.thema));

  const antwoord = {
    bijgewerkt: nuIso,
    persSyntheses,
    overheid,
    verenigingen,
    agenda: agenda || [], // activiteiten komende 14 dagen (verenigingen-repo)
    franseKoppen,
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
