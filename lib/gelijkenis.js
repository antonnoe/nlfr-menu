// Lijkt dit concept op iets dat er al is?
// ---------------------------------------------------------------------------
// Twee risico's bij het reviewen: (1) twee openstaande concepten gaan over
// hetzelfde verhaal en de redacteur publiceert ze allebei; (2) een concept
// herhaalt een artikel dat al live staat. De cron-dedup vangt het meeste bij het
// AANMAKEN, maar niet alles: een verhaal kan een dag later opnieuw clusteren met
// net andere trefwoorden, en een concept van gisteren kan pas vandaag worden
// beoordeeld.
//
// Deze module signaleert alleen — de redacteur beslist. Vervolgverhalen bij
// doorlopend nieuws (een brand die dagen duurt) zijn volstrekt legitiem; het
// systeem moet het per ongeluk voorkomen, niet het oordeel overnemen.
//
// Twee onafhankelijke signalen:
//   1. woordoverlap op de kern-vingerafdruk (kernTokens uit lib/cluster.js);
//   2. overlap van bron-URL's — harder, want twee syntheses die naar dezelfde
//      artikelen linken gaan over hetzelfde verhaal, hoe anders ook verwoord.
// Drempels staan in lib/config.js, met motivering.

import { kernOverlap, kernUitTekst } from "./cluster.js";
import { urlSleutel } from "./synthese.js";
import {
  LIJKT_OP_JACCARD,
  LIJKT_OP_GEDEELD_MIN,
  LIJKT_OP_URLS_MIN,
} from "./config.js";

// Kern-vingerafdruk van een concept of publicatie. Bij voorkeur de opgeslagen
// kernTokens (die de cron al berekende); anders alsnog uit kop + tekst.
export function kernVan(doc) {
  if (doc && Array.isArray(doc.kernTokens) && doc.kernTokens.length) return doc.kernTokens;
  return kernUitTekst(`${(doc && doc.kop) || ""} ${(doc && doc.tekst) || ""}`);
}

function urlSleutels(doc) {
  const uit = new Set();
  for (const b of (doc && doc.bronnen) || []) {
    const s = urlSleutel(b && b.url);
    if (s) uit.add(s);
  }
  return uit;
}

// Vergelijk twee documenten (concept of publicatie).
export function gelijkenis(a, b) {
  const { gedeeld, jaccard } = kernOverlap(kernVan(a), kernVan(b));
  const ua = urlSleutels(a);
  const ub = urlSleutels(b);
  let gedeeldeUrls = 0;
  for (const u of ua) if (ub.has(u)) gedeeldeUrls += 1;

  const viaUrls = gedeeldeUrls >= LIJKT_OP_URLS_MIN;
  const viaWoorden = jaccard >= LIJKT_OP_JACCARD && gedeeld >= LIJKT_OP_GEDEELD_MIN;
  return {
    jaccard: Number(jaccard.toFixed(2)),
    gedeeld,
    gedeeldeUrls,
    sterk: viaUrls || viaWoorden,
    reden: viaUrls ? "bron-urls" : viaWoorden ? "woordoverlap" : null,
  };
}

// Het sterkst lijkende ANDERE openstaande concept, en het sterkst lijkende
// artikel dat al live staat. Beide null als er niets boven de drempel uitkomt.
export function vindGelijkenis(concept, concepten = [], publicaties = []) {
  const id = concept && concept.id;
  let besteConcept = null;
  for (const c of concepten) {
    if (!c || c.id === id) continue;
    const g = gelijkenis(concept, c);
    if (!g.sterk) continue;
    if (!besteConcept || g.jaccard > besteConcept.jaccard || g.gedeeldeUrls > besteConcept.gedeeldeUrls) {
      besteConcept = { ...g, id: c.id, kop: c.kop || "", aangemaaktOp: c.aangemaaktOp || null };
    }
  }
  let bestePublicatie = null;
  for (const p of publicaties) {
    if (!p) continue;
    const g = gelijkenis(concept, p);
    if (!g.sterk) continue;
    if (!bestePublicatie || g.jaccard > bestePublicatie.jaccard || g.gedeeldeUrls > bestePublicatie.gedeeldeUrls) {
      bestePublicatie = { ...g, id: p.id, kop: p.kop || "", gepubliceerdOp: p.gepubliceerdOp || null };
    }
  }
  return { concept: besteConcept, publicatie: bestePublicatie };
}
