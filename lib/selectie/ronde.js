// Eén selectieronde: scannen, voorselecteren, laten beoordelen, opslaan.
// ---------------------------------------------------------------------------
// Draait vanuit /api/selectie-cron (Vercel Cron, elk uur). Raakt NIETS van de
// actueelketen: eigen sleutels (selectie:*), eigen bronnen, alleen-lezen op de
// overheidsvoorraad van /actueel.
//
// Volgorde per ronde:
//   1. bronnen ophalen (pers NL/BE, MeteoAlarm) + live overheidsberichten uit KV
//   2. Frankrijk-filter, venster, ontdubbelen
//   3. alles wat al kandidaat is of al beslist, overslaan
//   4. PEIL-voorselectie per bericht
//   5. hooguit SEL_MAX_PER_AANROEP berichten naar het model, met de laatste
//      beslissingen als voorbeelden
//   6. elk bericht als kandidaat opslaan, ook de berichten die nog op hun
//      oordeel wachten en ook als het model faalt: de redactie mist niets, en
//      de volgende ronde geeft ze alsnog een oordeel
//
// diagnose = stap 1 t/m 4 en STOP: geen modelaanroep, niets weggeschreven.

import { FEED_TIMEOUT_MS, SCAN_OVERHEID } from "../config.js";
import { getJSON, setJSON, listJSON } from "../store.js";
import { SELECTIE_PERS_BRONNEN, SELECTIE_METEO_FEED, SELECTIE_PEIL_URL } from "./bronnen.js";
import {
  leesPersFeed,
  leesMeteoFeed,
  gaatOverFrankrijk,
  ontdubbel,
  binnenVenster,
  kandidaatId,
  peilVoorselectie,
  peilKort,
  voorbeeldenVoorModel,
  KEY_SEL_KANDIDAAT,
  SCAN_SEL_KANDIDAAT,
  SCAN_SEL_BESLUIT,
  KEY_SEL_RONDE,
  KEY_SEL_PEIL,
  SEL_KANDIDAAT_TTL_S,
  SEL_PEIL_TTL_S,
  SEL_MAX_PER_AANROEP,
  SEL_MAX_NIEUW_PER_RONDE,
} from "./kern.js";
import { beoordeel, SELECTIE_MODEL } from "./model.js";

const UA = "NLFR-Selectie/1.0 (+https://www.nederlanders.fr)";

async function haal(url, f = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const r = await f(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, application/json, */*" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!r.ok) return { ok: false, http: r.status, tekst: "" };
    return { ok: true, http: r.status, tekst: await r.text() };
  } catch (e) {
    return { ok: false, http: e && e.name === "AbortError" ? "timeout" : "fout", tekst: "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function laadPeil(f = fetch) {
  const cache = await getJSON(KEY_SEL_PEIL);
  if (cache && Array.isArray(cache.parameters) && cache.parameters.length) return { ...cache, uitCache: true };
  const r = await haal(SELECTIE_PEIL_URL, f);
  if (!r.ok) return { parameters: [], fout: `PEIL niet bereikbaar (${r.http})` };
  try {
    const doc = JSON.parse(r.tekst);
    const parameters = Array.isArray(doc.parameters) ? doc.parameters : [];
    const uit = { versie: doc.versie || null, stand: doc.stand || null, parameters };
    try { await setJSON(KEY_SEL_PEIL, uit, SEL_PEIL_TTL_S); } catch { /* cache is een gemak */ }
    return uit;
  } catch (e) {
    return { parameters: [], fout: `PEIL onleesbaar: ${e.message}` };
  }
}

// Live overheidsberichten van /actueel (al in het Nederlands samengevat):
// de belangrijkste invoer voor "wet- en regelgeving" en de PEIL-koppeling.
function overheidAlsKandidaat(doc) {
  return {
    soort: "overheid",
    titel: doc.kop || doc.titelBron || "",
    url: doc.url,
    bron: doc.bron,
    land: /rijksoverheid|nederland/i.test(String(doc.bron || "")) ? "NL" : "FR",
    datum: doc.datum || doc.gepubliceerdOp || null,
    samenvatting: String(doc.samenvatting || "").slice(0, 600),
    idBasis: `overheid|${doc.id}`,
  };
}

export async function verzamel(nu = Date.now(), f = fetch) {
  const status = [];
  const pers = await Promise.all(
    SELECTIE_PERS_BRONNEN.map(async (b) => {
      const r = await haal(b.feed, f);
      const items = r.ok ? leesPersFeed(r.tekst, b) : [];
      const doorgelaten = b.filter ? items.filter((i) => gaatOverFrankrijk(`${i.titel} ${i.samenvatting}`)) : items;
      status.push({ naam: b.naam, http: r.http, ruw: items.length, frankrijk: doorgelaten.length });
      return doorgelaten;
    })
  );
  const meteoRuw = await haal(SELECTIE_METEO_FEED, f);
  const meteo = meteoRuw.ok ? leesMeteoFeed(meteoRuw.tekst, nu) : [];
  status.push({ naam: "MeteoAlarm", http: meteoRuw.http, ruw: meteo.length, frankrijk: meteo.length });

  let overheid = [];
  try {
    overheid = (await listJSON(SCAN_OVERHEID)).filter((d) => d && d.url && (d.kop || d.titelBron)).map(overheidAlsKandidaat);
  } catch {
    overheid = [];
  }
  status.push({ naam: "Overheid (actueel)", http: "kv", ruw: overheid.length, frankrijk: overheid.length });

  const binnen = [...pers.flat().filter((i) => binnenVenster(i, nu)), ...meteo, ...overheid.filter((i) => binnenVenster(i, nu, 72))];
  const uniek = ontdubbel(binnen).map((i) => ({ ...i, id: kandidaatId(i) }));
  return { items: uniek, status };
}

export async function draaiRonde({ nu = Date.now(), diagnose = false, f = fetch, maakClient } = {}) {
  const start = Date.now();
  const [{ items, status }, peil, kandidaten, besluiten] = await Promise.all([
    verzamel(nu, f),
    laadPeil(f),
    listJSON(SCAN_SEL_KANDIDAAT),
    listJSON(SCAN_SEL_BESLUIT),
  ]);
  const bekend = new Set([...kandidaten.map((k) => k.id), ...besluiten.map((b) => b.id)]);
  // Kandidaten zonder oordeel (vorige modelaanroep mislukt) krijgen een herkansing.
  const zonderOordeel = kandidaten.filter((k) => !k.ai);
  const nieuw = items.filter((i) => !bekend.has(i.id));

  const metPeil = [...zonderOordeel, ...nieuw].map((i) => ({
    ...i,
    peilAangeboden: peilVoorselectie(`${i.titel} ${i.samenvatting || ""}`, peil.parameters).map(peilKort),
  }));
  // Meteo en overheid eerst: die zijn zeldzaam en vaak het belangrijkst.
  const prio = { meteo: 0, overheid: 1, pers: 2 };
  metPeil.sort((a, b) => (prio[a.soort] ?? 3) - (prio[b.soort] ?? 3) || String(b.datum || "").localeCompare(String(a.datum || "")));
  // Alles wordt opgeslagen (de redactie ziet het meteen); het model beoordeelt
  // per ronde een batch, de rest krijgt zijn oordeel in de volgende rondes.
  const opslaan = metPeil.slice(0, SEL_MAX_NIEUW_PER_RONDE + zonderOordeel.length);
  const batch = opslaan.slice(0, SEL_MAX_PER_AANROEP);

  const journaal = {
    op: new Date(nu).toISOString(),
    diagnose,
    model: SELECTIE_MODEL,
    peil: { versie: peil.versie || null, aantal: peil.parameters.length, fout: peil.fout || null },
    bronnen: status,
    gevonden: items.length,
    nieuw: nieuw.length,
    herkansing: zonderOordeel.length,
    beoordeeld: 0,
    opgeslagen: 0,
    modelFout: null,
    duurMs: 0,
  };

  if (diagnose) {
    journaal.duurMs = Date.now() - start;
    journaal.voorbeeld = batch.slice(0, 10).map((i) => ({
      soort: i.soort,
      titel: i.titel,
      bron: i.bron,
      peil: i.peilAangeboden.map((p) => p.id),
    }));
    return journaal;
  }

  let oordelen = new Map();
  if (batch.length) {
    try {
      oordelen = await beoordeel(batch, voorbeeldenVoorModel(besluiten), maakClient);
      journaal.beoordeeld = oordelen.size;
    } catch (e) {
      journaal.modelFout = String(e && e.message ? e.message : e).slice(0, 300);
      console.warn(`[selectie] modelaanroep mislukt: ${journaal.modelFout}`);
    }
  }

  const gevondenOp = new Date(nu).toISOString();
  for (const i of opslaan) {
    const { peilAangeboden, ...rest } = i;
    const oordeel = oordelen.get(i.id) || null;
    const doc = {
      ...rest,
      peilAangeboden,
      gevondenOp: rest.gevondenOp || gevondenOp,
      ai: oordeel ? { ...oordeel, model: SELECTIE_MODEL, op: gevondenOp } : null,
    };
    try {
      await setJSON(KEY_SEL_KANDIDAAT(i.id), doc, SEL_KANDIDAAT_TTL_S);
      journaal.opgeslagen += 1;
    } catch (e) {
      console.warn(`[selectie] opslaan mislukt voor ${i.id}: ${e && e.message}`);
    }
  }
  journaal.duurMs = Date.now() - start;
  try { await setJSON(KEY_SEL_RONDE, journaal); } catch { /* journaal is diagnose */ }
  console.log(`[selectie] ronde: gevonden=${journaal.gevonden} nieuw=${journaal.nieuw} beoordeeld=${journaal.beoordeeld} opgeslagen=${journaal.opgeslagen}${journaal.modelFout ? " modelFout" : ""}`);
  return journaal;
}
