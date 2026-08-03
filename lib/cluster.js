// Hot-clustering: items van de afgelopen 12 uur clusteren op titelovereenkomst
// (genormaliseerde trefwoorden — geen AI-call per item). Score = aantal
// verschillende bronnen x recency-gewicht. Een cluster met >= HOT_MIN_BRONNEN
// onafhankelijke bronnen is "hot".

import {
  HOT_VENSTER_UREN,
  HOT_MIN_BRONNEN,
  MIN_SPECIFIEK_GEDEELD,
  MAX_PER_BRON_CLUSTER,
  PRIORITEIT_WOORDEN,
  DEDUP_GEDEELD_MIN,
  DEDUP_JACCARD_MIN,
  WIRE_TITEL_JACCARD,
  WIRE_ONDERLING_JACCARD,
  PERSBUREAU_MARKERS,
} from "./config.js";
import { normaliseer } from "./feeds.js";

// Is dit een prioriteitsonderwerp (hoog-impact nieuws)? Toets op de brontitels.
function isPrioriteit(items) {
  return items.some((i) => {
    const n = normaliseer(i.titel);
    return PRIORITEIT_WOORDEN.some((w) => n.includes(w));
  });
}

// Dedup over cron-rondes heen: betreft dit cluster hetzelfde verhaal als een
// eerder opgeslagen concept? Vergelijkt de kern-trefwoorden (FR). Bewust streng:
// zowel genoeg gedeelde betekenisvolle termen ALS voldoende titeloverlap.
export function zelfdeVerhaal(kernA, kernB) {
  const a = new Set(kernA || []);
  const b = new Set(kernB || []);
  if (!a.size || !b.size) return false;
  if (gedeeldSpecifiek(a, b) < DEDUP_GEDEELD_MIN) return false;
  return jaccard(a, b) >= DEDUP_JACCARD_MIN;
}

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

// Generieke nieuwstermen: komen in veel losse verhalen voor ("EN DIRECT",
// "incendie", "mort", ...). Ze tellen NIET mee als betekenisvolle overlap; alleen
// specifieke termen (plaatsnamen, eigennamen, kenmerkende woorden) doen dat.
// Zo belandt een lawine in Pakistan niet in een Ceuta-cluster op "direct"/"mort".
const GENERIEK = new Set([
  "direct", "live", "urgent", "alerte", "alertes", "info", "infos", "actu",
  "video", "videos", "photo", "photos", "image", "images", "carte", "cartes",
  "mort", "morts", "morte", "tue", "tues", "tuee", "blesse", "blesses",
  "victime", "victimes", "suivez", "suivi", "point", "edito", "analyse",
  "reactions", "communique", "communiques", "incendie", "incendies",
  "feux", "accident", "accidents", "drame", "sinistre", "sinistres",
  "attaque", "explosion", "nieuws", "update", "breaking",
]);

function tokeniseer(titel) {
  const n = normaliseer(titel);
  const woorden = n.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWOORDEN.has(w));
  return new Set(woorden);
}

// Aantal gedeelde BETEKENISVOLLE (niet-generieke) termen tussen een item en een
// cluster. Generieke termen tellen bewust niet mee.
function gedeeldSpecifiek(tokens, clusterTokens) {
  let n = 0;
  for (const w of tokens) {
    if (clusterTokens.has(w) && !GENERIEK.has(w)) n += 1;
  }
  return n;
}

// Jaccard-overeenkomst tussen twee token-sets.
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// ---- Onafhankelijkheid ------------------------------------------------------
// Outlet-identiteit uit een bronnaam. De namen in bronnen.json dragen vaak een
// rubrieksuffix ("Midi Libre — faits divers", "Le Monde — À la une"); alles ná
// het gedachtestreepje is dezelfde krant. Zonder deze normalisatie zouden twee
// feeds van dezelfde krant als twee onafhankelijke outlets tellen.
export function outletId(naam) {
  return normaliseer(naam)
    .split(/\s[—–-]\s/)[0]
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// Is dit item persbureau-copy (AFP, Reuters, AP, "(avec AFP)")? Getoetst op de
// kop én op de bronvermelding, op woordgrens zodat "ap" in "Cap d'Agde" of
// "Reuters" binnen een langer woord niet meetelt.
export function isWire(item) {
  const blob = normaliseer(`${(item && item.titel) || ""} ${(item && item.bron) || ""}`);
  return PERSBUREAU_MARKERS.some((m) =>
    new RegExp(`(^|[^a-z0-9])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(blob)
  );
}

// Aantal ONAFHANKELIJKE bronnen in een verzameling items. Onafhankelijk =
// VERSCHILLENDE outlet ÉN VERSCHILLENDE kop. Drie manieren waarop items samen
// als ÉÉN bron tellen:
//   1) zelfde outlet — twee artikelen van Midi Libre over twee losse zaken zijn
//      geen twee bevestigingen, maar één krant die twee keer publiceert;
//   2) (vrijwel) dezelfde kop — letterlijk overgenomen wire/persbericht;
//   3) twee persbureau-items over hetzelfde verhaal — agentschapscopy wordt per
//      krant herschreven, dus hier geldt een lossere titeldrempel.
// Zo haalt één krant of één agentschapsbericht de ≥2-drempel nooit alleen.
export function telOnafhankelijk(items) {
  const groepen = []; // { outlets:Set, koppen:[Set], wire:boolean }
  for (const it of items || []) {
    const tokens = tokeniseer(it.titel);
    const outlet = outletId(it.bron);
    const wire = isWire(it);

    // Alle groepen zoeken waar dit item bij hoort; matcht het er meer dan één,
    // dan waren die groepen via dit item ook onderling afhankelijk -> samenvoegen.
    const raak = [];
    groepen.forEach((g, i) => {
      if (outlet && g.outlets.has(outlet)) return raak.push(i);
      if (g.koppen.some((k) => jaccard(tokens, k) >= WIRE_TITEL_JACCARD)) return raak.push(i);
      if (
        wire &&
        g.wire &&
        g.koppen.some(
          (k) =>
            jaccard(tokens, k) >= WIRE_ONDERLING_JACCARD ||
            gedeeldSpecifiek(tokens, k) >= MIN_SPECIFIEK_GEDEELD
        )
      ) {
        raak.push(i);
      }
    });

    if (!raak.length) {
      groepen.push({ outlets: new Set(outlet ? [outlet] : []), koppen: [tokens], wire });
      continue;
    }
    const doel = groepen[raak[0]];
    for (const i of raak.slice(1).reverse()) {
      const g = groepen[i];
      for (const o of g.outlets) doel.outlets.add(o);
      doel.koppen.push(...g.koppen);
      doel.wire = doel.wire || g.wire;
      groepen.splice(i, 1);
    }
    if (outlet) doel.outlets.add(outlet);
    doel.koppen.push(tokens);
    doel.wire = doel.wire || wire;
  }
  return groepen.length;
}

// Namen van de verschillende outlets in een itemlijst (voor weergave in de
// reviewtool). Ontdubbeld op outletId, met de eerst geziene schrijfwijze.
export function outletNamen(items) {
  const gezien = new Map();
  for (const it of items || []) {
    const id = outletId(it.bron);
    if (!id || gezien.has(id)) continue;
    gezien.set(id, String(it.bron || "").split(/\s[—–-]\s/)[0].trim() || String(it.bron || ""));
  }
  return [...gezien.values()];
}

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

  const clusters = []; // { items:[], tokens:Set, bronnen:Set, bronCount:Map }
  for (const item of recent) {
    const tokens = tokeniseer(item.titel);
    const bron = item.bron;
    let doel = null;
    for (const c of clusters) {
      // Strenger: het nieuwe item moet PAARSGEWIJS met minstens één bestaand
      // cluster-lid >= MIN_SPECIFIEK_GEDEELD betekenisvolle termen delen — niet
      // met de opgehoopte woordenberg (union) van het hele cluster. Dat union-
      // matchen liet losse verhalen (bv. een CPI- of Nigeria-kop) als "bron" in
      // een bosbrandcluster glippen. Plus: één bron mag hooguit
      // MAX_PER_BRON_CLUSTER items in een cluster hebben.
      if (
        (c.bronCount.get(bron) || 0) < MAX_PER_BRON_CLUSTER &&
        c.itemTokens.some((it) => gedeeldSpecifiek(tokens, it) >= MIN_SPECIFIEK_GEDEELD)
      ) {
        doel = c;
        break;
      }
    }
    // Past nergens goed bij? Dan een eigen (voorlopig) cluster; dat wordt geen
    // hot-cluster en verschijnt gewoon in de themalijst.
    if (!doel) {
      doel = {
        items: [],
        itemTokens: [],
        tokens: new Set(),
        bronnen: new Set(),
        bronCount: new Map(),
      };
      clusters.push(doel);
    }
    doel.items.push(item);
    doel.itemTokens.push(tokens);
    for (const w of tokens) doel.tokens.add(w);
    doel.bronnen.add(bron);
    doel.bronCount.set(bron, (doel.bronCount.get(bron) || 0) + 1);
  }

  return clusters.map((c) => verrijkCluster(c, nu));
}

function verrijkCluster(c, nu) {
  const laatste = Math.max(...c.items.map((i) => Date.parse(i.datum) || 0));
  const leeftijdUren = (nu - laatste) / (60 * 60 * 1000);
  const recency = Math.max(0, 1 - leeftijdUren / HOT_VENSTER_UREN);
  // Verschillende KRANTEN, niet verschillende feeds: twee rubrieksfeeds van
  // dezelfde krant tellen als één outlet (zie outletId).
  const outlets = outletNamen(c.items);
  const aantalBronnen = outlets.length;
  const onafhankelijkeBronnen = telOnafhankelijk(c.items); // wire-copy telt als 1
  // Prioriteitsonderwerpen krijgen een score-boost, zodat belangrijk nieuws
  // bovenaan staat en nooit wordt weg-gesnoeid — ook bij precies 2 bronnen.
  const prioriteit = isPrioriteit(c.items);
  const score = onafhankelijkeBronnen * (0.4 + 0.6 * recency) * (prioriteit ? 2 : 1);

  // Kern-trefwoorden (gesorteerd): dienen als clustersleutel én als vingerafdruk
  // voor dedup over cron-rondes heen (zie zelfdeVerhaal).
  const kernTokens = [...c.tokens].sort();
  const kern = kernTokens.slice(0, 5).join("-");
  const sleutel = hash(kern || String(laatste));

  const items = [...c.items].sort(
    (a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0)
  );

  return {
    sleutel,
    items,
    bronnen: [...c.bronnen],
    outlets,
    aantalBronnen,
    onafhankelijkeBronnen,
    kernTokens: kernTokens.slice(0, 30), // vingerafdruk voor cross-ronde dedup
    prioriteit,
    laatste: new Date(laatste).toISOString(),
    recency,
    score,
    hot: prioriteit || onafhankelijkeBronnen >= HOT_MIN_BRONNEN,
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
