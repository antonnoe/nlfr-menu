// GET /api/cron — serverless job met TWEE stromen. Draait op Vercel Cron (elke
// 15 min; alleen op productie) en is handmatig aanroepbaar met
// `Authorization: Bearer <CRON_SECRET>`.
// ---------------------------------------------------------------------------
// 1) OVERHEID (Licence Ouverte): elk nieuw item uit de vijf overheidsthema's
//    krijgt een NL-samenvatting (2-4 zinnen) via de Anthropic API en gaat
//    DIRECT live (geen review). Dit garandeert dagelijkse NL-vulling.
// 2) PERS: items eerst door de faits-divers-zeef; daarna clusteren. Een cluster
//    met >= SYNTHESE_MIN_BRONNEN (2) onafhankelijke bronnen krijgt een NL-
//    synthese als CONCEPT (48 u TTL) -> reviewtool -> pas na akkoord live.
// `?force=1` negeert de bronnendrempel voor het best scorende perscluster (max.
// 1), zodat je vóór de merge gegarandeerd één concept kunt testen.

import { haalAlleItems, faitsDiversDoorlaat, hashId } from "../lib/feeds.js";
import { clusterItems } from "../lib/cluster.js";
import { getJSON, setJSON, kvBeschikbaar } from "../lib/store.js";
import { synthetiseer, samenvatOverheid } from "../lib/synthese.js";
import {
  CONCEPT_TTL_S,
  OVERHEID_TTL_S,
  MAX_SYNTHESE_PER_RONDE,
  MAX_OVERHEID_PER_RONDE,
  SYNTHESE_MIN_BRONNEN,
  OVERHEID_THEMAS,
  KEY_CONCEPT,
  KEY_PUBLICATIE,
  KEY_AFGEWEZEN,
  KEY_OVERHEID,
} from "../lib/config.js";

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
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    return res.status(503).json({ ok: false, fout: "CRON_SECRET niet ingesteld." });
  }
  const auth = (req.headers.authorization || "").trim();
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, fout: "Niet geautoriseerd." });
  }
  if (!kvBeschikbaar()) {
    return res.status(503).json({ ok: false, fout: "KV niet geconfigureerd." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ ok: false, fout: "ANTHROPIC_API_KEY ontbreekt." });
  }

  const nu = Date.now();
  const force = leesForce(req);
  const { items } = await haalAlleItems(nu);

  // ---- 1) OVERHEID: nieuwe items -> NL-samenvatting, direct live -----------
  const overheidItems = items.filter((i) => OVERHEID_THEMAS.includes(i.thema));
  const overheidVerwerkt = [];
  let nieuwOverheid = 0;
  for (const item of overheidItems) {
    if (nieuwOverheid >= MAX_OVERHEID_PER_RONDE) break;
    const id = hashId(item.url);
    if (await getJSON(KEY_OVERHEID(id))) {
      overheidVerwerkt.push({ id, status: "overgeslagen" });
      continue;
    }
    try {
      const { samenvatting, model } = await samenvatOverheid(item);
      const doc = {
        id,
        thema: item.thema,
        bron: item.bron,
        url: item.url,
        datum: item.datum,
        titelBron: item.titel, // Franse brontitel (niet getoond, wel bewaard)
        samenvatting, // NL
        model,
        gepubliceerdOp: new Date().toISOString(),
      };
      await setJSON(KEY_OVERHEID(id), doc, OVERHEID_TTL_S);
      nieuwOverheid += 1;
      overheidVerwerkt.push({ id, status: "live", bron: item.bron });
    } catch (e) {
      overheidVerwerkt.push({
        id,
        status: "mislukt",
        reden: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---- 2) PERS: faits-divers-zeef -> clusteren -> concept bij >= 2 bronnen --
  const persItems = items.filter(
    (i) => i.regime === "pers" && faitsDiversDoorlaat(i.titel)
  );
  const clusters = clusterItems(persItems, nu);
  const kandidaten = force
    ? [...clusters].sort((a, b) => b.score - a.score).slice(0, 1)
    : clusters
        .filter((c) => c.aantalBronnen >= SYNTHESE_MIN_BRONNEN)
        .sort((a, b) => b.score - a.score);
  const limiet = force ? 1 : MAX_SYNTHESE_PER_RONDE;

  const persVerwerkt = [];
  let nieuwConcept = 0;
  for (const cluster of kandidaten) {
    if (nieuwConcept >= limiet) break;
    const id = cluster.sleutel;
    const [c1, c2, c3] = await Promise.all([
      getJSON(KEY_CONCEPT(id)),
      getJSON(KEY_PUBLICATIE(id)),
      getJSON(KEY_AFGEWEZEN(id)),
    ]);
    if (c1 || c2 || c3) {
      persVerwerkt.push({ id, status: "overgeslagen" });
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
        clusterLaatste: cluster.laatste, // voor de versheids-dot bij weergave
        aangemaaktOp: new Date().toISOString(),
        gepubliceerd: false,
      };
      await setJSON(KEY_CONCEPT(id), concept, CONCEPT_TTL_S);
      nieuwConcept += 1;
      persVerwerkt.push({ id, status: "concept-aangemaakt", bronnen: cluster.aantalBronnen });
    } catch (e) {
      persVerwerkt.push({
        id,
        status: "mislukt",
        reden: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return res.status(200).json({
    ok: true,
    modus: force ? "force (test)" : "cron",
    tijdstip: new Date(nu).toISOString(),
    totaalItems: items.length,
    overheid: {
      kandidaten: overheidItems.length,
      nieuwLive: nieuwOverheid,
      verwerkt: overheidVerwerkt,
    },
    pers: {
      naZeef: persItems.length,
      clusters: clusters.length,
      geschiktVoorSynthese: clusters.filter((c) => c.aantalBronnen >= SYNTHESE_MIN_BRONNEN).length,
      nieuweConcepten: nieuwConcept,
      verwerkt: persVerwerkt,
    },
  });
}
