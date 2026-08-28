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
const { default: tekstHandler } = await import("../api/actueel-tekst.js");
const { default: archiefHandler } = await import("../api/actueel-archief.js");
const {
  KEY_ACTUEEL_SNAPSHOT,
  KEY_ACTUEEL_TEKST_SNAPSHOT,
  KEY_ACTUEEL_ARCHIEF_SNAPSHOT,
  KV_PREFIX,
} = await import("../lib/config.js");

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
  assert.ok(kv.has(KEY_ACTUEEL_SNAPSHOT), "en schrijft de compacte levering weg");
  assert.ok(kv.has(KEY_ACTUEEL_TEKST_SNAPSHOT), "én meteen de tekst-levering");
  assert.ok(kv.has(KEY_ACTUEEL_ARCHIEF_SNAPSHOT), "én de archieflevering");

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

  // Ronde 3: de TWEEDE route heeft nu niets meer te doen — de miss op
  // /api/actueel heeft haar levering al warm gezet.
  const res3 = nepRes();
  await tekstHandler({ method: "GET", headers: {} }, res3);
  assert.equal(res3.headers["x-actueel-herkomst"], "snapshot");
  assert.equal(telling.feeds, feedsNaRonde1, "ook de tweede route raakt geen feed aan");
  assert.equal(res3.body.bijgewerkt, res1.body.bijgewerkt, "zelfde bakmoment als de compacte");
});

test("de compacte levering draagt geen tekst en geen bronnen-array mee", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  const res = nepRes();
  await handler({ method: "GET", headers: {} }, res);

  const arts = res.body.tegels.flatMap((t) => t.artikelen || []);
  assert.ok(arts.length > 0);
  for (const a of arts) {
    assert.equal("tekst" in a, false);
    assert.equal("bronnen" in a, false);
    assert.equal(typeof a.bronAantal, "number", "bronAantal hoort er wél in te staan");
    assert.ok("bronMeta" in a, "bronMeta ook");
  }
});

test("de tweede route levert per artikel de tekst en de volledige bronnen", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);

  const compactRes = nepRes();
  await handler({ method: "GET", headers: {} }, compactRes);
  const tekstRes = nepRes();
  await tekstHandler({ method: "GET", headers: {} }, tekstRes);

  // Elk artikel uit de compacte levering heeft een tekst-record, op de sleutel
  // tegelId/artikelId — precies de koppeling die de sonde gebruikt.
  const sleutels = [];
  for (const t of compactRes.body.tegels) {
    for (const a of t.artikelen || []) sleutels.push(`${t.id}/${a.id}`);
  }
  assert.deepEqual(
    Object.keys(tekstRes.body.artikelen).sort(),
    sleutels.slice().sort(),
    "de twee leveringen dekken elkaar exact"
  );

  for (const t of compactRes.body.tegels) {
    for (const a of t.artikelen || []) {
      const extra = tekstRes.body.artikelen[`${t.id}/${a.id}`];
      assert.equal(typeof extra.tekst, "string");
      assert.ok(Array.isArray(extra.bronnen));
      // De compacte velden moeten kloppen met de volledige lijst.
      assert.equal(a.bronAantal, extra.bronnen.length);
      if (extra.bronnen.length) {
        assert.equal(a.bronMeta.naam, extra.bronnen[0].naam || null);
        assert.equal(a.bronMeta.datum, extra.bronnen[0].datum || null);
      } else {
        assert.equal(a.bronMeta, null);
      }
    }
  }
});

test("de derde route levert de archiefartikelen mét hun tekst en bronnen", async () => {
  // De KV-voorraad hier levert geen archieftegel op (die ontstaat pas als een
  // publicatie oud genoeg is), dus getoetst wordt de VORM en de koppeling met
  // wat de compacte levering over die tegel zegt.
  const kv = kvVoorraad();
  zetWereldOp(kv);

  const compactRes = nepRes();
  await handler({ method: "GET", headers: {} }, compactRes);
  const archiefRes = nepRes();
  await archiefHandler({ method: "GET", headers: {} }, archiefRes);

  assert.ok(Array.isArray(archiefRes.body.artikelen), "een lijst compacte artikelen");
  assert.equal(typeof archiefRes.body.teksten, "object", "en hun tekst-records");
  assert.equal(
    archiefRes.body.bijgewerkt,
    compactRes.body.bijgewerkt,
    "zelfde bakmoment als de compacte levering"
  );

  // Wat de compacte levering over de archieftegel zegt, moet kloppen met wat
  // deze route levert — precies wat de sonde in I12 toetst.
  const apart = compactRes.body.tegels.filter((t) => t.artikelenApart);
  for (const t of apart) {
    assert.equal(t.artikelAantal, archiefRes.body.artikelen.length);
    assert.equal("artikelen" in t, false, "de tegel draagt zijn artikelen niet mee");
    assert.equal(archiefRes.body.tegelId, t.id);
  }
  // En elk geleverd archiefartikel heeft een tekst-record.
  for (const a of archiefRes.body.artikelen) {
    const extra = archiefRes.body.teksten[`${archiefRes.body.tegelId}/${a.id}`];
    assert.ok(extra, `geen tekst-record voor ${a.id}`);
    assert.equal(typeof extra.tekst, "string");
    assert.ok(Array.isArray(extra.bronnen));
    assert.equal(a.bronAantal, extra.bronnen.length);
  }
});

test("elke tegel in de compacte levering draagt een kloppend artikelAantal", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  const res = nepRes();
  await handler({ method: "GET", headers: {} }, res);
  for (const t of res.body.tegels) {
    if (t.artikelenApart) {
      assert.equal("artikelen" in t, false);
      assert.equal(typeof t.artikelAantal, "number");
    } else if (Array.isArray(t.artikelen)) {
      assert.equal(t.artikelAantal, t.artikelen.length, `tegel ${t.id}`);
    }
  }
});

test("een miss op de derde route warmt de andere twee op", async () => {
  const kv = kvVoorraad();
  const telling = zetWereldOp(kv);

  const res = nepRes();
  await archiefHandler({ method: "GET", headers: {} }, res);
  assert.equal(res.headers["x-actueel-herkomst"], "vers-ontbrekend");
  assert.ok(kv.has(KEY_ACTUEEL_SNAPSHOT));
  assert.ok(kv.has(KEY_ACTUEEL_TEKST_SNAPSHOT));
  assert.ok(kv.has(KEY_ACTUEEL_ARCHIEF_SNAPSHOT));

  const feedsNa = telling.feeds;
  for (const h of [handler, tekstHandler]) {
    const r = nepRes();
    await h({ method: "GET", headers: {} }, r);
    assert.equal(r.headers["x-actueel-herkomst"], "snapshot");
  }
  assert.equal(telling.feeds, feedsNa, "de andere routes hoeven niets meer op te halen");
});

test("de drie routes leveren hetzelfde bakmoment", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  const res = [nepRes(), nepRes(), nepRes()];
  await handler({ method: "GET", headers: {} }, res[0]);
  await tekstHandler({ method: "GET", headers: {} }, res[1]);
  await archiefHandler({ method: "GET", headers: {} }, res[2]);
  assert.equal(res[1].body.gebakkenOp, res[0].body.gebakkenOp);
  assert.equal(res[2].body.gebakkenOp, res[0].body.gebakkenOp);
});

test("een miss op de tweede route warmt ook de compacte levering op", async () => {
  const kv = kvVoorraad();
  const telling = zetWereldOp(kv);

  const res = nepRes();
  await tekstHandler({ method: "GET", headers: {} }, res);
  assert.equal(res.headers["x-actueel-herkomst"], "vers-ontbrekend");
  assert.ok(kv.has(KEY_ACTUEEL_SNAPSHOT));
  assert.ok(kv.has(KEY_ACTUEEL_TEKST_SNAPSHOT));

  const feedsNa = telling.feeds;
  const res2 = nepRes();
  await handler({ method: "GET", headers: {} }, res2);
  assert.equal(res2.headers["x-actueel-herkomst"], "snapshot");
  assert.equal(telling.feeds, feedsNa, "de compacte route hoeft niets meer op te halen");
});

test("alle drie de routes hebben dezelfde cacheheaders", async () => {
  const kv = kvVoorraad();
  zetWereldOp(kv);
  const a = nepRes();
  await handler({ method: "GET", headers: {} }, a);
  for (const h of [tekstHandler, archiefHandler]) {
    const b = nepRes();
    await h({ method: "GET", headers: {} }, b);
    assert.equal(b.headers["cache-control"], a.headers["cache-control"]);
    assert.equal(b.headers["cdn-cache-control"], a.headers["cdn-cache-control"]);
    assert.equal(b.headers["vercel-cdn-cache-control"], a.headers["vercel-cdn-cache-control"]);
  }
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
