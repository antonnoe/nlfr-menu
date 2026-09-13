// /api/meting: wie mag tellen, wie mag lezen, en wat er nooit mag gebeuren.
// ---------------------------------------------------------------------------
// DE BELANGRIJKSTE REGEL STAAT IN DE EERSTE TOETS. Aan de POST-kant zit een
// bezoeker die een link aanklikt, op elke pagina van nederlanders.fr. Gaat het
// tellen mis, dan valt er voor hem niets te herstellen; een foutmelding of een
// traag antwoord is dan pure schade. De teller antwoordt dus altijd 204, ook als
// KV plat ligt.
//
// AAN DE LEESKANT PRECIES ANDERSOM: daar hangt alles aan het token, en een
// ontbrekend token in de runtime zet de deur dicht in plaats van open. Dat
// laatste is de fout die je niet ziet: zonder deze toets is één vergeten
// env-var genoeg om de cijfers van de site publiek te maken.
//
// De KV-omgevingsvariabelen staan hier BOVEN de imports. lib/store.js leest ze
// bij het laden van de module, dus later zetten komt niet meer aan.

process.env.KV_REST_API_URL = "https://kv.voorbeeld.test";
process.env.KV_REST_API_TOKEN = "test-token";

import test from "node:test";
import assert from "node:assert/strict";

import { VELD_MAX } from "../lib/meting.js";
import { METING_TTL_S, METING_PROEF_TTL_S } from "../lib/config.js";

function nepRes() {
  return {
    _status: 0, _json: null, _headers: {}, _ended: false,
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; return this; },
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    end() { this._ended = true; return this; },
  };
}

// Een req die zich, net als op Vercel, ook als stroom laat lezen: dat is de weg
// die sendBeacon werkelijk neemt (text/plain, dus niet voorgeparseerd).
function nepReq(method, o) {
  const opties = o || {};
  const req = { method, headers: opties.headers || {}, query: opties.query || {} };
  if (opties.body !== undefined) req.body = opties.body;
  if (opties.stroom !== undefined) {
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(opties.stroom); };
  }
  return req;
}

const NLFR = { origin: "https://www.nederlanders.fr" };

// Alle KV-verkeer loopt via fetch. Hier wordt het opgevangen: wat er langskomt
// is precies wat er naar Upstash zou gaan.
function vangKV(antwoordPerRonde) {
  const rondes = [];
  globalThis.fetch = async (url, opties) => {
    const opdrachten = JSON.parse(opties.body);
    rondes.push({ url: String(url), opdrachten });
    const maker = antwoordPerRonde[rondes.length - 1];
    if (maker === "stuk") throw new Error("KV onbereikbaar");
    const resultaten = typeof maker === "function" ? maker(opdrachten) : opdrachten.map(() => ({ result: 1 }));
    return { ok: true, json: async () => resultaten };
  };
  return rondes;
}

async function laadRoute() {
  const mod = await import("../api/meting.js?t=" + Math.random());
  return mod.default;
}

const origineleFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = origineleFetch; });

// ---- Tellen -----------------------------------------------------------------

test("een telling gaat als HINCRBY naar de dagsleutel, met een verloopdatum", async () => {
  process.env.VERCEL_ENV = "production";
  const rondes = vangKV([]);
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", {
    headers: NLFR,
    body: { gebeurtenissen: [{ soort: "weergave" }, { soort: "lade", id: "actueel" }] },
  }), res);

  assert.equal(res._status, 204);
  assert.equal(rondes.length, 1, "alles in één round-trip, niet één per teller");
  const opdrachten = rondes[0].opdrachten;
  assert.match(rondes[0].url, /\/pipeline$/);
  const tellingen = opdrachten.filter((o) => o[0] === "HINCRBY");
  assert.equal(tellingen.length, 2, "één telling per gebeurtenis");
  assert.match(tellingen[0][1], /^actueel:meting:\d{4}-\d{2}-\d{2}$/, "productie schrijft in de echte sleutel");
  assert.deepEqual(tellingen.map((o) => o[2]), ["weergave", "lade:actueel"]);
  const expire = opdrachten.find((o) => o[0] === "EXPIRE");
  assert.ok(expire, "zonder EXPIRE groeit de reeks eindeloos door");
  assert.equal(expire[2], String(METING_TTL_S));
});

test("een preview schrijft in een aparte sleutel met een korte levensduur", async () => {
  // Preview-deploys draaien met dezelfde KV-gegevens als productie. Zonder deze
  // scheiding vervuilt elke preview de echte cijfers, en dat zie je aan het
  // getal niet af.
  process.env.VERCEL_ENV = "preview";
  const rondes = vangKV([]);
  const handler = await laadRoute();
  await handler(nepReq("POST", { headers: NLFR, body: { gebeurtenissen: [{ soort: "weergave" }] } }), nepRes());

  assert.match(rondes[0].opdrachten[0][1], /^actueel:meting-proef:/);
  const expire = rondes[0].opdrachten.find((o) => o[0] === "EXPIRE");
  assert.equal(expire[2], String(METING_PROEF_TTL_S));
});

test("de body van een sendBeacon (tekst, ongeparseerd) wordt gewoon gelezen", async () => {
  // sendBeacon stuurt text/plain, want application/json zou een preflight
  // vragen die sendBeacon niet kan sturen. Vercel parseert zo'n body niet.
  process.env.VERCEL_ENV = "production";
  const rondes = vangKV([]);
  const handler = await laadRoute();
  await handler(nepReq("POST", {
    headers: NLFR,
    stroom: JSON.stringify({ gebeurtenissen: [{ soort: "klik", id: "strip/nlfr/page/x" }] }),
  }), nepRes());

  assert.equal(rondes.length, 1);
  assert.equal(rondes[0].opdrachten[0][2], "klik:strip/nlfr/page/x");
});

test("zonder herkomst van de eigen site wordt er niets geteld", async () => {
  const rondes = vangKV([]);
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", {
    headers: { origin: "https://kwaadaardig.nl" },
    body: { gebeurtenissen: [{ soort: "weergave" }] },
  }), res);

  assert.equal(rondes.length, 0, "er hoort geen enkele KV-opdracht te vertrekken");
  assert.equal(res._status, 204, "en de aanroeper krijgt er niets over te horen");
});

test("een kapotte KV levert de bezoeker nog steeds 204 op", async () => {
  const rondes = vangKV(["stuk"]);
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", { headers: NLFR, body: { gebeurtenissen: [{ soort: "weergave" }] } }), res);

  assert.equal(rondes.length, 1, "er is wel geprobeerd te tellen");
  assert.equal(res._status, 204, "maar de bezoeker merkt er niets van");
  assert.equal(res._json, null, "en krijgt geen foutmelding in zijn console");
});

test("een lege of onzinnige body kost geen enkele KV-opdracht", async () => {
  const rondes = vangKV([]);
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", { headers: NLFR, body: { gebeurtenissen: [] } }), res);
  await handler(nepReq("POST", { headers: NLFR, body: { onzin: true } }), res);

  assert.equal(rondes.length, 0);
  assert.equal(res._status, 204);
});

test("boven de veldgrens gaan de nieuw aangemaakte ingangen er weer uit", async () => {
  // De teller staat open voor iedereen. Zonder deze grens schrijft iemand de
  // dagsleutel vol met verzonnen ingangen, en die blijven staan.
  process.env.VERCEL_ENV = "production";
  const rondes = vangKV([
    (opdrachten) => opdrachten.map((o) =>
      (o[0] === "HLEN" ? { result: VELD_MAX + 1 } : o[0] === "HEXISTS" ? { result: 0 } : { result: 1 })),
    () => [{ result: 1 }],
  ]);
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("POST", {
    headers: NLFR,
    body: { gebeurtenissen: [{ soort: "klik", id: "verzonnen/ingang" }] },
  }), res);

  assert.equal(rondes.length, 2, "er hoort een opruimronde te volgen");
  assert.equal(rondes[1].opdrachten[0][0], "HDEL");
  assert.deepEqual(rondes[1].opdrachten[0].slice(2), ["klik:verzonnen/ingang"]);
  assert.equal(res._status, 204);
});

test("een bestaande ingang blijft staan als de grens wordt geraakt", async () => {
  // HEXISTS geeft 1 voor een veld dat er al stond. Dat hoort niet opgeruimd te
  // worden, anders wist de grens de cijfers van gisteren.
  process.env.VERCEL_ENV = "production";
  const rondes = vangKV([
    (opdrachten) => opdrachten.map((o) => (o[0] === "HLEN" ? { result: VELD_MAX + 1 } : { result: 1 })),
  ]);
  const handler = await laadRoute();
  await handler(nepReq("POST", {
    headers: NLFR,
    body: { gebeurtenissen: [{ soort: "klik", id: "bestaande/ingang" }] },
  }), nepRes());

  assert.equal(rondes.length, 1, "er valt niets op te ruimen, dus geen tweede ronde");
});

test("een nieuwe ingang die twee keer in één verzoek staat, telt ook als nieuw", async () => {
  // REGRESSIE. Nieuwheid werd afgeleid uit de uitkomst van HINCRBY: 1 betekende
  // nieuw. Maar twee dezelfde gebeurtenissen in één verzoek tellen in één keer
  // met 2 op, en dan geeft HINCRBY 2 — niet te onderscheiden van een veld dat er
  // al stond. Wie elke verzonnen ingang twee keer stuurt, liep zo langs de grens
  // heen en kon de dagsleutel ongelimiteerd laten groeien. HEXISTS gaat nu vóór
  // de telling de deur uit en zegt het onafhankelijk.
  process.env.VERCEL_ENV = "production";
  const rondes = vangKV([
    (opdrachten) => opdrachten.map((o) =>
      (o[0] === "HLEN" ? { result: VELD_MAX + 1 } : o[0] === "HEXISTS" ? { result: 0 } : { result: 2 })),
    () => [{ result: 1 }],
  ]);
  const handler = await laadRoute();
  await handler(nepReq("POST", {
    headers: NLFR,
    body: { gebeurtenissen: [{ soort: "klik", id: "verzonnen/ingang" }, { soort: "klik", id: "verzonnen/ingang" }] },
  }), nepRes());

  assert.equal(rondes[0].opdrachten[0][0], "HEXISTS", "de bestaanscheck gaat vóór de telling");
  assert.equal(rondes.length, 2, "de verzonnen ingang hoort alsnog opgeruimd te worden");
  assert.deepEqual(rondes[1].opdrachten[0].slice(2), ["klik:verzonnen/ingang"]);
});

// ---- Leveren ----------------------------------------------------------------

test("zonder METING_TOKEN in de runtime gaat de levering dicht, niet open", async () => {
  delete process.env.METING_TOKEN;
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("GET"), res);

  assert.equal(res._status, 503);
  assert.match(res._json.fout, /METING_TOKEN/);
});

test("een verkeerd token levert 401 en geen cijfers", async () => {
  process.env.METING_TOKEN = "geheim-voorbeeld-token";
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("GET", { headers: { "x-meting-token": "iets-anders-maar-lang" } }), res);

  assert.equal(res._status, 401);
  assert.equal(res._json.dagen, undefined);

  // En met een token van dezelfde LENGTE, want anders raakt deze toets alleen
  // de lengtecontrole en blijft een kapotte vergelijking eronder onzichtbaar.
  const zelfdeLengte = nepRes();
  await handler(nepReq("GET", { headers: { "x-meting-token": "geheim-voorbeeld-toker" } }), zelfdeLengte);
  assert.equal(zelfdeLengte._status, 401, "een fout token van gelijke lengte hoort er ook uit te vliegen");
});

test("met het juiste token komen de dagtotalen eruit, nieuwste eerst", async () => {
  process.env.METING_TOKEN = "geheim-voorbeeld-token";
  process.env.VERCEL_ENV = "production";
  const rondes = vangKV([
    (opdrachten) => opdrachten.map((_, i) =>
      (i === 0 ? { result: ["weergave", "500", "klik:paneel/nlfr/page/x", "50"] } : { result: [] })),
  ]);
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("GET", { headers: { "x-meting-token": "geheim-voorbeeld-token" }, query: { dagen: "3" } }), res);

  assert.equal(res._status, 200);
  assert.equal(res._headers["cache-control"], "no-store", "cijfers horen niet gecachet te worden");
  assert.equal(res._json.dagen.length, 3);
  assert.equal(res._json.dagen[0].weergaven, 500);
  assert.equal(res._json.dagen[0].doorklik, 10, "50 kliks op 500 weergaven is 10 procent");
  assert.equal(res._json.dagen[1].weergaven, 0, "een dag zonder data is 0, geen gat");
  assert.equal(res._json.dagen[1].doorklik, null, "en zonder weergaven is het percentage niet te zeggen");
  assert.equal(res._json.laatsteDagMetData, res._json.dagen[0].dag, "het versheidssignaal voor de Cockpit");
  assert.equal(res._json.omgeving, "productie");
  assert.equal(rondes[0].opdrachten.length, 3, "één HGETALL per dag, in één round-trip");
});

test("het aantal dagen is begrensd, ook als er meer gevraagd wordt", async () => {
  process.env.METING_TOKEN = "geheim-voorbeeld-token";
  const rondes = vangKV([(opdrachten) => opdrachten.map(() => ({ result: [] }))]);
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("GET", { headers: { "x-meting-token": "geheim-voorbeeld-token" }, query: { dagen: "5000" } }), res);

  assert.equal(res._json.dagen.length, 90, "meer dan 90 dagen in één keer hoeft niet");
  assert.equal(rondes[0].opdrachten.length, 90);
});

test("een onbereikbare KV bij het lezen is een fout, geen lege reeks", async () => {
  // Aan de leeskant zit de Cockpit. Die moet het verschil zien tussen "geen
  // kliks" en "ik kon er niet bij", anders slaat er geen alarm af als het
  // instrument stuk is.
  process.env.METING_TOKEN = "geheim-voorbeeld-token";
  vangKV(["stuk"]);
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("GET", { headers: { "x-meting-token": "geheim-voorbeeld-token" } }), res);

  assert.equal(res._status, 502);
  assert.equal(res._json.ok, false);
});

test("andere methodes worden netjes afgewezen", async () => {
  const handler = await laadRoute();
  const res = nepRes();
  await handler(nepReq("DELETE"), res);
  assert.equal(res._status, 405);
  assert.equal(res._headers.allow, "GET, POST, OPTIONS");
});
