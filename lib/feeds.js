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

import { FEED_TIMEOUT_MS, DATUMPOORT_UREN } from "./config.js";
// bronnen.json wordt bij de build ingesloten (esbuild inlinet de JSON-import),
// zodat er geen runtime-pad/cwd-onzekerheid is in de serverless functie. Een
// wijziging aan bronnen.json wordt bij de eerstvolgende Vercel-deploy actief.
import bronnenDoc from "../bronnen.json" with { type: "json" };

// ---- Bronnen laden ----------------------------------------------------------
export function laadBronnen() {
  return Array.isArray(bronnenDoc.bronnen) ? bronnenDoc.bronnen : [];
}

// ---- Frankrijk-filter voor NL-persfeeds ------------------------------------
const FRANKRIJK_TREFWOORDEN = [
  "frankrijk",
  "franse",
  "fransen",
  "parijs",
  "france",
  "french",
  "macron",
  "bardella",
  "le pen",
  "matignon",
  "elysee",
  "elysée",
  "assemblee nationale",
  "assemblée",
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
  const bronStatus = resultaten.map((r) => ({
    naam: r.bron.naam,
    thema: r.bron.thema,
    regime: r.bron.regime,
    verificatie: r.bron.verificatie || null,
    ok: r.ok,
    aantal: r.items.length,
  }));
  return { items, bronStatus };
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
    if (!reactie.ok) return { bron, ok: false, items: [] };
    // Meeste bronnen zijn RSS/Atom (XML). De verenigingen-bron levert JSON
    // (de aggregaat-feed van antonnoe/verenigingen-kalender).
    let ruw;
    if (bron.type === "json-verenigingen") {
      ruw = parseerJsonVerenigingen(await reactie.json());
    } else {
      ruw = parseerFeed(await reactie.text());
    }
    const items = normaliseerBron(ruw, bron, nu);
    return { bron, ok: true, items };
  } catch {
    return { bron, ok: false, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

function normaliseerBron(ruw, bron, nu) {
  const gezien = new Set();
  const uit = [];
  // Sommige bronnen (bv. verenigingen: laagfrequent, evergreen) mogen een ruimer
  // venster hebben dan de standaard-datumpoort.
  const urenTerug = bron.vensterDagen ? bron.vensterDagen * 24 : DATUMPOORT_UREN;
  for (const item of ruw) {
    if (!binnenDatumpoort(item.datum, nu, urenTerug)) continue;
    if (bron.frankrijkFilter && !gaatOverFrankrijk(item.titel)) continue;

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
    // Regime: alleen overheid krijgt de feed-samenvatting mee. Pers = titel-only.
    if (bron.regime === "overheid" && item.samenvatting) {
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
