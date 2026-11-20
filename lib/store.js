// Opslag voor concepten en publicaties.
// ---------------------------------------------------------------------------
// KEUZE (gemotiveerd): Vercel KV (Upstash Redis), niet Blob. Twee redenen:
//   1. Concepten moeten AUTOMATISCH na 48 uur verlopen. Redis heeft daarvoor
//      een native TTL (SET ... EX). Blob kent geen TTL; dan zou je zelf een
//      opruimjob moeten bouwen.
//   2. Het gaat om enkele kleine JSON-documenten (concept/publicatie), precies
//      waar een key-value store voor is; Blob is bedoeld voor (grote) bestanden.
// We praten rechtstreeks met de Upstash REST-API via fetch, zodat er GEEN extra
// npm-pakket nodig is. De env-vars zijn de standaard Vercel KV-namen
// (KV_REST_API_URL / KV_REST_API_TOKEN).
//
// Graceful degradation: is KV niet ingesteld, dan geeft lezen leeg terug (de
// feed blijft werken) en gooit schrijven een duidelijke fout (zichtbaar in de
// reviewtool/cron, niet stil).

const URL_ENV = process.env.KV_REST_API_URL;
const TOKEN_ENV = process.env.KV_REST_API_TOKEN;

export function kvBeschikbaar() {
  return Boolean(URL_ENV && TOKEN_ENV);
}

async function cmd(args) {
  if (!kvBeschikbaar()) {
    throw new Error(
      "KV niet geconfigureerd (KV_REST_API_URL / KV_REST_API_TOKEN ontbreken)."
    );
  }
  const res = await fetch(URL_ENV, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN_ENV}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) {
    const tekst = await res.text().catch(() => "");
    throw new Error(`KV-fout ${res.status}: ${tekst.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json && typeof json === "object" && "error" in json && json.error) {
    throw new Error(`KV-fout: ${json.error}`);
  }
  return json ? json.result : null;
}

export async function getJSON(key) {
  if (!kvBeschikbaar()) return null;
  try {
    const waarde = await cmd(["GET", key]);
    if (waarde == null) return null;
    return JSON.parse(waarde);
  } catch {
    return null;
  }
}

// Zoals getJSON, maar een MISLUKTE lezing is hier een fout en geen "bestaat niet".
// getJSON slikt elke fout in en geeft dan null, waardoor een storing er hetzelfde
// uitziet als een ontbrekend record. Wie op grond van het resultaat gaat
// SCHRIJVEN (lezen-wijzigen-schrijven) gebruikt deze: null betekent echt "leeg",
// een gooi betekent "niet te lezen, schrijf niets".
// Zonder KV-configuratie gooit hij ook; de aanroeper hoort dat eerst te toetsen.
export async function getJSONStrikt(key) {
  const waarde = await cmd(["GET", key]);
  if (waarde == null) return null;
  return JSON.parse(waarde);
}

export async function setJSON(key, waarde, ttlSeconden) {
  const args = ["SET", key, JSON.stringify(waarde)];
  if (ttlSeconden && ttlSeconden > 0) {
    args.push("EX", String(Math.floor(ttlSeconden)));
  }
  await cmd(args);
  await indexToevoegen(key);
}

export async function del(key) {
  await cmd(["DEL", key]);
  await indexVerwijderen([key]);
}

// ---- Index per soort ----------------------------------------------------------
// Vroeger doorzocht elke scanKeys() de HELE opslag (SCAN over alle sleutels,
// met een stil plafond van 50 rondes = ~5.000 sleutels). Dat werd trager met
// elke sleutel en kapte bij groei stil af. Nu houdt elke schrijfactie een index
// bij: een gesorteerde verzameling per soort (`ix:<soortvoorvoegsel>`, bv.
// `ix:actueel:overheid:`), met als score het moment van schrijven. Lezen kost
// één opdracht voor de sleutels van die soort, ongeacht hoe groot de rest is,
// en kan met `sindsUren` alleen het recente deel ophalen.
//
// Oude gegevens: sleutels van vóór de index staan er niet in. Zolang de marker
// `ix:klaar` ontbreekt (eerste keer, en daarna elke 24 uur) bouwt de eerste
// lezing de index uit één volledige SCAN (zonder plafond; bij een
// noodstop wordt de marker niet gezet en gaat het volgende keer opnieuw).
// Daarna blijft alles werken zoals het was: niets wordt gewist of verplaatst,
// bestaande sleutels worden met ZADD NX toegevoegd (score van een al bekend
// item blijft). Sleutels die verlopen zijn ruimt de lezing zelf uit de index.
// Faalt een indexopdracht (KV zonder gesorteerde verzamelingen), dan valt
// scanKeys terug op de volledige SCAN: trager maar volledig.
const INDEX_MARKER = "ix:klaar";
const INDEX_MARKER_TTL_S = 24 * 60 * 60;
const SCAN_COUNT = "1000";
const SCAN_MAX_RONDES = 5000;

// "actueel:overheid:abc" -> "actueel:overheid:". Sleutels zonder tweede dubbele
// punt (zoals "selectie:ronde") krijgen geen index.
export function soortVoorvoegsel(sleutel) {
  const m = /^([^:]+:[^:]+:)/.exec(String(sleutel || ""));
  return m ? m[1] : null;
}
// Een patroon "voorvoegsel*" is indexeerbaar als het voorvoegsel exact een soort is.
function patroonVoorvoegsel(patroon) {
  const m = /^([^*?\[\]\\]+)\*$/.exec(String(patroon || ""));
  if (!m) return null;
  return soortVoorvoegsel(m[1] + "x") === m[1] ? m[1] : null;
}
const indexNaam = (voorvoegsel) => `ix:${voorvoegsel}`;

async function indexToevoegen(sleutel) {
  const v = soortVoorvoegsel(sleutel);
  if (!v) return;
  try {
    await cmd(["ZADD", indexNaam(v), String(Date.now()), sleutel]);
  } catch {
    // De index is een versnelling: een mislukte schrijfactie hier mag het
    // opslaan niet breken. De dagelijkse herbouw vult het aan.
  }
}
async function indexVerwijderen(sleutels) {
  const perSoort = new Map();
  for (const k of sleutels) {
    const v = soortVoorvoegsel(k);
    if (!v) continue;
    if (!perSoort.has(v)) perSoort.set(v, []);
    perSoort.get(v).push(k);
  }
  for (const [v, lijst] of perSoort) {
    try {
      await cmd(["ZREM", indexNaam(v), ...lijst]);
    } catch {
      /* zie indexToevoegen */
    }
  }
}

// Volledige scan, zonder het oude stille plafond: een noodstop meldt zich.
async function volledigeScan(patroon) {
  const gevonden = [];
  let cursor = "0";
  let rondes = 0;
  do {
    const res = await cmd(["SCAN", cursor, "MATCH", patroon, "COUNT", SCAN_COUNT]);
    // Upstash geeft [nieuweCursor, [keys...]]
    cursor = Array.isArray(res) ? String(res[0]) : "0";
    const keys = Array.isArray(res) && Array.isArray(res[1]) ? res[1] : [];
    gevonden.push(...keys);
    rondes += 1;
  } while (cursor !== "0" && rondes < SCAN_MAX_RONDES);
  const compleet = cursor === "0";
  if (!compleet) console.warn(`[store] scan afgebroken na ${SCAN_MAX_RONDES} rondes voor ${patroon}: lijst onvolledig`);
  return { sleutels: [...new Set(gevonden)], compleet };
}

// Bouwt alle indexen uit één scan en zet de marker. Alleen toevoegen (NX).
async function bouwIndex() {
  const { sleutels, compleet } = await volledigeScan("*");
  const perSoort = new Map();
  for (const k of sleutels) {
    const v = soortVoorvoegsel(k);
    if (!v || v.startsWith("ix:")) continue;
    if (!perSoort.has(v)) perSoort.set(v, []);
    perSoort.get(v).push(k);
  }
  const nu = String(Date.now());
  for (const [v, lijst] of perSoort) {
    for (let i = 0; i < lijst.length; i += 500) {
      const args = ["ZADD", indexNaam(v), "NX"];
      for (const k of lijst.slice(i, i + 500)) args.push(nu, k);
      await cmd(args);
    }
  }
  if (compleet) await cmd(["SET", INDEX_MARKER, nu, "EX", String(INDEX_MARKER_TTL_S)]);
}

// opties.sindsUren: alleen sleutels die in de laatste N uur zijn geschreven.
export async function scanKeys(patroon, opties = {}) {
  if (!kvBeschikbaar()) return [];
  const v = patroonVoorvoegsel(patroon);
  if (v) {
    try {
      if ((await cmd(["GET", INDEX_MARKER])) == null) {
        // opties.nietBouwen: een lezing die niets mag schrijven (diagnose)
        // bouwt de index niet maar leest dan met de volledige scan.
        if (opties.nietBouwen) throw new Error("index niet gebouwd");
        await bouwIndex();
      }
      const min = opties.sindsUren > 0 ? String(Date.now() - opties.sindsUren * 3600e3) : "-inf";
      const res = await cmd(["ZRANGEBYSCORE", indexNaam(v), min, "+inf"]);
      if (Array.isArray(res)) return res;
    } catch {
      // geen index beschikbaar: terugval hieronder
    }
  }
  return (await volledigeScan(patroon)).sleutels;
}

// Hoeveel sleutels er per MGET meegaan. Upstash accepteert er meer, maar een
// begrensde batch houdt de request-body en het geheugen voorspelbaar.
export const MGET_BATCH = 100;

async function leesDocumenten(keys) {
  const uit = [];
  const verlopen = [];
  for (let i = 0; i < keys.length; i += MGET_BATCH) {
    const groep = keys.slice(i, i + MGET_BATCH);
    const waarden = await cmd(["MGET", ...groep]);
    if (!Array.isArray(waarden)) continue;
    waarden.forEach((waarde, n) => {
      if (waarde == null) {
        verlopen.push(groep[n]); // tussen indexeren en lezen verlopen of gewist
        return;
      }
      let doc;
      try {
        doc = JSON.parse(waarde);
      } catch {
        return; // onparseerbaar document: stil overslaan
      }
      if (doc) uit.push(doc);
    });
  }
  return { uit, verlopen };
}

// Alle JSON-documenten voor een patroon. Verlopen sleutels worden stil
// uitgefilterd en uit de index gehaald. Zonder KV-configuratie: lege lijst.
export async function listJSON(patroon, opties = {}) {
  if (!kvBeschikbaar()) return [];
  try {
    const { uit, verlopen } = await leesDocumenten(await scanKeys(patroon, opties));
    if (verlopen.length) await indexVerwijderen(verlopen);
    return uit;
  } catch {
    return [];
  }
}

// Zoals listJSON, maar een storing is een fout (nooit een stille lege lijst).
// Voor wie op grond van de lijst gaat schrijven of weghalen.
export async function listJSONStrikt(patroon, opties = {}) {
  if (!kvBeschikbaar()) return [];
  const sleutels = await scanKeys(patroon, opties);
  const { uit, verlopen } = await leesDocumenten(sleutels);
  if (verlopen.length) await indexVerwijderen(verlopen);
  if (sleutels.length && !uit.length && verlopen.length < sleutels.length) {
    throw new Error(`KV gaf ${sleutels.length} sleutels voor ${patroon} maar geen leesbare inhoud.`);
  }
  return uit;
}
