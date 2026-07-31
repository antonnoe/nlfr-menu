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

export async function setJSON(key, waarde, ttlSeconden) {
  const args = ["SET", key, JSON.stringify(waarde)];
  if (ttlSeconden && ttlSeconden > 0) {
    args.push("EX", String(Math.floor(ttlSeconden)));
  }
  await cmd(args);
}

export async function del(key) {
  await cmd(["DEL", key]);
}

// Alle sleutels die op een patroon matchen, via SCAN (cursor-loop). Voor de
// handvol concepten/publicaties hier is dit ruim voldoende.
export async function scanKeys(patroon) {
  if (!kvBeschikbaar()) return [];
  const gevonden = [];
  let cursor = "0";
  let rondes = 0;
  do {
    const res = await cmd(["SCAN", cursor, "MATCH", patroon, "COUNT", "100"]);
    // Upstash geeft [nieuweCursor, [keys...]]
    cursor = Array.isArray(res) ? String(res[0]) : "0";
    const keys = Array.isArray(res) && Array.isArray(res[1]) ? res[1] : [];
    gevonden.push(...keys);
    rondes += 1;
  } while (cursor !== "0" && rondes < 50);
  return gevonden;
}

// Alle JSON-documenten voor een patroon. Sleutels die tussen scan en lezen
// verlopen zijn, worden er stil uitgefilterd.
export async function listJSON(patroon) {
  if (!kvBeschikbaar()) return [];
  try {
    const keys = await scanKeys(patroon);
    const uit = [];
    for (const key of keys) {
      const doc = await getJSON(key);
      if (doc) uit.push(doc);
    }
    return uit;
  } catch {
    return [];
  }
}
