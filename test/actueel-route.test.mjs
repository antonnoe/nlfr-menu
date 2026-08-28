// /api/actueel: voorgebakken antwoord lezen, of het terugvalpad draaien.
// ---------------------------------------------------------------------------
// WAAROM DEZE TEST BESTAAT. De cache-miss-ingreep hangt op één belofte: het
// antwoord uit de snapshot is HETZELFDE antwoord dat de route vroeger ter
// plekke maakte. Deze test draait de route twee keer op dezelfde gemockte
// wereld — één keer met een lege KV-snapshot (terugvalpad: feeds + KV) en één
// keer met de zojuist gebakken snapshot — en eist dat beide antwoorden tot op
// het veld gelijk zijn, dat het aantal tegels en artikelen niet verschilt, en
// dat de tweede ronde GEEN enkele feed meer aanraakt.
//
// Alles loopt via een gemockte fetch: geen netwerk, geen echte KV.

import test from "node:test";
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://kv.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

const { default: handler } = await import("../api/actueel.js");
const { KEY_ACTUEEL_SNAPSHOT, KV_PREFIX } = await import("../lib/config.js");

// Twee overheidsdocumenten in KV; genoeg om echte tegels te laten ontstaan
// zonder van een externe feed af te hangen.
function kvVoorraad() {
  const nu = Date.now();
  const doc = (n) => ({
    id: `doc${n}`,
    thema: "geld-belasting",
    bron: "Service-Public",
    url: `https://www.service-public.gouv.fr/particuliers/actualites/A1890${n}`,
    datum: new Date(nu - n * 3600 * 1000).toISOString(),
    titelBron: `Actualité ${n}`,
    kop: `Nederlandse kop ${n}`,
    samenvatting: `Nederlandse samenvatting ${n}.`,
    gepubliceerdOp: new Date(nu - n * 3600 * 1000).toISOString(),
  });
  return new Map([
    [`${KV_PREFIX}overheid:doc1`, JSON.stringify(doc(1))],
    [`${KV_PREFIX}overheid:doc2`, JSON.stringify(doc(2))],
  ]);
}

// Gemockte wereld: Upstash-commando's op een Map, alle overige URL's zijn
// feeds (lege maar geldige RSS) of de verenigingen-agenda (JSON).
function zetWereldOp(kv) {
  const telling = { feeds: 0, agenda: 0, kv: 0 };
  globalThis.fetch = async (url, opties = {}) => {
    const adres = String(url);
    if (adres.startsWith("https://kv.test.invalid")) {
      telling.kv += 1;
      return jsonAntwoord({ result: voerKvUit(kv, JSON.parse(opties.body)) });
    }
    if (adres.includes("verenigingen-kalender")) {
      telling.agenda += 1;
      return jsonAntwoord({ verenigingen: [] });
    }
    telling.feeds += 1;
    return tekstAntwoord(
      '<?xml version="1.0"?><rss version="2.0"><channel><title>test</title></channel></rss>'
    );
  };
  return telling;
}

function voerKvUit(kv, args) {
  const commando = String(args[0]).toUpperCase();
  if (commando === "GET") return kv.has(args[1]) ? kv.get(args[1]) : null;
  if (commando === "SET") {
    kv.set(args[1], args[2]);
    return "OK";
  }
  if (commando === "MGET") return args.slice(1).map((k) => (kv.has(k) ? kv.get(k) : null));
  if (commando === "SCAN") {
    const patroon = args[3];
    const voorvoegsel = patroon.replace(/\*$/, "");
    return ["0", [...kv.keys()].filter((k) => k.startsWith(voorvoegsel))];
  }
  throw new Error(`onverwacht KV-commando: ${commando}`);
}

const jsonAntwoord = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const tekstAntwoord = (tekst) => ({
  ok: true,
  status: 200,
  text: async () => tekst,
  json: async () => JSON.parse(tekst),
});

// Minimale namaak van het Vercel-response-object.
function nepRes() {
  const res = {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

const origineleFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = origineleFetch;
});

test("terugvalpad bakt zelf, snapshotpad geeft exact hetzelfde antwoord", async () => {
  const kv = kvVoorraad();
  const telling = zetWereldOp(kv);

  // Ronde 1: geen snapshot in KV -> zelf samenstellen (het oude gedrag).
  const res1 = nepRes();
  await handler({ method: "GET", headers: {} }, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.headers["x-actueel-herkomst"], "vers-ontbrekend");
  assert.ok(telling.feeds > 0, "het terugvalpad haalt de feeds wél live op");
  assert.ok(kv.has(KEY_ACTUEEL_SNAPSHOT), "en schrijft het resultaat weg als snapshot");

  const feedsNaRonde1 = telling.feeds;

  // Ronde 2: de snapshot staat er nu -> die moet gebruikt worden.
  const res2 = nepRes();
  await handler({ method: "GET", headers: {} }, res2);
  assert.equal(res2.headers["x-actueel-herkomst"], "snapshot");
  assert.equal(telling.feeds, feedsNaRonde1, "geen enkele feed meer aangeraakt");

  // De kern van de belofte: hetzelfde antwoord.
  assert.deepEqual(res2.body, res1.body);
  assert.equal(
    res2.body.tegels.length,
    res1.body.tegels.length,
    "evenveel tegels als vóór de ingreep"
  );
  assert.equal(aantalArtikelen(res2.body), aantalArtikelen(res1.body), "evenveel artikelen");
  assert.ok(res1.body.tegels.length > 0 && aantalArtikelen(res1.body) > 0);

  // `bijgewerkt` is het BAKMOMENT: ronde 2 toont dat van ronde 1, niet "nu".
  assert.equal(res2.body.bijgewerkt, res1.body.gebakkenOp);
});

test("een te oude snapshot wordt overgebakken, niet geserveerd", async () => {
  const kv = kvVoorraad();
  const verouderd = {
    bijgewerkt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    gebakkenOp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    tegels: [{ id: "oud", artikelen: [] }],
    agenda: [],
    bronStatus: [],
  };
  kv.set(KEY_ACTUEEL_SNAPSHOT, JSON.stringify(verouderd));
  const telling = zetWereldOp(kv);

  const res = nepRes();
  await handler({ method: "GET", headers: {} }, res);

  assert.equal(res.headers["x-actueel-herkomst"], "vers-verouderd");
  assert.ok(telling.feeds > 0, "3 uur oud: de route stelt zelf verse data samen");
  assert.notDeepEqual(res.body.tegels, verouderd.tegels);
  assert.notEqual(
    JSON.parse(kv.get(KEY_ACTUEEL_SNAPSHOT)).gebakkenOp,
    verouderd.gebakkenOp,
    "en vervangt de verouderde snapshot"
  );
});

test("de cacheheaders staan op het nieuwe venster", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  const res = nepRes();
  await handler({ method: "GET", headers: {} }, res);

  assert.equal(
    res.headers["cache-control"],
    "public, max-age=120, s-maxage=900, stale-while-revalidate=86400"
  );
  assert.equal(
    res.headers["cdn-cache-control"],
    "public, s-maxage=900, stale-while-revalidate=86400"
  );
  assert.equal(res.headers["vercel-cdn-cache-control"], res.headers["cdn-cache-control"]);
});

function aantalArtikelen(antwoord) {
  return (antwoord.tegels || []).reduce((n, t) => n + (t.artikelen || []).length, 0);
}
