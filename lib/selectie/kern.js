// Kern van de nieuwsselectie: pure functies, zonder netwerk of opslag.
// ---------------------------------------------------------------------------
// De cyclus: AI scant (bronnen.js) -> biedt aan met categorie, score, reden en
// PEIL-koppeling (model.js) -> de redactie geeft go of no-go (/selectie) ->
// goedgekeurde berichten staan in de publieke feed (/api/selectie-feed) en in
// de sidebar van Nederlanders.fr. Elke beslissing blijft bewaard: dat is het
// lesmateriaal voor de volgende selectie (voorbeeldenVoorModel).
//
// Alles hier is te testen zonder KV en zonder Anthropic.

import { normaliseer, hashId, faitsDiversDoorlaat, sportDoorlaat, buitenlandDoorlaat, buitenlandDoorlaatNL } from "../feeds.js";
import { SCORE_DREMPEL } from "../config.js";
import { FRANKRIJK_BEGIN, RUBRIEKEN, RUBRIEK_LABEL, SEL_FEED_MAX_MERKWAARDIG, PLEKKEN_VIJF, PLEK_IDS, LOS_PLEKKEN, CAFE_DOMEINEN, REDENEN as REDENEN_REGEL, VOORBEELDEN_MAX_PER_SOORT, VOORBEELD_MAX_TEKENS, METEN_MIN_BESLUITEN, METEN_DAGEN, SELECTIE_MAX_PER_BRON, SELECTIE_MAX_PER_BRON_UITZONDERING } from "../redactieregels.js";

// ---- Categorieën (de indeling van de redactie, 6 november 2026) ------------
export const CATEGORIEEN = RUBRIEKEN; // regelbestand
export const CATEGORIE_LABEL = RUBRIEK_LABEL;

// Opslag: kandidaten verlopen, beslissingen nooit.
export const SEL_PREFIX = "selectie:";
export const KEY_SEL_KANDIDAAT = (id) => `${SEL_PREFIX}kandidaat:${id}`;
export const KEY_SEL_BESLUIT = (id) => `${SEL_PREFIX}besluit:${id}`;
export const SCAN_SEL_KANDIDAAT = `${SEL_PREFIX}kandidaat:*`;
export const SCAN_SEL_BESLUIT = `${SEL_PREFIX}besluit:*`;
// Teruggedraaide beslissingen: blijven bewaard (geen TTL), los van de actieve
// besluiten, zodat ook een correctie van de redactie lesmateriaal blijft.
export const KEY_SEL_HISTORIE = (id, op) => `${SEL_PREFIX}historie:${id}:${op}`;
export const KEY_SEL_RONDE = `${SEL_PREFIX}ronde`;
export const KEY_SEL_PEIL = `${SEL_PREFIX}peil-cache`;
export const KEY_SEL_TOOLS = `${SEL_PREFIX}tools-cache`;
export const KEY_SEL_BLOKKADE = `${SEL_PREFIX}bronblokkade`; // { bronnen: [{ naam, op, door }] }, geen TTL
export const SEL_KANDIDAAT_TTL_S = 7 * 24 * 60 * 60;
// Besluiten en teruggedraaide besluiten hebben bewust GEEN vervaltermijn: het is
// lesmateriaal voor het model. Alleen kandidaten houden hun TTL (SEL_KANDIDAAT_TTL_S).
// Kandidaten ouder dan dit (uren, op moment van laatste schrijven) zijn buiten
// elk venster (48 u pers, 72 u overheid en scherm): ze worden niet meer gelezen.
export const SEL_LEES_UREN = 96;
export const SEL_PEIL_TTL_S = 6 * 60 * 60;
export const SEL_TOOLS_TTL_S = 6 * 60 * 60;
export const SEL_VENSTER_UREN = 48; // ouder persnieuws wordt niet meer aangeboden
export const SEL_MAX_PER_AANROEP = 12; // kandidaten per modelaanroep (binnen de 60 s van de functie)
export const SEL_MAX_NIEUW_PER_RONDE = 150; // zoveel nieuwe kandidaten worden per ronde hooguit opgeslagen
export const SEL_FEED_DAGEN = 7; // zo lang staat een goedgekeurd bericht in de feed
export const SEL_FEED_MAX_PER_CATEGORIE = 8;
export const SEL_PEIL_KANDIDATEN = 6; // PEIL-parameters die per bericht aan het model worden voorgelegd

// ---- Over Frankrijk? --------------------------------------------------------
// "frans" staat er bewust NIET in: dat is ook een voornaam (Frans Timmermans).
const FRANKRIJK_WOORDEN = FRANKRIJK_BEGIN; // lijst in lib/redactieregels.js

export function gaatOverFrankrijk(tekst) {
  const n = normaliseer(tekst);
  return FRANKRIJK_WOORDEN.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n));
}

// ---- De zeven op de selectiestroom (regel R11) --------------------------------
// Dezelfde zeven als de persstroom (faits divers, sport, buitenland), vóór het
// model. Nederlandstalige berichten (land NL of BE) gaan door de NL-variant van
// de buitenlandzeef, Franse door de Franse. Geeft true als het bericht door mag.
export function zeefDoorlaat(item) {
  const tekst = `${item.titel || ""}`;
  if (!faitsDiversDoorlaat(tekst)) return false;
  if (!sportDoorlaat(tekst)) return false;
  const nl = item.land === "NL" || item.land === "BE";
  return nl ? buitenlandDoorlaatNL(tekst) : buitenlandDoorlaat(tekst);
}
// Per bron hooguit `max` nieuwste berichten (regel R13). Items zonder bron tellen als één bron.
export function maxPerBron(items, max = SELECTIE_MAX_PER_BRON, uitzondering = SELECTIE_MAX_PER_BRON_UITZONDERING, sleutel = (i) => i.bron) {
  const telling = new Map();
  const nieuwste = [...items].sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")));
  const door = new Set();
  for (const i of nieuwste) {
    const naam = sleutel(i) || "";
    const grens = Object.prototype.hasOwnProperty.call(uitzondering, naam) ? uitzondering[naam] : max;
    const n = telling.get(naam) || 0;
    if (n >= grens) continue;
    telling.set(naam, n + 1);
    door.add(i);
  }
  return items.filter((i) => door.has(i));
}

// ---- Feeds lezen ------------------------------------------------------------
function tag(blok, naam) {
  const m = blok.match(new RegExp(`<${naam}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${naam}>`, "i"));
  return m ? m[1] : "";
}

function ontsnap(tekst) {
  return String(tekst || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function linkVan(blok) {
  const tekstLink = ontsnap(tag(blok, "link"));
  if (/^https?:\/\//.test(tekstLink)) return tekstLink;
  const href = blok.match(/<link[^>]*href="([^"]+)"/i);
  return href ? href[1].replace(/&amp;/g, "&") : "";
}

function iso(datum) {
  const t = Date.parse(ontsnap(datum));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// RSS 2.0 of Atom naar ruwe items. Bij Google News staat de redactie in
// <source> en hangt " - Redactie" achter de kop: die gaat eraf.
export function leesPersFeed(xml, bron) {
  const uit = [];
  const blokken = [...String(xml || "").matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  for (const blok of blokken) {
    let titel = ontsnap(tag(blok, "title"));
    const url = linkVan(blok);
    if (!titel || !url) continue;
    let redactie = bron.naam;
    if (bron.googleNews) {
      const bronTag = ontsnap(tag(blok, "source"));
      if (bronTag) redactie = bronTag;
      const staart = ` - ${redactie}`;
      if (redactie && titel.endsWith(staart)) titel = titel.slice(0, -staart.length).trim();
      else titel = titel.replace(/\s+-\s+[^-]{2,40}$/, "").trim();
    }
    const samenvatting = bron.googleNews ? "" : ontsnap(tag(blok, "description") || tag(blok, "summary")).slice(0, 400);
    uit.push({
      soort: "pers",
      titel,
      url,
      bron: redactie,
      land: bron.land,
      datum: iso(tag(blok, "pubDate") || tag(blok, "published") || tag(blok, "updated")),
      samenvatting,
      viaGoogleNews: Boolean(bron.googleNews),
    });
  }
  return uit;
}

// ---- Meteo: MeteoAlarm-Atom naar één kandidaat per kleur en type ----------
const METEO_TYPE = {
  "rain-flood": "regen en overstromingen",
  rain: "zware regen",
  flooding: "overstromingen",
  wind: "storm",
  thunderstorm: "onweer",
  "snow-ice": "sneeuw en ijzel",
  snow: "sneeuw",
  avalanches: "lawinegevaar",
  "coastal event": "hoge golven aan de kust",
  "high-temperature": "hitte",
  "low-temperature": "kou",
  "forest-fire": "bosbrandgevaar",
  fog: "mist",
};
const METEO_KLEUR = { orange: "Oranje", red: "Rode" };

export function leesMeteoFeed(xml, nu = Date.now()) {
  const groepen = new Map();
  const blokken = [...String(xml || "").matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  for (const blok of blokken) {
    const titel = ontsnap(tag(blok, "title"));
    const m = titel.match(/^(Yellow|Orange|Red)\s+(.+?)\s+Warning issued for France\s*-\s*(.+)$/i);
    if (!m) continue;
    const kleur = m[1].toLowerCase();
    if (!METEO_KLEUR[kleur]) continue; // geel telt niet
    const verloopt = Date.parse(ontsnap(tag(blok, "cap:expires")));
    if (Number.isFinite(verloopt) && verloopt < nu) continue;
    const type = m[2].toLowerCase();
    const sleutel = `${kleur}|${type}`;
    const g = groepen.get(sleutel) || { kleur, type, gebieden: new Set(), verloopt: 0, begint: null };
    g.gebieden.add(m[3].trim());
    if (Number.isFinite(verloopt)) g.verloopt = Math.max(g.verloopt, verloopt);
    const begint = iso(tag(blok, "cap:onset") || tag(blok, "published"));
    if (begint && (!g.begint || begint < g.begint)) g.begint = begint;
    groepen.set(sleutel, g);
  }
  const uit = [];
  for (const g of groepen.values()) {
    const gebieden = [...g.gebieden].sort((a, b) => a.localeCompare(b, "fr"));
    const typeNl = METEO_TYPE[g.type] || g.type;
    const dag = (g.begint || new Date(nu).toISOString()).slice(0, 10);
    uit.push({
      soort: "meteo",
      titel: `${METEO_KLEUR[g.kleur]} waarschuwing voor ${typeNl}: ${gebieden.join(", ")}`,
      url: "https://vigilance.meteofrance.fr/fr",
      bron: "Météo-France vigilance",
      land: "FR",
      datum: g.begint,
      samenvatting: `${METEO_KLEUR[g.kleur]} vigilance van Météo-France voor ${typeNl} in ${gebieden.length} departement${gebieden.length === 1 ? "" : "en"}.`,
      verloopt: g.verloopt ? new Date(g.verloopt).toISOString() : null,
      kleur: g.kleur,
      // Eén id per kleur, type en dag: een uitbreiding van dezelfde waarschuwing
      // naar meer departementen is geen nieuw bericht.
      idBasis: `meteo|${g.kleur}|${g.type}|${dag}`,
    });
  }
  return uit;
}

// ---- Identiteit en ontdubbeling --------------------------------------------
const STOP = new Set(
  "de het een en van in op te dat die is voor met aan bij als zijn er om ook niet naar uit door over na tot nog dan wel maar of hij zij ze we je u wat wie hoe waar wordt worden werd heeft hebben had kan kunnen moet moeten zal zullen deze dit meer veel".split(" ")
);

export function kernwoorden(tekst) {
  return [...new Set(
    normaliseer(tekst)
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  )];
}

export function overlap(a, b) {
  const A = new Set(kernwoorden(a));
  const B = new Set(kernwoorden(b));
  if (!A.size || !B.size) return 0;
  let gedeeld = 0;
  for (const w of A) if (B.has(w)) gedeeld += 1;
  return gedeeld / (A.size + B.size - gedeeld);
}

export function kandidaatId(item) {
  if (item.idBasis) return hashId(item.idBasis);
  return hashId(kernwoorden(item.titel).sort().join(" "));
}

// Houdt per verhaal één item: een directe redactie gaat voor op Google News
// (dan linken we naar het artikel zelf en niet naar een doorverwijzing).
export function ontdubbel(items, drempel = 0.5) {
  const geordend = [...items].sort((a, b) => Number(a.viaGoogleNews) - Number(b.viaGoogleNews));
  const uit = [];
  for (const it of geordend) {
    if (uit.some((u) => u.soort === it.soort && overlap(u.titel, it.titel) >= drempel)) continue;
    uit.push(it);
  }
  return uit;
}

export function binnenVenster(item, nu = Date.now(), uren = SEL_VENSTER_UREN) {
  if (item.soort === "meteo") return true; // daar telt de vervaldatum
  if (!item.datum) return false; // ongedateerd persnieuws bieden we niet aan
  const t = Date.parse(item.datum);
  return Number.isFinite(t) && nu - t <= uren * 3600 * 1000 && t <= nu + 3600 * 1000;
}

// ---- PEIL: voorselectie per bericht -----------------------------------------
// Het model krijgt per bericht alleen de parameters te zien waarvan de
// trefwoorden in de tekst voorkomen. Zo blijft de aanroep klein en kan het
// model geen parameter-id verzinnen: het kiest uit wat het voorgelegd krijgt.
// Gewone woorden die in parameternamen staan maar niets over het onderwerp
// zeggen ("zonder partner", "twee jaar", "vanaf 2027"). Gemeten op de echte
// persstroom van 7 november 2026: zonder deze lijst koppelde "Frankrijk zonder
// Dembélé" aan de zorgtoeslag.
const PEIL_STOP = new Set(
  ("frankrijk franse nederland nederlandse belgie procent euro jaar jaren tarief regel regels zonder twee drie vier " +
    "vanaf eerste tweede verplicht maand maanden per auto boven onder hoog laag nieuw nieuwe oude grens grenzen " +
    "minimum maximum bedrag bedragen totaal korting partner").split(" ")
);

// Trefwoorden zijn met de hand gekozen: daar tellen ook korte afkortingen
// (cak, aow, csg, cfe, ifi, dpe). Uit de namen alleen langere woorden.
export function peilTermen(p) {
  const tref = kernwoorden(p.trefwoorden || "").filter((w) => w.length >= 3 && !PEIL_STOP.has(w));
  const naam = kernwoorden(`${p.naam || ""} ${p.naam_fr || ""}`).filter((w) => w.length >= 5 && !PEIL_STOP.has(w));
  return [...new Set([...tref, ...naam])];
}

// Rangschikt op zeldzaamheid: een term die in vier parameters voorkomt (cak)
// zegt meer dan een term die in twintig voorkomt (pensioen). Een parameter
// komt alleen door bij één zeldzame term (in hooguit 8 parameters) of bij
// minstens twee termen.
export function peilVoorselectie(tekst, parameters, max = SEL_PEIL_KANDIDATEN) {
  const lijst = parameters || [];
  const woorden = new Set(kernwoorden(tekst));
  const n = normaliseer(tekst);
  const termenPer = lijst.map((p) => peilTermen(p));
  const df = new Map();
  for (const termen of termenPer) for (const t of termen) df.set(t, (df.get(t) || 0) + 1);
  const scores = [];
  lijst.forEach((p, i) => {
    let score = 0;
    let raak = 0;
    let zeldzaam = false;
    for (const t of termenPer[i]) {
      const gevonden = woorden.has(t) || (t.length >= 7 && n.includes(t)); // samenstellingen
      if (!gevonden) continue;
      const d = df.get(t) || 1;
      raak += 1;
      if (d <= 8) zeldzaam = true;
      score += Math.log(1 + lijst.length / d);
    }
    if (zeldzaam || raak >= 2) scores.push({ p, score });
  });
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, max).map((s) => s.p);
}

export function peilKort(p) {
  return {
    id: p.id,
    naam: p.naam,
    waarde: String(p.waarde_weergave || "").slice(0, 220),
    land: p.land || null,
    verificatiedatum: p.verificatiedatum || null,
    bronUrl: p.bron_url || null,
    tools: (p.tools || []).filter((t) => t && t.naam).map((t) => ({ naam: t.naam, url: t.url || null })),
  };
}

// ---- Toolcatalogus (Infopoche) ---------------------------------------------
// De lijst met tools komt uit de modulecatalogus van Infopoche (modules.json),
// zodat er geen tweede lijst bestaat. Alleen tools die af zijn, zichtbaar zijn
// en een eigen adres hebben. De link gaat naar het uitlegartikel op
// Infofrankrijk als dat er is, anders naar de tool zelf.
// Toegestaan: "af", "inhoud af" en "deels af" (live en in gebruik in
// Infopoche, zoals Veiligheid & natuur). Geen status, "in bouw" of "in
// ontwikkeling" doet niet mee.
const TOOL_STATUS_OK = new Set(["af", "inhoud af", "deels af"]);
export function toolCatalogus(doc) {
  const modules = Array.isArray(doc) ? doc : doc && Array.isArray(doc.modules) ? doc.modules : [];
  const uit = [];
  for (const m of modules) {
    if (!m || !m.id || !m.naam || m.zichtbaar === false) continue;
    if (!TOOL_STATUS_OK.has(String(m.status || "").trim().toLowerCase())) continue;
    const url = [m.artikel, m.url].find((u) => /^https:\/\//.test(String(u || "")));
    if (!url) continue;
    uit.push({ id: String(m.id), naam: String(m.naam).slice(0, 80), meta: String(m.meta || "").slice(0, 160), url });
  }
  return uit;
}

// Café Claude heeft vakgebieden (Anton, 20-11-2026: "Vraag het Café Claude"
// zonder vakgebied klopt niet). Ze staan bij de thema's in modules.json als
// cafe: {domein, tekst}; de link is de url van de module cafeclaude met
// ?domain=<domein>, zoals Infopoche hem maakt.
export function cafeDomeinen(doc) {
  const modules = doc && Array.isArray(doc.modules) ? doc.modules : [];
  const cc = modules.find((m) => m && m.id === "cafeclaude" && /^https:\/\//.test(String(m.url || "")));
  if (!cc) return [];
  const gezien = new Set();
  const uit = [];
  for (const t of [...((doc && doc.themas) || []), ...((doc && doc.groepen) || [])]) {
    const c = t && t.cafe;
    if (!c || !c.domein || gezien.has(c.domein) || !/^[a-z0-9-]{2,40}$/.test(String(c.domein))) continue;
    gezien.add(c.domein);
    let url;
    try { const u = new URL(cc.url); u.searchParams.set("domain", c.domein); url = u.href; } catch { continue; }
    uit.push({ domein: String(c.domein), tekst: String(c.tekst || `Vraag het Café Claude (${c.domein})`).slice(0, 120), url });
  }
  return uit;
}

// Catalogus als array (alleen tools, oud) of als {tools, cafe}.
export function normCatalogus(x) {
  if (Array.isArray(x)) return { tools: x, cafe: [] };
  return { tools: (x && x.tools) || [], cafe: (x && x.cafe) || [] };
}

export const PRIOS = ["1", "2", "3", "4", "5", "6a", "6b", "7", "8", "9", "m", "0"];
// Oude vier waarden (veld `plek`, blijft voor oude oordelen en het scherm) en de
// vijf plekken van het regelbestand (veld `plekken`, het model kent die nu).
export const PLEKKEN = ["nieuwspagina", "zijbalk", "beide", "weg"];

// Een los krantenbericht (soort pers of meteo uit de selectiestroom) mag alleen
// naar de plekken met losMag (regelbestand). Overheid mag overal heen.
export function plekkenVoorSoort(soort, plekken) {
  const lijst = (Array.isArray(plekken) ? plekken : []).filter((p) => PLEK_IDS.includes(p));
  const uniek = [...new Set(lijst)];
  const los = soort === "pers" || soort === "meteo";
  const mag = los ? uniek.filter((p) => LOS_PLEKKEN.includes(p)) : uniek;
  // nieuwsbrief en Infopoche volgen de nieuwspagina
  return mag.filter((p) => {
    const def = PLEKKEN_VIJF.find((x) => x.id === p);
    return !(def && def.volgtNieuwspagina) || mag.includes("nieuwspagina");
  });
}
// Oud veld `plek` uit de vijf plekken (voor het scherm en de feed).
export function plekUitPlekken(plekken) {
  const np = plekken.includes("nieuwspagina"), zb = plekken.includes("zijbalk");
  if (np && zb) return "beide";
  if (np) return "nieuwspagina";
  if (zb || plekken.includes("infofrankrijk")) return "zijbalk";
  return "weg";
}
export function plekkenUitPlek(plek) {
  return plek === "beide" ? ["nieuwspagina", "zijbalk"] : plek === "nieuwspagina" ? ["nieuwspagina"] : plek === "zijbalk" ? ["zijbalk"] : [];
}

// ---- Wat het model terugstuurt ----------------------------------------------
// Verwacht een JSON-array. Alles wat niet klopt wordt weggelaten in plaats van
// geraden: een onbekende categorie wordt "geen", een PEIL-id die niet was
// voorgelegd verdwijnt.
export function leesModelAntwoord(ruw, aangeboden, catalogus = []) {
  const { tools, cafe } = normCatalogus(catalogus);
  const toolOpId = new Map((tools || []).map((t) => [t.id, t]));
  const cafeOpDomein = new Map((cafe || []).map((c) => [c.domein, c]));
  const tekst = String(ruw || "");
  const begin = tekst.indexOf("[");
  const eind = tekst.lastIndexOf("]");
  if (begin < 0 || eind <= begin) throw new Error("Modelantwoord bevat geen JSON-array.");
  let lijst;
  try {
    lijst = JSON.parse(tekst.slice(begin, eind + 1));
  } catch (e) {
    throw new Error(`Modelantwoord is geen geldige JSON: ${e.message}`);
  }
  if (!Array.isArray(lijst)) throw new Error("Modelantwoord is geen array.");
  const uit = new Map();
  for (const r of lijst) {
    const nr = Number(r && r.nr);
    const item = aangeboden[nr - 1];
    if (!item) continue;
    const categorie = CATEGORIEEN.includes(r.categorie) ? r.categorie : "geen";
    const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
    const toegestaan = new Map((item.peilAangeboden || []).map((p) => [p.id, p]));
    const peil = [];
    for (const x of Array.isArray(r.peil) ? r.peil : []) {
      const p = toegestaan.get(x && x.id);
      if (!p) continue;
      const soort = x.soort === "mogelijk-gewijzigd" ? "mogelijk-gewijzigd" : "raakt";
      peil.push({ ...p, soort, toelichting: String(x.toelichting || "").slice(0, 240) });
    }
    const gat = r.gat ? String(r.gat).slice(0, 240) : null;
    const t = toolOpId.get(r && r.tool);
    const c = cafeOpDomein.get(r && r.cafe);
    const prio = PRIOS.includes(String(r.prio)) ? String(r.prio) : null;
    let plekken = Array.isArray(r.plekken) ? plekkenVoorSoort(item.soort, r.plekken) : null;
    if (score < SCORE_DREMPEL) plekken = [];
    if (plekken == null) {
      const oud = PLEKKEN.includes(r.plek) ? r.plek : score < SCORE_DREMPEL ? "weg" : "zijbalk";
      plekken = plekkenVoorSoort(item.soort, plekkenUitPlek(oud));
    }
    const plek = plekUitPlekken(plekken);
    const titelNl = r.titel_nl ? String(r.titel_nl).replace(/\s*[\u2013\u2014]\s*/g, ", ").slice(0, 200) : null;
    uit.set(item.id, {
      categorie,
      score,
      prio,
      plek,
      plekken,
      titelNl,
      reden: String(r.reden || "").slice(0, 300),
      peil,
      gat,
      tool: t ? { id: t.id, naam: t.naam, url: t.url } : null,
      cafe: c ? { domein: c.domein, tekst: c.tekst, url: c.url } : null,
    });
  }
  return uit;
}

// ---- Leren van eerdere beslissingen ----------------------------------------
// De laatste beslissingen gaan als voorbeelden mee naar het model: wat de
// redactie koos en wat ze liet liggen. Meer voorbeelden = beter afgestemd.
// Wat het model voorstelde en wat de redactie koos, als lijst plekken. Alleen de
// drie plekken die het besluit zelf bewaart (nieuwspagina, zijbalk, infofrankrijk);
// nieuwsbrief en Infopoche staan op het bericht, niet op het besluit.
const METEN_PLEKKEN = ["nieuwspagina", "zijbalk", "infofrankrijk"];
export function voorgesteldePlekken(b) {
  // Het voorstel zoals de pagina het toonde gaat voor het ruwe modelvoorstel.
  if (b && Array.isArray(b.voorstelPlekken)) return METEN_PLEKKEN.filter((p) => b.voorstelPlekken.includes(p));
  const ai = b && b.ai;
  if (!ai) return null;
  const lijst = Array.isArray(ai.plekken) ? ai.plekken : plekkenUitPlek(ai.plek);
  return METEN_PLEKKEN.filter((p) => lijst.includes(p));
}
export function gekozenPlekken(b) {
  if (!b) return [];
  if (Array.isArray(b.plekken)) return METEN_PLEKKEN.filter((p) => b.plekken.includes(p));
  if (b.besluit !== "go") return [];
  const uit = new Set(kanalenVan(b));
  if (b.redactie && (b.redactie.nieuwspagina === true || b.redactie.herkomst === "publicatie")) uit.add("nieuwspagina");
  return METEN_PLEKKEN.filter((p) => uit.has(p));
}
const zelfde = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
export function voorstelKlopte(b) {
  const v = voorgesteldePlekken(b);
  return v ? zelfde(v, gekozenPlekken(b)) : null;
}

// Meten: hoe vaak het voorstel gelijk was aan de keuze in de laatste METEN_DAGEN
// dagen. Rekent op de besluiten zelf (geen aparte teller die uit de pas kan lopen).
// tonen = pas bij minstens METEN_MIN_BESLUITEN besluiten.
export function meetVoorstel(besluiten, nu = Date.now()) {
  const grens = nu - METEN_DAGEN * 86400 * 1000;
  let klopt = 0, totaal = 0;
  for (const b of besluiten || []) {
    const t = Date.parse(b && b.besluitOp || "");
    if (!Number.isFinite(t) || t < grens) continue;
    const k = voorstelKlopte(b);
    if (k == null) continue;
    totaal += 1;
    if (k) klopt += 1;
  }
  return { dagen: METEN_DAGEN, klopt, totaal, tonen: totaal >= METEN_MIN_BESLUITEN };
}

// ---- Leren van eerdere beslissingen ----------------------------------------
// De beslissingen gaan als voorbeelden mee naar het model. Eerst de besluiten
// waarin het voorstel en de keuze verschilden (daar valt het meeste te leren),
// dan de nieuwste. Begrensd: VOORBEELDEN_MAX_PER_SOORT per soort.
export function voorbeeldenVoorModel(besluiten, maxPerSoort = VOORBEELDEN_MAX_PER_SOORT) {
  const recent = [...(besluiten || [])].sort((a, b) => String(b.besluitOp || "").localeCompare(String(a.besluitOp || "")));
  const kies = (lijst) => [...lijst.filter((b) => voorstelKlopte(b) === false), ...lijst.filter((b) => voorstelKlopte(b) !== false)].slice(0, maxPerSoort);
  return { go: kies(recent.filter((b) => b.besluit === "go")), nogo: kies(recent.filter((b) => b.besluit === "nogo")) };
}

// Eén voorbeeldregel: bron, titel, eigen voorstel, gekozen plekken en reden bij Nee.
export function voorbeeldRegel(b) {
  const v = voorgesteldePlekken(b);
  const g = gekozenPlekken(b);
  const lijst = (x) => (x && x.length ? x.join("+") : "weg");
  const delen = [];
  if (v) delen.push(`voorstel: ${lijst(v)}${b.ai && typeof b.ai.score === "number" ? ` (score ${b.ai.score})` : ""}`);
  delen.push(`gekozen: ${b.besluit === "go" ? lijst(g) : "weg"}`);
  if (b.besluit === "go" && b.categorie) delen.push(`rubriek: ${b.categorie}`);
  if (b.besluit === "nogo" && b.reden) delen.push(`reden: ${b.reden}`);
  const kop = `${b.besluit === "go" ? "GO" : "NO-GO"}${b.bron ? ` [${b.bron}]` : ""} ${b.titel}`;
  return `${kop} (${delen.join("; ")})`.slice(0, VOORBEELD_MAX_TEKENS);
}

// ---- Prompt -----------------------------------------------------------------
export const SYSTEM_SELECTIE = `Je bent de eerste lezer van de redactie van Nederlanders.fr en Infofrankrijk.com. De lezers zijn Nederlanders en Belgen die in Frankrijk wonen of er een tweede woning hebben, vaak ouder en op het platteland. De redacteur beslist; jij doet per bericht een voorstel: prioriteit, score, rubriek, plek, PEIL, tool en Café Claude.

Bepaal eerst de prioriteit, dan de score binnen de band. Kies de hoogste prioriteit die past.
Prio 1 (85-100): raakt Nederlanders of Belgen in Frankrijk of met een tweede woning daar direct: taxe d'habitation, taxe foncière, CAK, woonlandfactor, AOW en pensioen over de grens, zorgverzekering, dubbele nationaliteit, bankrekening, erfrecht NL-FR, belastingverdrag.
Prio 2 (70-89): raakt alle inwoners van Frankrijk: belastingen, wetswijzigingen, uitkeringen, subsidies voor energie en verduurzaming (MaPrimeRénov' en dergelijke), tarieven van notarissen, makelaars, energie en zorg.
Prio 3 (55-74): politiek en maatschappij met gevolgen: verkiezingen, regering, begroting en staatsschuld, overstromingen, bosbranden, droogte, grote stakingen.
Prio 4 (50-70): ondernemers in sectoren waar Nederlanders actief zijn: gîtes, chambres d'hôtes, toerisme, bouw en klussen, micro-entreprise, URSSAF, chambres de commerce.
Prio 5 (40-60): Frankrijk internationaal: EU-besluiten, samenwerking NL-FR of BE-FR, economie en recessie.
Prio 6a (45-65): reizen, praktisch: gesloten vliegvelden of routes van en naar NL en BE, wegwerkzaamheden, tunnels dicht, zwarte zaterdagen, stakingen in het vervoer.
Prio 6b (35-55): reizen, plezier: grote festivals, kerstmarkten (landelijk overzicht), grote brocantes zoals Lille.
Prio 7 meteo: oranje waarschuwing 65, rode 90.
Prio 8 sport: in principe 0-30. Groot toernooi met een Franse ploeg (voetbal, rugby) of Olympische Spelen 40-55. Wedstrijd Nederland-Frankrijk of België-Frankrijk 60.
Prio 9 (20-40): overig nieuws uit het Élysée en de ministeries zonder directe gevolgen voor de lezer.
Prio m (45-60): merkwaardig: een vreemd, grappig of verrassend voorval in Frankrijk waar een lezer om glimlacht of van opkijkt (een sjamaan die een politiebureau ontdoet van boze geesten, een burgemeester met een eigenaardig besluit, een dier dat een dorp op stelten zet). Het lichte element in het nieuws. Niet bij misdaad met slachtoffers, ongelukken, sterren en roddel, of als het buiten Frankrijk speelt.
Prio 0 (0-19): niet relevant: Nederlands binnenlands nieuws en bestuur (benoemingen, vacatures, Kamerbrieven, defensie-inzet, binnenlandse regelingen) tenzij het Nederlanders in Frankrijk of het buitenland raakt (AOW en pensioen, belasting buitenland, zorgverzekering verdragslanden, paspoort, rijbewijs en consulaire zaken, kiezers in het buitenland); Caribisch Nederland altijd; misdaad zonder bredere betekenis, buitenlandse politiek zonder gevolgen in Frankrijk, sterren en roddel.

Bijstellen: +10 als het bericht een concreet bedrag, tarief, datum of termijn noemt. -15 bij sensatie zonder gevolgen voor de lezer (niet bij prio m). -10 als het alleen een kleine plaats of streek raakt, behalve bij rampen, waarschuwingen en prio m. Hetzelfde verhaal uit meerdere bronnen krijgt dezelfde score.

Per bericht:
- prio: "1", "2", "3", "4", "5", "6a", "6b", "7", "8", "9", "m" of "0".
- score: 0-100 volgens de band en de bijstelling.
- categorie: "regelgeving" (prio 1 en 2), "algemeen" (prio 3, 5, 8, 9), "ondernemers" (prio 4), "reizen" (prio 6a en 6b), "meteo" (prio 7), "merkwaardig" (prio m), "geen" (prio 0).
- plekken: lijst van de plekken waar dit bericht naartoe kan, uit: ${PLEKKEN_VIJF.map((p) => `"${p.id}"`).join(", ")}. Zijbalk is voor korte, snelle berichten (reizen, meteo, sport, merkwaardig, een kop die op zichzelf staat); nieuwspagina bij prio 1 tot en met 4 als er genoeg inhoud is voor een eigen tekst. Nieuwsbrief en Infopoche volgen de nieuwspagina: alleen samen met nieuwspagina. Een los krantenbericht (soort pers of meteo, dus één krant) komt NOOIT op de nieuwspagina, in de nieuwsbrief of in Infopoche: voor zulke berichten alleen "zijbalk" en/of "infofrankrijk". Bij een score onder de ${SCORE_DREMPEL}. lege lijst.
- titel_nl: de kop in gewoon Nederlands als het bericht niet in het Nederlands is (kort, feitelijk, geen lange streepjes); anders null.
- reden: één korte Nederlandse zin waarom (geen lange streepjes).
- peil: alleen kiezen uit de PEIL-parameters die bij dat bericht staan. "raakt" = het bericht gaat over dit onderwerp. "mogelijk-gewijzigd" = het bericht noemt een NIEUWE waarde, datum of regel die afwijkt van de waarde in PEIL; leg in "toelichting" uit wat het bericht zegt. Twijfel je, kies dan "raakt". Niets relevant: lege lijst.
- gat: als het bericht een bedrag, tarief, drempel, termijn of regel noemt die voor deze lezers telt maar door geen van de voorgelegde parameters wordt gedekt, beschrijf die in één zin; anders null.
- tool: de id van de ene tool uit TOOLS waarmee een lezer direct verder kan (iets uitrekenen, opzoeken, regelen). Zoek altijd eerst of er een past; alleen als er echt geen over hetzelfde onderwerp gaat: null. Nooit een id die niet in de lijst staat.
- cafe: alleen bij een kennisdomein (${CAFE_DOMEINEN.join(", ")}); het domein uit CAFÉ CLAUDE waar een lezer met een vraag over dit bericht terecht kan; past geen van de domeinen echt, dan null.

Antwoord UITSLUITEND met een JSON-array, één object per bericht: {"nr":1,"prio":"2","score":0,"categorie":"…","plekken":["zijbalk"],"titel_nl":null,"reden":"…","peil":[{"id":"…","soort":"raakt","toelichting":"…"}],"gat":null,"tool":null,"cafe":null}`;

export function bouwInvoer(items, voorbeelden, catalogus = []) {
  const { tools, cafe } = normCatalogus(catalogus);
  const regels = [];
  if (tools && tools.length) {
    regels.push("TOOLS (kies hooguit één per bericht, op id):");
    for (const t of tools) regels.push(`- ${t.id}: ${t.naam}${t.meta ? ` (${t.meta})` : ""}`);
    regels.push("");
  }
  if (cafe && cafe.length) {
    regels.push("CAFÉ CLAUDE (domeinen, kies hooguit één):");
    for (const c of cafe) regels.push(`- ${c.domein}: ${c.tekst}`);
    regels.push("");
  }
  if (voorbeelden && (voorbeelden.go.length || voorbeelden.nogo.length)) {
    regels.push("EERDERE KEUZES VAN DE REDACTIE (leer hiervan):");
    for (const b of voorbeelden.go) regels.push(voorbeeldRegel(b));
    for (const b of voorbeelden.nogo) regels.push(voorbeeldRegel(b));
    regels.push("");
  }
  regels.push("TE BEOORDELEN BERICHTEN:");
  items.forEach((it, i) => {
    regels.push(`\n#${i + 1} [${it.soort}, ${it.bron}, ${it.land}] ${it.titel}`);
    if (it.samenvatting) regels.push(`Tekst: ${it.samenvatting}`);
    if (it.peilAangeboden && it.peilAangeboden.length) {
      regels.push("PEIL-parameters om uit te kiezen:");
      for (const p of it.peilAangeboden) regels.push(`- ${p.id}: ${p.naam} = ${p.waarde}`);
    } else {
      regels.push("PEIL-parameters om uit te kiezen: geen");
    }
  });
  return regels.join("\n");
}

// ---- Kanalen -----------------------------------------------------------------
// Waar een goedgekeurd bericht verschijnt (20-11-2026): de zijbalk van
// Nederlanders.fr en het nieuwsblok op Infofrankrijk (#open). Een besluit van
// vóór deze indeling heeft geen veld en staat alleen in de zijbalk.
export const SEL_KANALEN = ["zijbalk", "infofrankrijk"];
export function leesKanalen(v) {
  if (!Array.isArray(v)) return null;
  return SEL_KANALEN.filter((k) => v.includes(k));
}
export function kanalenVan(b) {
  if (!b || b.besluit !== "go") return [];
  return Array.isArray(b.kanalen) ? b.kanalen.filter((k) => SEL_KANALEN.includes(k)) : ["zijbalk"];
}

// ---- Feed voor lezers --------------------------------------------------------
export function bouwFeed(besluiten, nu = Date.now(), dagen = SEL_FEED_DAGEN, kanaal = "zijbalk") {
  const grens = nu - dagen * 86400 * 1000;
  const zichtbaar = (besluiten || []).filter((b) => {
    if (b.besluit !== "go") return false;
    if (!kanalenVan(b).includes(kanaal)) return false;
    if (b.soort === "meteo") return !b.verloopt || Date.parse(b.verloopt) > nu;
    const t = Date.parse(b.datum || b.besluitOp || "");
    return Number.isFinite(t) && t >= grens;
  });
  const categorieen = CATEGORIEEN.map((key) => ({
    key,
    label: CATEGORIE_LABEL[key],
    items: zichtbaar
      .filter((b) => b.categorie === key)
      .sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")))
      .slice(0, key === "merkwaardig" ? SEL_FEED_MAX_MERKWAARDIG : SEL_FEED_MAX_PER_CATEGORIE)
      .map((b) => ({
        id: b.id,
        titel: b.titelRedactie || (b.ai && b.ai.titelNl) || b.titel,
        bron: b.bron,
        url: b.url,
        datum: b.datum,
        soort: b.soort,
        kleur: b.kleur || null,
        // Hooguit twee parameters. "Mogelijk gewijzigd" gaat mee als soort: de
        // lezer krijgt dan te zien dat het nog wordt nagelopen, nooit een tool
        // met een waarde die het bericht misschien al tegenspreekt zonder die
        // kanttekening.
        peil: (b.ai && b.ai.peil ? b.ai.peil : []).slice(0, 2).map((p) => ({
          naam: p.naam,
          waarde: p.waarde,
          verificatiedatum: p.verificatiedatum,
          soort: p.soort === "mogelijk-gewijzigd" ? "mogelijk-gewijzigd" : "raakt",
          tools: p.tools || [],
        })),
        tool: b.ai && b.ai.tool && /^https:\/\//.test(String(b.ai.tool.url || "")) ? { naam: b.ai.tool.naam, url: b.ai.tool.url } : null,
        cafe: b.ai && b.ai.cafe && /^https:\/\//.test(String(b.ai.cafe.url || "")) ? { tekst: b.ai.cafe.tekst, url: b.ai.cafe.url } : null,
      })),
  })).filter((c) => c.items.length);
  return { bijgewerkt: new Date(nu).toISOString(), categorieen };
}

function xmlEsc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function bouwRss(feed, zelfUrl) {
  const items = feed.categorieen.flatMap((c) =>
    c.items.map((i) => {
      const peil = i.peil.length ? ` Raakt PEIL: ${i.peil.map((p) => p.naam).join("; ")}.` : "";
      return `<item><title>${xmlEsc(i.titel)}</title><link>${xmlEsc(i.url)}</link><guid isPermaLink="false">nlfr-selectie-${xmlEsc(i.id)}</guid>${
        i.datum ? `<pubDate>${new Date(i.datum).toUTCString()}</pubDate>` : ""
      }<category>${xmlEsc(c.label)}</category><description>${xmlEsc(`${i.bron}.${peil}`)}</description></item>`;
    })
  );
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Nederlanders.fr nieuwsselectie</title><link>${xmlEsc(zelfUrl)}</link><description>Door de redactie geselecteerd nieuws over Frankrijk</description><lastBuildDate>${new Date(feed.bijgewerkt).toUTCString()}</lastBuildDate>${items.join("")}</channel></rss>`;
}

// ---- Wat het kiesscherm toont ------------------------------------------------
// Gemeten 20-11-2026: /selectie liet 410 voorstellen zien, terug tot 7 november,
// en hetzelfde verhaal soms twee of drie keer (andere krant, andere ronde).
// Het scherm toont daarom alleen wat nog vers is, per verhaal één kaart (de
// hoogste score; bij meteo de nieuwste), en niets dat lijkt op een bericht
// waarover de redactie de afgelopen dagen al besliste. De rest blijft in KV
// staan en verloopt vanzelf (SEL_KANDIDAAT_TTL_S).
export const SEL_SCHERM_UREN = 72;
export const SEL_SCHERM_GELIJK = 0.5;

function kaleTitel(k) {
  const t = String((k && k.titel) || "");
  return k && k.viaGoogleNews ? t.replace(/\s+-\s+[^-]+$/, "") : t;
}

export function kandidatenVoorScherm(kandidaten, besluiten = [], nu = Date.now()) {
  const vers = (kandidaten || []).filter((k) => {
    if (!k) return false;
    if (k.soort === "meteo") return !k.verloopt || Date.parse(k.verloopt) > nu;
    return binnenVenster(k, nu, SEL_SCHERM_UREN);
  });
  const score = (k) => (k.ai && typeof k.ai.score === "number" ? k.ai.score : -1);
  vers.sort((a, b) =>
    a.soort === "meteo" && b.soort === "meteo"
      ? String(b.datum || "").localeCompare(String(a.datum || ""))
      : score(b) - score(a) || String(b.datum || "").localeCompare(String(a.datum || ""))
  );
  const grens = nu - SEL_FEED_DAGEN * 86400 * 1000;
  const recentBeslist = (besluiten || []).filter((b) => Date.parse(b.besluitOp || "") >= grens);
  const lijkt = (a, b) => a.soort === b.soort && overlap(kaleTitel(a), kaleTitel(b)) >= SEL_SCHERM_GELIJK;
  const uit = [];
  for (const k of vers) {
    if (recentBeslist.some((b) => lijkt(k, b))) continue;
    const zelfde = uit.find((u) => lijkt(u, k));
    if (zelfde) {
      zelfde.ookBij = [...(zelfde.ookBij || []), k.bron].filter((x, i, l) => x && l.indexOf(x) === i && x !== zelfde.bron);
      continue;
    }
    uit.push({ ...k });
  }
  return uit.sort((a, b) => score(b) - score(a) || String(b.datum || "").localeCompare(String(a.datum || "")));
}

// ---- Bronnen onder embargo (20-11-2026, keuze Anton) ------------------------
// De redactie blokkeert een bron met één tik op /selectie. Een geblokkeerde
// bron komt niet meer op het kiesscherm en de ronde laat hem weg (geen
// modelkosten). Vergelijken op naam, zonder hoofdletters en spaties eromheen.
export function bronSleutel(naam) {
  return String(naam || "").trim().toLowerCase().replace(/\s+/g, " ");
}
export function geblokkeerdeSet(doc) {
  return new Set(((doc && doc.bronnen) || []).map((b) => bronSleutel(b && b.naam)).filter(Boolean));
}
export function zonderGeblokkeerd(items, doc) {
  const set = geblokkeerdeSet(doc);
  if (!set.size) return items || [];
  return (items || []).filter((i) => !set.has(bronSleutel(i && i.bron)));
}

// ---- Eén redactiepagina (20-11-2026, keuze Anton) ---------------------------
// Een synthese of overheidsbericht uit /review kan ook naar de zijbalk. Staat
// hetzelfde artikel al als kandidaat in de selectie (zelfde bronlink), dan
// neemt het besluit dat over: het AI-oordeel met PEIL, tool en Café Claude gaat
// mee, en de kandidaat komt niet nog eens op het scherm.
export const FRANKRIJKNIEUWS_URL = "https://www.nederlanders.fr/page/actueel-frankrijknieuws";

export function urlSleutel(u) {
  try {
    const x = new URL(String(u || ""));
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return "";
  }
}

export function urlsVanRedactieDoc(doc) {
  const lijst = [doc && doc.url, ...((doc && doc.bronnen) || []).map((b) => b && b.url)];
  return [...new Set(lijst.map(urlSleutel).filter(Boolean))];
}

// Alle kandidaten met een bronlink van het bericht, beste AI-score eerst. De
// eerste levert het oordeel; de andere worden gemarkeerd als opgenomen, zodat
// ze na de keuze niet los terugkomen (en bij terugdraaien wel).
export function zoekGekoppeldAlle(doc, kandidaten) {
  const urls = new Set(urlsVanRedactieDoc(doc));
  if (!urls.size) return [];
  const hits = (kandidaten || []).filter((k) => k && urls.has(urlSleutel(k.url)));
  const score = (k) => (k.ai && typeof k.ai.score === "number" ? k.ai.score : -1);
  return hits.sort((a, b) => score(b) - score(a));
}
export function zoekGekoppeld(doc, kandidaten) {
  return zoekGekoppeldAlle(doc, kandidaten)[0] || null;
}

// herkomst: "concept" (synthese, niet op de nieuwspagina), "publicatie"
// (synthese op de nieuwspagina) of "overheid" (staat automatisch op de
// nieuwspagina). Wat op de nieuwspagina staat, linkt daarheen; een synthese die
// alleen in de zijbalk komt linkt naar de eerste krant waarop hij steunt.
// zijbalk false = de redactie koos alleen de nieuwspagina of Weg: dan een
// no-go, zodat het bericht van de redactiepagina af is en de AI ervan leert.
export function standaardRubriek(soort) {
  return soort === "meteo" ? "meteo" : soort === "overheid" ? "regelgeving" : "algemeen";
}

// Reden bij een Nee op /redactie (leerstof voor het model). Nooit verplicht.
export const REDENEN = REDENEN_REGEL; // regelbestand
export function leesReden(r) {
  return REDENEN.includes(r) ? r : null;
}

// Het voorstel zoals de pagina het toonde (lijst plek-ids), door de pagina meegestuurd.
export function leesVoorstel(v) {
  return Array.isArray(v) ? PLEK_IDS.filter((p) => v.includes(p)) : null;
}

export function redactieBesluit({ herkomst, doc, gekoppeld = null, categorie = null, reden = null, voorstelLijst = null, weg = false, zijbalk = true, kanalen = null, elders = false, opPagina = null, nu = Date.now(), door = null }) {
  if (Array.isArray(kanalen)) zijbalk = kanalen.length > 0;
  if (!doc || !doc.id) return { fout: "Bericht niet gevonden." };
  const ai = gekoppeld && gekoppeld.ai ? gekoppeld.ai : null;
  const voorstel = ai && CATEGORIEEN.includes(ai.categorie) ? ai.categorie : herkomst === "overheid" ? "regelgeving" : null;
  // De rubriek is nooit verplicht: zonder keuze en zonder voorstel van het model
  // een redelijke standaard (zie standaardRubriek).
  const gekozen = CATEGORIEEN.includes(categorie) ? categorie : voorstel || standaardRubriek(herkomst === "overheid" ? "overheid" : "pers");
  // opPagina false: een overheidsbericht dat nog niet live is en alleen in de
  // zijbalk komt, linkt naar zijn eigen bron en niet naar de nieuwspagina.
  const opNieuwspagina = opPagina == null ? herkomst !== "concept" : Boolean(opPagina) && herkomst !== "concept";
  const eerste = ((doc.bronnen || []).find((b) => b && /^https:\/\//.test(String(b.url || ""))) || (herkomst === "overheid" && /^https:\/\//.test(String(doc.url || "")) ? { naam: doc.bron, url: doc.url } : null));
  const titel = String(doc.kop || doc.titel || doc.titelBron || "").trim();
  return {
    besluit: {
      id: gekoppeld ? gekoppeld.id : `r${doc.id}`.slice(0, 20),
      soort: herkomst === "overheid" ? "overheid" : "pers",
      titel,
      titelRedactie: titel,
      bron: opNieuwspagina ? "Nederlanders.fr" : (eerste && eerste.naam) || "Nederlanders.fr",
      url: opNieuwspagina ? FRANKRIJKNIEUWS_URL : (eerste && eerste.url) || FRANKRIJKNIEUWS_URL,
      datum: doc.gepubliceerdOp || doc.aangemaaktOp || doc.datum || new Date(nu).toISOString(),
      ai,
      // Alleen een echte "nee" (niets gekozen, of Weg) is een no-go. Een bericht
      // dat wel op de nieuwspagina, in de nieuwsbrief of in Infopoche komt maar
      // niet in de zijbalk, is een go met lege zijbalkkanalen: de feed toont het
      // niet, het model leert er wel "dit was goed" van.
      besluit: zijbalk || elders ? "go" : "nogo",
      kanalen: zijbalk ? (Array.isArray(kanalen) ? kanalen : ["zijbalk"]) : [],
      // Wat de redactie koos, voor het meten en het leersignaal (nieuwspagina, zijbalk, infofrankrijk).
      // Een gepubliceerde synthese blijft op de nieuwspagina staan tenzij hij weg gaat.
      plekken: [...(zijbalk ? (Array.isArray(kanalen) ? kanalen : ["zijbalk"]) : []), ...(((opNieuwspagina && (opPagina === true || elders)) || (herkomst === "publicatie" && weg !== true && opPagina !== false)) ? ["nieuwspagina"] : [])],
      ...(Array.isArray(voorstelLijst) ? { voorstelPlekken: voorstelLijst } : {}),
      categorie: gekozen,
      categorieDoorRedactie: Boolean(categorie && categorie !== voorstel),
      ...(leesReden(reden) ? { reden: leesReden(reden) } : {}),
      besluitOp: new Date(nu).toISOString(),
      door,
      redactie: { herkomst, reviewId: doc.id, kandidaat: gekoppeld || null, ...(weg === true ? { weg: true } : {}), ...(herkomst === "overheid" && (opPagina === true || opPagina === false) ? { nieuwspagina: Boolean(opPagina) } : {}) },
    },
  };
}
