// Herstelronde "onzichtbare fouten" (20-11-2026): tekstverlies op /redactie,
// rubriek nooit verplicht, overheid achter een poort, Weg blijft weg, index per
// soort in de opslag en het leersignaal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

import { redactieBesluit, standaardRubriek, voorbeeldenVoorModel, SYSTEM_SELECTIE } from "../lib/selectie/kern.js";
import { SCORE_DREMPEL } from "../lib/config.js";
import { LOS_SCORE_DREMPEL } from "../lib/redactieregels.js";
import { poortUitslag, verwerkPoort, overheidIsLive } from "../lib/overheidpoort.js";

const html = fs.readFileSync(new URL("../redactie.html", import.meta.url), "utf8");
const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

// ---- 1. tekstverlies -------------------------------------------------------
test("1. /redactie: getypte tekst staat in st.cn en wordt niet door tekenen of laden teruggezet", () => {
  assert.match(html, /addEventListener\("input"[\s\S]{0,300}conceptVan\(it\)\.tekst = t\.value/);
  assert.match(html, /esc\(c\.tekst\)/, "het tekstvak toont de getypte tekst");
  assert.ok(!/esc\(it\.tekst\) \+ '<\/textarea>/.test(html), "geen servertekst meer in het vak");
  assert.match(html, /function tekenItem\(id\)/, "alleen de kaart die verandert wordt opnieuw getekend");
});

test("1. Plaats zo publiceert de tekst uit het vak, niet de servertekst", () => {
  assert.match(html, /actie: "publiceer", id: id, kop: b\.kop, tekst: b\.tekst/);
  assert.ok(!/actie: "publiceer", id: id, kop: it\.kop, tekst: it\.tekst/.test(html));
  assert.match(html, /tekst: c3\.tekst/, "Plaats zo neemt de inhoud van de vakken");
});

// ---- 2. rubriek nooit verplicht ---------------------------------------------
test("2. rubriek: standaard vooraf ingevuld, geen weigering (pagina en server)", () => {
  assert.ok(!html.includes("Kies eerst een rubriek"));
  assert.match(html, /return "algemeen"; \/\/ nooit/);
  assert.equal(standaardRubriek("pers"), "algemeen");
  assert.equal(standaardRubriek("overheid"), "regelgeving");
  assert.equal(standaardRubriek("meteo"), "meteo");
  const uit = redactieBesluit({ herkomst: "concept", doc: { id: "a1", kop: "k" } });
  assert.equal(uit.fout, undefined);
  assert.equal(uit.besluit.categorie, "algemeen");
  assert.ok(!lees("../api/selectie.js").includes("Kies eerst een categorie"));
});

// ---- 3. overheid achter een poort --------------------------------------------
test("3. drempel: overheid 40, losse kranten 70, beide centraal en doorgegeven aan de pagina", () => {
  assert.equal(SCORE_DREMPEL, 40);
  assert.equal(LOS_SCORE_DREMPEL, 70);
  assert.ok(SYSTEM_SELECTIE.includes(`onder de ${SCORE_DREMPEL} een lege lijst`));
  assert.ok(SYSTEM_SELECTIE.includes(`onder de ${LOS_SCORE_DREMPEL} een lege lijst`));
  assert.match(lees("../api/selectie.js"), /drempel: SCORE_DREMPEL/);
  assert.match(lees("../api/selectie.js"), /losDrempel: LOS_SCORE_DREMPEL/);
  assert.match(html, /if \(sel && typeof sel\.drempel === "number"\) DREMPEL = sel\.drempel/);
  assert.match(html, /if \(sel && typeof sel\.losDrempel === "number"\) LOS_DREMPEL = sel\.losDrempel/);
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
  const nogo = { besluit: "nogo", redactie: { reviewId: "o1", weg: true } };
  assert.equal(poortUitslag(DOC({ poort: { status: "ok" } }), { kandidaten: [KAND(90)], besluiten: [nogo] }).status, "afgewezen");
});

test("3. poort: een go van de redactie op een oud live bericht blijft; op een nieuw wachtend bericht niet", () => {
  const go = { besluit: "go", redactie: { reviewId: "o1" } };
  // Variant B (20-11-2026): een go-besluit zonder poort.keuze telt niet meer.
  assert.equal(poortUitslag(DOC(), { besluiten: [go] }).status, "wacht");
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { besluiten: [go] }).status, "wacht", "zijbalk-go zet het niet op de nieuwspagina");
  assert.equal(poortUitslag(DOC({ poort: { status: "ok", door: "redactie", keuze: true } }), { besluiten: [go] }).status, "ok", "expliciete plaatsing blijft");
});

test("3. overheidIsLive: alleen ok = live; ontbrekend veld of wacht = niet", () => {
  assert.equal(overheidIsLive(DOC()), false);
  assert.equal(overheidIsLive(DOC({ poort: { status: "ok" } })), true);
  assert.equal(overheidIsLive(DOC({ poort: { status: "wacht" } })), false);
});

test("3. verwerkPoort: haalt bestaande live berichten eraf, wist afgewezen en merkt ze af", async () => {
  const docs = [DOC({ id: "a" }), DOC({ id: "b", url: "https://x.nl/b" }), DOC({ id: "c", url: "https://x.nl/c", poort: { status: "wacht" } })];
  const kandidaten = [{ id: "ka", url: "https://www.rijksoverheid.nl/a", ai: { score: 12 } }, { id: "kb", url: "https://x.nl/b", ai: { score: 80 } }];
  const besluiten = [{ besluit: "nogo", redactie: { reviewId: "c", weg: true } }];
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

test("5. besluiten en historie hebben GEEN vervaltermijn (lesmateriaal); geen herlaadbeurt na een klik", () => {
  const api = lees("../api/selectie.js");
  assert.ok(!/SEL_BESLUIT_TTL_S/.test(api));
  assert.ok(!/KEY_SEL_(BESLUIT|HISTORIE)\([^;]*, [A-Z_]+_TTL_S\)/.test(api));
  assert.ok(!/function besluit\([^)]*\) \{[^}]*laad\(\)/.test(html), "geen volledige herlaadbeurt na een klik");
});

// ---- Aanvulling keuring (F1 t/m F7) --------------------------------------------
test("F1. een oud nogo-besluit zonder redactie.weg wijst niets af; een expliciete Weg wel", () => {
  const oud = redactieBesluit({ herkomst: "overheid", doc: DOC(), kanalen: [] }).besluit; // zo schreef de vorige versie 'alleen nieuwspagina'
  assert.equal(oud.besluit, "nogo");
  assert.notEqual(poortUitslag(DOC({ poort: { status: "ok" } }), { besluiten: [oud] }).status, "afgewezen");
  const weg = redactieBesluit({ herkomst: "overheid", doc: DOC(), kanalen: [], weg: true }).besluit;
  assert.equal(poortUitslag(DOC({ poort: { status: "ok" } }), { besluiten: [weg] }).status, "afgewezen");
});

test("F3. de keuze van de redactie gaat voor de score", () => {
  const alleenZij = redactieBesluit({ herkomst: "overheid", doc: DOC(), kanalen: ["zijbalk"], opPagina: false }).besluit;
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { kandidaten: [KAND(90)], besluiten: [alleenZij] }).status, "wacht");
  const metPagina = redactieBesluit({ herkomst: "overheid", doc: DOC(), kanalen: ["zijbalk"], opPagina: true }).besluit;
  // nieuwspagina:true in het besluit alleen is geen keuze (de pagina slaat dat ook op voor al-live regels): keuze:true is nodig.
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { kandidaten: [KAND(10)], besluiten: [metPagina] }).status, "wacht");
  assert.equal(poortUitslag(DOC({ poort: { status: "ok", door: "redactie", keuze: true } }), { kandidaten: [KAND(10)], besluiten: [metPagina] }).status, "ok");
  assert.ok(!html.includes("geen score van"), "geen onjuiste uitleg over de score");
});

test("F7. een go van het oude selectiescherm (zonder redactie) telt NIET meer voor de poort (variant B)", () => {
  const go = { id: "k1", besluit: "go", url: "https://www.rijksoverheid.nl/a", kanalen: ["zijbalk"] };
  assert.equal(poortUitslag(DOC({ poort: { status: "wacht" } }), { besluiten: [go] }).status, "wacht");
  assert.equal(poortUitslag(DOC(), { besluiten: [go] }).status, "wacht");
  assert.equal(poortUitslag(DOC({ poort: { status: "ok", door: "redactie", keuze: true } }), { besluiten: [go] }).status, "ok");
});

test("F5. verwerkPoort leest het bericht opnieuw vlak voor het schrijven: een tussentijdse redactiekeuze blijft", async () => {
  const doc = DOC();
  const vers = { ...doc, poort: { status: "ok", score: null, door: "redactie", keuze: true }, kanalen: { nieuwsbrief: false } };
  const geschreven = [];
  await verwerkPoort([doc], { kandidaten: [KAND(5)] }, { lees: async () => vers, schrijf: async (d) => geschreven.push(d), verwijder: async () => {}, afgewezen: async () => {} });
  assert.deepEqual(geschreven, [], "door de redactie geplaatst: niet overschreven");
  const vers2 = { ...doc, kanalen: { infopoche: false } };
  await verwerkPoort([doc], { kandidaten: [KAND(5)] }, { lees: async () => vers2, schrijf: async (d) => geschreven.push(d), verwijder: async () => {}, afgewezen: async () => {} });
  assert.equal(geschreven.length, 1);
  assert.deepEqual(geschreven[0].kanalen, { infopoche: false }, "de nieuwe kanaalkeuze blijft behouden");
  assert.equal(geschreven[0].poort.status, "wacht");
  assert.match(lees("../api/cron.js"), /lees: \(d\) => getJSON\(KEY_OVERHEID\(d\.id\)\)/);
});

test("F2. een oud bericht dat de poort niet haalt wordt niet gewist uit de voorraad", () => {
  const cron = lees("../api/cron.js");
  const i = cron.indexOf('if (d.poort && d.poort.status === "wacht") {', cron.indexOf("REGISTEROPNAME"));
  const blok = cron.slice(i, i + 500);
  assert.ok(!/del\(KEY_OVERHEID/.test(blok.split("continue;")[0]), "geen del in de wacht-tak");
});

test("F4. mislukte ZADD markeert de index als vuil; opbouw met slot; diagnose schrijft niets", () => {
  const st = lees("../lib/store.js");
  assert.match(st, /cmd\(\["DEL", INDEX_MARKER\]\)/);
  assert.match(st, /"NX", "EX", "120"/);
  assert.match(st, /!opties\.nietBouwen\) await indexVerwijderen/);
});

test("Ongedaan maken: besluit gaat pas na vijf seconden naar de server; reden bij Nee", () => {
  assert.match(html, /ONGEDAAN_MS = 5000/);
  assert.match(html, /b\.timer = setTimeout\(function \(\) \{ opslaan\(it\.id\); \}, ONGEDAAN_MS\)/);
  assert.match(html, /actie: "reden"/);
  const b = redactieBesluit({ herkomst: "concept", doc: { id: "a1", kop: "k" }, kanalen: [], reden: "Dubbel" }).besluit;
  assert.equal(b.reden, "Dubbel");
  assert.equal(redactieBesluit({ herkomst: "concept", doc: { id: "a1", kop: "k" }, reden: "onzin" }).besluit.reden, undefined);
});

// ---- Herstelronde 1 na keuring ----------------------------------------------------
test("A. één verzoek volstaat: weg van een synthese en publiceren met besluit (nep-KV)", async () => {
  const { maakNepKV } = await import("./fixtures/nepkv.mjs");
  process.env.KV_REST_API_URL = "http://nep"; process.env.KV_REST_API_TOKEN = "x";
  const kv = maakNepKV(); const echt = globalThis.fetch; globalThis.fetch = kv.fetchNep;
  try {
    const { slaRedactieBesluitOp } = await import("../lib/selectie/redactie-opslag.js");
    const { getJSON, setJSON } = await import("../lib/store.js");
    const { KEY_CONCEPT, KEY_PUBLICATIE, KEY_AFGEWEZEN } = await import("../lib/config.js");
    await setJSON(KEY_CONCEPT("c1"), { id: "c1", kop: "Kop", tekst: "T", bronnen: [] });
    const w = await slaRedactieBesluitOp({ herkomst: "concept", id: "c1", kanalen: [], weg: true, reden: "Dubbel" });
    assert.equal(w.ok, true);
    assert.equal(await getJSON(KEY_CONCEPT("c1")), null, "concept weg in hetzelfde verzoek");
    assert.ok(await getJSON(KEY_AFGEWEZEN("c1")));
    // C: eerdere poging publiceerde al; het concept bestaat niet meer, de publicatie wel
    await setJSON(KEY_PUBLICATIE("c2"), { id: "c2", kop: "K2", tekst: "T", bronnen: [] });
    const h = await slaRedactieBesluitOp({ herkomst: "concept", id: "c2", kanalen: ["zijbalk"], categorie: "algemeen" });
    assert.equal(h.ok, true, "hervat als publicatie in plaats van falen");
    // C: Nee werkt dan ook
    const nee = await slaRedactieBesluitOp({ herkomst: "concept", id: "c2", kanalen: [], weg: true });
    assert.equal(nee.ok, true);
  } finally { globalThis.fetch = echt; }
  const rv = lees("../api/review.js");
  assert.match(rv, /selectie: \{ kanalen: zij|redactieNaPubliceren\(id, body, deur\)/);
  assert.match(rv, /hervat: true/);
});

test("A. pagehide spoelt met keepalive, een verborgen tabblad behoudt de vijf seconden", () => {
  assert.match(html, /keepalive: wegGaand/);
  assert.match(html, /addEventListener\("pagehide", spoel\)/);
  assert.match(html, /wegGaand = document\.visibilityState === "hidden";/);
  assert.doesNotMatch(html, /visibilityState === "hidden"\) spoel\(\)/);
});

test("B. alles zonder besluit uit 24 uur staat in de lijst, niet alleen kalender-vandaag", () => {
  assert.match(html, /Date\.now\(\) - 24 \* 3600e3/);
  assert.match(html, /if \(!recent\(it\)\) return;/);
});

test("D. oud overheidsbericht (geen poortveld) met een besluit zonder keuze:true is niet live (variant B)", () => {
  const nogo = { besluit: "nogo", redactie: { reviewId: "o1" } };
  assert.equal(poortUitslag(DOC(), { kandidaten: [KAND(5)], besluiten: [nogo] }).status, "wacht");
  assert.equal(poortUitslag(DOC(), { kandidaten: [KAND(5)], besluiten: [{ besluit: "go", redactie: { reviewId: "o1" } }] }).status, "wacht");
});

test("E. na een tik 700 ms geen tikken op de lijst", () => {
  assert.match(html, /blokTot = Date\.now\(\) \+ 700/);
  assert.match(html, /Date\.now\(\) < blokTot && e\.target\.closest[\s\S]{0,60}#lijst/);
});

test("G. geen leeg reden-verzoek; Caribisch Nederland wordt niet gewist; besluiten zonder TTL", () => {
  assert.match(html, /\(b\.redenGestuurd \|\| ""\) === r\) return/);
  const cron = lees("../api/cron.js");
  const i = cron.indexOf("nlOverheidUitgesloten(`");
  assert.ok(!/del\(KEY_OVERHEID/.test(cron.slice(i, i + 700)), "alleen niet live, niet wissen");
  assert.match(cron, /door: "uitgesloten"/);
});

test("A2. Nee op een publicatie of overheid depubliceert in hetzelfde verzoek (nep-KV)", async () => {
  const { maakNepKV } = await import("./fixtures/nepkv.mjs");
  process.env.KV_REST_API_URL = "http://nep"; process.env.KV_REST_API_TOKEN = "x";
  const kv = maakNepKV(); const echt = globalThis.fetch; globalThis.fetch = kv.fetchNep;
  try {
    const { slaRedactieBesluitOp } = await import("../lib/selectie/redactie-opslag.js");
    const { getJSON, setJSON } = await import("../lib/store.js");
    const { KEY_PUBLICATIE, KEY_OVERHEID, KEY_AFGEWEZEN } = await import("../lib/config.js");
    await setJSON(KEY_PUBLICATIE("p1"), { id: "p1", kop: "K", tekst: "T", bronnen: [], gepubliceerdOp: new Date().toISOString() });
    assert.equal((await slaRedactieBesluitOp({ herkomst: "publicatie", id: "p1", kanalen: [], weg: true })).ok, true);
    assert.equal(await getJSON(KEY_PUBLICATIE("p1")), null, "van de nieuwspagina in hetzelfde verzoek");
    await setJSON(KEY_OVERHEID("o9"), { id: "o9", kop: "K", url: "https://x.nl/o9", gepubliceerdOp: new Date().toISOString(), poort: { status: "wacht" } });
    assert.equal((await slaRedactieBesluitOp({ herkomst: "overheid", id: "o9", kanalen: ["zijbalk"], opPagina: true, live: true, act: { nieuwsbrief: false, infopoche: true } })).ok, true);
    const o = await getJSON(KEY_OVERHEID("o9"));
    assert.equal(o.poort.status, "ok"); assert.deepEqual(o.kanalen, { nieuwsbrief: false, infopoche: true });
    assert.equal((await slaRedactieBesluitOp({ herkomst: "overheid", id: "o9", kanalen: [], weg: true })).ok, true);
    assert.equal(await getJSON(KEY_OVERHEID("o9")), null);
    assert.ok((await getJSON(KEY_AFGEWEZEN("o9"))).doc, "bewaard voor Terugzetten");
  } finally { globalThis.fetch = echt; }
});

test("Nieuwspagina uit voor overheid: poort meteen wacht en keuze vervalt, ook na een eigen plaatsing (nep-KV)", async () => {
  const { maakNepKV } = await import("./fixtures/nepkv.mjs");
  process.env.KV_REST_API_URL = "http://nep"; process.env.KV_REST_API_TOKEN = "x";
  const kv = maakNepKV(); const echt = globalThis.fetch; globalThis.fetch = kv.fetchNep;
  try {
    const { slaRedactieBesluitOp } = await import("../lib/selectie/redactie-opslag.js");
    const { getJSON, setJSON } = await import("../lib/store.js");
    const { KEY_OVERHEID } = await import("../lib/config.js");
    const nieuw = (id, poort) => setJSON(KEY_OVERHEID(id), { id, kop: "K", url: `https://x.nl/${id}`, gepubliceerdOp: new Date().toISOString(), poort });
    // eerder zelf geplaatst (keuze:true): alleen zijbalk = meteen wacht, zonder keuze
    await nieuw("u1", { status: "ok", score: 61, door: "redactie", keuze: true });
    assert.equal((await slaRedactieBesluitOp({ herkomst: "overheid", id: "u1", kanalen: ["zijbalk"], opPagina: false })).ok, true);
    const a = await getJSON(KEY_OVERHEID("u1"));
    assert.equal(a.poort.status, "wacht"); assert.equal(a.poort.keuze, undefined); assert.equal(a.poort.score, 61);
    assert.equal(overheidIsLive(a), false);
    // automatisch live (model): Anders zonder nieuwspagina haalt het ook meteen eraf
    await nieuw("u2", { status: "ok", score: 70, door: "model" });
    await slaRedactieBesluitOp({ herkomst: "overheid", id: "u2", kanalen: ["zijbalk"], opPagina: false, act: undefined });
    assert.equal((await getJSON(KEY_OVERHEID("u2"))).poort.status, "wacht");
    // en de volgende cron-toets zet het niet terug (geen keuze, besluit zegt nieuwspagina false)
    assert.equal(poortUitslag(a, { besluiten: [{ besluit: "go", redactie: { reviewId: "u1", nieuwspagina: false } }] }).status, "wacht");
    // opPagina true met live blijft ok met keuze
    await slaRedactieBesluitOp({ herkomst: "overheid", id: "u1", kanalen: ["zijbalk"], opPagina: true, live: true });
    const b = await getJSON(KEY_OVERHEID("u1"));
    assert.equal(b.poort.status, "ok"); assert.equal(b.poort.keuze, true);
    // Weg blijft zoals het was
    assert.equal((await slaRedactieBesluitOp({ herkomst: "overheid", id: "u1", kanalen: [], weg: true })).ok, true);
    assert.equal(await getJSON(KEY_OVERHEID("u1")), null);
  } finally { globalThis.fetch = echt; }
});
