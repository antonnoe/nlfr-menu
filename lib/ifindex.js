// De index van infofrankrijk.com: artikelen, categorieën, en wie waarbij hoort.
// ---------------------------------------------------------------------------
// WAARVOOR. Onder een bericht op /actueel kan de redactie een verwijzing zetten
// naar een achtergrondartikel op infofrankrijk.com, en omgekeerd kan een nieuw
// overheidsbericht betekenen dat zo'n artikel nagekeken moet worden. Beide
// draaien op dezelfde vraag: WELKE IF-artikelen horen bij dit bericht?
//
// De RSS-feed beantwoordt die vraag niet — die geeft alleen de laatste veertien
// dagen, en juist het oudere achtergrondmateriaal is waar je naar wilt
// verwijzen. De openbare WordPress-REST-API geeft wél alles: bij ~350 artikelen
// zijn dat vier verzoeken. Die lijst gaat één keer per zes uur in KV; de
// reviewtool zoekt daarna lokaal, dus zonder wachttijd voor de redacteur.
//
// DEZE MODULE BESLIST NIETS. Hij levert kandidaten; kiezen doet de redactie in
// de reviewtool. Zonder klik komt er geen verwijzing — zie api/review.js.
//
// De filters, allebei uit lib/config.js:
//   1. CATEGORIE — IF_CATEGORIE_PER_THEMA koppelt het thema van het bericht aan
//      Infofrankrijk-categorieën. Handwerk, met opzet (zie de motivering daar).
//   2. DATUM — niets waarvan `modified` ouder is dan IF_MAX_LEEFTIJD_MAANDEN.
//
// LET OP `modified` VS `modified_gmt`. WordPress levert `modified` in de
// tijdzone van de site, ZONDER tijdzone-aanduiding: "2026-08-23T14:29:45"
// parseert in Node (UTC) dus twee uur te vroeg. We nemen daarom `modified_gmt`
// en zetten er expliciet een Z achter. Dezelfde valkuil als bij de
// schoolvakantiedatums, en met dezelfde consequentie als je hem vergeet: een
// datum die er net naast zit.

import { getJSON, setJSON } from "./store.js";
import {
  IF_API_BASIS,
  IF_PER_PAGINA,
  IF_MAX_PAGINAS,
  IF_TIMEOUT_MS,
  KEY_IF_INDEX,
  IF_INDEX_TTL_S,
  IF_INDEX_VERVERS_NA_S,
  IF_MAX_LEEFTIJD_MAANDEN,
  IF_BIJNA_VERLOPEN_MAANDEN,
  IF_CATEGORIE_PER_THEMA,
} from "./config.js";

// ---- Tekst uit WordPress ----------------------------------------------------
// Titels komen als `{ rendered: "..." }` binnen, met HTML-entiteiten
// ("Frankrijk &#8217;s"). Onvertaald zouden die letterlijk in de reviewtool en
// op de nieuwspagina belanden.
const ENTITEITEN = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç",
  ouml: "ö", euml: "ë", iuml: "ï", uuml: "ü", hellip: "…", ndash: "–", mdash: "—",
  laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  euro: "€", deg: "°",
};
export function ontHtml(ruw) {
  return String(ruw == null ? "" : ruw)
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (heel, naam) => {
      const k = ENTITEITEN[naam.toLowerCase()];
      return k == null ? heel : k;
    })
    .replace(/\s+/g, " ")
    .trim();
}

// De wijzigingsdatum als ISO-string in UTC. Zie de opmerking bovenaan.
export function wijzigingsdatum(post) {
  const gmt = post && post.modified_gmt;
  if (gmt) {
    const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(gmt) ? gmt : `${gmt}Z`);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  // Terugval: alleen `modified` (lokale tijd van de site). Dan liever een datum
  // die een paar uur kan schelen dan helemaal geen datum — maar nooit stil:
  // zonder bruikbare datum valt het artikel door het 12-maandenfilter weg.
  const lokaal = post && post.modified;
  const t = Date.parse(lokaal || "");
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---- Ophalen ---------------------------------------------------------------

function metTimeout(url, ms, fetchImpl) {
  const ctrl = new AbortController();
  const klok = setTimeout(() => ctrl.abort(), ms);
  return fetchImpl(url, { signal: ctrl.signal, headers: { Accept: "application/json" } })
    .finally(() => clearTimeout(klok));
}

export function postsUrl(pagina) {
  return `${IF_API_BASIS}/posts?per_page=${IF_PER_PAGINA}&page=${pagina}` +
    `&_fields=id,link,title,modified,modified_gmt,categories&orderby=modified&order=desc`;
}
export function categorieUrl(pagina) {
  return `${IF_API_BASIS}/categories?per_page=${IF_PER_PAGINA}&page=${pagina}&_fields=id,name,count`;
}

// Haalt de volledige index op. Gooit bij een mislukking — de aanroeper (de
// cron) bepaalt wat dat betekent; de vorige index in KV blijft dan gewoon staan.
export async function haalIfIndex({ nu = Date.now(), fetchImpl = fetch } = {}) {
  const artikelen = [];
  for (let pagina = 1; pagina <= IF_MAX_PAGINAS; pagina += 1) {
    const res = await metTimeout(postsUrl(pagina), IF_TIMEOUT_MS, fetchImpl);
    // Voorbij de laatste pagina antwoordt WordPress met 400 (rest_post_invalid_page_number).
    if (res.status === 400 && pagina > 1) break;
    if (!res.ok) throw new Error(`Infofrankrijk gaf HTTP ${res.status} op pagina ${pagina}`);
    const lijst = await res.json();
    if (!Array.isArray(lijst) || !lijst.length) break;
    for (const p of lijst) {
      const url = typeof p.link === "string" ? p.link : "";
      if (!p || !p.id || !url) continue;
      artikelen.push({
        ifId: Number(p.id),
        titel: ontHtml(p.title && p.title.rendered),
        url,
        modified: wijzigingsdatum(p),
        categorieen: Array.isArray(p.categories) ? p.categories.map(Number) : [],
      });
    }
    if (lijst.length < IF_PER_PAGINA) break;
  }

  const categorieen = {};
  for (let pagina = 1; pagina <= IF_MAX_PAGINAS; pagina += 1) {
    const res = await metTimeout(categorieUrl(pagina), IF_TIMEOUT_MS, fetchImpl);
    if (res.status === 400 && pagina > 1) break;
    if (!res.ok) throw new Error(`Infofrankrijk gaf HTTP ${res.status} op categoriepagina ${pagina}`);
    const lijst = await res.json();
    if (!Array.isArray(lijst) || !lijst.length) break;
    for (const c of lijst) {
      if (c && c.id) categorieen[String(c.id)] = ontHtml(c.name);
    }
    if (lijst.length < IF_PER_PAGINA) break;
  }

  return {
    opgehaaldOp: new Date(nu).toISOString(),
    aantal: artikelen.length,
    artikelen,
    categorieen,
  };
}

// Ververst de index als hij ontbreekt of ouder is dan IF_INDEX_VERVERS_NA_S.
// Geeft altijd een statusobject terug en gooit NOOIT: dit is bijwerk in de
// cronronde, en een onbereikbare WordPress-API mag de ronde niet rood maken.
export async function verversIfIndex({ nu = Date.now(), fetchImpl = fetch, forceer = false } = {}) {
  let bestaand = null;
  try {
    bestaand = await getJSON(KEY_IF_INDEX);
  } catch {
    bestaand = null;
  }
  const leeftijdS = bestaand && bestaand.opgehaaldOp
    ? (nu - (Date.parse(bestaand.opgehaaldOp) || 0)) / 1000
    : Infinity;
  if (!forceer && bestaand && Array.isArray(bestaand.artikelen) && leeftijdS < IF_INDEX_VERVERS_NA_S) {
    return { ok: true, ververst: false, aantal: bestaand.artikelen.length, opgehaaldOp: bestaand.opgehaaldOp };
  }
  try {
    const index = await haalIfIndex({ nu, fetchImpl });
    await setJSON(KEY_IF_INDEX, index, IF_INDEX_TTL_S);
    return { ok: true, ververst: true, aantal: index.aantal, opgehaaldOp: index.opgehaaldOp };
  } catch (e) {
    // De oude index blijft staan (TTL 30 dagen), dus de reviewtool blijft
    // werken; de reden staat in de cronuitvoer.
    return {
      ok: false,
      ververst: false,
      reden: e instanceof Error ? e.message : String(e),
      aantal: bestaand && Array.isArray(bestaand.artikelen) ? bestaand.artikelen.length : 0,
      opgehaaldOp: (bestaand && bestaand.opgehaaldOp) || null,
    };
  }
}

// ---- Filteren en sorteren (puur) -------------------------------------------

// De grens van het datumfilter: `maanden` kalendermaanden terug vanaf `nu`.
// Kalendermaanden, niet 30-daagse blokken — "twaalf maanden" is wat de redactie
// zegt, en dat is 28 februari, niet 4 maart.
export function venstergrens(nu, maanden = IF_MAX_LEEFTIJD_MAANDEN) {
  const d = new Date(nu);
  d.setUTCMonth(d.getUTCMonth() - maanden);
  return d.getTime();
}

// Valt dit artikel binnen het datumvenster? Zonder bruikbare `modified` is het
// antwoord NEE: liever een artikel missen dan verwijzen naar iets waarvan we
// niet weten hoe oud het is.
export function binnenVenster(artikel, nu = Date.now(), maanden = IF_MAX_LEEFTIJD_MAANDEN) {
  const t = Date.parse((artikel && artikel.modified) || "");
  if (Number.isNaN(t)) return false;
  return t >= venstergrens(nu, maanden);
}

export function categorieIdsVoorThema(thema) {
  const ids = IF_CATEGORIE_PER_THEMA[thema];
  return Array.isArray(ids) ? ids.slice() : [];
}

function zoekbaar(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// De kandidaten onder één bericht.
//   thema  — het thema van het bericht (overheidsthema of perstegel). Bepaalt
//            via de koppeltabel welke categorieën meedoen.
//   zoek   — vrije zoekterm. Die NEGEERT het categoriefilter (daar is hij voor:
//            alles wat de tabel niet dekt), maar nooit het datumfilter.
// Sortering: OUDSTE `modified` eerst. Dat is tegelijk de auditvolgorde — wat het
// langst niet is aangeraakt staat bovenaan — en de reden om de bovenste
// kandidaten kritisch te bekijken voordat je ernaar verwijst.
export function kandidaten({
  index,
  thema = null,
  zoek = "",
  nu = Date.now(),
  maanden = IF_MAX_LEEFTIJD_MAANDEN,
  max = 0,
} = {}) {
  const alle = (index && Array.isArray(index.artikelen) ? index.artikelen : []).filter((a) =>
    binnenVenster(a, nu, maanden)
  );
  const term = zoekbaar(zoek).trim();
  let uit;
  if (term) {
    uit = alle.filter((a) => zoekbaar(a.titel).includes(term));
  } else {
    const ids = new Set(categorieIdsVoorThema(thema));
    uit = ids.size ? alle.filter((a) => (a.categorieen || []).some((c) => ids.has(c))) : [];
  }
  uit = uit
    .slice()
    .sort((a, b) => (Date.parse(a.modified) || 0) - (Date.parse(b.modified) || 0));
  return max > 0 ? uit.slice(0, max) : uit;
}

// Wat er BÍJNA uit de verwijzingen valt: binnen het venster, maar minder dan
// `waarschuwMaanden` ervan verwijderd. Zonder deze lijst gebeurt het verdwijnen
// stil — het artikel is er nog, het is alleen niet meer verwijsbaar.
export function bijnaVerlopen({
  index,
  nu = Date.now(),
  maanden = IF_MAX_LEEFTIJD_MAANDEN,
  waarschuwMaanden = IF_BIJNA_VERLOPEN_MAANDEN,
} = {}) {
  const ondergrens = venstergrens(nu, maanden);
  const bovengrens = venstergrens(nu, Math.max(0, maanden - waarschuwMaanden));
  return (index && Array.isArray(index.artikelen) ? index.artikelen : [])
    .filter((a) => {
      const t = Date.parse(a.modified || "");
      return !Number.isNaN(t) && t >= ondergrens && t < bovengrens;
    })
    .sort((a, b) => (Date.parse(a.modified) || 0) - (Date.parse(b.modified) || 0));
}

// Eén artikel uit de index opzoeken (de reviewtool stuurt alleen een id op).
export function artikelUitIndex(index, ifId) {
  const nr = Number(ifId);
  const lijst = index && Array.isArray(index.artikelen) ? index.artikelen : [];
  return lijst.find((a) => Number(a.ifId) === nr) || null;
}
