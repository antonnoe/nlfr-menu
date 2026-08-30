// Gedeelde feedtoetsen voor de bronverkenners.
// ---------------------------------------------------------------------------
// Twee verkenners gebruiken dezelfde vragen: haalt dit adres iets op, is wat er
// terugkomt een feed, hoe vers is hij, en welke adressen op een pagina lijken
// op een feed. Het verschil zit alleen in HOE de pagina binnenkomt —
// verken-bronnen.mjs haalt de kale HTML op, verken-render.mjs laat een browser
// hem eerst uitvoeren. De toetsen horen dus hier, één keer.

const TIMEOUT_MS = 20000;
const UA = "NLFR-bronverkenner/1.0 (+https://nederlanders.fr)";
// Sommige sites (svb.nl, dutchculture.nl) beantwoorden een onbekende agent met
// een 403. Dat zegt niets over de feed en alles over de User-Agent, dus krijgt
// zo'n weigering nog één poging als gewone browser.
export const UA_BROWSER =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
export const ACCEPT_FEED =
  "application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8";

// Sporen die iets zeggen over hergebruik. Bewust ook de negatieve: "tous

const LICENTIESPOREN = [
  { patroon: /licence\s+ouverte/i, oordeel: "Licence Ouverte genoemd", goed: true },
  { patroon: /etalab/i, oordeel: "Etalab genoemd", goed: true },
  { patroon: /creativecommons\.org\/licenses\/by/i, oordeel: "CC BY genoemd", goed: true },
  { patroon: /données?\s+ouvertes?|open\s?data/i, oordeel: "open data genoemd", goed: true },
  { patroon: /tous\s+droits\s+r[ée]serv[ée]s/i, oordeel: "“tous droits réservés”", goed: false },
  { patroon: /reproduction\s+interdite/i, oordeel: "“reproduction interdite”", goed: false },
];

export async function eenmaalHalen(url, accept, agent) {
  const ctrl = new AbortController();
  const klok = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": agent, Accept: accept },
    });
    const tekst = await r.text();
    return { ok: r.ok, status: r.status, type: r.headers.get("content-type") || "", tekst, url: r.url };
  } catch (e) {
    // "fetch failed" alleen is nietszeggend. De onderliggende oorzaak maakt het
    // verschil tussen een hostnaam die niet bestaat (ENOTFOUND — dan klopt de
    // URL niet), een geweigerde verbinding, een TLS-probleem en een hapering.
    const oorzaak = e.cause && (e.cause.code || e.cause.message);
    const uitleg = {
      ENOTFOUND: "hostnaam bestaat niet (DNS)",
      EAI_AGAIN: "DNS tijdelijk niet bereikbaar",
      ECONNREFUSED: "verbinding geweigerd",
      ECONNRESET: "verbinding verbroken",
      ETIMEDOUT: "verbinding liep vast",
      CERT_HAS_EXPIRED: "TLS-certificaat verlopen",
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS-certificaat niet te verifiëren",
    }[oorzaak];
    const fout = e.name === "AbortError"
      ? "tijd verstreken"
      : `${e.message}${oorzaak ? ` — ${uitleg || oorzaak}` : ""}`;
    return { ok: false, status: 0, type: "", tekst: "", url, fout };
  } finally {
    clearTimeout(klok);
  }
}

export async function haal(url, accept) {
  const eerste = await eenmaalHalen(url, accept, UA);
  if (eerste.status !== 403) return eerste;
  const tweede = await eenmaalHalen(url, accept, UA_BROWSER);
  return tweede.ok ? { ...tweede, browserNodig: true } : eerste;
}

// Lang niet elke site kondigt zijn feed aan in de <head>; overheidssites doen
// dat opvallend vaak niet. "Niet aangekondigd" is dus geen bewijs van "niet
// aanwezig" — daarom probeert de verkenner daarna deze gebruikelijke paden.
//
// EN OOK DAN BLIJFT EEN "NEE" ZWAK. Beproefd op 22 instanties (Frans en
// Nederlands) vond deze methode er geen enkele, terwijl service-public.fr —
// dat in bronnen.json staat en aantoonbaar werkt — er óók als "geen feed" uit
// kwam: zijn feed zit op /abonnements/rss/actu-actualites-particuliers.rss,
// een pad dat niemand raadt. Deze verkenner is dus betrouwbaar om een feed te
// BEVESTIGEN en ongeschikt om er een uit te sluiten. De uitvoer zegt dat er
// met zoveel woorden bij; meer gokpaden stapelen maakt dat niet beter.

export const MAX_GELINKT = 25;

export const GEBRUIKELIJKE_PADEN = [
  "/rss", "/rss.xml", "/feed", "/feed/", "/flux-rss", "/flux-rss.xml",
  "/atom.xml", "/index.rss", "/actualites/rss", "/actualites.rss",
  "/fr/rss.xml", "/rss/actualites.xml", "/?feed=rss2",
];

// Een feed herken je aan zijn WORTELELEMENT, niet aan zijn content-type. Een
// sitemap.xml wordt ook als application/xml geserveerd en is geen feed; wie op
// de content-type afgaat haalt die binnen als "gevonden feed". Vandaar deze
// toets op de inhoud. Het venster is ruim: sommige feeds beginnen met een lange
// XML-prolog en een stylesheet-verwijzing.
export const isFeed = (type, tekst) => /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(tekst.slice(0, 4000));

// Feeds die in de <head> van een gewone pagina staan aangekondigd.
export function feedsUitPagina(html, basis) {
  const uit = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["'][^"']*(rss|atom)[^"']*["']/i.test(tag)) continue;
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    const titel = (tag.match(/title=["']([^"']*)["']/i) || [])[1] || "";
    if (!href) continue;
    try {
      uit.push({ url: new URL(href, basis).href, titel });
    } catch { /* onbruikbare href */ }
  }
  return uit;
}

// Feeds die de site in de PAGINA zelf aanbiedt in plaats van in de <head>.
// Rijksoverheid, RVO en KVK hebben een pagina "RSS-feeds" of "nieuwsbrieven"
// waar de feeds als doodgewone links staan. Wie alleen de <head> leest ziet
// daar niets en concludeert ten onrechte "geen feed". Dit is nadrukkelijk geen
// gokken: het volgt uitsluitend links die de site zelf publiceert.
// Hoe zeker een kandidaat eruitziet. Bepaalt de volgorde waarin we ze proberen,
// want we trekken er hooguit MAX_GELINKT na.
export function feedScore(url) {
  if (/sitemap/i.test(url)) return 0;             // XML, maar nooit een feed
  if (/\.rss(\?|$)/i.test(url)) return 5;
  if (/\.atom(\?|$)/i.test(url)) return 5;
  if (/(^|[/.?=&-])rss([/.?&=-]|$)/i.test(url)) return 4;
  if (/(^|[/?=&-])feed([/.?&=-]|$)/i.test(url)) return 3;
  if (/\.xml(\?|$)/i.test(url)) return 1;
  return 0;
}

export function feedLinksUitTekst(html, basis) {
  // Bewust NIET alleen <a href>. rijksoverheid.nl is een Next.js-app: 223 kB
  // HTML met 25 <a>-tags, want de feedlijst zit in de JavaScript-payload en
  // niet in de opmaak. Wie alleen ankers leest, ziet daar niets. We halen de
  // URL's daarom uit de hele respons — nog steeds uitsluitend adressen die de
  // site zelf publiceert, alleen niet meer afhankelijk van waar ze staan.
  const kaal = html.replace(/\\\//g, "/").replace(/\\u002[fF]/g, "/").replace(/&amp;/g, "&");
  const scores = new Map();
  const re = /https?:\/\/[^\s"'<>\\)\]}]+|\/[A-Za-z0-9._~%+-]+(?:\/[A-Za-z0-9._~%+-]+)*/g;
  let m;
  while ((m = re.exec(kaal))) {
    const kandidaat = m[0].replace(/[.,;:)\]]+$/, "");
    const score = feedScore(kandidaat);
    if (!score) continue;
    try {
      const url = new URL(kandidaat, basis).href;
      if (!/^https?:/i.test(url)) continue;
      if ((scores.get(url) || 0) < score) scores.set(url, score);
    } catch { /* onbruikbaar adres */ }
  }
  return [...scores]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => ({ url, titel: "" }));
}

export function feedSamenvatting(tekst) {
  const titel = (tekst.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const items = (tekst.match(/<item[\s>]|<entry[\s>]/gi) || []).length;
  const datums = [...tekst.matchAll(/<(?:pubDate|updated|published|dc:date)>([^<]+)</gi)]
    .map((d) => Date.parse(d[1]))
    .filter((t) => !Number.isNaN(t));
  const nieuwste = datums.length ? new Date(Math.max(...datums)) : null;
  return {
    titel: titel.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/\s+/g, " ").trim().slice(0, 70),
    items,
    nieuwste,
    dagenOud: nieuwste ? Math.round((Date.now() - nieuwste.getTime()) / 86400000) : null,
  };
}

export function licentieSporen(html) {
  const gevonden = [];
  for (const s of LICENTIESPOREN) if (s.patroon.test(html)) gevonden.push(s);
  return gevonden;
}

// Diagnose. Als een verkenning een uitkomst geeft die niet kan kloppen — "geen
// feedlink" op een pagina die de feedlijst van de Rijksoverheid is — dan is de
// vraag niet welke regexp beter moet, maar WAT de runner eigenlijk binnenkrijgt.
// Met BRON_DUMP=1 toont hij dat: de lengte, het aantal links, de content-type
