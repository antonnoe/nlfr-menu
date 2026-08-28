// listJSON() haalt zijn documenten in BATCHES op (MGET), niet één voor één.
// ---------------------------------------------------------------------------
// WAAROM DEZE TEST BESTAAT. De trage cache-miss op /api/actueel (12 s) had twee
// oorzaken; deze module was de tweede: een SCAN gevolgd door een losse GET per
// sleutel, sequentieel — bij ~145 documenten dus ~146 round-trips naar Upstash.
// De test legt vast dat het er nu een handvol zijn, én dat het GEDRAG gelijk
// bleef: verlopen sleutels (null) en onparseerbare documenten worden stil
// overgeslagen, en zonder KV-configuratie komt er een lege lijst terug.
//
// De module leest de env-vars bij het laden, dus die worden hier vóór de import
// gezet. Voor het "zonder KV"-geval wordt de module een tweede keer geladen via
// een querystring in de specifier: ESM cachet op de volledige URL, dus dat
// levert een verse module-instantie met andere env.

import test from "node:test";
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://kv.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

const { listJSON, MGET_BATCH } = await import("../lib/store.js");

// Neemt de plaats in van de Upstash REST-API. Legt elk commando vast en
// antwoordt met wat `antwoorden` per commandonaam teruggeeft.
function zetFetchOp({ keys, waardeVoor }) {
  const commandos = [];
  globalThis.fetch = async (_url, opties) => {
    const args = JSON.parse(opties.body);
    commandos.push(args);
    const commando = String(args[0]).toUpperCase();
    if (commando === "SCAN") {
      return jsonAntwoord({ result: ["0", keys] });
    }
    if (commando === "MGET") {
      return jsonAntwoord({ result: args.slice(1).map((k) => waardeVoor(k)) });
    }
    throw new Error(`onverwacht commando in deze test: ${commando}`);
  };
  return commandos;
}

function jsonAntwoord(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

const origineleFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = origineleFetch;
});

test("listJSON haalt in batches van MGET_BATCH op, niet één GET per sleutel", async () => {
  const aantal = 250; // > 2 volle batches, zodat ook de restbatch getoetst wordt
  const keys = Array.from({ length: aantal }, (_, i) => `actueel:overheid:${i}`);
  const commandos = zetFetchOp({
    keys,
    waardeVoor: (k) => JSON.stringify({ id: k }),
  });

  const docs = await listJSON("actueel:overheid:*");

  assert.equal(docs.length, aantal, "alle documenten komen terug");
  assert.deepEqual(
    docs.map((d) => d.id),
    keys,
    "in de volgorde van de scan"
  );

  const mgets = commandos.filter((c) => c[0] === "MGET");
  assert.equal(mgets.length, Math.ceil(aantal / MGET_BATCH), "3 MGET's voor 250 sleutels");
  assert.deepEqual(
    mgets.map((c) => c.length - 1),
    [100, 100, 50],
    "batches van hoogstens MGET_BATCH sleutels"
  );
  assert.equal(
    commandos.filter((c) => c[0] === "GET").length,
    0,
    "geen enkele losse GET meer"
  );
  // Eén SCAN + drie MGET's: vier round-trips in plaats van 251.
  assert.equal(commandos.length, 4);
});

test("null-waarden (tussen scan en lezen verlopen) worden stil overgeslagen", async () => {
  const keys = ["actueel:overheid:a", "actueel:overheid:b", "actueel:overheid:c"];
  zetFetchOp({
    keys,
    waardeVoor: (k) => (k.endsWith(":b") ? null : JSON.stringify({ id: k })),
  });

  const docs = await listJSON("actueel:overheid:*");

  assert.deepEqual(
    docs.map((d) => d.id),
    ["actueel:overheid:a", "actueel:overheid:c"],
    "de verlopen sleutel valt weg, de rest blijft"
  );
});

test("onparseerbare en lege documenten vallen weg, de rest niet", async () => {
  const keys = ["a", "b", "c", "d"].map((x) => `actueel:overheid:${x}`);
  zetFetchOp({
    keys,
    waardeVoor: (k) => {
      if (k.endsWith(":b")) return "{dit is geen json";
      if (k.endsWith(":c")) return "null"; // geldige JSON, maar geen document
      return JSON.stringify({ id: k });
    },
  });

  const docs = await listJSON("actueel:overheid:*");

  assert.deepEqual(
    docs.map((d) => d.id),
    ["actueel:overheid:a", "actueel:overheid:d"],
    "kapotte JSON breekt de lijst niet af"
  );
});

test("een lege scan doet geen enkele MGET", async () => {
  const commandos = zetFetchOp({ keys: [], waardeVoor: () => null });
  const docs = await listJSON("actueel:overheid:*");
  assert.deepEqual(docs, []);
  assert.equal(commandos.filter((c) => c[0] === "MGET").length, 0);
});

test("zonder KV-configuratie komt er een lege lijst terug, zonder netwerk", async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  // Verse module-instantie: ESM cachet per volledige specifier-URL.
  const zonderKv = await import("../lib/store.js?zonder-kv");
  globalThis.fetch = async () => {
    throw new Error("er mag zonder KV-configuratie niets over het net gaan");
  };
  assert.deepEqual(await zonderKv.listJSON("actueel:overheid:*"), []);
  assert.equal(zonderKv.kvBeschikbaar(), false);

  process.env.KV_REST_API_URL = "https://kv.test.invalid";
  process.env.KV_REST_API_TOKEN = "test-token";
});
