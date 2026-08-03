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

// Aantal ONAFHANKELIJKE bronnen in een cluster. Twee items met (vrijwel)
// dezelfde titel zijn bijna zeker dezelfde wire/persbericht (AFP, of een derde
// als een auto-club of ministerie), gerepubliceerd door meerdere kranten — dat
// telt als ÉÉN onafhankelijke bron, niet twee. Zo haalt wire-copy de ≥2-
// drempel niet en nemen we niet feitelijk één bron over als was het bevestigd.
function telOnafhankelijk(items) {
  const groepen = []; // representatieve token-sets van al geziene titels
  for (const it of items) {
    const t = tokeniseer(it.titel);
    let bekend = false;
    for (const g of groepen) {
      if (jaccard(t, g) >= 0.6) {
        bekend = true;
        break;
      }
    }
    if (!bekend) groepen.push(t);
  }
  return groepen.length;
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
  const aantalBronnen = c.bronnen.size; // verschillende kranten (voor weergave)
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
