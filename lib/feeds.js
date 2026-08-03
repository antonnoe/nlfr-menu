// Feed-aggregatie voor /actueel: bronnen laden, RSS 2.0 + Atom parsen,
// normaliseren en per bron het regime respecteren.
// ---------------------------------------------------------------------------
// Regime-regel (hard):
//   - overheid: titel + samenvatting (uit de feed) + bron + URL
//   - pers:     UITSLUITEND titel + bron + datum + link (geen samenvatting)
// Bronnen met "frankrijkFilter": true (NL-persfeeds) worden server-side op
// Frankrijk-trefwoorden gefilterd. Een kapotte/te trage feed wordt overgeslagen;
// de rest blijft werken (zelfde resilience als de bosbrandentool).
// De XML-parser is bewust regex-gebaseerd en dependency-vrij, overgenomen en
// vertaald uit antonnoe/bosbranden (lib/nieuws-filter.ts).

import {
  FEED_TIMEOUT_MS,
  VENSTER_PERS_UREN,
  VENSTER_OVERHEID_UREN,
  FAITS_DIVERS_IN,
  FAITS_DIVERS_UIT,
  VERENIGING_UIT,
  BUITENLAND_UIT,
  BUITENLAND_UIT_NL,
  GEBLOKKEERDE_DOMEINEN,
  AGENDA_URL,
  AGENDA_DAGEN,
} from "./config.js";
// bronnen.json wordt bij de build ingesloten (esbuild inlinet de JSON-import),
// zodat er geen runtime-pad/cwd-onzekerheid is in de serverless functie. Een
// wijziging aan bronnen.json wordt bij de eerstvolgende Vercel-deploy actief.
import bronnenDoc from "../bronnen.json" with { type: "json" };

// ---- Bronnen laden ----------------------------------------------------------
export function laadBronnen() {
  return Array.isArray(bronnenDoc.bronnen) ? bronnenDoc.bronnen : [];
}

// ---- Frankrijk-filter voor NL-persfeeds ------------------------------------
// Ruim opgezet: los land/-bijvoeglijk, hoofdsteden/regio's, politiek en de
// grote (brand)regio's — zodat NL-nieuws over bv. de bosbranden in de Gironde
// niet meer wegvalt. Accent-ongevoelig (zie normaliseer()).
const FRANKRIJK_TREFWOORDEN = [
  // land & volk
  "frankrijk", "frans", "franse", "fransen", "france", "french",
  // steden & regio's
  "parijs", "parijse", "paris", "marseille", "lyon", "bordeaux", "toulouse",
  "nice", "montpellier", "cannes", "corsica", "corse", "bretagne", "normandie",
  "provence", "gironde", "landes", "var", "aude", "herault", "riviera",
  "cote d'azur", "cote d azur", "azurenkust", "dordogne", "ardeche",
  // politiek & instituties
  "macron", "bardella", "le pen", "lepen", "matignon", "elysee", "elysée",
  "assemblee nationale", "assemblée", "franse regering", "franse president",
  // Franse bijvoeglijke vormen (de bronkoppen zijn Frans)
  "francais", "francaise", "francaises", "francophone", "hexagone",
];

export function normaliseer(tekst) {
  return String(tekst || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function gaatOverFrankrijk(titel) {
  const n = normaliseer(titel);
  return FRANKRIJK_TREFWOORDEN.some((w) => n.includes(w));
}

// ---- Buitenland-zeef voor pers ---------------------------------------------
// True = doorlaten. Een kop over het buitenland (FIFA, VS, Israël, Ceuta…) valt
// weg, TENZIJ hij ook Frankrijk noemt (directe impact op Frankrijk). Zo blijft
// "renforts français à la frontière espagnole" wél staan.
export function buitenlandDoorlaat(titel) {
  const n = normaliseer(titel);
  const buitenland = BUITENLAND_UIT.some((w) => n.includes(w));
  if (!buitenland) return true;
  return gaatOverFrankrijk(titel); // rescue bij directe Frankrijk-link
}

// ---- Buitenland-zeef, tweede laag: op NL-SYNTHESETEKST ----------------------
// De titelzeef hierboven werkt op Franse brontitels bij het inlezen. Maar een
// verhaal waarvan de Franse koppen het land niet noemen glipt erdoor, en pas de
// NL-synthese maakt er "Israël/Hamas" van. Deze functie toetst die NL-tekst
// (kop + tekst) op zowel de Franse als de Nederlandse buitenlandtermen. True =
// doorlaten; zelfde rescue als de titelzeef (noemt de tekst óók Frankrijk → blijft).
export function buitenlandDoorlaatNL(tekst) {
  const n = normaliseer(tekst);
  const buitenland =
    BUITENLAND_UIT.some((w) => n.includes(w)) ||
    BUITENLAND_UIT_NL.some((w) => n.includes(w));
  if (!buitenland) return true;
  return gaatOverFrankrijk(tekst); // rescue bij directe Frankrijk-link
}

// Host van een URL (of null). Voor de domein-blocklist.
function urlHost(url) {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domeinGeblokkeerd(url) {
  const host = urlHost(url);
  if (!host) return false;
  return GEBLOKKEERDE_DOMEINEN.some((d) => host === d || host.endsWith(`.${d}`));
}

// ---- Faits-divers-zeef (alleen op pers-input, vóór clustering/synthese) -----
// Insluitlijst wint altijd: een titel met een insluitterm gaat door, ook al
// bevat hij ook een uitsluitterm (bv. "incendie" met "mort"). Anders: bevat de
// titel een uitsluitterm -> geweigerd. Zo blijven relevante onderwerpen
// (brand, staking, belasting…) staan en vallen pure misdaad/faits-divers
// (Orange/Annecy-achtig) eruit.
export function faitsDiversDoorlaat(titel) {
  const n = normaliseer(titel);
  if (FAITS_DIVERS_IN.some((w) => n.includes(w))) return true; // insluiten wint
  if (FAITS_DIVERS_UIT.some((w) => n.includes(w))) return false;
  return true;
}

// Stabiele korte id uit een URL (voor KV-sleutels van overheidsberichten).
export function hashId(tekst) {
  let h = 5381;
  const s = String(tekst || "");
  for (let i = 0; i < s.length; i += 1) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

// ---- Commerciële/zelfpromotie-zeef voor de verenigingenfeed ----------------
// True = doorlaten. Alleen de TITEL wordt getoetst: zelfpromotie van
// dienstverleners noemt de dienst in de kop ("… MultiServices", "reparatie"),
// terwijl echt cultureel nieuws (bv. een expositie waar werk "te koop" is) die
// termen soms in de samenvatting heeft — die willen we juist behouden.
export function verenigingDoorlaat(titel) {
  const n = normaliseer(titel || "");
  return !VERENIGING_UIT.some((w) => n.includes(w));
}

// ---- Datumpoort -------------------------------------------------------------
function binnenDatumpoort(iso, nu, urenTerug) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  if (t > nu + 24 * 60 * 60 * 1000) return false; // >1 dag in de toekomst = fout
  const grens = nu - urenTerug * 60 * 60 * 1000;
  return t >= grens;
}

// ---- Publieke functie: alle actieve bronnen ophalen en normaliseren --------
export async function haalAlleItems(nu = Date.now()) {
  const bronnen = laadBronnen().filter((b) => b.actief && b.feed);
  const resultaten = await Promise.all(bronnen.map((b) => haalBron(b, nu)));
  const items = resultaten.flatMap((r) => r.items);
  const bronStatus = resultaten.map((r) => {
    // Per-bron diagnose in de serverlogs: HTTP-status, aantal geparseerd
    // (vóór filtering) en aantal na filtering. Zo is direct te zien of een
    // "0 items"-bron kapot is (HTTP/parse) of alleen door de filters valt.
    console.log(
      `[feeds] ${r.bron.naam}: http=${r.http}, ruw=${r.ruw}, na-filter=${r.items.length}`
    );
    return {
      naam: r.bron.naam,
      thema: r.bron.thema,
      regime: r.bron.regime,
      verificatie: r.bron.verificatie || null,
      ok: r.ok,
      http: r.http,
      ruw: r.ruw, // aantal items vóór filtering
      aantal: r.items.length, // aantal na filtering
    };
  });
  return { items, bronStatus };
}

// ---- Verenigingen-agenda: activiteiten in de komende AGENDA_DAGEN dagen -----
// Databron: verenigingen[].events[] uit de verenigingen-repo (GitHub Pages).
export async function haalAgenda(nu = Date.now()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const reactie = await fetch(AGENDA_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!reactie.ok) return { ok: false, items: [] };
    const json = await reactie.json();
    const verenigingen = Array.isArray(json && json.verenigingen)
      ? json.verenigingen
      : [];
    const grensBegin = nu - 12 * 60 * 60 * 1000; // events van vandaag meenemen
    const grensEind = nu + AGENDA_DAGEN * 24 * 60 * 60 * 1000;
    const uit = [];
    for (const ver of verenigingen) {
      const naam = ver.afkorting || ver.naam || "";
      const events = Array.isArray(ver.events) ? ver.events : [];
      for (const ev of events) {
        const t = Date.parse(ev.datum);
        if (Number.isNaN(t) || t < grensBegin || t > grensEind) continue;
        uit.push({
          datum: ev.datum,
          titel: schoonTekst(ev.titel || ""),
          plaats: schoonTekst(ev.plaats || ""),
          tijd: schoonTekst(ev.tijd || ""),
          vereniging: schoonTekst(naam),
        });
      }
    }
    uit.sort((a, b) => (Date.parse(a.datum) || 0) - (Date.parse(b.datum) || 0));
    return { ok: true, items: uit };
  } catch {
    return { ok: false, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function haalBron(bron, nu) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const reactie = await fetch(bron.feed, {
      headers: {
        "User-Agent": "NLFR-Actueel/1.0 (+https://www.nederlanders.fr)",
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });
    if (!reactie.ok) {
      return { bron, ok: false, http: reactie.status, ruw: 0, items: [] };
    }
    // Meeste bronnen zijn RSS/Atom (XML). De verenigingen-bron levert JSON
    // (de aggregaat-feed van antonnoe/verenigingen-kalender).
    let ruw;
    if (bron.type === "json-verenigingen") {
      ruw = parseerJsonVerenigingen(await reactie.json());
    } else {
      ruw = parseerFeed(await reactie.text());
    }
    const items = normaliseerBron(ruw, bron, nu);
    return { bron, ok: true, http: reactie.status, ruw: ruw.length, items };
  } catch (e) {
    const reden = e && e.name === "AbortError" ? "timeout" : "fout";
    return { bron, ok: false, http: reden, ruw: 0, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

function normaliseerBron(ruw, bron, nu) {
  const gezien = new Set();
  const uit = [];
  // Datumvenster per regime (pers kort, overheid ruim); een bron kan dit
  // overrulen met "vensterDagen" in bronnen.json (bv. verenigingen: 30 dagen).
  const urenTerug = bron.vensterDagen
    ? bron.vensterDagen * 24
    : bron.regime === "overheid"
    ? VENSTER_OVERHEID_UREN
    : VENSTER_PERS_UREN;
  for (const item of ruw) {
    if (!binnenDatumpoort(item.datum, nu, urenTerug)) continue;
    if (domeinGeblokkeerd(item.url)) continue; // uitgesloten bron (bv. goedinfrankrijk.com)
    if (bron.frankrijkFilter && !gaatOverFrankrijk(item.titel)) continue;
    // Pers: buitenlandnieuws zonder Frankrijk-link eruit (FIFA, VS, Israël, Ceuta…).
    if (bron.regime === "pers" && !buitenlandDoorlaat(item.titel)) continue;
    // Verenigingenfeed: commerciële/zelfpromotie-items weren (op titel).
    if (bron.type === "json-verenigingen" && !verenigingDoorlaat(item.titel)) {
      continue;
    }

    const sleutel = normaliseer(item.titel).replace(/\s+/g, " ").trim();
    if (!sleutel || gezien.has(sleutel)) continue;
    gezien.add(sleutel);

    const genormaliseerd = {
      titel: item.titel,
      url: item.url,
      // Bij de aggregaat-feed staat de echte vereniging in item.bronNaam; anders
      // de bronnaam uit bronnen.json.
      bron: item.bronNaam || bron.naam,
      datum: item.datum,
      thema: bron.thema,
      regime: bron.regime,
    };
    // Regime: pers = titel-only (hard). Overheid én eigen content (bv.
    // Infofrankrijk) krijgen wél de feed-samenvatting mee.
    if (bron.regime !== "pers" && item.samenvatting) {
      genormaliseerd.samenvatting = item.samenvatting;
    }
    uit.push(genormaliseerd);
  }
  return uit;
}

// ---- JSON-aggregaatfeed van antonnoe/verenigingen-kalender -----------------
// Vorm: { items: [{ bron_naam, datum "YYYY-MM-DD", titel, link, excerpt }] }
export function parseerJsonVerenigingen(json) {
  const bron = json && Array.isArray(json.items) ? json.items : [];
  const uit = [];
  for (const it of bron) {
    const titel = schoonTekst(it.titel || it.title || "");
    const url = it.link || it.url;
    if (!titel || !url || !veiligeUrl(url)) continue;
    uit.push({
      titel,
      url,
      datum: naarIso(schoonTekst(it.datum || it.date || "")),
      samenvatting: kort(schoonTekst(it.excerpt || it.samenvatting || ""), 400),
      bronNaam: it.bron_naam || it.bron || null,
    });
  }
  return uit;
}

// ---- RSS 2.0 + Atom parser (regex, dependency-vrij) ------------------------
export function parseerFeed(xml) {
  const items = [];
  const blokken = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ];
  for (const match of blokken) {
    const blok = match[0];
    const titel = schoonTekst(leesTag(blok, "title"));
    const url = leesLink(blok);
    const datumRuw =
      leesTag(blok, "pubDate") ||
      leesTag(blok, "published") ||
      leesTag(blok, "updated") ||
      leesTag(blok, "dc:date");
    const datum = naarIso(schoonTekst(datumRuw));
    const samenvatting = schoonTekst(
      leesTag(blok, "description") || leesTag(blok, "summary")
    );
    if (!titel || !url) continue;
    items.push({
      titel,
      url,
      datum,
      samenvatting: kort(samenvatting, 400),
    });
  }
  return items;
}

function leesTag(blok, tag) {
  const patroon = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  return blok.match(patroon)?.[1] ?? "";
}

function leesLink(blok) {
  const atom = blok.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\/?>/i);
  if (atom) {
    const url = schoonTekst(atom[1]);
    return url && veiligeUrl(url) ? url : null;
  }
  const rss = schoonTekst(leesTag(blok, "link"));
  return rss && veiligeUrl(rss) ? rss : null;
}

function schoonTekst(waarde) {
  return decodeerXml(
    String(waarde || "")
      .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function kort(tekst, max) {
  if (!tekst) return "";
  return tekst.length > max ? `${tekst.slice(0, max - 1).trimEnd()}…` : tekst;
}

function naarIso(waarde) {
  if (!waarde) return null;
  const d = new Date(waarde);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function decodeerXml(waarde) {
  const benoemd = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"', nbsp: " " };
  return String(waarde).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (vol, code) => {
    if (code.startsWith("#x")) {
      const g = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(g) ? String.fromCodePoint(g) : vol;
    }
    if (code.startsWith("#")) {
      const g = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(g) ? String.fromCodePoint(g) : vol;
    }
    return benoemd[code.toLowerCase()] ?? vol;
  });
}

function veiligeUrl(waarde) {
  try {
    const u = new URL(waarde);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
