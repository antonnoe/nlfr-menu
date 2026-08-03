// Publicatiepoort: de laatste controle vóór een persconcept live gaat.
// ---------------------------------------------------------------------------
// De huisregels (>= 2 onafhankelijke kranten, faits-divers-zeef, één onderwerp)
// zaten tot nu toe alleen aan de INSTROOMkant (cron) en in de AI-prompt. Een
// concept dat vóór een regelwijziging in KV belandde, of dat via de force-route
// binnenkwam, kon daardoor alsnog gepubliceerd worden. Deze module herbeoordeelt
// het concept op het MOMENT VAN PUBLICEREN, op basis van de bronkoppen die bij
// het concept zijn opgeslagen.
//
// Buiten deze poort vallen concepten van overheids- en verenigingsbronnen: die
// hebben een eigen regime (Licence Ouverte / eigen berichten) waarvoor de
// tweekranten-eis en de faits-divers-zeef niet gelden.

import { telOnafhankelijk, outletNamen, outletId } from "./cluster.js";
import { faitsDiversDoorlaat, laadBronnen, normaliseer } from "./feeds.js";
import { SYNTHESE_MIN_BRONNEN, KOP_NGRAM, KOP_OVERLAP_MAX } from "./config.js";

// ---- Regime van een bronnaam ------------------------------------------------
// bronnen.json kent geen expliciet id-veld; de outlet-identiteit (outletId)
// dient als sleutel. Namen die er niet in staan (bv. een losse vereniging uit de
// aggregaatfeed) leveren geen regime op en zetten de poort dus niet aan.
let regimeCache = null;
function regimePerOutlet() {
  if (regimeCache) return regimeCache;
  regimeCache = new Map();
  for (const b of laadBronnen()) {
    const id = outletId(b && b.naam);
    if (id) regimeCache.set(id, (b && b.regime) || "");
  }
  return regimeCache;
}

// Is dit een persconcept? Alleen dan geldt de poort. We kijken naar de
// opgeslagen bronnen: zit er minstens één bekende PERS-outlet bij, dan is het
// een persconcept.
export function isPersConcept(concept) {
  const kaart = regimePerOutlet();
  return (concept && Array.isArray(concept.bronnen) ? concept.bronnen : []).some(
    (b) => kaart.get(outletId(b && b.naam)) === "pers"
  );
}

// ---- Gelijkenis concepttekst <-> bronkop ------------------------------------
// Doel: parafrase afdwingen, geen kop-naschrijverij. We vergelijken woord-
// n-grammen (KOP_NGRAM = 3 opeenvolgende woorden) van de bronkop met die van de
// concepttekst, genormaliseerd (accentloos, kleine letters, leestekens weg).
// Functiewoorden blijven bewust staan: bij n-grammen draagt de woordVOLGORDE de
// betekenis, en juist een letterlijk overgenomen woordgroep moet opvallen.
//
// DREMPEL (KOP_OVERLAP_MAX = 0.5): weigeren zodra de helft of meer van de
// woord-drietallen uit een bronkop letterlijk in de concepttekst terugkomt. Bij
// een typische kop van 8-12 woorden (6-10 drietallen) betekent dat vier tot vijf
// aaneengesloten woordgroepen die één op één zijn overgenomen — dat is geen
// toeval meer, maar naschrijven. Onder die grens blijft de normale overlap
// mogelijk die een synthese nu eenmaal met haar bron deelt: plaatsnamen,
// eigennamen en vaste combinaties ("ministre de l'interieur"). De drempel is
// bewust niet lager gezet: een synthese gaat per definitie over hetzelfde
// onderwerp als haar bronnen, en een te strenge grens zou correcte parafrases
// blokkeren — de poort mag geen redactionele ruis worden.
function woorden(tekst) {
  return normaliseer(tekst)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function ngrammen(lijst, n) {
  const uit = new Set();
  for (let i = 0; i + n <= lijst.length; i += 1) uit.add(lijst.slice(i, i + n).join(" "));
  return uit;
}

// Aandeel van de n-grammen uit `kop` dat letterlijk in `tekst` voorkomt.
// Koppen korter dan KOP_NGRAM woorden leveren geen n-grammen op; die geven 0
// (niet te beoordelen) — het bronnenaantal en de zeef vangen die gevallen af.
export function kopGelijkenis(tekst, kop) {
  const kopG = ngrammen(woorden(kop), KOP_NGRAM);
  if (!kopG.size) return 0;
  const tekstG = ngrammen(woorden(tekst), KOP_NGRAM);
  let raak = 0;
  for (const g of kopG) if (tekstG.has(g)) raak += 1;
  return raak / kopG.size;
}

// ---- Outletnamen in de lopende tekst ----------------------------------------
// De bodytekst hoort geen medium bij naam te noemen ("volgens Le Monde"); de
// bronnenlijst onder het artikel ís de attributie. Dit is een ZACHTE controle:
// hij waarschuwt in de reviewtool, blokkeert niets — de redacteur haalt de naam
// er inline uit.
//
// Bekend nevengeval: sommige krantennamen zijn ook een streeknaam ("Sud Ouest",
// "Midi Libre"). Een tekst over het zuidwesten kan de melding dus onterecht
// oproepen. Dat is aanvaard: het is een waarschuwing, geen blokkade.
function naamVarianten(naam) {
  const vol = String(naam || "").trim();
  if (!vol) return [];
  const kort = vol.split(/\s[—–-]\s/)[0].trim(); // "Le Monde — À la une" -> "Le Monde"
  return [...new Set([kort, vol])].filter((v) => v.replace(/[^a-zA-Z0-9]/g, "").length >= 3);
}

// Regex op woordgrens, met soepele scheidingstekens ertussen: "NU.nl" matcht
// ook "NU nl", "Le Monde" ook "le  monde".
function naamRegex(naam) {
  const delen = normaliseer(naam)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!delen.length) return null;
  return new RegExp(`\\b${delen.join("[\\s.'’-]*")}\\b`);
}

// Welke outletnamen uit de bronnenlijst komen letterlijk in de tekst voor?
export function outletnamenInTekst(tekst, bronnen) {
  const n = normaliseer(tekst);
  if (!n.trim()) return [];
  const gevonden = new Set();
  for (const b of bronnen || []) {
    // Kortste variant eerst: die staat het dichtst bij hoe een naam in lopende
    // tekst wordt geschreven, en is dus ook wat we terugmelden.
    for (const v of naamVarianten(b && b.naam)) {
      const re = naamRegex(v);
      if (re && re.test(n)) {
        gevonden.add(v);
        break;
      }
    }
  }
  return [...gevonden];
}

// ---- De poort ---------------------------------------------------------------
// Geeft { ok:true } terug, of { ok:false, code, fout, details } met een reden die
// de reviewtool letterlijk kan tonen.
//
// `tekst` is de tekst zoals die gepubliceerd zou worden (dus inclusief eventuele
// handmatige bewerking in de reviewtool), niet per se concept.tekst.
export function beoordeelPublicatie(concept, tekst) {
  const bronnen = concept && Array.isArray(concept.bronnen) ? concept.bronnen : [];

  // Overheid en verenigingen: eigen regime, poort niet van toepassing.
  if (!isPersConcept(concept)) return { ok: true, overgeslagen: "geen-persconcept" };

  // (a) Minstens twee ONAFHANKELIJKE outlets: verschillende kranten én
  //     verschillende koppen, wire-copy samengeteld (zie telOnafhankelijk).
  const items = bronnen.map((b) => ({ titel: (b && b.titel) || "", bron: (b && b.naam) || "" }));
  const onafhankelijk = telOnafhankelijk(items);
  const outlets = outletNamen(items);
  if (onafhankelijk < SYNTHESE_MIN_BRONNEN) {
    return {
      ok: false,
      code: "te-weinig-outlets",
      fout:
        `Publicatie geweigerd: dit concept steunt op ${onafhankelijk} onafhankelijke ` +
        `bron${onafhankelijk === 1 ? "" : "nen"} (${outlets.join(", ") || "onbekend"}), en de huisregel ` +
        `eist er minstens ${SYNTHESE_MIN_BRONNEN}. Twee berichten van dezelfde krant — of twee kranten die ` +
        `dezelfde persbureaukop overnemen — tellen samen als één bron.`,
      details: { onafhankelijk, outlets, aantalBronlinks: bronnen.length },
    };
  }

  // (b) Faits-divers-zeef, opnieuw beoordeeld op elke bronkop. Vangt oude
  //     concepten uit KV die dateren van vóór een uitbreiding van de zeef.
  const gezakt = bronnen.filter((b) => b && b.titel && !faitsDiversDoorlaat(b.titel));
  if (gezakt.length) {
    return {
      ok: false,
      code: "faits-divers",
      fout:
        `Publicatie geweigerd: ${gezakt.length} bronkop${gezakt.length === 1 ? "" : "pen"} ` +
        `komt niet door de faits-divers-zeef — “${gezakt[0].titel}”` +
        `${gezakt.length > 1 ? ` (en ${gezakt.length - 1} andere)` : ""}. ` +
        `Misdaad, vermissingen en verdrinkingen zijn geen onderwerp voor deze feed.`,
      details: { koppen: gezakt.map((b) => b.titel) },
    };
  }

  // (c) Gelijkenis met de bronkoppen: parafrase afdwingen.
  const teksten = String(tekst || "");
  let ergste = null;
  for (const b of bronnen) {
    if (!b || !b.titel) continue;
    const score = kopGelijkenis(teksten, b.titel);
    if (!ergste || score > ergste.score) ergste = { score, titel: b.titel, naam: b.naam };
  }
  if (ergste && ergste.score >= KOP_OVERLAP_MAX) {
    return {
      ok: false,
      code: "te-veel-kopoverlap",
      fout:
        `Publicatie geweigerd: de tekst ligt te dicht op de bronkop van ${ergste.naam || "een bron"} ` +
        `(${Math.round(ergste.score * 100)}% van de woordgroepen komt letterlijk terug in “${ergste.titel}”). ` +
        `Herschrijf de passage in eigen woorden; de synthese mag de kop niet naschrijven.`,
      details: { score: Number(ergste.score.toFixed(2)), titel: ergste.titel, bron: ergste.naam },
    };
  }

  return { ok: true, onafhankelijk, outlets };
}

// Lichtere variant voor het opruimen van de KV-voorraad en voor de weergave in
// de reviewtool: alleen de twee structurele checks (outlets + zeef), NIET de
// gelijkenistoets. Die laatste beoordeelt de TEKST, en die kan de redactie nog
// herschrijven — daar hoort geen concept om weggegooid te worden.
export function structureelGeldig(concept) {
  if (!isPersConcept(concept)) return { ok: true, overgeslagen: "geen-persconcept" };
  const bronnen = concept && Array.isArray(concept.bronnen) ? concept.bronnen : [];
  const items = bronnen.map((b) => ({ titel: (b && b.titel) || "", bron: (b && b.naam) || "" }));
  const onafhankelijk = telOnafhankelijk(items);
  const outlets = outletNamen(items);
  if (onafhankelijk < SYNTHESE_MIN_BRONNEN) {
    return { ok: false, code: "te-weinig-outlets", onafhankelijk, outlets };
  }
  const gezakt = bronnen.filter((b) => b && b.titel && !faitsDiversDoorlaat(b.titel));
  if (gezakt.length) {
    return { ok: false, code: "faits-divers", onafhankelijk, outlets, koppen: gezakt.map((b) => b.titel) };
  }
  return { ok: true, onafhankelijk, outlets };
}

// Zachte signalen bij een concept: dingen die de redacteur moet zien maar die
// publicatie niet tegenhouden. Nu: outletnamen in de lopende tekst.
export function zachteSignalen(concept) {
  if (!isPersConcept(concept)) return { outletnamen: [] };
  const bronnen = concept && Array.isArray(concept.bronnen) ? concept.bronnen : [];
  return { outletnamen: outletnamenInTekst((concept && concept.tekst) || "", bronnen) };
}
