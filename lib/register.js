// Regelgevingsregister — duurzaam archief van overheidsberichten.
// ---------------------------------------------------------------------------
// WAAROM. Overheidsberichten zijn geen vergankelijk nieuws maar wet- en
// regelgeving. Ze na 28 dagen weggooien is waardevernietiging: een regel over
// de aangifteplicht van micro-ondernemers is over twee jaar nog steeds het
// startpunt van de keten die er daarna op volgde. Dit register bewaart ze
// permanent, rubrieksgewijs, met de keten van vervangingen en aanvullingen.
//
// TWEE HARDE PRINCIPES.
//   1. NOOIT WEGGOOIEN. Er is geen verwijderpad. "Eruit" betekent status
//      'vervangen': onzichtbaar in de publieke weergave, data en keten intact.
//      Registerrecords worden zonder TTL opgeslagen (zie bewaarRegister).
//   2. PUBLIEK ALLEEN TITELS. De publieke weergave krijgt uitsluitend het
//      triplet datum · bron · titel, samengesteld door publiekeRij(). De tekst
//      verlaat de server niet — de muur zit in de API, niet in de pagina.
//
// REIKWIJDTE. Uitsluitend de overheidsstroom. Pers, Infofrankrijk en
// verenigingen houden hun bestaande levenscyclus; die raken dit bestand niet.

import { normaliseer } from "./feeds.js";
import { bronUrlOordeel, bronVoorNaam } from "./bronurl.js";
import { kernUitTekst, kernOverlap } from "./cluster.js";
import { overheidSleutel } from "./overheid.js";
import {
  OVERHEID_THEMAS,
  REGISTER_ZICHTBAAR,
  REGISTER_KETEN_JACCARD,
  REGISTER_KETEN_GEDEELD_MIN,
} from "./config.js";

// ---- Onderwerp-slug ---------------------------------------------------------
// De ketensleutel: een genormaliseerde vorm van de kop. Accentloos, kleine
// letters, koppeltekens. Bewust GEEN datum of nummer erin — juist het onderwerp
// moet twee versies van dezelfde regeling bij elkaar brengen.
const SLUG_STOP = new Set([
  "de", "het", "een", "van", "voor", "naar", "met", "aan", "door", "over", "bij",
  "op", "in", "te", "en", "of", "dat", "die", "dit", "deze", "wordt", "worden",
  "is", "zijn", "wat", "hoe", "als", "ook", "niet", "meer", "per", "tot",
]);
export function maakSlug(kop, maxWoorden = 8) {
  const woorden = normaliseer(kop)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !SLUG_STOP.has(w));
  return woorden.slice(0, maxWoorden).join("-");
}

// ---- Opbouw van een registerrecord -----------------------------------------
// Bouwt het record uit een overheidsdocument (zoals de cron dat opslaat) zonder
// er iets aan te verliezen: rubriek en beide brondatums gaan mee.
// `datumOpname` is het moment van opname in het register; `datumKeten` blijft
// null tot er daadwerkelijk een keten-gebeurtenis is.
export function maakRegisterRecord(doc, nu = Date.now()) {
  const rubriek = OVERHEID_THEMAS.includes(doc && doc.thema) ? doc.thema : "wetgeving";
  const titel = (doc && (doc.kop || doc.titelBron)) || "";
  const bronNaam = (doc && doc.bron) || "";
  // Bron-URL toetsen bij opname (host hoort bij de bron, niet-leeg pad, geen
  // asset-host). Het register gooit NOOIT weg — ook een afgekeurde URL blijft
  // dus bewaard in `bronUrlGeweigerd`, zodat achteraf te zien is wat de bron
  // aanleverde. `bronUrl` bevat alleen nog een URL die je mag aanklikken.
  const bronOordeel = bronUrlOordeel(doc && doc.url, bronVoorNaam(bronNaam) || {});
  return {
    id: (doc && doc.id) || "",
    rubriek,
    titel,
    tekst: (doc && doc.samenvatting) || "",
    bronNaam,
    bronUrl: bronOordeel.ok ? bronOordeel.url : "",
    bronUrlRuw: bronOordeel.ok ? null : (doc && doc.url) || null,
    bronUrlGeweigerd: bronOordeel.ok ? null : bronOordeel.reden,
    slug: maakSlug(titel),
    // Actualité-nummer (A18905) als de bron dat heeft: het sterke ketensignaal.
    sleutel: (doc && doc.sleutel) || overheidSleutel(doc && doc.url),
    // Vingerafdruk voor de zwakkere ketendetectie op onderwerpsovereenkomst.
    kernTokens: kernUitTekst(`${titel} ${(doc && doc.samenvatting) || ""}`).slice(0, 40),
    // Drie datums, elk met een eigen betekenis.
    datumBron: (doc && doc.datum) || (doc && doc.gepubliceerdOp) || null,
    datumOpname: new Date(nu).toISOString(),
    datumKeten: null,
    status: "actueel",
    // Ketenverwijzingen (id's van andere registerrecords).
    vervangt: null,
    vervangenDoor: null,
    aanvullingOp: null,
    aangevuldDoor: null,
    // GERESERVEERD voor de latere koppeling met Infofrankrijk en Café Claude.
    // Bewust leeg aangemaakt zodat bestaande records straks niet gemigreerd
    // hoeven te worden; nog niet vullen.
    ifSlug: null,
    ccContext: null,
    registerVersie: 1,
  };
}

// ---- Publieke weergave ------------------------------------------------------
// Het triplet en verder niets. Geen tekst, geen bron-URL — de muur zit hier.
export function publiekeRij(record) {
  return {
    id: (record && record.id) || "",
    rubriek: (record && record.rubriek) || "",
    datum: datumTag((record && record.datumBron) || (record && record.datumOpname)),
    bron: kortelBron((record && record.bronNaam) || ""),
    titel: (record && record.titel) || "",
  };
}

// Datumtag in het formaat 20260804.
export function datumTag(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}${mm}${dd}`;
}

// "Service-Public — particuliers" -> "Service-Public": in het triplet staat de
// uitgever, niet de rubriek van de feed.
function kortelBron(naam) {
  return String(naam || "").split(/\s[—–-]\s/)[0].trim();
}

export function isZichtbaar(record) {
  return REGISTER_ZICHTBAAR.includes((record && record.status) || "");
}

// Rubrieksgewijze, publieke weergave: alleen zichtbare records, nieuwste eerst.
export function publiekeRubrieken(records) {
  const perRubriek = new Map();
  for (const r of records || []) {
    if (!r || !isZichtbaar(r)) continue;
    if (!perRubriek.has(r.rubriek)) perRubriek.set(r.rubriek, []);
    perRubriek.get(r.rubriek).push(r);
  }
  const uit = [];
  for (const rubriek of OVERHEID_THEMAS) {
    const lijst = perRubriek.get(rubriek);
    if (!lijst || !lijst.length) continue;
    lijst.sort((a, b) => sorteerSleutel(b) - sorteerSleutel(a));
    uit.push({ rubriek, items: lijst.map(publiekeRij) });
  }
  return uit;
}
function sorteerSleutel(r) {
  return Date.parse((r && r.datumBron) || (r && r.datumOpname)) || 0;
}

// ---- Keten-detectie ---------------------------------------------------------
// Toetst een binnenkomend overheidsbericht tegen bestaande register- en live
// overheidsrecords in DEZELFDE rubriek. Geeft het beste voorstel terug, of null.
//
// De uitkomst BLOKKEERT NIETS: het bericht gaat gewoon live. Het voorstel wordt
// als vraagvlag op het record gezet en in de reviewtool aan de redacteur
// voorgelegd. Zie REGISTER_KETEN_* in lib/config.js voor de drempels.
export function zoekKeten(nieuw, kandidaten) {
  const rubriek = (nieuw && nieuw.rubriek) || (nieuw && nieuw.thema) || "";
  const sleutel = (nieuw && nieuw.sleutel) || overheidSleutel(nieuw && nieuw.url);
  const titel = (nieuw && (nieuw.titel || nieuw.kop)) || "";
  const kern =
    (nieuw && nieuw.kernTokens) ||
    kernUitTekst(`${titel} ${(nieuw && (nieuw.tekst || nieuw.samenvatting)) || ""}`);
  const slug = (nieuw && nieuw.slug) || maakSlug(titel);

  let beste = null;
  for (const k of kandidaten || []) {
    if (!k || k.id === (nieuw && nieuw.id)) continue;
    const kRubriek = k.rubriek || k.thema || "";
    if (kRubriek !== rubriek) continue; // keten loopt binnen één rubriek
    // Al vervangen records zijn geen ketenkandidaat meer.
    if (k.status === "vervangen") continue;

    const kSleutel = k.sleutel || overheidSleutel(k.url);
    const kTitel = k.titel || k.kop || "";
    const kKern = k.kernTokens || kernUitTekst(`${kTitel} ${k.tekst || k.samenvatting || ""}`);
    const { gedeeld, jaccard } = kernOverlap(kern, kKern);

    // 1) Gelijk actualité-nummer: dezelfde bron-actualité opnieuw uitgegeven.
    if (sleutel && kSleutel && sleutel === kSleutel) {
      beste = kies(beste, {
        soort: "vervangen",
        doelId: k.id,
        doelTitel: kTitel,
        doelRubriek: kRubriek,
        reden: "gelijk actualité-nummer",
        zekerheid: 2,
        jaccard: Number(jaccard.toFixed(2)),
        // Bij twijfel toont de UI beide opties; met een gelijk A-nummer is
        // "vervangen" zo waarschijnlijk dat dat niet nodig is — tenzij de
        // teksten sterk uiteenlopen, want dan is het eerder een aanvulling.
        beideOpties: jaccard < REGISTER_KETEN_JACCARD,
      });
      continue;
    }
    // 2) Zelfde onderwerp volgens de slug of voldoende tokenoverlap.
    const zelfdeSlug = slug && k.slug && slug === k.slug;
    const genoegOverlap = jaccard >= REGISTER_KETEN_JACCARD && gedeeld >= REGISTER_KETEN_GEDEELD_MIN;
    if (zelfdeSlug || genoegOverlap) {
      beste = kies(beste, {
        soort: "aanvulling",
        doelId: k.id,
        doelTitel: kTitel,
        doelRubriek: kRubriek,
        reden: zelfdeSlug ? "zelfde onderwerp-slug" : "sterke tokenoverlap",
        zekerheid: 1,
        jaccard: Number(jaccard.toFixed(2)),
        // Alleen overlap is dubbelzinnig: het kan net zo goed een nieuwe versie
        // zijn. Daarom hier wél beide opties tonen.
        beideOpties: true,
      });
    }
  }
  return beste;
}
function kies(a, b) {
  if (!a) return b;
  if (b.zekerheid !== a.zekerheid) return b.zekerheid > a.zekerheid ? b : a;
  return b.jaccard > a.jaccard ? b : a;
}

// ---- Keten toepassen --------------------------------------------------------
// Beide functies geven de GEWIJZIGDE records terug; de aanroeper bewaart ze.
// Er wordt niets verwijderd — dat is het hele punt van dit register.

// "Ja" op vervangen: het oude record wordt achterhaald (publiek onzichtbaar),
// het nieuwe neemt de plaats in. De keten wijst beide kanten op.
export function pasVervangingToe(oud, nieuw, nu = Date.now()) {
  const moment = new Date(nu).toISOString();
  const oudNieuw = {
    ...oud,
    status: "vervangen",
    datumKeten: moment,
    vervangenDoor: nieuw.id,
  };
  const nieuwNieuw = {
    ...nieuw,
    // Een vervanger die zelf al een aanvulling was, blijft 'aangevuld'.
    status: nieuw.status === "aangevuld" ? "aangevuld" : "actueel",
    datumKeten: moment,
    vervangt: oud.id,
  };
  return { oud: oudNieuw, nieuw: nieuwNieuw };
}

// "Ja" op aanvullen: beide blijven zichtbaar, in een keten naast elkaar.
export function pasAanvullingToe(oud, nieuw, nu = Date.now()) {
  const moment = new Date(nu).toISOString();
  return {
    oud: { ...oud, status: "aangevuld", datumKeten: moment, aangevuldDoor: nieuw.id },
    nieuw: { ...nieuw, status: "aangevuld", datumKeten: moment, aanvullingOp: oud.id },
  };
}
