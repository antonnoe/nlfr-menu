// Bron-URL-validatie: hoort deze URL werkelijk bij de geconfigureerde bron?
// ---------------------------------------------------------------------------
// AANLEIDING. Op /actueel wezen bronlinks onder Infofrankrijk-items naar
// https://fonts.googleapis.com (leeg pad) en naar de Google-Fonts-stylesheet.
// Grondoorzaak zat in lib/feeds.js: de Atom-tak van leesLink() zocht met één
// regex naar het EERSTE <link ... href="..."> in het hele <item>-blok — en dat
// blok bevat bij WordPress ook <content:encoded> met de volledige artikel-HTML.
// Artikelen met een ingebouwd Divi-blok beginnen met hun eigen font-links, dus
// die won van de echte <link>…</link> van het item.
//
// Die fout is aan de wortel gerepareerd (leesLink kijkt niet meer in de
// inhoudstags). Deze module is de tweede lijn: een expliciete toets op ELKE
// bron-URL, voor ALLE regimes — ook Infofrankrijk en verenigingen, die buiten
// de inhoudelijke publicatie-gate vallen. Faalt de toets, dan is er geen
// klikbare link en een leesbare weigeringsreden; er wordt NOOIT stil op een
// andere waarde teruggevallen.
//
// De toets is bewust deterministisch en dependency-vrij: dezelfde code draait
// in de serverless functie, in de tests en in de sonde-workflow.

import { GEBLOKKEERDE_DOMEINEN } from "./config.js";
// bronnen.json rechtstreeks, niet via lib/feeds.js: anders importeren feeds.js
// en bronurl.js elkaar circulair.
import bronnenDoc from "../bronnen.json" with { type: "json" };

// ---- Publieke suffixen ------------------------------------------------------
// Een piepklein stukje "public suffix list", alleen de suffixen die in
// bronnen.json daadwerkelijk voorkomen. Waarom nodig: de registreerbare
// domeinnaam bepaalt of twee hosts bij dezelfde uitgever horen.
//   feeds.nos.nl        -> nos.nl              (artikelen staan op nos.nl)
//   www.douane.gouv.fr  -> douane.gouv.fr      (NIET het hele gouv.fr)
//   antonnoe.github.io  -> antonnoe.github.io  (NIET heel github.io)
// Zonder "gouv.fr" zou elke gouv.fr-site voor elke overheidsbron doorgaan;
// zonder "github.io" zou elke GitHub-Pages-site voor de verenigingenbron
// doorgaan. Onbekende suffixen vallen terug op het laatste label, wat voor
// .fr/.nl/.com precies goed is.
const PUBLIEKE_SUFFIXEN = ["gouv.fr", "github.io"];

// ---- Asset-hosts ------------------------------------------------------------
// Categorisch geweerd, ongeacht welke bron ze aanlevert: fonts, CDN's,
// statische assets, analytics en tagmanagers. Dit zijn nooit artikelpagina's.
// Twee lijsten, want beide aanvalsvormen komen voor: een herkenbare volledige
// domeinnaam, en een herkenbaar hostlabel voor de eigen assetsubdomeinen van
// een verder legitieme bron (static.lemonde.fr, cdn.nos.nl).
const ASSET_DOMEINEN = new Set([
  "googleapis.com", "gstatic.com", "googletagmanager.com", "google-analytics.com",
  "googlesyndication.com", "doubleclick.net", "googleadservices.com",
  "cloudflare.com", "cloudfront.net", "akamaized.net", "akamai.net", "fastly.net",
  "jsdelivr.net", "unpkg.com", "cdnjs.com", "bootstrapcdn.com", "fontawesome.com",
  "typekit.net", "typography.com", "fonts.com",
  "gravatar.com", "w.org", "wp.com", "wordpress.org",
  "facebook.net", "fbcdn.net", "twimg.com", "licdn.com",
  "segment.com", "segment.io", "hotjar.com", "matomo.cloud", "mixpanel.com",
  "scorecardresearch.com", "quantserve.com", "adsrvr.org", "criteo.com",
  "outbrain.com", "taboola.com",
]);
const ASSET_LABELS = new Set([
  "fonts", "font", "cdn", "cdn1", "cdn2", "cdns", "static", "statics",
  "assets", "asset", "img", "imgs", "image", "images", "media", "files",
  "analytics", "analytic", "stats", "stat", "telemetry", "tracking", "track",
  "tracker", "pixel", "tag", "tags", "tagmanager", "gtm", "ads", "ad",
  "adserver", "adservice", "doubleclick", "beacon", "metrics",
]);

// ---- Hostgereedschap --------------------------------------------------------
function kaal(host) {
  const h = String(host || "").trim().toLowerCase().replace(/\.$/, "");
  return h.startsWith("www.") ? h.slice(4) : h;
}

// De registreerbare domeinnaam: publiek suffix + één label ervoor.
export function registreerbaarDomein(host) {
  const h = kaal(host);
  if (!h) return "";
  for (const suf of PUBLIEKE_SUFFIXEN) {
    if (h === suf) return h;
    if (h.endsWith("." + suf)) {
      const rest = h.slice(0, -(suf.length + 1)).split(".");
      return `${rest[rest.length - 1]}.${suf}`;
    }
  }
  const delen = h.split(".");
  return delen.length <= 2 ? h : delen.slice(-2).join(".");
}

export function isAssetHost(host) {
  const h = kaal(host);
  if (!h) return false;
  if (ASSET_DOMEINEN.has(registreerbaarDomein(h))) return true;
  // Elk label los toetsen: "fonts.googleapis.com", "static.lemonde.fr",
  // "cdn-images.example.org" (koppelteken-samenstellingen meegenomen).
  return h
    .split(".")
    .slice(0, -1) // het TLD zelf nooit als label toetsen
    .some((label) => label.split("-").some((deel) => ASSET_LABELS.has(deel)));
}

function geblokkeerdDomein(host) {
  const h = kaal(host);
  return GEBLOKKEERDE_DOMEINEN.some((d) => {
    const k = kaal(d);
    return h === k || h.endsWith("." + k);
  });
}

// Hoort `host` bij `toegestaan`? Gelijk, of een subdomein daarvan.
function hoortBij(host, toegestaan) {
  const h = kaal(host);
  const t = kaal(toegestaan);
  if (!h || !t) return false;
  return h === t || h.endsWith("." + t) || registreerbaarDomein(h) === registreerbaarDomein(t);
}

// Welke hosts mag deze bron aanleveren?
//   - de host van de feed zelf (en subdomeinen / hetzelfde registreerbare domein)
//   - alles wat de bron expliciet in `linkDomeinen` declareert
export function toegestaneHosts(bron) {
  const uit = [];
  if (bron && bron.feed) {
    try { uit.push(new URL(bron.feed).hostname); } catch { /* onbruikbare feed-URL */ }
  }
  for (const d of (bron && bron.linkDomeinen) || []) {
    if (typeof d === "string" && d.trim()) uit.push(d.trim());
  }
  return uit;
}

// ---- Het oordeel ------------------------------------------------------------
// Geeft { ok, url, reden }. Bij ok:false is `url` altijd null en `reden` een
// zin die zo in /review getoond kan worden.
export function bronUrlOordeel(ruw, bron = {}) {
  const tekst = typeof ruw === "string" ? ruw.trim() : ruw && ruw.url ? String(ruw.url).trim() : "";
  if (!tekst) return { ok: false, url: null, reden: "geen bron-URL aanwezig" };

  let u;
  try { u = new URL(tekst); } catch {
    return { ok: false, url: null, reden: `geen absolute URL: "${kort(tekst)}"` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, url: null, reden: `protocol ${u.protocol} is niet http(s)` };
  }
  // Inloggegevens in een URL horen nooit bij een artikellink en maskeren de host.
  if (u.username || u.password) {
    return { ok: false, url: null, reden: "URL bevat inloggegevens" };
  }
  const host = u.hostname.toLowerCase();
  if (!host || !host.includes(".") || /^[\d.]+$/.test(host) || host.endsWith(".local")) {
    return { ok: false, url: null, reden: `geen publieke hostnaam: "${host}"` };
  }
  // Leeg pad: "https://fonts.googleapis.com" en "https://example.org/" wijzen
  // naar een voorpagina, nooit naar het artikel waar de bronregel over gaat.
  if (u.pathname === "" || u.pathname === "/") {
    return { ok: false, url: null, reden: `leeg pad (alleen de voorpagina van ${host})` };
  }
  if (isAssetHost(host)) {
    return { ok: false, url: null, reden: `asset-host geweigerd: ${host}` };
  }
  if (geblokkeerdDomein(host)) {
    return { ok: false, url: null, reden: `uitgesloten domein: ${host}` };
  }

  // De herkomsttoets. Aggregaatbronnen (zie hieronder) slaan deze over, alle
  // andere regimes — pers, overheid én eigen/Infofrankrijk — niet.
  if (!bron.linkAggregaat) {
    const toegestaan = toegestaneHosts(bron);
    if (!toegestaan.length) {
      return { ok: false, url: null, reden: "bron heeft geen geconfigureerde feed-host" };
    }
    if (!toegestaan.some((t) => hoortBij(host, t))) {
      return {
        ok: false,
        url: null,
        reden: `host ${host} hoort niet bij bron ${bron.naam || toegestaan[0]} (verwacht ${toegestaan.join(" of ")})`,
      };
    }
  }
  return { ok: true, url: u.href, reden: null };
}

// Kortweg: mag deze URL als klikbare bronlink getoond worden?
export function bronUrlGeldig(ruw, bron = {}) {
  return bronUrlOordeel(ruw, bron).ok;
}

function kort(tekst) {
  const s = String(tekst || "");
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

// ---- Bron opzoeken bij een opgeslagen record --------------------------------
// Opgeslagen documenten (publicaties, overheidsberichten, registerrecords)
// bewaren de bronNAAM, niet de bronconfiguratie. Om zo'n record achteraf te
// kunnen toetsen moet de naam terug naar bronnen.json.
const BRONNEN = Array.isArray(bronnenDoc.bronnen) ? bronnenDoc.bronnen : [];

export function bronVoorNaam(naam) {
  const n = String(naam || "").trim().toLowerCase();
  if (!n) return null;
  return (
    BRONNEN.find((b) => String(b.naam || "").toLowerCase() === n) ||
    // "Service-Public — particuliers" is opgeslagen als "Service-Public":
    // val terug op een bron waarvan de naam met de opgeslagen naam begint.
    BRONNEN.find((b) => String(b.naam || "").toLowerCase().startsWith(n)) ||
    null
  );
}

// Bij welke bron hoort deze URL, ongeacht welke naam het record noemt? Nodig
// voor herstel: een besmet record ("fonts.googleapis.com") heeft een bronnaam
// die nog wél klopt, en dan is de vraag of de URL bij díé bron hoort.
export function bronVoorUrl(url) {
  let host;
  try { host = new URL(String(url)).hostname; } catch { return null; }
  return BRONNEN.find((b) => {
    try { return hoortBij(host, new URL(b.feed).hostname); } catch { return false; }
  }) || null;
}

// ---- Toetsing van een opgeslagen record -------------------------------------
// Loopt de bronnenlijst van één document langs en geeft per onbruikbare bron
// een leesbare weigering terug. Verwijdert niets: de aanroeper beslist of hij
// de link onderdrukt (tegels) of de weigering toont (reviewtool).
export function keurBronnen(doc) {
  const weigeringen = [];
  const bronnen = (doc && Array.isArray(doc.bronnen) ? doc.bronnen : []);
  for (const b of bronnen) {
    const bron = bronVoorNaam(b && b.naam) || {};
    const oordeel = bronUrlOordeel(b && b.url, bron);
    if (!oordeel.ok) {
      weigeringen.push({ naam: (b && b.naam) || "", url: (b && b.url) || null, reden: oordeel.reden });
    }
  }
  // Overheidsberichten en registerrecords hebben één losse bron-URL.
  const los = doc && (doc.bronUrl || (doc.bronnen ? null : doc.url));
  if (los) {
    const bron = bronVoorNaam(doc.bronNaam || doc.bron) || {};
    const oordeel = bronUrlOordeel(los, bron);
    if (!oordeel.ok) {
      weigeringen.push({ naam: doc.bronNaam || doc.bron || "", url: los, reden: oordeel.reden });
    }
  }
  return weigeringen;
}
