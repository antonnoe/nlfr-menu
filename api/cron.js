// GET /api/cron — serverless job die hot-clusters detecteert en er AI-syntheses
// (concepten) voor schrijft. Wordt door Vercel Cron aangeroepen (schema in
// vercel.json) — Vercel Cron draait ALLEEN op de productie-deployment.
// Handmatig aanroepen kan altijd met `Authorization: Bearer <CRON_SECRET>`,
// op elke deployment. Met `?force=1` negeert de run de >=3-bronnendrempel en
// synthetiseert hij het best scorende cluster (max. 1), zodat je vóór de merge
// gegarandeerd één concept krijgt om de Publiceer/Weg-knoppen te testen.
// ---------------------------------------------------------------------------
// Trigger: een cluster met >= HOT_MIN_BRONNEN bronnen dat nog geen concept,
// publicatie of afwijzing heeft -> synthese schrijven en als CONCEPT opslaan
// (48 u TTL). Nooit direct live. Per ronde hooguit MAX_SYNTHESE_PER_RONDE nieuwe
// syntheses, om kosten en functietijd te begrenzen.

import { haalAlleItems } from "../lib/feeds.js";
import { bepaalHot } from "../lib/cluster.js";
import { getJSON, setJSON, kvBeschikbaar } from "../lib/store.js";
import { synthetiseer } from "../lib/synthese.js";
import {
  CONCEPT_TTL_S,
  MAX_SYNTHESE_PER_RONDE,
  KEY_CONCEPT,
  KEY_PUBLICATIE,
  KEY_AFGEWEZEN,
} from "../lib/config.js";

// Leest ?force=... robuust (req.query kan in de runtime leeg zijn).
function leesForce(req) {
  let f = req && req.query ? req.query.force : undefined;
  if (!f && req && req.url) {
    try {
      f = new URL(req.url, "http://localhost").searchParams.get("force");
    } catch {
      f = null;
    }
  }
  return /^(1|true|ja|yes)$/i.test(String(f || "").trim());
}

export default async function handler(req, res) {
  // --- Toegang (secret getrimd, zelfde robuustheid als de reviewtool) ---
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    return res
      .status(503)
      .json({ ok: false, fout: "CRON_SECRET niet ingesteld." });
  }
  const auth = (req.headers.authorization || "").trim();
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, fout: "Niet geautoriseerd." });
  }
  if (!kvBeschikbaar()) {
    return res
      .status(503)
      .json({ ok: false, fout: "KV niet geconfigureerd (opslag ontbreekt)." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res
      .status(503)
      .json({ ok: false, fout: "ANTHROPIC_API_KEY ontbreekt." });
  }

  const nu = Date.now();
  const { items } = await haalAlleItems(nu);
  const { clusters, hot } = bepaalHot(items, nu);

  // Normaal: alleen echte hot-clusters (>= 3 bronnen). Met ?force=1 (handmatige
  // test): het best scorende cluster ongeacht bronaantal, zodat je gegarandeerd
  // één concept krijgt om de Publiceer/Weg-knoppen mee te testen.
  const force = leesForce(req);
  const kandidaten = force
    ? [...clusters].sort((a, b) => b.score - a.score)
    : hot;
  const limiet = force ? 1 : MAX_SYNTHESE_PER_RONDE;

  const verwerkt = [];
  let nieuw = 0;

  for (const cluster of kandidaten) {
    if (nieuw >= limiet) break;
    const id = cluster.sleutel;

    // Al een concept, publicatie of afwijzing? Dan overslaan (dedup).
    const [bestaatConcept, bestaatPub, afgewezen] = await Promise.all([
      getJSON(KEY_CONCEPT(id)),
      getJSON(KEY_PUBLICATIE(id)),
      getJSON(KEY_AFGEWEZEN(id)),
    ]);
    if (bestaatConcept || bestaatPub || afgewezen) {
      verwerkt.push({ id, status: "overgeslagen" });
      continue;
    }

    try {
      const synth = await synthetiseer(cluster);
      const concept = {
        id,
        sleutel: id,
        tekst: synth.tekst,
        bronnen: synth.bronnen,
        model: synth.model,
        aantalBronnen: cluster.aantalBronnen,
        aangemaaktOp: new Date().toISOString(),
        gepubliceerd: false,
      };
      await setJSON(KEY_CONCEPT(id), concept, CONCEPT_TTL_S);
      nieuw += 1;
      verwerkt.push({ id, status: "concept-aangemaakt" });
    } catch (e) {
      verwerkt.push({
        id,
        status: "mislukt",
        reden: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return res.status(200).json({
    ok: true,
    modus: force ? "force (test: negeert de >=3-drempel)" : "cron",
    tijdstip: new Date(nu).toISOString(),
    totaalItems: items.length,
    totaalClusters: clusters.length,
    hotClusters: hot.length,
    nieuweConcepten: nieuw,
    verwerkt,
  });
}
