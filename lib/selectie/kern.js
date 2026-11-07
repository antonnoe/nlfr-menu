// Kern van de nieuwsselectie: pure functies, zonder netwerk of opslag.
// ---------------------------------------------------------------------------
// De cyclus: AI scant (bronnen.js) -> biedt aan met categorie, score, reden en
// PEIL-koppeling (model.js) -> de redactie geeft go of no-go (/selectie) ->
// goedgekeurde berichten staan in de publieke feed (/api/selectie-feed) en in
// de sidebar van Nederlanders.fr. Elke beslissing blijft bewaard: dat is het
// lesmateriaal voor de volgende selectie (voorbeeldenVoorModel).
//
// Alles hier is te testen zonder KV en zonder Anthropic.

import { normaliseer, hashId } from "../feeds.js";

// ---- Categorieën (de indeling van de redactie, 6 november 2026) ------------
export const CATEGORIEEN = ["algemeen", "ondernemers", "reizen", "meteo", "regelgeving"];
export const CATEGORIE_LABEL = {
  algemeen: "Algemeen nieuws",
  ondernemers: "Ondernemersnieuws",
  reizen: "Reisnieuws",
  meteo: "Meteo",
  regelgeving: "Wet- en regelgeving",
};

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
export const SEL_KANDIDAAT_TTL_S = 7 * 24 * 60 * 60;
export const SEL_PEIL_TTL_S = 6 * 60 * 60;
export const SEL_VENSTER_UREN = 48; // ouder persnieuws wordt niet meer aangeboden
export const SEL_MAX_PER_AANROEP = 12; // kandidaten per modelaanroep (binnen de 60 s van de functie)
export const SEL_MAX_NIEUW_PER_RONDE = 150; // zoveel nieuwe kandidaten worden per ronde hooguit opgeslagen
export const SEL_FEED_DAGEN = 7; // zo lang staat een goedgekeurd bericht in de feed
export const SEL_FEED_MAX_PER_CATEGORIE = 8;
export const SEL_PEIL_KANDIDATEN = 6; // PEIL-parameters die per bericht aan het model worden voorgelegd

// ---- Over Frankrijk? --------------------------------------------------------
// "frans" staat er bewust NIET in: dat is ook een voornaam (Frans Timmermans).
const FRANKRIJK_WOORDEN = [
  "frankrijk", "franse", "fransen", "fransman", "fransman", "parijs", "parisienne",
  "macron", "lecornu", "corsica", "bretagne", "normandie", "elzas", "provence",
  "dordogne", "marseille", "lyon", "toulouse", "bordeaux", "lille", "straatsburg",
  "montpellier", "nantes", "ardeche", "pyreneeen", "cote d'azur", "occitanie",
  "auvergne", "bourgogne", "loire", "calais", "duinkerke", "tgv", "elysee",
];

export function gaatOverFrankrijk(tekst) {
  const n = normaliseer(tekst);
  return FRANKRIJK_WOORDEN.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n));
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
  return [...new Set([...peilTrefwoorden(p), ...peilNaamwoorden(p)])];
}
function peilTrefwoorden(p) {
  return kernwoorden(p.trefwoorden || "").filter((w) => w.length >= 3 && !PEIL_STOP.has(w));
}
function peilNaamwoorden(p) {
  return kernwoorden(`${p.naam || ""} ${p.naam_fr || ""}`).filter((w) => w.length >= 5 && !PEIL_STOP.has(w));
}

// Een parameter komt door bij:
//  - een TREFWOORD dat in hooguit 8 parameters voorkomt (cak, woonlandfactor), of
//  - minstens twee verschillende termen waarvan minstens één trefwoord.
// Een los woord uit een parameternaam telt nooit alleen: gemeten op 7 november
// 2026 koppelde "miljoen" aan de IFI-décote, "kinderen" aan de réserve
// héréditaire en "vakantie" aan het AOW-vakantiegeld. Rangschikking op
// zeldzaamheid (een zeldzame term zegt meer dan een veelvoorkomende).
// Gewone Nederlandse woorden die wel als trefwoord in PEIL staan, maar alleen
// in combinatie met een tweede term iets zeggen ("hoge kosten", "Grote Markt",
// "van plan", "lokale media"). Gemeten op de persstroom van 7 november 2026.
const PEIL_GENERIEK = new Set(
  ("lokale markt plan koop kosten bouw bouwen europese belasting ondernemer aankoop huis prijs prijzen " +
    "kopen verkopen huur wonen werk werken geld zorg kind kinderen school reizen auto").split(" ")
);

export function peilVoorselectie(tekst, parameters, max = SEL_PEIL_KANDIDATEN) {
  const lijst = parameters || [];
  const woorden = new Set(kernwoorden(tekst));
  const n = normaliseer(tekst);
  const gevonden = (t) => woorden.has(t) || (t.length >= 7 && n.includes(t)); // samenstellingen
  const per = lijst.map((p) => ({ tref: peilTrefwoorden(p), naam: peilNaamwoorden(p) }));
  const df = new Map();
  for (const { tref, naam } of per) for (const t of new Set([...tref, ...naam])) df.set(t, (df.get(t) || 0) + 1);
  const scores = [];
  lijst.forEach((p, i) => {
    const trefRaak = per[i].tref.filter(gevonden);
    const alleRaak = [...new Set([...trefRaak, ...per[i].naam.filter(gevonden)])];
    if (!trefRaak.length) return;
    const zeldzaam = trefRaak.some((t) => (df.get(t) || 1) <= 8 && !PEIL_GENERIEK.has(t));
    if (!zeldzaam && alleRaak.length < 2) return;
    const score = alleRaak.reduce((s, t) => s + Math.log(1 + lijst.length / (df.get(t) || 1)), 0);
    scores.push({ p, score });
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

// ---- Wat het model terugstuurt ----------------------------------------------
// Verwacht een JSON-array. Alles wat niet klopt wordt weggelaten in plaats van
// geraden: een onbekende categorie wordt "geen", een PEIL-id die niet was
// voorgelegd verdwijnt.
export function leesModelAntwoord(ruw, aangeboden) {
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
    uit.set(item.id, {
      categorie,
      score,
      reden: String(r.reden || "").slice(0, 300),
      peil,
      gat,
    });
  }
  return uit;
}

// ---- Leren van eerdere beslissingen ----------------------------------------
// De laatste beslissingen gaan als voorbeelden mee naar het model: wat de
// redactie koos en wat ze liet liggen. Meer voorbeelden = beter afgestemd.
export function voorbeeldenVoorModel(besluiten, maxPerSoort = 25) {
  const recent = [...(besluiten || [])].sort((a, b) => String(b.besluitOp || "").localeCompare(String(a.besluitOp || "")));
  const go = recent.filter((b) => b.besluit === "go").slice(0, maxPerSoort);
  const nogo = recent.filter((b) => b.besluit === "nogo").slice(0, maxPerSoort);
  return { go, nogo };
}

// ---- Prompt -----------------------------------------------------------------
export const SYSTEM_SELECTIE = `Je bent de eerste lezer van de redactie van Nederlanders.fr en Infofrankrijk.com. Je beoordeelt nieuwsberichten voor Nederlanders en Belgen die in Frankrijk wonen of er een tweede huis hebben, veelal ouder, met een rustig leven op het platteland. De redacteur beslist; jij doet een voorstel.

Beoordeel per bericht:
1. categorie: "algemeen" (algemeen nieuws over Frankrijk dat deze lezers moeten weten), "ondernemers" (voor wie in Frankrijk onderneemt: gîte, micro-entreprise, vakmensen), "reizen" (verkeer, tol, treinen, grens, vluchten, stakingen in het vervoer, reizen tussen NL/BE en Frankrijk), "meteo" (weer en weerwaarschuwingen), "regelgeving" (wetten, regels, bedragen, tarieven, termijnen, uitkeringen, belastingen, in Frankrijk of in Nederland/België wanneer het Frankrijkbewoners raakt), of "geen" (niet relevant).
2. score 0-100: hoe graag deze lezers dit willen weten. Hoog: raakt de portemonnee, zorg, pensioen, belasting, wonen, veiligheid of reizen; Nederlands of Belgisch beleid dat inwoners van Frankrijk raakt (CAK, AOW, zorgverzekering, belasting); ernstig weer. Laag: sensatie zonder gevolgen voor de lezer, curiosa, criminaliteit zonder bredere betekenis, sport, buitenlandse politiek zonder gevolgen in Frankrijk. Dubbele verhalen krijgen dezelfde score.
3. reden: één korte Nederlandse zin waarom (geen lange streepjes).
4. peil: alleen kiezen uit de PEIL-parameters die bij dat bericht staan. "raakt" = het bericht gaat over dit onderwerp. "mogelijk-gewijzigd" = het bericht noemt een NIEUWE waarde, datum of regel die afwijkt van de waarde in PEIL; leg in "toelichting" uit wat het bericht zegt. Twijfel je, kies dan "raakt". Niets relevant: lege lijst.
5. gat: als het bericht een bedrag, tarief, drempel, termijn of regel noemt die voor deze lezers telt maar door geen van de voorgelegde parameters wordt gedekt, beschrijf die in één zin; anders null.

Antwoord UITSLUITEND met een JSON-array, één object per bericht: {"nr":1,"categorie":"…","score":0,"reden":"…","peil":[{"id":"…","soort":"raakt","toelichting":"…"}],"gat":null}`;

export function bouwInvoer(items, voorbeelden) {
  const regels = [];
  if (voorbeelden && (voorbeelden.go.length || voorbeelden.nogo.length)) {
    regels.push("EERDERE KEUZES VAN DE REDACTIE (leer hiervan):");
    for (const b of voorbeelden.go) regels.push(`GO [${b.categorie}] ${b.titel}`);
    for (const b of voorbeelden.nogo) regels.push(`NO-GO ${b.titel}`);
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

// ---- Feed voor lezers --------------------------------------------------------
export function bouwFeed(besluiten, nu = Date.now(), dagen = SEL_FEED_DAGEN) {
  const grens = nu - dagen * 86400 * 1000;
  const zichtbaar = (besluiten || []).filter((b) => {
    if (b.besluit !== "go") return false;
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
      .slice(0, SEL_FEED_MAX_PER_CATEGORIE)
      .map((b) => ({
        id: b.id,
        titel: b.titel,
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
