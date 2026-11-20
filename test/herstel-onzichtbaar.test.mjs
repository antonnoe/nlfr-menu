// Herstelronde "onzichtbare fouten" (20-11-2026): tekstverlies op /redactie,
// rubriek nooit verplicht, overheid achter een poort, Weg blijft weg, index per
// soort in de opslag en het leersignaal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

import { redactieBesluit, standaardRubriek, voorbeeldenVoorModel, SYSTEM_SELECTIE } from "../lib/selectie/kern.js";
import { SCORE_DREMPEL } from "../lib/config.js";
import { poortUitslag, verwerkPoort, overheidIsLive } from "../lib/overheidpoort.js";

const html = fs.readFileSync(new URL("../redactie.html", import.meta.url), "utf8");
const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

// ---- 1. tekstverlies -------------------------------------------------------
test("1. /redactie: getypte tekst staat in tekstEdit en wordt niet door tekenen of laden teruggezet", () => {
  assert.match(html, /var tekstEdit = \{\}/);
  assert.match(html, /addEventListener\("input"[\s\S]{0,200}tekstEdit\[t\.dataset\.tekst\] = t\.value/);
  assert.match(html, /esc\(huidigeTekst\(it\)\)/, "het tekstvak toont de getypte tekst");
  assert.ok(!/esc\(it\.tekst\) \+ '<\/textarea>/.test(html), "geen servertekst meer in het vak");
  assert.match(html, /function huidigeTekst\(it\) \{ return tekstEdit\[it\.id\] != null \? tekstEdit\[it\.id\] : it\.tekst; \}/);
});

test("1. OK, plaatsen publiceert de tekst uit het vak, niet de servertekst", () => {
  assert.match(html, /actie: "publiceer", id: id, tekst: tekstNu/);
  assert.ok(!/actie: "publiceer", id: id, tekst: it\.tekst/.test(html));
  assert.match(html, /if \(ta\) tekstEdit\[id\] = ta\.value;/, "het vak wordt vlak voor het plaatsen uitgelezen");
});

test("1. focus en cursor blijven bij het opnieuw tekenen", () => {
  assert.match(html, /setSelectionRange\(van, tot\)/);
});

// ---- 2. rubriek nooit verplicht ---------------------------------------------
test("2. rubriek: standaard vooraf ingevuld, geen weigering (pagina en server)", () => {
  assert.ok(!html.includes("Kies eerst een rubriek"));
  assert.match(html, /return "algemeen";/);
  assert.equal(standaardRubriek("pers"), "algemeen");
  assert.equal(standaardRubriek("overheid"), "regelgeving");
  assert.equal(standaardRubriek("meteo"), "meteo");
  const uit = redactieBesluit({ herkomst: "concept", doc: { id: "a1", kop: "k" } });
  assert.equal(uit.fout, undefined);
  assert.equal(uit.besluit.categorie, "algemeen");
  assert.ok(!lees("../api/selectie.js").includes("Kies eerst een categorie"));
});

// ---- 3. overheid achter een poort --------------------------------------------
test("3. drempel: één waarde (config) voor model, kandidaten en pagina", () => {
  assert.equal(SCORE_DREMPEL, 40);
  assert.match(SYSTEM_SELECTIE, new RegExp(`onder de ${SCORE_DREMPEL}\\.`));
  assert.match(lees("../api/selectie.js"), /drempel: SCORE_DREMPEL/);
  assert.match(html, /if \(sel && typeof sel\.drempel === "number"\) DREMPEL = sel\.drempel/);
  assert.ok(!/score < 40/.test(lees("../lib/selectie/kern.js")));
});

const DOC = (extra = {}) => ({ id: "o1", url: "https://www.rijksoverheid.nl/a", kop: "Titel", bron: "Rijksoverheid", gepubliceerdOp: "2026-11-20T08:00:00Z", ...extra });
const KAND = (score) => ({ id: "k1", url: "https://www.rijksoverheid.nl/a", ai: score == null ? null : { score } });

test("3. poort: live alleen bij score >= drempel; zonder score of eronder wacht het", () => {
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { kandidaten: [KAND(40)] }).status, "ok");
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { kandidaten: [KAND(39)] }).status, "wacht");
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { kandidaten: [KAND(null)] }).status, "wacht");
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { kandidaten: [] }).status, "wacht");
  assert.equal(poortUitslag(DOC(), { kandidaten: [KAND(10)] }).status, "wacht", "oud bericht zonder poortveld wordt alsnog getoetst");
});

test("3. poort: ok blijft ok (ook als de kandidaat verlopen is); een nogo wint van alles", () => {
  assert.equal(poortUitslag(DOC({ poort: { status: "ok", score: 70, door: "model" } }), { kandidaten: [] }).status, "ok");
  const nogo = { besluit: "nogo", redactie: { reviewId: "o1" } };
  assert.equal(poortUitslag(DOC({ poort: { status: "ok" } }), { kandidaten: [KAND(90)], besluiten: [nogo] }).status, "afgewezen");
});

test("3. poort: een go van de redactie op een oud live bericht blijft; op een nieuw wachtend bericht niet", () => {
  const go = { besluit: "go", redactie: { reviewId: "o1" } };
  assert.equal(poortUitslag(DOC(), { besluiten: [go] }).status, "ok");
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { besluiten: [go] }).status, "wacht", "zijbalk-go zet het niet op de nieuwspagina");
});

test("3. overheidIsLive: ontbrekend veld of ok = live, wacht = niet", () => {
  assert.equal(overheidIsLive(DOC()), true);
  assert.equal(overheidIsLive(DOC({ poort: { status: "ok" } })), true);
  assert.equal(overheidIsLive(DOC({ poort: { status: "wacht" } })), false);
});

test("3. verwerkPoort: haalt bestaande live berichten eraf, wist afgewezen en merkt ze af", async () => {
  const docs = [DOC({ id: "a" }), DOC({ id: "b", url: "https://x.nl/b" }), DOC({ id: "c", url: "https://x.nl/c", poort: { status: "wacht" } })];
  const kandidaten = [{ id: "ka", url: "https://www.rijksoverheid.nl/a", ai: { score: 12 } }, { id: "kb", url: "https://x.nl/b", ai: { score: 80 } }];
  const besluiten = [{ besluit: "nogo", redactie: { reviewId: "c" } }];
  const geschreven = [], weg = [], afgewezen = [];
  const tel = await verwerkPoort(docs, { kandidaten, besluiten }, {
    schrijf: async (d) => geschreven.push([d.id, d.poort.status]),
    verwijder: async (d) => weg.push(d.id),
    afgewezen: async (d) => afgewezen.push(d.id),
  });
  assert.deepEqual(geschreven, [["a", "wacht"], ["b", "ok"]]);
  assert.deepEqual(weg, ["c"]);
  assert.deepEqual(afgewezen, ["c"], "Weg blijft weg: merkteken gezet");
  assert.equal(tel.eraf, 1);
});

test("3. de cron zet nieuwe overheid niet live, kent de poort en de afgewezen-controle; DG Trésor is weg", () => {
  const cron = lees("../api/cron.js");
  assert.match(cron, /poort: \{ status: "wacht"/);
  assert.match(cron, /verwerkPoort\(/);
  assert.match(cron, /getJSON\(KEY_AFGEWEZEN\(id\)\)[\s\S]{0,120}status: "afgewezen"/);
  assert.ok(!JSON.parse(lees("../bronnen.json")).bronnen.some((b) => /Trésor/.test(b.naam)));
  assert.ok(!lees("../lib/feeds.js").includes("NL_OVERHEID_DOEL"));
  assert.match(lees("../lib/antwoord.js"), /overheidDocs\.filter\(overheidIsLive\)/);
});

// ---- 4. Weg blijft weg --------------------------------------------------------
test("4. verwijder-overheid zet een afgewezen-merkteken", () => {
  const r = lees("../api/review.js");
  assert.match(r, /setJSON\(KEY_AFGEWEZEN\(id\)[^;]*redactie-weg[^;]*\);\s*\n\s*await del\(KEY_OVERHEID\(id\)\)/);
});

// ---- 6. leersignaal ------------------------------------------------------------
test("6. alleen nieuwspagina (of nieuwsbrief/Infopoche) is een go, niet een no-go; Weg blijft no-go", () => {
  const doc = { id: "p1", kop: "k", gepubliceerdOp: "2026-11-20T08:00:00Z" };
  const alleenPagina = redactieBesluit({ herkomst: "publicatie", doc, kanalen: [], elders: true }).besluit;
  assert.equal(alleenPagina.besluit, "go");
  assert.deepEqual(alleenPagina.kanalen, [], "niet in de zijbalkfeed");
  const weg = redactieBesluit({ herkomst: "publicatie", doc, kanalen: [], elders: false }).besluit;
  assert.equal(weg.besluit, "nogo");
  assert.deepEqual(voorbeeldenVoorModel([alleenPagina, weg]).go.map((b) => b.id), [alleenPagina.id]);
  assert.match(html, /elders: elders/);
});

// ---- 5. opslagindex --------------------------------------------------------------
// Namaak-Upstash met gesorteerde verzamelingen, die elke opdracht telt.
async function nepKv() {
  const db = new Map();
  const zsets = new Map();
  const log = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const a = JSON.parse(body);
      const c = String(a[0]).toUpperCase();
      log.push(a);
      let r = null;
      if (c === "GET") r = db.has(a[1]) ? db.get(a[1]) : null;
      else if (c === "SET") { db.set(a[1], a[2]); r = "OK"; }
      else if (c === "DEL") r = db.delete(a[1]) ? 1 : 0;
      else if (c === "MGET") r = a.slice(1).map((k) => (db.has(k) ? db.get(k) : null));
      else if (c === "SCAN") {
        const patroon = a[a.indexOf("MATCH") + 1];
        const re = new RegExp("^" + patroon.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
        r = ["0", [...db.keys()].filter((k) => re.test(k))];
      } else if (c === "ZADD") {
        const z = zsets.get(a[1]) || new Map(); zsets.set(a[1], z);
        const nx = a[2] === "NX"; const rest = a.slice(nx ? 3 : 2);
        for (let i = 0; i < rest.length; i += 2) if (!(nx && z.has(rest[i + 1]))) z.set(rest[i + 1], Number(rest[i]));
        r = 1;
      } else if (c === "ZREM") { const z = zsets.get(a[1]); a.slice(2).forEach((m) => z && z.delete(m)); r = 1; }
      else if (c === "ZRANGEBYSCORE") {
        const z = zsets.get(a[1]) || new Map(); const min = a[2] === "-inf" ? -Infinity : Number(a[2]);
        r = [...z.entries()].filter(([, s]) => s >= min).map(([m]) => m);
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result: r }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.KV_REST_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.KV_REST_API_TOKEN = "test";
  process.env.NO_PROXY = "127.0.0.1,localhost"; process.env.no_proxy = "127.0.0.1,localhost";
  return { db, zsets, log, sluit: () => server.close() };
}

test("5. index per soort: lezen scant niet meer de hele opslag; oude sleutels worden eenmalig opgenomen", async () => {
  const kv = await nepKv();
  try {
    const { listJSON, setJSON, del, scanKeys } = await import("../lib/store.js");
    // Oude gegevens van vóór de index: staan alleen in db.
    for (let i = 0; i < 30; i++) kv.db.set(`actueel:overheid:oud${i}`, JSON.stringify({ id: `oud${i}` }));
    for (let i = 0; i < 20; i++) kv.db.set(`actueel:concept:c${i}`, JSON.stringify({ id: `c${i}` }));
    let lijst = await listJSON("actueel:overheid:*");
    assert.equal(lijst.length, 30, "oude gegevens blijven werken, niets verloren");
    const scans1 = kv.log.filter((x) => x[0] === "SCAN").length;
    assert.equal(scans1, 1, "eenmalig één volledige scan om de index te bouwen");
    // Daarna geen scans meer, ook niet voor een andere soort of bij nieuwe schrijfacties.
    await setJSON("actueel:overheid:nieuw", { id: "nieuw" }, 100);
    lijst = await listJSON("actueel:overheid:*");
    assert.equal(lijst.length, 31);
    assert.equal((await listJSON("actueel:concept:*")).length, 20);
    await del("actueel:overheid:oud0");
    assert.equal((await listJSON("actueel:overheid:*")).length, 30);
    assert.equal(kv.log.filter((x) => x[0] === "SCAN").length, 1, "geen SCAN meer: lezen groeit niet met de opslag");
    // Verlopen sleutel (zonder DEL): lezing slaat hem over en ruimt de index op.
    kv.db.delete("actueel:overheid:oud1");
    assert.equal((await listJSON("actueel:overheid:*")).length, 29);
    assert.ok(!(await scanKeys("actueel:overheid:*")).includes("actueel:overheid:oud1"));
    // sindsUren: alleen recent geschreven sleutels.
    // (Oude sleutels krijgen bij het opnemen de score "nu": ze tellen dus eerst
    // als recent, wat veilig is; hier zetten we ze terug in de tijd.)
    const z = kv.zsets.get("ix:actueel:overheid:");
    for (const [m] of z) if (m !== "actueel:overheid:nieuw") z.set(m, 1);
    const recent = await scanKeys("actueel:overheid:*", { sindsUren: 1 });
    assert.deepEqual(recent, ["actueel:overheid:nieuw"]);
  } finally {
    kv.sluit();
  }
});

test("5. besluiten en historie krijgen een vervaltermijn; Gekozen-lijst herlaadt niet na elke klik", () => {
  const api = lees("../api/selectie.js");
  assert.ok(!/setJSON\(KEY_SEL_BESLUIT\([^)]*\)\)?, [a-z.]+\);/.test(api.replace(/SEL_BESLUIT_TTL_S/g, "")) || api.includes("SEL_BESLUIT_TTL_S"));
  assert.equal((api.match(/SEL_BESLUIT_TTL_S\)/g) || []).length >= 3, true, "besluit, besluit van de redactie en historie hebben een TTL");
  assert.match(html, /function klaar\(\) \{ lopend--; verouderd = true; \}/);
  assert.ok(!/function klaar\(\) \{ lopend--; if \(!lopend\) laad\(\); \}/.test(html));
});
