// /api/banner: wie mag lezen, wie mag schrijven, en wat er gebeurt als KV leeg
// is. De route wordt hier rechtstreeks aangeroepen met een nagebouwde req/res,
// zoals de reviewtool-test dat ook doet — geen server, geen netwerk.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const STARTWAARDE = JSON.parse(fs.readFileSync(new URL("../banner.json", import.meta.url), "utf8"));

function nepRes() {
  const res = {
    _status: 0, _json: null, _headers: {}, _ended: false,
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; return this; },
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    end() { this._ended = true; return this; },
  };
  return res;
}

function nepReq(method, opties) {
  const o = opties || {};
  const req = { method, headers: o.headers || {}, query: o.query || {} };
  if (o.body !== undefined) req.body = o.body;
  return req;
}

// De route importeren met een schone module-cache, zodat env-wijzigingen
// (BANNER_TOKEN, KV-vars) per test echt aankomen.
async function laadRoute() {
  const mod = await import("../api/banner.js?t=" + Math.random());
  return mod.default;
}

test("GET levert de startwaarde uit banner.json als KV leeg is", async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("GET"), res);

  assert.equal(res._status, 200);
  assert.equal(res._json.bron, "banner.json", "zonder KV komt het uit de repo");
  assert.equal(res._json.aan, STARTWAARDE.aan);
  assert.equal(res._json.titel, "Café Jeudi");
  assert.deepEqual(res._json.wekelijks, STARTWAARDE.wekelijks);
  assert.equal(res._headers["cache-control"], "no-store", "de banner mag niet gecachet worden");
  assert.equal(res._headers["access-control-allow-origin"], "*", "het menu haalt hem cross-origin op");
});

test("POST zonder token geeft 401 en schrijft niets", async () => {
  process.env.BANNER_TOKEN = "geheim-voorbeeld-token";
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", { body: { aan: false } }), res);

  assert.equal(res._status, 401);
  assert.equal(res._json.ok, false);
  assert.match(res._json.fout, /token/i);
});

test("POST met een fout token geeft 401, ook bij dezelfde lengte", async () => {
  process.env.BANNER_TOKEN = "geheim-voorbeeld-token";
  const handler = await laadRoute();

  for (const kop of [
    "Bearer fout",
    "Bearer geheim-voorbeeld-tokeN",          // zelfde lengte, één letter anders
    "geheim-voorbeeld-token",                  // zonder "Bearer "
    "Basic geheim-voorbeeld-token",
  ]) {
    const res = nepRes();
    await handler(nepReq("POST", { headers: { authorization: kop }, body: { aan: false } }), res);
    assert.equal(res._status, 401, "had 401 moeten geven voor: " + kop);
  }
});

test("het token hoort niet in de querystring te werken", async () => {
  process.env.BANNER_TOKEN = "geheim-voorbeeld-token";
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", { query: { token: "geheim-voorbeeld-token" }, body: { aan: false } }), res);
  assert.equal(res._status, 401, "een URL komt in serverlogs terecht; alleen de header telt");
});

test("zonder BANNER_TOKEN in de omgeving kan niemand schrijven", async () => {
  delete process.env.BANNER_TOKEN;
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", { headers: { authorization: "Bearer wat-dan-ook" }, body: { aan: false } }), res);
  assert.equal(res._status, 401, "geen env-var betekent dicht, niet open");
});

test("POST met een geldig token maar ongeldige inhoud geeft 400", async () => {
  process.env.BANNER_TOKEN = "geheim-voorbeeld-token";
  const handler = await laadRoute();

  for (const [body, waarom] of [
    [{ aan: "ja" }, "aan is geen boolean"],
    [{ aan: true, soort: "film" }, "onbekende soort"],
    [{ aan: true, kleur: "groen" }, "kleur geen hex"],
    [{ aan: true, overslaan: ["10-09-2026"] }, "datum verkeerd om"],
  ]) {
    const res = nepRes();
    await handler(nepReq("POST", { headers: { authorization: "Bearer geheim-voorbeeld-token" }, body }), res);
    assert.equal(res._status, 400, "had 400 moeten geven: " + waarom);
    assert.equal(res._json.ok, false);
    assert.ok(res._json.fout.length > 5, "met een leesbare reden: " + waarom);
  }
});

test("POST met geldig token en geldige inhoud, maar zonder KV, zegt dat eerlijk", async () => {
  process.env.BANNER_TOKEN = "geheim-voorbeeld-token";
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", {
    headers: { authorization: "Bearer geheim-voorbeeld-token" },
    body: { ...STARTWAARDE, aan: false },
  }), res);

  assert.equal(res._status, 503, "niet stil doen alsof er is opgeslagen");
  assert.equal(res._json.ok, false);
  assert.match(res._json.fout, /KV/);
});

test("OPTIONS is een kale preflight", async () => {
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("OPTIONS"), res);
  assert.equal(res._status, 204);
  assert.match(String(res._headers["access-control-allow-headers"]), /Authorization/i);
});

test("een andere methode geeft 405", async () => {
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("DELETE"), res);
  assert.equal(res._status, 405);
});
