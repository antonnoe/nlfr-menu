// /api/meting zonder KV: de meting valt uit, de site niet.
// ---------------------------------------------------------------------------
// Dit staat in een eigen bestand omdat lib/store.js de KV-variabelen leest bij
// het laden van de module; ze later weghalen komt niet meer aan, en node draait
// elk toetsbestand in een eigen proces.
//
// WAT HIER BEWAAKT WORDT. Een ontbrekende KV mag niet leiden tot een fout bij de
// bezoeker (die staat op elke pagina van de site), maar aan de leeskant moet het
// juist wél te zien zijn — anders leest de Cockpit nullen en concludeert dat er
// niet geklikt wordt, terwijl er in werkelijkheid niets geteld wórdt. Dat
// verschil is het hele verschil tussen een stille storing en een gemeten nul.

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

import test from "node:test";
import assert from "node:assert/strict";

function nepRes() {
  return {
    _status: 0, _json: null, _headers: {}, _ended: false,
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; return this; },
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    end() { this._ended = true; return this; },
  };
}

const handler = (await import("../api/meting.js")).default;

test("tellen zonder KV kost geen netwerkverkeer en geen foutmelding", async () => {
  let geroepen = 0;
  const origineel = globalThis.fetch;
  globalThis.fetch = async () => { geroepen += 1; return { ok: true, json: async () => [] }; };
  const res = nepRes();
  await handler(
    { method: "POST", headers: { origin: "https://www.nederlanders.fr" }, query: {},
      body: { gebeurtenissen: [{ soort: "weergave" }] } },
    res
  );
  globalThis.fetch = origineel;

  assert.equal(geroepen, 0, "zonder KV valt er niets te schrijven, dus ook niets te proberen");
  assert.equal(res._status, 204);
});

test("de levering meldt met zoveel woorden dat er niets geteld wordt", async () => {
  process.env.METING_TOKEN = "geheim-voorbeeld-token";
  const res = nepRes();
  await handler(
    { method: "GET", headers: { "x-meting-token": "geheim-voorbeeld-token" }, query: {} },
    res
  );

  assert.equal(res._status, 200);
  assert.equal(res._json.kv, false, "de Cockpit moet dit als storing kunnen zien");
  assert.match(res._json.waarschuwing, /niet geconfigureerd/i);
  assert.deepEqual(res._json.dagen, [], "en krijgt geen verzonnen nullen voorgeschoteld");
});
