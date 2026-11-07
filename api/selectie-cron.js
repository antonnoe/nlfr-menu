// GET /api/selectie-cron — één ronde van de nieuwsselectie (de vervanger van
// Feedspot). Vercel Cron, elk uur op minuut 37, alleen op productie; handmatig
// aanroepbaar met `Authorization: Bearer <CRON_SECRET>`.
// `?diagnose=1` haalt alles op en legt het naast PEIL, maar roept het model
// niet aan en schrijft niets weg. Zie lib/selectie/ronde.js en docs/selectie.md.
//
// Staat los van /api/cron: een storing hier raakt /actueel, de reviewtool en
// de dagelijkse brief niet.

import { kvBeschikbaar } from "../lib/store.js";
import { draaiRonde } from "../lib/selectie/ronde.js";

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return res.status(503).json({ ok: false, fout: "CRON_SECRET niet ingesteld." });
  const auth = (req.headers.authorization || "").trim();
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, fout: "Niet geautoriseerd." });
  if (!kvBeschikbaar()) return res.status(503).json({ ok: false, fout: "KV niet geconfigureerd." });

  const diagnose = String((req.query && req.query.diagnose) || "") === "1";
  if (!diagnose && !process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ ok: false, fout: "ANTHROPIC_API_KEY ontbreekt." });
  }
  try {
    const journaal = await draaiRonde({ diagnose });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, ...journaal });
  } catch (e) {
    console.error(`[selectie] ronde afgebroken: ${e && e.stack ? e.stack : e}`);
    return res.status(500).json({ ok: false, fout: String(e && e.message ? e.message : e).slice(0, 300) });
  }
}
