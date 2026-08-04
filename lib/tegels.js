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

import { laadBronnen, normaliseer, buitenlandDoorlaatNL } from "./feeds.js";
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
  ARCHIEF_NA_UREN,
  PUBLICATIE_TTL_S,
  OVERHEID_ARCHIEF_NA_DAGEN,
  OVERHEID_MAX_LIVE_PER_TEGEL,
  OVERHEID_TTL_S,
  VENSTER_INFOFRANKRIJK_DAGEN,
  VENSTER_VERENIGINGEN_DAGEN,
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

function versFilter(nu, dagen = MAX_NIEUWS_LEEFTIJD_DAGEN) {
  const grens = dagen * 24 * 60 * 60 * 1000;
  return (iso) => {
    const t = Date.parse(iso);
    return !Number.isNaN(t) && nu - t <= grens;
  };
}

// Eén overheidsbericht als artikel (herbruikt voor live-tegel én archief).
function overheidArtikel(d) {
  return {
    id: d.id,
    // `soort` stuurt de onderregel in de weergave: één afzender (overheid,
    // Infofrankrijk, vereniging) krijgt de bronregel, een perssynthese krijgt
    // de NLFR-byline. Zie artikelHTML() in actueel.html.
    soort: "overheid",
    titel: (d.kop && d.kop.trim()) || afleidKop(d.samenvatting),
    summary: eersteZin(d.samenvatting),
    tekst: d.samenvatting,
    bronnen: [{ naam: d.bron, titel: d.titelBron || null, url: d.url, datum: d.datum }],
  };
}

function persArtikel(pub) {
  const titel = (pub.kop && pub.kop.trim()) || afleidKop(pub.tekst);
  return {
    id: pub.id,
    // Perssynthese: eigen redactioneel product met meerdere bronnen. De
    // onderregel toont daarom de redactie en de publicatiedatum, niet de eerste
    // krant uit de bronnenlijst.
    soort: "pers",
    datum: pub.gepubliceerdOp || null,
    titel,
    summary: eersteZin(pub.tekst),
    tekst: pub.tekst,
    bronnen: pub.bronnen || [],
    label: REDACTIE_LABEL,
  };
}

// ---- Dedup in de weergave --------------------------------------------------
// Ook na de cron-dedup kan hetzelfde verhaal dubbel in de weergave belanden:
// twee losse publicaties over hetzelfde nieuws (van vóór de dedup-fix), of één
// overheidsbericht dat via twee feeds (Service-Public particuliers én
// professionnels) binnenkomt. We groeperen bijna-gelijke teksten en houden de
// EERSTE (de aanroeper sorteert vooraf op "beste").
function dedupTokens(s) {
  return new Set(
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
  );
}
function dedupJaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const w of a) if (b.has(w)) i += 1;
  return i / (a.size + b.size - i);
}
// Pers-dedup: twee syntheses van hetzelfde verhaal worden door de synthese
// verschillend verwoord (tekstoverlap faalt), maar ze delen vrijwel altijd
// dezelfde BRON-URL's. Dat is het betrouwbare signaal: ≥ 2 identieke bronlinks
// (of voldoende tekstoverlap) = duplicaat. De lijst is vooraf op "beste" gesorteerd.
function bronUrlSet(p) {
  return new Set((p.bronnen || []).map((b) => b && b.url).filter(Boolean));
}
// Overheid-dedup: hetzelfde artikel komt soms via twee feeds binnen (Service-
// Public particuliers én professionnels) met een IDENTIEKE artikel-URL op de
// tracking-parameter na (…/A19013?xtor=RSS-111 vs …?xtor=RSS-112). Dedup daarom
// primair op host+pad (zonder querystring), met tekstoverlap als vangnet.
function urlPad(u) {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return String(u || "");
  }
}
function ontdubbelOverheid(lijst) {
  const gezienUrl = new Set();
  const gezienTok = [];
  const uit = [];
  for (const d of lijst) {
    const bronUrl = d.url || (d.bronnen && d.bronnen[0] && d.bronnen[0].url) || "";
    const pad = urlPad(bronUrl);
    if (pad && gezienUrl.has(pad)) continue;
    const tok = dedupTokens(`${d.kop || ""} ${d.samenvatting || ""}`);
    if (gezienTok.some((g) => dedupJaccard(tok, g) >= 0.5)) continue;
    if (pad) gezienUrl.add(pad);
    gezienTok.push(tok);
    uit.push(d);
  }
  return uit;
}

function ontdubbelPers(lijst) {
  const gezienUrls = [];
  const gezienTok = [];
  const uit = [];
  for (const p of lijst) {
    const urls = bronUrlSet(p);
    const tok = dedupTokens(`${p.kop || ""} ${p.tekst || ""}`);
    let dup = false;
    for (let i = 0; i < gezienUrls.length; i += 1) {
      let gedeeld = 0;
      for (const u of urls) if (gezienUrls[i].has(u)) gedeeld += 1;
      if (gedeeld >= 2 || dedupJaccard(tok, gezienTok[i]) >= 0.45) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    gezienUrls.push(urls);
    gezienTok.push(tok);
    uit.push(p);
  }
  return uit;
}

// ---- Hoofdfunctie -----------------------------------------------------------
// publicaties : gepubliceerde perssyntheses (KV)   -> groene thema-tegels
// overheidDocs: NL-overheidsberichten (KV)          -> bordeaux thema-tegels
// items       : live feed-items (voor infofrankrijk + verenigingen)
export function assembleerTegels({ publicaties = [], overheidDocs = [], items = [], nu = Date.now() }) {
  const versInfo = versFilter(nu, VENSTER_INFOFRANKRIJK_DAGEN);
  const versVer = versFilter(nu, VENSTER_VERENIGINGEN_DAGEN);
  const naamNaarThema = bouwNaamNaarThema();

  // Dedup vóór indeling. Pers: sorteer op meeste bronnen -> nieuwste, zodat de
  // beste synthese de dubbelen wint. Overheid: nieuwste eerst; hetzelfde bericht
  // uit twee feeds verschijnt zo maar in één tegel.
  const persPubs = ontdubbelPers(
    [...publicaties].sort(
      (a, b) =>
        (b.bronnen ? b.bronnen.length : 0) - (a.bronnen ? a.bronnen.length : 0) ||
        (Date.parse(b.gepubliceerdOp) || 0) - (Date.parse(a.gepubliceerdOp) || 0)
    )
  );
  const overheidUniek = ontdubbelOverheid(
    [...overheidDocs].sort(
      (a, b) =>
        (Date.parse(b.datum || b.gepubliceerdOp) || 0) -
        (Date.parse(a.datum || a.gepubliceerdOp) || 0)
    )
  );
  const versGrens = HOT_VENSTER_UREN * 60 * 60 * 1000;
  const tegels = [];

  // 1) PERS -> thema-tegels (bosbranden / verkeer / landelijk / regionaal).
  // Levenscyclus op basis van publicatietijd: eerste 48 u live in de tegel,
  // daarna naar "Archief" (met "blijft nog X dagen"), na 14 dagen weg.
  const LIVE_MS = ARCHIEF_NA_UREN * 60 * 60 * 1000;
  const TTL_MS = PUBLICATIE_TTL_S * 1000;
  const DAG_MS = 24 * 60 * 60 * 1000;
  const perTegel = new Map();
  const archief = [];
  for (const p of persPubs) {
    if (!p || !p.gepubliceerd || !p.tekst) continue;
    // Buitenland-vangnet: een vóór de filterfix gepubliceerde niet-Frankrijk-
    // synthese mag niet 14 dagen blijven staan.
    if (!buitenlandDoorlaatNL(`${p.kop || ""} ${p.tekst || ""}`)) continue;
    const gepubT = Date.parse(p.gepubliceerdOp) || 0;
    const leeftijd = nu - gepubT;
    if (leeftijd >= TTL_MS) continue; // te oud (TTL zou dit al hebben verwijderd)
    // Naar archief als het 48 u live is geweest, óf als de redactie het handmatig
    // heeft gearchiveerd (knop "Toevoegen aan archief").
    if (p.gearchiveerd || leeftijd >= LIVE_MS) {
      const art = persArtikel(p);
      art.restDagen = Math.max(1, Math.ceil((TTL_MS - leeftijd) / DAG_MS));
      art.themaLabel = PERS_TEGEL_LABEL[persTegelVoor(p, naamNaarThema)] || "";
      archief.push({ art, gepubT });
      continue;
    }
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
  // Levenscyclus: eerste OVERHEID_ARCHIEF_NA_DAGEN dagen live in de thema-tegel,
  // daarna naar Archief (met "blijft nog X dagen"), na OVERHEID_TTL_S weg.
  const OVERHEID_LIVE_MS = OVERHEID_ARCHIEF_NA_DAGEN * DAG_MS;
  const OVERHEID_TTL_MS = OVERHEID_TTL_S * 1000;
  // Verzamel per thema alles wat nog binnen de TTL valt; live/archief bepalen we
  // daarna (op leeftijd én op de volumecap per tegel).
  const perThema = new Map();
  for (const d of overheidUniek) {
    if (!d || !d.samenvatting) continue;
    const t = Date.parse(d.datum || d.gepubliceerdOp) || 0;
    if (nu - t >= OVERHEID_TTL_MS) continue; // te oud
    if (!perThema.has(d.thema)) perThema.set(d.thema, []);
    perThema.get(d.thema).push({ d, t });
  }
  for (const thema of OVERHEID_THEMAS) {
    const lijst = perThema.get(thema);
    if (!lijst || !lijst.length) continue;
    lijst.sort((a, b) => b.t - a.t); // nieuwste eerst
    const live = [];
    for (const { d, t } of lijst) {
      const leeftijd = nu - t;
      // Live als het jong genoeg is ÉN de tegel nog ruimte heeft; anders archief.
      if (leeftijd < OVERHEID_LIVE_MS && live.length < OVERHEID_MAX_LIVE_PER_TEGEL) {
        live.push(d);
        continue;
      }
      // GEEN archief-tegel meer voor overheid. Een bericht dat zijn live periode
      // heeft gehad, verhuist naar het duurzame regelgevingsregister (/archief);
      // de cron neemt het daar op en haalt het live record weg. Belandt het hier
      // toch nog even (cron loopt achter, of de tegel zit vol), dan tonen we het
      // simpelweg niet meer — de Archief-tegel is voortaan alleen voor pers.
      void leeftijd;
    }
    if (!live.length) continue;
    tegels.push({
      soort: "overheid",
      id: `overheid-${thema}`,
      thema,
      label: OVERHEID_THEMA_LABEL[thema] || thema,
      accent: "brand",
      badge: "Overheid",
      hot: false,
      artikelen: live.map(overheidArtikel),
    });
  }

  // 3) INFOFRANKRIJK -> eigen tegel (eigen content: titel + summary + link).
  const info = items
    .filter((i) => i.thema === "infofrankrijk")
    .filter((i) => versInfo(i.datum))
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
        soort: "infofrankrijk",
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
    .filter((i) => versVer(i.datum))
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
        soort: "verenigingen",
        titel: i.titel,
        summary: eersteZin(i.samenvatting) || i.titel,
        tekst: i.samenvatting || "",
        bronnen: [{ naam: i.bron, titel: i.titel, url: i.url, datum: i.datum }],
      })),
    });
  }

  // 5) ARCHIEF -> ingeklapte tegel onderaan met perssyntheses ouder dan 48 u.
  if (archief.length) {
    archief.sort((a, b) => b.gepubT - a.gepubT);
    tegels.push({
      soort: "archief",
      id: "archief",
      thema: "archief",
      label: "Archief",
      accent: "archief",
      badge: "",
      hot: false,
      artikelen: archief.map((x) => x.art),
    });
  }

  return tegels;
}
