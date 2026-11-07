// GET /api/selectie-feed — openbare feed van de door de redactie goedgekeurde
// berichten, per categorie, met de PEIL-route naar de tools. Vervangt de
// Feedspot-pinboard die via FeedWind in de NLFR-sidebar stond.
//   ?format=rss  -> RSS 2.0
//   ?status=1    -> alleen tellingen en de laatste ronde (geen inhoud), voor
//                   controle van buitenaf
// Geen persoonsgegevens: wie besliste, gaat er niet in mee.

import { getJSON, listJSON, kvBeschikbaar } from "../lib/store.js";
import { bouwFeed, bouwRss, KEY_SEL_RONDE, SCAN_SEL_BESLUIT, SCAN_SEL_KANDIDAAT } from "../lib/selectie/kern.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  if (!kvBeschikbaar()) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ bijgewerkt: new Date().toISOString(), categorieen: [], storing: "opslag niet beschikbaar" });
  }
  const q = req.query || {};

  if (String(q.status || "") === "1") {
    const [ronde, kandidaten, besluiten] = await Promise.all([
      getJSON(KEY_SEL_RONDE),
      listJSON(SCAN_SEL_KANDIDAAT),
      listJSON(SCAN_SEL_BESLUIT),
    ]);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      kandidaten: kandidaten.length,
      kandidatenMetOordeel: kandidaten.filter((k) => k.ai).length,
      kandidatenMetPeil: kandidaten.filter((k) => k.ai && k.ai.peil && k.ai.peil.length).length,
      besluiten: besluiten.length,
      go: besluiten.filter((b) => b.besluit === "go").length,
      ronde: ronde
        ? {
            op: ronde.op,
            model: ronde.model,
            peil: ronde.peil,
            gevonden: ronde.gevonden,
            nieuw: ronde.nieuw,
            beoordeeld: ronde.beoordeeld,
            opgeslagen: ronde.opgeslagen,
            modelFout: ronde.modelFout,
            bronnen: ronde.bronnen,
            duurMs: ronde.duurMs,
          }
        : null,
    });
  }

  const feed = bouwFeed(await listJSON(SCAN_SEL_BESLUIT));
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  if (String(q.format || "") === "rss") {
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    return res.status(200).send(bouwRss(feed, "https://nlfr-menu.vercel.app/sidebar-nieuws"));
  }
  return res.status(200).json(feed);
}
