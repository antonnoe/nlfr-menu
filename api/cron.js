// GET /api/cron — serverless job die hot-clusters detecteert en er AI-syntheses
// (concepten) voor schrijft. Wordt door Vercel Cron aangeroepen (schema in
// vercel.json). Ook handmatig aan te roepen met de juiste Authorization-header,
// handig om te testen.
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

export default async function handler(req, res) {
  // --- Toegang ---
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res
      .status(503)
      .json({ ok: false, fout: "CRON_SECRET niet ingesteld." });
  }
  const auth = req.headers.authorization || "";
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
  const { hot } = bepaalHot(items, nu);

  const verwerkt = [];
  let nieuw = 0;

  for (const cluster of hot) {
    if (nieuw >= MAX_SYNTHESE_PER_RONDE) break;
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
    tijdstip: new Date(nu).toISOString(),
    hotClusters: hot.length,
    nieuweConcepten: nieuw,
    verwerkt,
  });
}
