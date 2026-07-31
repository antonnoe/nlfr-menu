// Hot-clustering: items van de afgelopen 12 uur clusteren op titelovereenkomst
// (genormaliseerde trefwoorden — geen AI-call per item). Score = aantal
// verschillende bronnen x recency-gewicht. Een cluster met >= HOT_MIN_BRONNEN
// onafhankelijke bronnen is "hot".

import {
  HOT_VENSTER_UREN,
  HOT_MIN_BRONNEN,
} from "./config.js";
import { normaliseer } from "./feeds.js";

// Stopwoorden (FR + NL + EN). Eigennamen (Macron, Parijs, plaatsnamen, getallen)
// blijven staan en dragen het clusteren — die matchen ook tussen talen.
const STOPWOORDEN = new Set([
  "avec","dans","pour","sur","les","des","une","un","le","la","du","de","au","aux",
  "et","en","par","que","qui","est","son","sa","ses","plus","pas","ont","aux","ce",
  "cette","selon","apres","avant","entre","sous","leur","leurs","the","and","for",
  "with","van","het","een","de","der","den","voor","naar","met","aan","door","over",
  "van","dat","die","niet","wordt","zijn","worden","meer","tegen","onder","tussen",
  "wat","hoe","waarom","bij","als","maar","ook","nog","weer","toch","frankrijk",
  "france","franse","frans","parijs","paris",
]);

function tokeniseer(titel) {
  const n = normaliseer(titel);
  const woorden = n.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWOORDEN.has(w));
  return new Set(woorden);
}

function gedeeld(a, b) {
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n;
}

// Twee items horen bij hetzelfde verhaal als ze >= 2 betekenisvolle trefwoorden
// delen. Kort en robuust genoeg voor nieuws-dedup, ook cross-taal via eigennamen.
const MIN_GEDEELD = 2;

// Stabiele, korte hash van een tekst (voor de clustersleutel).
function hash(tekst) {
  let h = 5381;
  for (let i = 0; i < tekst.length; i += 1) {
    h = (h * 33) ^ tekst.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export function clusterItems(items, nu = Date.now()) {
  const grens = nu - HOT_VENSTER_UREN * 60 * 60 * 1000;
  const recent = items.filter((i) => {
    const t = Date.parse(i.datum);
    return !Number.isNaN(t) && t >= grens;
  });

  const clusters = []; // { items:[], tokens:Set, bronnen:Set }
  for (const item of recent) {
    const tokens = tokeniseer(item.titel);
    let doel = null;
    for (const c of clusters) {
      if (gedeeld(tokens, c.tokens) >= MIN_GEDEELD) {
        doel = c;
        break;
      }
    }
    if (!doel) {
      doel = { items: [], tokens: new Set(), bronnen: new Set() };
      clusters.push(doel);
    }
    doel.items.push(item);
    for (const w of tokens) doel.tokens.add(w);
    doel.bronnen.add(item.bron);
  }

  return clusters.map((c) => verrijkCluster(c, nu));
}

function verrijkCluster(c, nu) {
  const laatste = Math.max(...c.items.map((i) => Date.parse(i.datum) || 0));
  const leeftijdUren = (nu - laatste) / (60 * 60 * 1000);
  const recency = Math.max(0, 1 - leeftijdUren / HOT_VENSTER_UREN);
  const aantalBronnen = c.bronnen.size;
  const score = aantalBronnen * (0.4 + 0.6 * recency);

  // Clustersleutel: de vijf meest kenmerkende trefwoorden, gesorteerd, gehasht.
  // Zo krijgt hetzelfde verhaal steeds dezelfde sleutel (dedup van synthese).
  const kern = [...c.tokens].sort().slice(0, 5).join("-");
  const sleutel = hash(kern || String(laatste));

  const items = [...c.items].sort(
    (a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0)
  );

  return {
    sleutel,
    items,
    bronnen: [...c.bronnen],
    aantalBronnen,
    laatste: new Date(laatste).toISOString(),
    recency,
    score,
    hot: aantalBronnen >= HOT_MIN_BRONNEN,
  };
}

// Splits een itemlijst in hot-clusters (boven, gesorteerd op score) en de rest
// (chronologisch per thema, afgehandeld in de API-route).
export function bepaalHot(items, nu = Date.now()) {
  const clusters = clusterItems(items, nu);
  const hot = clusters
    .filter((c) => c.hot)
    .sort((a, b) => b.score - a.score);
  return { clusters, hot };
}
