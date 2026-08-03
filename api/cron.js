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

import { haalAlleItems, faitsDiversDoorlaat, buitenlandDoorlaatNL, hashId } from "../lib/feeds.js";
import { clusterItems, zelfdeVerhaal } from "../lib/cluster.js";
import { getJSON, setJSON, del, listJSON, kvBeschikbaar } from "../lib/store.js";
import { synthetiseer, samenvatOverheid } from "../lib/synthese.js";
import {
  CONCEPT_TTL_S,
  OVERHEID_TTL_S,
  MAX_SYNTHESE_PER_RONDE,
  MAX_OVERHEID_PER_RONDE,
  MAX_OPENSTAANDE_CONCEPTEN,
  SYNTHESE_MIN_BRONNEN,
  OVERHEID_THEMAS,
  KEY_CONCEPT,
  KEY_PUBLICATIE,
  KEY_AFGEWEZEN,
  KEY_OVERHEID,
  SCAN_CONCEPT,
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
      const { kop, samenvatting, model } = await samenvatOverheid(item);
      const doc = {
        id,
        thema: item.thema,
        bron: item.bron,
        url: item.url,
        datum: item.datum,
        titelBron: item.titel, // Franse brontitel (niet getoond, wel bewaard)
        kop, // NL-kop voor de artikelweergave
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
  // Synthese-drempel (auteursrechtelijk hard): een verhaal moet door minstens
  // SYNTHESE_MIN_BRONNEN VERSCHILLENDE kranten zijn gebracht (aantalBronnen), én
  // door evenveel ONAFHANKELIJKE (niet-wire-copy) berichten (onafhankelijkeBronnen).
  //   - aantalBronnen >= 2  -> niet uit één krant (twee artikelen van Le Figaro
  //     over hetzelfde onderwerp tellen NIET als bevestiging).
  //   - onafhankelijkeBronnen >= 2 -> twee kranten die exact dezelfde wire
  //     overnemen tellen samen als één (geen schijnbevestiging).
  const geschiktVoorSynthese = (c) =>
    c.aantalBronnen >= SYNTHESE_MIN_BRONNEN &&
    c.onafhankelijkeBronnen >= SYNTHESE_MIN_BRONNEN;
  // Prioriteit zit al in cluster.score verwerkt (boost), dus sorteren op score
  // brengt belangrijk nieuws vanzelf bovenaan.
  const kandidaten = force
    ? [...clusters].sort((a, b) => b.score - a.score).slice(0, 1)
    : clusters.filter(geschiktVoorSynthese).sort((a, b) => b.score - a.score);

  // Auto-prune: snoei de conceptenberg elke ronde terug tot MAX_OPENSTAANDE_
  // CONCEPTEN. Behoud de BESTE (score = bronnen × recency × prioriteitsboost) en
  // altijd de handmatig bewerkte concepten; gooi de rest weg. Zo blijft de
  // reviewlijst behapbaar zonder belangrijk nieuws te verliezen.
  const CONCEPT_MS = CONCEPT_TTL_S * 1000;
  const pruneScore = (c) => {
    const basis = c.onafhankelijkeBronnen || c.aantalBronnen || 1;
    const t = Date.parse(c.clusterLaatste || c.aangemaaktOp) || 0;
    const rec = Math.max(0, 1 - (nu - t) / CONCEPT_MS);
    return basis * (0.4 + 0.6 * rec) * (c.prioriteit ? 2 : 1);
  };
  let bestaande = await listJSON(SCAN_CONCEPT);
  let gesnoeid = 0;
  if (!force && bestaande.length > MAX_OPENSTAANDE_CONCEPTEN) {
    const gesorteerd = [...bestaande].sort((a, b) => {
      const ea = a.bewerktOp ? 1 : 0;
      const eb = b.bewerktOp ? 1 : 0;
      if (ea !== eb) return eb - ea; // bewerkte concepten altijd behouden
      return pruneScore(b) - pruneScore(a);
    });
    const weg = gesorteerd.slice(MAX_OPENSTAANDE_CONCEPTEN);
    for (const c of weg) if (c && c.id) await del(KEY_CONCEPT(c.id));
    bestaande = gesorteerd.slice(0, MAX_OPENSTAANDE_CONCEPTEN);
    gesnoeid = weg.length;
  }

  // Vingerafdrukken van de overgebleven concepten, voor dedup over rondes heen.
  const bestaandeKernen = bestaande.map((c) => c.kernTokens).filter(Boolean);

  const openstaand = bestaande.length;
  const ruimte = Math.max(0, MAX_OPENSTAANDE_CONCEPTEN - openstaand);
  const limiet = force ? 1 : Math.min(MAX_SYNTHESE_PER_RONDE, ruimte);

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
    // "Laatste productie wint": betreft dit cluster hetzelfde verhaal als een
    // bestaand concept (ook al is de sleutel gedrift)? Dan geen tweede concept.
    if (bestaandeKernen.some((k) => zelfdeVerhaal(cluster.kernTokens, k))) {
      persVerwerkt.push({ id, status: "duplicaat-overgeslagen" });
      continue;
    }
    // Buitenland-zeef vóór de synthese (bespaart een API-call): clusters waarvan
    // de gezamenlijke brontitels het buitenland betreffen zonder Frankrijk-link.
    const koppenBlob = cluster.items.map((i) => i.titel || "").join(" · ");
    if (!buitenlandDoorlaatNL(koppenBlob)) {
      await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString(), reden: "buitenland" }, CONCEPT_TTL_S);
      persVerwerkt.push({ id, status: "buitenland-geweigerd" });
      continue;
    }
    try {
      const synth = await synthetiseer(cluster);
      // Tweede laag: de NL-synthese kan een land noemen dat in de Franse titels
      // ontbrak. Dan geen concept, en onthouden als afwijzing (geen regeneratie).
      if (!buitenlandDoorlaatNL(`${synth.kop || ""} ${synth.tekst || ""}`)) {
        await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString(), reden: "buitenland" }, CONCEPT_TTL_S);
        persVerwerkt.push({ id, status: "buitenland-geweigerd" });
        continue;
      }
      const concept = {
        id,
        sleutel: id,
        kop: synth.kop, // korte NL-kop voor de artikelweergave
        tekst: synth.tekst,
        bronnen: synth.bronnen,
        model: synth.model,
        aantalBronnen: cluster.aantalBronnen,
        onafhankelijkeBronnen: cluster.onafhankelijkeBronnen, // voor prune-score
        prioriteit: cluster.prioriteit, // prune-bescherming + markering
        kernTokens: cluster.kernTokens, // vingerafdruk voor cross-ronde dedup
        clusterLaatste: cluster.laatste, // voor de versheids-dot bij weergave
        aangemaaktOp: new Date().toISOString(),
        gepubliceerd: false,
      };
      await setJSON(KEY_CONCEPT(id), concept, CONCEPT_TTL_S);
      bestaandeKernen.push(cluster.kernTokens); // volgende kandidaten dedupen hiertegen
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
      geschiktVoorSynthese: clusters.filter(geschiktVoorSynthese).length,
      openstaandeConcepten: openstaand,
      gesnoeid,
      ruimteVoorNieuwe: force ? "force" : ruimte,
      nieuweConcepten: nieuwConcept,
      verwerkt: persVerwerkt,
    },
  });
}
