// Wordt een verwijzing ook echt ZICHTBAAR? De keten van klik tot lezer.
// ---------------------------------------------------------------------------
// AANLEIDING, GEMETEN. Verwijzingen die in de reviewtool onder een bericht van
// de Rijksoverheid werden gezet, verschenen niet op /actueel. De keten zelf
// bleek intact: api/review.js schreef het KV-record, /api/review gaf het terug,
// lib/tegels.js hing het aan het juiste artikel, lib/levering.js zette het in de
// tekst-levering en actueel.html rendeerde het. Er ging niets verloren.
//
// Wat de lezer kreeg was iets anders: /api/actueel serveert de VOORGEBAKKEN
// momentopname uit KV. Die was van vóór de klik, en lib/lever.js laat hem pas
// los als hij ouder is dan SNAPSHOT_MAX_LEEFTIJD_S (een uur) of als de cron een
// nieuwe bakt. Loopt de cron niet — en op een preview-deploy loopt hij niet —
// dan blijft dezelfde momentopname tot SNAPSHOT_TTL_S (zes uur) staan. Een
// verwijzing die pas uren later verschijnt, is in de praktijk geen verwijzing.
//
// Deze test draait de ECHTE route tegen een namaak-KV (dezelfde REST-vorm als
// Upstash, in het geheugen). Geen kopie van de logica: als api/review.js het
// vervallen weer laat vallen, wordt deze test rood.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";

// ---- Namaak-KV: GET/SET/DEL/SCAN/MGET, precies wat lib/store.js stuurt -----
const db = new Map();
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const a = JSON.parse(body || "[]");
    const cmd = String(a[0]).toUpperCase();
    let result = null;
    if (cmd === "GET") result = db.has(a[1]) ? db.get(a[1]) : null;
    else if (cmd === "SET") { db.set(a[1], a[2]); result = "OK"; }
    else if (cmd === "DEL") result = db.delete(a[1]) ? 1 : 0;
    else if (cmd === "MGET") result = a.slice(1).map((k) => (db.has(k) ? db.get(k) : null));
    else if (cmd === "SCAN") {
      const i = a.indexOf("MATCH");
      const pat = i > -1 ? a[i + 1] : "*";
      const re = new RegExp(
        "^" + pat.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
      );
      result = ["0", [...db.keys()].filter((k) => re.test(k))];
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ result }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
test.after(() => server.close());

// De env moet staan vóór de import: lib/store.js leest hem bij het laden.
process.env.KV_REST_API_URL = `http://127.0.0.1:${server.address().port}`;
process.env.KV_REST_API_TOKEN = "test";
process.env.REVIEW_TOKEN = "geheim";
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const C = await import("../lib/config.js");
const review = (await import("../api/review.js")).default;
const { assembleerTegels } = await import("../lib/tegels.js");
const { splitsAntwoord, artikelSleutel } = await import("../lib/levering.js");

const SNAPSHOTS = [C.KEY_ACTUEEL_SNAPSHOT, C.KEY_ACTUEEL_TEKST_SNAPSHOT, C.KEY_ACTUEEL_ARCHIEF_SNAPSHOT];
const NU = Date.now();
const ID = "nlo123";
const IF_URL = "https://infofrankrijk.com/paspoort/";
const TEGEL_ID = "overheid-nl-overheid";

// Precies de vorm die api/cron.js wegschrijft voor een Nederlandstalige bron.
const doc = {
  id: ID,
  sleutel: null,
  thema: "nl-overheid",
  bron: "Rijksoverheid",
  url: "https://www.rijksoverheid.nl/actueel/nieuws/2026/09/05/paspoort",
  datum: new Date(NU - 3600e3).toISOString(),
  titelBron: "Paspoort aanvragen in het buitenland",
  kop: "Paspoort aanvragen in het buitenland wordt eenvoudiger",
  samenvatting: "Nederlanders in Frankrijk kunnen hun paspoort voortaan bij meer loketten aanvragen.",
  model: "geen (feedtekst)",
  gepubliceerdOp: new Date(NU - 3600e3).toISOString(),
};

// Een momentopname van tien minuten oud: ruim binnen SNAPSHOT_MAX_LEEFTIJD_S,
// dus lib/lever.js vertrouwt hem en bakt niet opnieuw. Dit is de toestand
// waarin de verwijzing onzichtbaar bleef.
function zetVulling() {
  db.clear();
  db.set(C.KEY_OVERHEID(ID), JSON.stringify(doc));
  db.set(C.KEY_IF_INDEX, JSON.stringify({
    opgehaaldOp: new Date(NU).toISOString(),
    categorieen: { 26: "Overheden" },
    artikelen: [{
      ifId: 501, titel: "Paspoort en identiteitskaart", url: IF_URL,
      modified: new Date(NU - 30 * 864e5).toISOString(), categorieen: [26],
    }],
  }));
  const voorDeKlik = splitsAntwoord({
    bijgewerkt: new Date(NU - 600e3).toISOString(),
    gebakkenOp: new Date(NU - 600e3).toISOString(),
    tegels: assembleerTegels({ overheidDocs: [doc], verwijzingen: [], nu: NU }),
    agenda: [], bronStatus: [],
  });
  db.set(C.KEY_ACTUEEL_SNAPSHOT, JSON.stringify(voorDeKlik.compact));
  db.set(C.KEY_ACTUEEL_TEKST_SNAPSHOT, JSON.stringify(voorDeKlik.tekst));
  db.set(C.KEY_ACTUEEL_ARCHIEF_SNAPSHOT, JSON.stringify(voorDeKlik.archief));
}

async function roep(method, body) {
  const res = { code: 0, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.code = c; return res; };
  res.json = (j) => { res.body = j; return res; };
  res.end = () => res;
  await review({ method, url: "/api/review?token=geheim", headers: { "x-review-token": "geheim" }, body }, res);
  return res;
}

// ---- De keten, schakel voor schakel ---------------------------------------

test("de klik komt in KV en in /api/review terecht", async () => {
  zetVulling();
  const post = await roep("POST", { actie: "verwijs", id: ID, ifId: 501 });
  assert.equal(post.code, 200, JSON.stringify(post.body));

  const record = JSON.parse(db.get(C.KEY_VERWIJZING(ID)));
  assert.equal(record.items.length, 1);
  assert.equal(record.items[0].url, IF_URL);

  const get = await roep("GET");
  assert.deepEqual((get.body.verwijzingen[ID] || []).map((v) => v.url), [IF_URL]);
});

test("lib/tegels.js en lib/levering.js dragen hem naar de tekst-levering", () => {
  const tegels = assembleerTegels({
    overheidDocs: [doc],
    verwijzingen: [{ id: ID, items: [{ ifId: 501, titel: "Paspoort en identiteitskaart", url: IF_URL }] }],
    nu: NU,
  });
  const tegel = tegels.find((t) => t.id === TEGEL_ID);
  assert.ok(tegel, "de tegel Nederlandse overheid bestaat");
  const art = tegel.artikelen.find((a) => a.id === ID);
  assert.deepEqual(art.verwijzingen, [{ titel: "Paspoort en identiteitskaart", url: IF_URL }]);

  const { tekst } = splitsAntwoord({ bijgewerkt: "n", gebakkenOp: "n", tegels, agenda: [], bronStatus: [] });
  assert.deepEqual(tekst.artikelen[artikelSleutel(TEGEL_ID, ID)].verwijzingen, art.verwijzingen);
});

test("actueel.html rendert hem in het omkaderde blok onder de bronnen", () => {
  // Dezelfde aanpak als test/verwijzing.test.mjs: de echte renderfunctie.
  const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
  const b = html.indexOf("function bronHTML(b){");
  const e = html.indexOf("function leegHTML(){");
  const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  // eslint-disable-next-line no-new-func
  const artikelHTML = new Function(
    "esc", "ico", "datum", "artOpen", "teksten", "tekstStatus", "archiefArtikelen",
    "archiefStatus", "open", "themaIco", "meerv", "CATS", "VERWIJS_KOP",
    `${html.slice(b, e)}; return artikelHTML;`
  )(esc, (n) => `<svg data-ic="${n}"></svg>`, (d) => String(d || "").slice(0, 10), {},
    { [artikelSleutel(TEGEL_ID, ID)]: {
      tekst: doc.samenvatting,
      bronnen: [{ naam: "Rijksoverheid", titel: doc.titelBron, url: doc.url, datum: doc.datum }],
      verwijzingen: [{ titel: "Paspoort en identiteitskaart", url: IF_URL }],
    } }, "klaar", null, "niet-nodig", {}, () => "ic", (n) => `${n}`, [], C.IF_VERWIJZING_KOP);

  const uit = artikelHTML("nieuws", { id: TEGEL_ID, soort: "overheid" },
    { id: ID, soort: "overheid", titel: doc.kop, summary: doc.samenvatting,
      bronMeta: { naam: "Rijksoverheid", datum: doc.datum }, bronAantal: 1 });

  assert.ok(uit.includes(`href="${IF_URL}"`), "de verwijzing staat in de pagina");
  assert.ok(uit.indexOf('class="verwijs"') > uit.indexOf("bronknop"), "in een eigen blok onder de bronnen");
});

// ---- De schakel die brak ---------------------------------------------------

test("een verwijzing maakt de voorgebakken momentopname ongeldig", async () => {
  zetVulling();
  for (const s of SNAPSHOTS) assert.ok(db.has(s), `${s} hoort er vooraf te staan`);
  // Bewijs dat de momentopname de verwijzing NIET kan bevatten: hij is gebakken
  // vóór de klik. Zolang hij blijft staan, ziet de lezer niets.
  const voor = JSON.parse(db.get(C.KEY_ACTUEEL_TEKST_SNAPSHOT));
  assert.equal(voor.artikelen[artikelSleutel(TEGEL_ID, ID)].verwijzingen, undefined);

  const post = await roep("POST", { actie: "verwijs", id: ID, ifId: 501 });
  assert.equal(post.code, 200);
  assert.equal(post.body.snapshotVervallen, true, "het antwoord zegt het ook");
  for (const s of SNAPSHOTS) {
    assert.equal(db.has(s), false, `${s} hoort na de klik weg te zijn, anders serveert /api/actueel de oude`);
  }
  // De verwijzing zelf blijft natuurlijk staan.
  assert.ok(db.has(C.KEY_VERWIJZING(ID)));
});

test("weghalen maakt hem net zo goed ongeldig", async () => {
  zetVulling();
  await roep("POST", { actie: "verwijs", id: ID, ifId: 501 });
  zetVulling.call(null); // nieuwe momentopname, alsof de cron intussen bakte
  db.set(C.KEY_VERWIJZING(ID), JSON.stringify({ id: ID, items: [{ ifId: 501, titel: "T", url: IF_URL }] }));

  const post = await roep("POST", { actie: "verwijs-weg", id: ID, ifId: 501 });
  assert.equal(post.code, 200);
  for (const s of SNAPSHOTS) {
    assert.equal(db.has(s), false, `${s} hoort ook na het weghalen weg te zijn`);
  }
  assert.equal(db.has(C.KEY_VERWIJZING(ID)), false, "en het lege record blijft niet achter");
});

test("alle drie de leveringen vervallen samen, nooit één", async () => {
  // De verwijzing zit alleen in de tekst-levering, maar de drie horen hetzelfde
  // bakmoment te dragen; de sonde toetst dat (I10). Eén sleutel weggooien zou ze
  // uit elkaar laten lopen en de sonde rood maken.
  zetVulling();
  await roep("POST", { actie: "verwijs", id: ID, ifId: 501 });
  assert.deepEqual(SNAPSHOTS.map((s) => db.has(s)), [false, false, false]);
});
