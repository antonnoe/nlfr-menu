// Dedup van overheidsberichten OVER DE FEEDS HEEN.
// ---------------------------------------------------------------------------
// Service-Public publiceert dezelfde actualité op meerdere feeds — particuliers
// én professionnels — elk met een eigen URL:
//   https://www.service-public.fr/particuliers/actualites/A18905?xtor=RSS-111
//   https://entreprendre.service-public.fr/actualites/A18905?xtor=RSS-112
// De opslagsleutel was hashId(url), dus dat werden twee records met elk een
// eigen AI-samenvatting: hetzelfde bericht twee keer op /actueel.
//
// Het actualité-nummer (A<cijfers>) is per bericht uniek en identiek op alle
// feeds, ongeacht subdomein of tracking-parameter. Dat is dus de betrouwbare
// identiteit. Als vangnet — voor overheidsbronnen zonder zo'n nummer (Bercy,
// Douane, DG Trésor, vie-publique) — vergelijken we de brontitels met dezelfde
// tokenoverlap als de clustering.

import { titelJaccard, outletId } from "./cluster.js";
import { laadBronnen } from "./feeds.js";
import { OVERHEID_TITEL_JACCARD } from "./config.js";

// Het actualité-nummer uit een Service-Public-URL, of null.
// Matcht /actualites/A18905 op elk subdomein (www., entreprendre., …) en
// negeert querystring en fragment (?xtor=RSS-111, #top).
export function overheidSleutel(url) {
  const m = String(url || "").match(/\/actualites\/(A\d+)(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// De identiteit van een opgeslagen overheidsdocument: het actualité-nummer als
// dat er is, anders null (dan valt het terug op de titelvergelijking).
export function docSleutel(doc) {
  if (!doc) return null;
  if (doc.sleutel) return String(doc.sleutel).toUpperCase();
  return overheidSleutel(doc.url);
}

function docTitel(doc) {
  return (doc && (doc.titelBron || doc.kop)) || "";
}

// Gaan deze twee records over hetzelfde bericht?
//   - hebben beide een actualité-nummer -> alleen gelijk als de nummers gelijk
//     zijn (twee verschillende A-nummers zijn per definitie twee berichten);
//   - ontbreekt het nummer bij minstens één -> vangnet op titeloverlap.
export function zelfdeOverheidBericht(a, b) {
  const sa = docSleutel(a);
  const sb = docSleutel(b);
  if (sa && sb) return sa === sb;
  const ta = docTitel(a);
  const tb = docTitel(b);
  if (!ta || !tb) return false;
  return titelJaccard(ta, tb) >= OVERHEID_TITEL_JACCARD;
}

// ---- Welk exemplaar houden we? ---------------------------------------------
// BEHOUD-REGEL (deterministisch, in deze volgorde):
//   1. het OUDSTE record (vroegste gepubliceerdOp). Dat bewaart de levenscyclus:
//      het bericht houdt zijn oorspronkelijke publicatiemoment en schuift op de
//      afgesproken termijn naar het archief. Het jongste exemplaar behouden zou
//      de teller juist terugzetten — precies de reset die we willen vermijden.
//   2. bij gelijke datum: de bron met de HOOGSTE prioriteit in bronnen.json
//      (prioriteit 1 wint van 2); onbekende bronnen tellen als laagste.
//   3. bij gelijke prioriteit: het lexicografisch kleinste id, puur zodat de
//      uitkomst niet van de scanvolgorde afhangt.
// Let op: de prioriteit hangt aan de VOLLEDIGE bronnaam, niet aan outletId().
// Die laatste snijdt de rubrieksuffix eraf, waardoor "Service-Public —
// particuliers" (prioriteit 1) en "— professionnels" (prioriteit 2) op dezelfde
// sleutel zouden vallen — precies de twee bronnen waar deze regel over beslist.
// outletId dient alleen als vangnet voor namen die niet exact in bronnen.json
// staan; daar geldt de hoogste prioriteit van die uitgever.
let prioCache = null;
function prioriteitVan(naam) {
  if (!prioCache) {
    const opNaam = new Map();
    const opOutlet = new Map();
    for (const b of laadBronnen()) {
      const p = Number(b && b.prioriteit) || 9;
      const volledig = String((b && b.naam) || "").trim().toLowerCase();
      if (volledig) opNaam.set(volledig, p);
      const id = outletId(b && b.naam);
      if (id) opOutlet.set(id, Math.min(opOutlet.get(id) ?? 9, p));
    }
    prioCache = { opNaam, opOutlet };
  }
  const volledig = String(naam || "").trim().toLowerCase();
  if (prioCache.opNaam.has(volledig)) return prioCache.opNaam.get(volledig);
  return prioCache.opOutlet.get(outletId(naam)) ?? 9;
}

export function kiesBehoud(a, b) {
  const ta = Date.parse(a && a.gepubliceerdOp) || Number.MAX_SAFE_INTEGER;
  const tb = Date.parse(b && b.gepubliceerdOp) || Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta < tb ? a : b;
  const pa = prioriteitVan(a && a.bron);
  const pb = prioriteitVan(b && b.bron);
  if (pa !== pb) return pa < pb ? a : b;
  return String((a && a.id) || "") <= String((b && b.id) || "") ? a : b;
}

// Deelt een lijst overheidsdocumenten in { behouden, weg }. `weg` mag de
// aanroeper uit KV verwijderen; per groep blijft er precies één record over.
export function dedupOverheid(docs) {
  const groepen = []; // [{ behoud, leden:[] }]
  for (const doc of docs || []) {
    if (!doc) continue;
    const groep = groepen.find((g) => g.leden.some((l) => zelfdeOverheidBericht(l, doc)));
    if (!groep) {
      groepen.push({ behoud: doc, leden: [doc] });
      continue;
    }
    groep.leden.push(doc);
    groep.behoud = kiesBehoud(groep.behoud, doc);
  }
  const behouden = groepen.map((g) => g.behoud);
  const weg = [];
  for (const g of groepen) for (const l of g.leden) if (l !== g.behoud) weg.push(l);
  return { behouden, weg };
}

// Is dit binnenkomende feed-item er al, als record in de voorraad? Zelfde
// vergelijking als hierboven, maar op een nog niet opgeslagen item.
export function alBekend(item, voorraad) {
  const pseudo = {
    sleutel: overheidSleutel(item && item.url),
    url: (item && item.url) || "",
    titelBron: (item && item.titel) || "",
  };
  return (voorraad || []).some((d) => zelfdeOverheidBericht(d, pseudo));
}
