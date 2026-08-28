// /api/review: de Infofrankrijk-kandidaten, verwijzen en nakijken.
// ---------------------------------------------------------------------------
// DE REGEL DIE HIER WORDT BEWAAKT: er komt alleen een verwijzing als de
// redactie er een aanklikt. Deze route is de ENIGE die verwijzingen schrijft;
// de cron doet het niet, en er is geen automatische keuze uit de lijst. Wordt
// dat ooit "handig" gemaakt, dan valt deze test om.
//
// Verder: het THEMA — en daarmee welke IF-categorieën meedoen — wordt hier uit
// het bericht zelf afgeleid, niet uit wat de browser meestuurt.
//
// Alles loopt via een gemockte fetch: geen netwerk, geen echte KV. Zelfde
// aanpak als test/actueel-route.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.KV_REST_API_URL = "https://kv.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";
process.env.REVIEW_TOKEN = "geheim-token";

const { default: handler } = await import("../api/review.js");
const {
  KV_PREFIX,
  KEY_IF_INDEX,
  KEY_VERWIJZING,
  KEY_NAKIJKEN,
  IF_VERWIJZING_MAX,
} = await import("../lib/config.js");

const NU = Date.now();
const iso = (msGeleden) => new Date(NU - msGeleden).toISOString();
const DAG = 24 * 60 * 60 * 1000;

// 18 = Belastingen, dus gekoppeld aan het thema "geld-belasting"; 39 =
// Verbouwen, dat aan geen enkel overheidsthema hangt.
const INDEX = {
  opgehaaldOp: iso(3600 * 1000),
  categorieen: { 18: "Belastingen", 39: "Verbouwen" },
  artikelen: [
    { ifId: 101, titel: "Belastingaangifte", url: "https://infofrankrijk.com/aangifte/", modified: iso(30 * DAG), categorieen: [18] },
    { ifId: 102, titel: "De SCI", url: "https://infofrankrijk.com/de-sci/", modified: iso(200 * DAG), categorieen: [18] },
    { ifId: 103, titel: "Dakkapel", url: "https://infofrankrijk.com/dakkapel/", modified: iso(10 * DAG), categorieen: [39] },
    { ifId: 104, titel: "Te oud", url: "https://infofrankrijk.com/te-oud/", modified: iso(400 * DAG), categorieen: [18] },
    { ifId: 105, titel: "Nog een fiscaal stuk", url: "https://infofrankrijk.com/fiscaal/", modified: iso(20 * DAG), categorieen: [18] },
    { ifId: 106, titel: "En nog een", url: "https://infofrankrijk.com/nog-een/", modified: iso(25 * DAG), categorieen: [18] },
  ],
};

function kvVoorraad() {
  return new Map([
    [
      `${KV_PREFIX}overheid:o1`,
      JSON.stringify({
        id: "o1",
        thema: "geld-belasting",
        bron: "Bercy",
        url: "https://www.economie.gouv.fr/actualites/a1",
        kop: "Bercy verschuift de aangiftetermijn",
        samenvatting: "De termijn verschuift.",
        datum: iso(DAG),
        gepubliceerdOp: iso(DAG),
      }),
    ],
    [KEY_IF_INDEX, JSON.stringify(INDEX)],
  ]);
}

function voerKvUit(kv, args) {
  const commando = String(args[0]).toUpperCase();
  if (commando === "GET") return kv.has(args[1]) ? kv.get(args[1]) : null;
  if (commando === "SET") {
    kv.set(args[1], args[2]);
    return "OK";
  }
  if (commando === "DEL") {
    const bestond = kv.delete(args[1]);
    return bestond ? 1 : 0;
  }
  if (commando === "MGET") return args.slice(1).map((k) => (kv.has(k) ? kv.get(k) : null));
  if (commando === "SCAN") {
    const voorvoegsel = String(args[3]).replace(/\*$/, "");
    return ["0", [...kv.keys()].filter((k) => k.startsWith(voorvoegsel))];
  }
  throw new Error(`onverwacht KV-commando: ${commando}`);
}

function zetWereldOp(kv) {
  const gezet = [];
  globalThis.fetch = async (url, opties = {}) => {
    const args = JSON.parse(opties.body);
    if (String(args[0]).toUpperCase() === "SET") gezet.push(args);
    const result = voerKvUit(kv, args);
    return { ok: true, status: 200, json: async () => ({ result }), text: async () => "" };
  };
  return gezet;
}

function nepRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

const get = (query = "") =>
  ({ method: "GET", headers: { "x-review-token": "geheim-token" }, url: `/api/review?token=geheim-token${query}` });
const post = (body) =>
  ({ method: "POST", headers: { "x-review-token": "geheim-token" }, url: "/api/review?token=geheim-token", body });

async function roep(req) {
  const res = nepRes();
  await handler(req, res);
  return res;
}

const origineleFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = origineleFetch;
});

// ---- De kandidatenlijst ----------------------------------------------------

test("de kandidaten volgen het thema van het bericht zelf, met beide filters", async () => {
  zetWereldOp(kvVoorraad());
  const res = await roep(get("&deel=if&artikel=o1"));
  assert.equal(res.statusCode, 200);
  const ids = res.body.kandidaten.map((k) => k.ifId);
  // geld-belasting -> categorie 18. Oudste wijziging eerst: 200, 30, 25 en 20
  // dagen geleden.
  assert.deepEqual(ids, [102, 101, 106, 105]);
  assert.ok(!ids.includes(103), "een artikel buiten de gekoppelde categorieën hoort er niet bij");
  assert.ok(!ids.includes(104), "en een artikel ouder dan twaalf maanden evenmin");
  assert.equal(res.body.bericht.thema, "geld-belasting");
  assert.deepEqual(res.body.categorieen.find((c) => c.id === 18), { id: 18, naam: "Belastingen" });
  assert.equal(res.body.index.aantal, INDEX.artikelen.length);
});

test("zoeken doorbreekt de categorieën, niet de twaalf maanden", async () => {
  zetWereldOp(kvVoorraad());
  const res = await roep(get("&deel=if&artikel=o1&zoek=dakkapel"));
  assert.deepEqual(res.body.kandidaten.map((k) => k.ifId), [103]);
  const oud = await roep(get("&deel=if&artikel=o1&zoek=oud"));
  assert.deepEqual(oud.body.kandidaten, [], "het te oude artikel blijft onvindbaar");
});

test("zonder index is de lijst leeg, met uitleg — geen fout en geen gok", async () => {
  const kv = kvVoorraad();
  kv.delete(KEY_IF_INDEX);
  zetWereldOp(kv);
  const res = await roep(get("&deel=if&artikel=o1"));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.kandidaten, []);
  assert.match(res.body.fout, /index/i);
});

// ---- Verwijzen -------------------------------------------------------------

test("er komt pas een verwijzing als er één wordt aangeklikt", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  // Alleen de lijst bekijken schrijft niets.
  await roep(get("&deel=if&artikel=o1"));
  assert.ok(!kv.has(KEY_VERWIJZING("o1")), "kijken is nog geen kiezen");

  const res = await roep(post({ actie: "verwijs", id: "o1", ifId: 101 }));
  assert.equal(res.statusCode, 200);
  const record = JSON.parse(kv.get(KEY_VERWIJZING("o1")));
  assert.equal(record.id, "o1");
  assert.equal(record.items.length, 1);
  assert.equal(record.items[0].url, "https://infofrankrijk.com/aangifte/");
  assert.equal(record.items[0].titel, "Belastingaangifte");
  assert.ok(record.items[0].gekozenOp, "met het moment van kiezen erbij");
});

test("de titel en URL komen uit de index, niet uit het verzoek", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  await roep(post({
    actie: "verwijs",
    id: "o1",
    ifId: 101,
    // Dit stuurt de browser mee; het hoort genegeerd te worden.
    url: "https://kwaadaardig.example/pagina",
    titel: "Klik hier",
  }));
  const record = JSON.parse(kv.get(KEY_VERWIJZING("o1")));
  assert.equal(record.items[0].url, "https://infofrankrijk.com/aangifte/");
  assert.equal(record.items[0].titel, "Belastingaangifte");
});

test("een ifId dat niet in de index staat, wordt geweigerd", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  const res = await roep(post({ actie: "verwijs", id: "o1", ifId: 999 }));
  assert.equal(res.statusCode, 404);
  assert.ok(!kv.has(KEY_VERWIJZING("o1")));
});

test("een verwijzing bij een niet-bestaand bericht wordt geweigerd", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  const res = await roep(post({ actie: "verwijs", id: "bestaat-niet", ifId: 101 }));
  assert.equal(res.statusCode, 404);
});

test("een link met een vreemde host haalt het niet, ook niet via de index", async () => {
  const kv = kvVoorraad();
  const stuk = {
    ...INDEX,
    artikelen: [...INDEX.artikelen, { ifId: 900, titel: "Stuk", url: "https://fonts.googleapis.com/css", modified: iso(DAG), categorieen: [18] }],
  };
  kv.set(KEY_IF_INDEX, JSON.stringify(stuk));
  zetWereldOp(kv);
  const res = await roep(post({ actie: "verwijs", id: "o1", ifId: 900 }));
  assert.equal(res.statusCode, 409);
  assert.match(res.body.fout, /Onbruikbare link/);
  assert.ok(!kv.has(KEY_VERWIJZING("o1")));
});

test(`meer dan ${IF_VERWIJZING_MAX} verwijzingen wordt geweigerd met uitleg`, async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  for (const ifId of [101, 102, 105]) {
    const ok = await roep(post({ actie: "verwijs", id: "o1", ifId }));
    assert.equal(ok.statusCode, 200);
  }
  const res = await roep(post({ actie: "verwijs", id: "o1", ifId: 106 }));
  assert.equal(res.statusCode, 409);
  assert.match(res.body.fout, new RegExp(String(IF_VERWIJZING_MAX)));
  assert.equal(JSON.parse(kv.get(KEY_VERWIJZING("o1"))).items.length, IF_VERWIJZING_MAX);
});

test("dezelfde twee keer aanklikken levert geen dubbele verwijzing op", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  await roep(post({ actie: "verwijs", id: "o1", ifId: 101 }));
  const res = await roep(post({ actie: "verwijs", id: "o1", ifId: 101 }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ongewijzigd, true);
  assert.equal(JSON.parse(kv.get(KEY_VERWIJZING("o1"))).items.length, 1);
});

test("weghalen laat geen leeg record achter", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  await roep(post({ actie: "verwijs", id: "o1", ifId: 101 }));
  await roep(post({ actie: "verwijs", id: "o1", ifId: 102 }));
  await roep(post({ actie: "verwijs-weg", id: "o1", ifId: 101 }));
  assert.deepEqual(JSON.parse(kv.get(KEY_VERWIJZING("o1"))).items.map((x) => x.ifId), [102]);
  await roep(post({ actie: "verwijs-weg", id: "o1", ifId: 102 }));
  assert.ok(!kv.has(KEY_VERWIJZING("o1")), "de laatste eruit betekent: record weg");
});

// ---- Nakijken (de auditkant) -----------------------------------------------

test("nakijken zet het artikel op de lijst, met de aanleiding erbij", async () => {
  const kv = kvVoorraad();
  const gezet = zetWereldOp(kv);
  const res = await roep(post({ actie: "nakijken", id: "o1", ifId: 102 }));
  assert.equal(res.statusCode, 200);
  const record = JSON.parse(kv.get(KEY_NAKIJKEN(102)));
  assert.equal(record.titel, "De SCI");
  assert.equal(record.aanleidingen.length, 1);
  assert.equal(record.aanleidingen[0].kop, "Bercy verschuift de aangiftetermijn");
  // BEWUST ZONDER TTL: een takenlijst verloopt niet, hij wordt afgevinkt.
  const schrijf = gezet.find((a) => a[1] === KEY_NAKIJKEN(102));
  assert.equal(schrijf.length, 3, "SET zonder EX-argumenten");
  // En de lezer ziet hier niets van: er is geen verwijzing geschreven.
  assert.ok(!kv.has(KEY_VERWIJZING("o1")));
});

test("twee keer nakijken vanaf hetzelfde bericht geeft één record", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  await roep(post({ actie: "nakijken", id: "o1", ifId: 102 }));
  await roep(post({ actie: "nakijken", id: "o1", ifId: 102 }));
  assert.equal(JSON.parse(kv.get(KEY_NAKIJKEN(102))).aanleidingen.length, 1);
});

test("afvinken haalt het van de lijst", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  await roep(post({ actie: "nakijken", id: "o1", ifId: 102 }));
  await roep(post({ actie: "nakijken-klaar", id: "102", ifId: 102 }));
  assert.ok(!kv.has(KEY_NAKIJKEN(102)));
});

// ---- De hoofd-GET ----------------------------------------------------------

test("de hoofd-GET levert de gekozen verwijzingen en de auditlijst", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  await roep(post({ actie: "verwijs", id: "o1", ifId: 101 }));
  await roep(post({ actie: "nakijken", id: "o1", ifId: 102 }));
  const res = await roep(get());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.verwijzingen.o1.length, 1);
  assert.equal(res.body.nakijken.length, 1);
  assert.equal(res.body.nakijken[0].ifId, 102);
  assert.equal(res.body.ifIndex.aantal, INDEX.artikelen.length);
  // De bestaande velden blijven staan.
  assert.ok(Array.isArray(res.body.overheid));
  assert.ok(Array.isArray(res.body.concepten));
});

test("zonder geldig token gebeurt er niets", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  const res = nepRes();
  await handler({ method: "POST", headers: {}, url: "/api/review", body: { actie: "verwijs", id: "o1", ifId: 101 } }, res);
  assert.equal(res.statusCode, 401);
  assert.ok(!kv.has(KEY_VERWIJZING("o1")));
});

// ---- De hoofdregel, structureel --------------------------------------------

test("alleen de reviewroute schrijft verwijzingen — de cron niet", () => {
  // Dit is de regel in één zin: "klik ik niets aan, dan komt er geen
  // verwijzing". Zolang de cron de verwijzingssleutel niet kent, kán hij er
  // ook geen schrijven. Wordt dat ooit toegevoegd, dan hoort dat een bewuste
  // beslissing te zijn — en valt deze test om.
  const cron = readFileSync(new URL("../api/cron.js", import.meta.url), "utf8");
  assert.ok(!cron.includes("KEY_VERWIJZING"), "api/cron.js schrijft verwijzingen");
  assert.ok(!cron.includes("SCAN_VERWIJZING"), "api/cron.js raakt de verwijzingen aan");
});

test("elke actie die de reviewtool stuurt, kent de route ook", () => {
  // De tool is losstaande HTML; een typefout in een actienaam zou pas op
  // productie opvallen, als een klik niets doet.
  const tool = readFileSync(new URL("../review.html", import.meta.url), "utf8");
  const route = readFileSync(new URL("../api/review.js", import.meta.url), "utf8");
  const acties = [...tool.matchAll(/actie:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(acties.includes("verwijs"), "de tool stuurt geen verwijs-actie meer");
  for (const actie of new Set(acties)) {
    assert.ok(
      route.includes(`actie === "${actie}"`),
      `api/review.js kent de actie "${actie}" niet`
    );
  }
});
