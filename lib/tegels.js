// Presentatielaag voor /actueel: bouwt uit de opgeslagen NL-content de
// thema-TEGELS die de pagina toont. Bewust een PURE module (geen fetch, geen
// KV): de losse data komt binnen, hier wordt alleen gegroepeerd en gevormd —
// makkelijk te testen.
// ---------------------------------------------------------------------------
// Elke tegel is thematisch en bevat artikelen. Een artikel heeft:
//   titel   -> korte NL-kop
//   summary -> één regel teaser
//   tekst   -> de volledige NL-tekst (synthese of samenvatting)
//   bronnen -> [{naam,titel,url,datum}]  (pers: meerdere; overige: één)
// De weergave klapt uit: tegel -> artikelen (titel+summary) -> tekst -> bronnen.

import { laadBronnen, normaliseer } from "./feeds.js";
import {
  OVERHEID_THEMAS,
  OVERHEID_THEMA_LABEL,
  PERS_TEGELS,
  PERS_TEGEL_LABEL,
  BOSBRAND_WOORDEN,
  VERKEER_WOORDEN,
  BRONTHEMA_NAAR_PERSTEGEL,
  INFOFRANKRIJK_LABEL,
  VERENIGINGEN_LABEL,
  REDACTIE_LABEL,
  HOT_VENSTER_UREN,
  MAX_NIEUWS_LEEFTIJD_DAGEN,
} from "./config.js";

// Bronnaam -> brontthema, uit bronnen.json (voor pers-groepering).
function bouwNaamNaarThema() {
  const map = new Map();
  for (const b of laadBronnen()) if (b.naam) map.set(b.naam, b.thema);
  return map;
}

// Eerste zin als teaser (val terug op een nette afkapping).
export function eersteZin(tekst, max = 150) {
  const s = String(tekst || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const punt = s.search(/[.!?](\s|$)/);
  let zin = punt > -1 ? s.slice(0, punt + 1) : s;
  if (zin.length > max) zin = `${zin.slice(0, max - 1).trimEnd()}…`;
  return zin;
}

// Korte kop afleiden als er geen door het model geleverde kop is (bv. voor
// concepten van vóór deze versie). Neemt de eerste zin en kapt netjes op een
// woordgrens rond maxLen tekens — niet te kort, geen halve woorden.
export function afleidKop(tekst, maxLen = 72) {
  const zin = eersteZin(tekst, 200).replace(/[.!?…]+$/, "").trim();
  if (zin.length <= maxLen) return zin;
  const knip = zin.slice(0, maxLen);
  const spatie = knip.lastIndexOf(" ");
  return `${(spatie > 30 ? knip.slice(0, spatie) : knip).trimEnd()}…`;
}

// Welke pers-tegel hoort bij een publicatie? We kijken naar de EIGEN NL-tekst
// (kop + synthese), niet naar de Franse brontitels — die kunnen door losse
// clustering vervuild zijn en een verhaal in de verkeerde tegel duwen.
// Volgorde: bosbranden -> verkeer -> brontthema-fallback (landelijk/regionaal).
export function persTegelVoor(pub, naamNaarThema) {
  const tekstBlob = normaliseer(`${pub.kop || ""} ${pub.tekst || ""}`);
  if (BOSBRAND_WOORDEN.some((w) => tekstBlob.includes(w))) return "bosbranden";
  if (VERKEER_WOORDEN.some((w) => tekstBlob.includes(w))) return "verkeer";
  const tel = {};
  for (const b of pub.bronnen || []) {
    const brontThema = naamNaarThema.get(b.naam);
    const tegel = BRONTHEMA_NAAR_PERSTEGEL[brontThema];
    if (tegel) tel[tegel] = (tel[tegel] || 0) + 1;
  }
  let beste = "landelijk";
  let max = 0;
  for (const [tegel, n] of Object.entries(tel)) {
    if (n > max) {
      max = n;
      beste = tegel;
    }
  }
  return beste;
}

function versFilter(nu) {
  const grens = MAX_NIEUWS_LEEFTIJD_DAGEN * 24 * 60 * 60 * 1000;
  return (iso) => {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && nu - t <= grens;
  };
}

function persArtikel(pub) {
  const titel = (pub.kop && pub.kop.trim()) || afleidKop(pub.tekst);
  return {
    id: pub.id,
    titel,
    summary: eersteZin(pub.tekst),
    tekst: pub.tekst,
    bronnen: pub.bronnen || [],
    label: REDACTIE_LABEL,
  };
}

// ---- Hoofdfunctie -----------------------------------------------------------
// publicaties : gepubliceerde perssyntheses (KV)   -> groene thema-tegels
// overheidDocs: NL-overheidsberichten (KV)          -> bordeaux thema-tegels
// items       : live feed-items (voor infofrankrijk + verenigingen)
export function assembleerTegels({ publicaties = [], overheidDocs = [], items = [], nu = Date.now() }) {
  const vers = versFilter(nu);
  const naamNaarThema = bouwNaamNaarThema();
  const versGrens = HOT_VENSTER_UREN * 60 * 60 * 1000;
  const tegels = [];

  // 1) PERS -> thema-tegels (bosbranden / landelijk / regionaal), nieuwste eerst.
  const perTegel = new Map();
  for (const p of publicaties) {
    if (!p || !p.gepubliceerd || !p.tekst) continue;
    if (!vers(p.clusterLaatste || p.gepubliceerdOp)) continue;
    const groep = persTegelVoor(p, naamNaarThema);
    if (!perTegel.has(groep)) perTegel.set(groep, []);
    const hot = p.clusterLaatste
      ? nu - (Date.parse(p.clusterLaatste) || 0) < versGrens
      : false;
    perTegel.get(groep).push({ pub: p, hot });
  }
  for (const groep of PERS_TEGELS) {
    const lijst = perTegel.get(groep);
    if (!lijst || !lijst.length) continue;
    lijst.sort(
      (a, b) => (Date.parse(b.pub.gepubliceerdOp) || 0) - (Date.parse(a.pub.gepubliceerdOp) || 0)
    );
    tegels.push({
      soort: "pers",
      id: `pers-${groep}`,
      thema: groep,
      label: PERS_TEGEL_LABEL[groep] || groep,
      accent: "groen",
      badge: "Redactie",
      hot: lijst.some((x) => x.hot),
      artikelen: lijst.map((x) => persArtikel(x.pub)),
    });
  }

  // 2) OVERHEID -> thema-tegels (per OVERHEID_THEMAS-volgorde). Eén bron per bericht.
  const perThema = new Map();
  for (const d of overheidDocs) {
    if (!d || !d.samenvatting) continue;
    if (!vers(d.datum || d.gepubliceerdOp)) continue;
    if (!perThema.has(d.thema)) perThema.set(d.thema, []);
    perThema.get(d.thema).push(d);
  }
  for (const thema of OVERHEID_THEMAS) {
    const lijst = perThema.get(thema);
    if (!lijst || !lijst.length) continue;
    lijst.sort((a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0));
    tegels.push({
      soort: "overheid",
      id: `overheid-${thema}`,
      thema,
      label: OVERHEID_THEMA_LABEL[thema] || thema,
      accent: "brand",
      badge: "Overheid",
      hot: false,
      artikelen: lijst.map((d) => ({
        id: d.id,
        titel: (d.kop && d.kop.trim()) || afleidKop(d.samenvatting),
        summary: eersteZin(d.samenvatting),
        tekst: d.samenvatting,
        bronnen: [{ naam: d.bron, titel: d.titelBron || null, url: d.url, datum: d.datum }],
      })),
    });
  }

  // 3) INFOFRANKRIJK -> eigen tegel (eigen content: titel + summary + link).
  const info = items
    .filter((i) => i.thema === "infofrankrijk")
    .filter((i) => vers(i.datum))
    .sort((a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0))
    .slice(0, 12);
  if (info.length) {
    tegels.push({
      soort: "infofrankrijk",
      id: "infofrankrijk",
      thema: "infofrankrijk",
      label: INFOFRANKRIJK_LABEL,
      accent: "groen",
      badge: "Infofrankrijk",
      hot: false,
      artikelen: info.map((i) => ({
        id: `if-${i.url}`,
        titel: i.titel,
        summary: eersteZin(i.samenvatting) || i.titel,
        tekst: i.samenvatting || "",
        bronnen: [{ naam: "Infofrankrijk", titel: i.titel, url: i.url, datum: i.datum }],
      })),
    });
  }

  // 4) VERENIGINGEN -> eigen tegel (al NL, uit de live feed).
  const ver = items
    .filter((i) => i.thema === "verenigingen")
    .filter((i) => vers(i.datum))
    .sort((a, b) => (Date.parse(b.datum) || 0) - (Date.parse(a.datum) || 0))
    .slice(0, 20);
  if (ver.length) {
    tegels.push({
      soort: "verenigingen",
      id: "verenigingen",
      thema: "verenigingen",
      label: VERENIGINGEN_LABEL,
      accent: "groen",
      badge: "Uit de feed",
      hot: false,
      artikelen: ver.map((i) => ({
        id: `ver-${i.url}`,
        titel: i.titel,
        summary: eersteZin(i.samenvatting) || i.titel,
        tekst: i.samenvatting || "",
        bronnen: [{ naam: i.bron, titel: i.titel, url: i.url, datum: i.datum }],
      })),
    });
  }

  return tegels;
}
