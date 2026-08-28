// /api/actueel zonder KV-configuratie: de route blijft gewoon antwoorden.
// ---------------------------------------------------------------------------
// Graceful degradation was er altijd al (lezen levert leeg op, de feeds blijven
// werken) en mag door het voorgebakken antwoord niet stiekem verdwijnen: zonder
// KV valt er geen snapshot te lezen en geen snapshot weg te schrijven, en dan
// moet de route het antwoord samenstellen zoals vroeger — zonder te struikelen
// over de mislukte schrijfpoging.
//
// Dit staat in een EIGEN bestand omdat lib/store.js zijn env-vars bij het laden
// leest: één testproces, één configuratie. `node --test` geeft elk bestand een
// eigen proces.

import test from "node:test";
import assert from "node:assert/strict";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { default: handler } = await import("../api/actueel.js");

test("zonder KV: geen KV-verkeer, wél een volledig gevormd antwoord", async () => {
  let kvAanroepen = 0;
  let feedAanroepen = 0;
  const origineleFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const adres = String(url);
    if (adres.includes("upstash") || adres.includes("kv.")) kvAanroepen += 1;
    if (adres.includes("verenigingen-kalender")) {
      return { ok: true, status: 200, json: async () => ({ verenigingen: [] }) };
    }
    feedAanroepen += 1;
    return {
      ok: true,
      status: 200,
      text: async () =>
        '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>',
    };
  };

  const res = {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };

  try {
    await handler({ method: "GET", headers: {} }, res);
  } finally {
    globalThis.fetch = origineleFetch;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(kvAanroepen, 0, "geen enkele KV-aanroep zonder configuratie");
  assert.ok(feedAanroepen > 0, "de feeds worden dan wél live opgehaald");
  assert.ok(Array.isArray(res.body.tegels));
  assert.ok(Array.isArray(res.body.agenda));
  assert.ok(Array.isArray(res.body.bronStatus));
  assert.ok(res.body.bijgewerkt, "bijgewerkt is gevuld");
  // De mislukte schrijfpoging is zichtbaar in de diagnoseheader, niet in een 500.
  assert.equal(res.headers["x-actueel-herkomst"], "vers-ontbrekend-nietbewaard");
});
