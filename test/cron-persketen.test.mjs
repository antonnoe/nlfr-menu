// De cronronde meet en meldt wat de persketen doet — ook als dat niets is.
// ---------------------------------------------------------------------------
// AANLEIDING. Op 6 september 2026 was er sinds 4 september 16:12 geen concept
// meer aangemaakt. De cron gaf status 200 in 9,39 seconden, alle feeds kwamen
// binnen, en het draailog bevatte twintig regels — allemaal `[feeds]` — en
// daarna niets. Er stond nergens hoeveel clusters er waren gevormd, hoeveel er
// boven de tweebronnendrempel uitkwamen, of de synthese was aangeroepen, of er
// een concept was weggeschreven. Een storing en een rustige nieuwsdag zagen er
// identiek uit.
//
// Wat deze toetsen vastleggen:
//   1. De diagnosestand (`?diagnose=1`) meet de keten en VERANDERT NIETS.
//   2. Hij noemt per kandidaat waarom die blijft liggen — met name "eerder
//      afgewezen", de reden die veertig uur onzichtbaar was.
//   3. Elke stap komt in het draailog terecht, ook op nul.
//   4. De ronde laat een journaal in KV achter, zodat het antwoord dat niemand
//      leest niet langer de enige plek is waar de tellingen staan.
//
// Alles loopt via een gemockte fetch: geen netwerk, geen echte KV, geen model.

import test from "node:test";
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://kv.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";
process.env.CRON_SECRET = "geheim";
process.env.ANTHROPIC_API_KEY = "sleutel-die-niet-gebruikt-wordt";

const { default: cron } = await import("../api/cron.js");
const { KEY_CRON_RONDE, KEY_AFGEWEZEN, KV_PREFIX } = await import("../lib/config.js");

// Drie kranten over hetzelfde verhaal: genoeg om de tweebronnendrempel te
// halen. Bewust echte koppen-van-die-vorm en geen "test 1 / test 2": de
// clustering werkt op trefwoorden, en met verzonnen invoer meet deze toets de
// zeef en de drempel niet.
const KOPPEN = [
  ["https://www.lemonde.fr/rss/une.xml", "Le Monde", "Budget 2027 : le gouvernement présente un plan d'économies de 40 milliards d'euros"],
  ["https://www.lefigaro.fr/rss/figaro_actualites.xml", "Le Figaro", "Budget 2027 : Bercy détaille 40 milliards d'économies"],
  ["francetvinfo", "Franceinfo", "Budget : ce que contient le plan d'économies présenté par le gouvernement"],
];

function rssVoor(adres) {
  const treffer = KOPPEN.find(([fragment]) => adres.includes(fragment.replace("https://", "").split("/")[0]) || adres.includes(fragment));
  if (!treffer) {
    return '<?xml version="1.0"?><rss version="2.0"><channel><title>leeg</title></channel></rss>';
  }
  const [, , titel] = treffer;
  const link = `https://${new URL(adres.startsWith("http") ? adres : `https://${adres}`).host}/actualite/${encodeURIComponent(titel).slice(0, 40)}`;
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item>
    <title>${titel.replace(/&/g, "&amp;")}</title>
    <link>${link}</link>
    <pubDate>${new Date(Date.now() - 3600e3).toUTCString()}</pubDate>
  </item></channel></rss>`;
}

function voerKvUit(kv, args) {
  const commando = String(args[0]).toUpperCase();
  if (commando === "GET") return kv.has(args[1]) ? kv.get(args[1]) : null;
  if (commando === "SET") { kv.set(args[1], args[2]); return "OK"; }
  if (commando === "DEL") return kv.delete(args[1]) ? 1 : 0;
  if (commando === "MGET") return args.slice(1).map((k) => (kv.has(k) ? kv.get(k) : null));
  if (commando === "SCAN") {
    const voorvoegsel = String(args[3]).replace(/\*$/, "");
    return ["0", [...kv.keys()].filter((k) => k.startsWith(voorvoegsel))];
  }
  throw new Error(`onverwacht KV-commando: ${commando}`);
}

function zetWereldOp(kv) {
  globalThis.fetch = async (url, opties = {}) => {
    const adres = String(url);
    if (adres.startsWith("https://kv.test.invalid")) {
      const body = { result: voerKvUit(kv, JSON.parse(opties.body)) };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (adres.includes("verenigingen-kalender")) {
      const body = { verenigingen: [], items: [] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    const tekst = rssVoor(adres);
    return { ok: true, status: 200, text: async () => tekst, json: async () => ({}) };
  };
}

function nepRes() {
  const res = {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return res;
}

const verzoek = (query = "") => ({
  method: "GET",
  url: `/api/cron${query}`,
  headers: { authorization: "Bearer geheim" },
});

// Vangt console.log/error op, zodat de logregels toetsbaar zijn. Dat het log
// gevuld is, is hier geen bijzaak maar het onderwerp.
function vangLog(fn) {
  const regels = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => regels.push(a.join(" "));
  console.error = (...a) => regels.push(a.join(" "));
  return Promise.resolve(fn()).finally(() => {
    console.log = log;
    console.error = err;
  }).then((uit) => ({ uit, regels }));
}

test("diagnose meet de keten en schrijft niets weg", async () => {
  const kv = new Map();
  zetWereldOp(kv);
  const res = nepRes();
  const { regels } = await vangLog(() => cron(verzoek("?diagnose=1"), res));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.modus, "diagnose (leest alleen)");
  assert.equal(kv.size, 0, "de diagnosestand hoort geen enkele sleutel te schrijven");

  const m = res.body.meting;
  assert.ok(m.persRuw >= 3, `verwacht minstens drie persitems, kreeg ${m.persRuw}`);
  assert.equal(m.bovenDrempel, 1, "de drie kranten horen één cluster boven de drempel op te leveren");
  assert.equal(m.beoordeeld, 1, "dat cluster hoort nu de synthese in te mogen");
  assert.equal(m.syntheseAangeroepen, 0, "de diagnosestand roept het model nooit aan");
  assert.equal(res.body.kandidaten.length, 1);
  assert.equal(res.body.kandidaten[0].blokkade, null);

  // Elke stap staat in het log, ook de stappen die nul zijn.
  const log = regels.join("\n");
  assert.match(log, /\[pers·diagnose\] clusters gevormd: \d+/);
  assert.match(log, /\[pers·diagnose\] clusters boven de tweebronnendrempel: 1/);
  assert.match(log, /\[pers·diagnose\] synthese-aanroepen: 0/);
  assert.match(log, /\[pers·diagnose\] concepten weggeschreven: 0/);
});

test("diagnose noemt een eerdere afwijzing als reden dat een cluster blijft liggen", async () => {
  const kv = new Map();
  zetWereldOp(kv);

  // Eerst de sleutel opzoeken die dit cluster krijgt, dan die afwijzen.
  const eerste = nepRes();
  await vangLog(() => cron(verzoek("?diagnose=1"), eerste));
  const sleutel = eerste.body.kandidaten[0].sleutel;

  kv.set(
    KEY_AFGEWEZEN(sleutel),
    JSON.stringify({ id: sleutel, op: "2026-09-04T16:12:00.000Z", reden: "te-smal" })
  );

  const res = nepRes();
  const { regels } = await vangLog(() => cron(verzoek("?diagnose=1"), res));
  assert.equal(res.body.meting.beoordeeld, 0);
  assert.equal(res.body.meting.overgeslagen.afgewezen, 1);
  assert.equal(res.body.kandidaten[0].blokkade.reden, "eerder-afgewezen");
  assert.match(res.body.kandidaten[0].blokkade.uitleg, /te-smal/);
  assert.equal(res.body.kandidaten[0].blokkade.sinds, "2026-09-04T16:12:00.000Z");

  assert.equal(res.body.eersteNul.veld, "beoordeeld");
  assert.equal(res.body.eersteNul.aantalErvoor, 1, "het aantal vóór de nulstap hoort erbij te staan");
  assert.match(res.body.duiding, /eerder afgewezen/);
  assert.match(regels.join("\n"), /STAP OP NUL: "kandidaten die aan de synthese toekwamen"/);
});

test("een gewone ronde laat een journaal in KV achter", async () => {
  const kv = new Map();
  zetWereldOp(kv);
  const res = nepRes();
  await vangLog(() => cron(verzoek(), res));

  assert.equal(res.statusCode, 200);
  const journaal = JSON.parse(kv.get(KEY_CRON_RONDE));
  assert.ok(journaal.op, "het journaal draagt het moment van de ronde");
  assert.equal(typeof journaal.persItemsLaatsteRonde, "number");
  assert.ok(journaal.pers, "de volledige meting hoort in het journaal");
  assert.ok(Object.prototype.hasOwnProperty.call(journaal, "laatsteConceptOp"));
  assert.equal(typeof journaal.tegels, "object");
});

test("het journaal onthoudt het laatste concept over rondes heen", async () => {
  const kv = new Map();
  zetWereldOp(kv);
  kv.set(
    KEY_CRON_RONDE,
    JSON.stringify({
      op: "2026-09-05T08:00:00.000Z",
      laatsteConceptOp: "2026-09-04T16:12:00.000Z",
      tegels: { "pers-landelijk": { aantal: 4, laatstGevuld: "2026-09-04T21:00:00.000Z" } },
    })
  );
  const res = nepRes();
  await vangLog(() => cron(verzoek(), res));

  const journaal = JSON.parse(kv.get(KEY_CRON_RONDE));
  assert.equal(
    journaal.laatsteConceptOp,
    "2026-09-04T16:12:00.000Z",
    "zonder nieuw concept blijft het oude moment staan — anders wist de stilte zichzelf uit"
  );
  assert.ok(
    journaal.tegels["pers-landelijk"],
    "een tegel die nu helemaal niet meer wordt gebouwd, houdt zijn geschiedenis"
  );
  assert.equal(journaal.tegels["pers-landelijk"].aantal, 0);
  assert.equal(journaal.tegels["pers-landelijk"].laatstGevuld, "2026-09-04T21:00:00.000Z");
});

test("de bewaking reist mee in de levering die de sonde ophaalt", async () => {
  const kv = new Map();
  zetWereldOp(kv);
  await vangLog(() => cron(verzoek(), nepRes()));

  const snapshot = JSON.parse(kv.get(`${KV_PREFIX}snapshot:v3`));
  assert.ok(snapshot.bewaking, "zonder dit blok kan de sonde de persketen niet toetsen");
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.bewaking, "laatsteConceptOp"));
  assert.equal(typeof snapshot.bewaking.persItemsLaatsteRonde, "number");
  assert.ok(snapshot.bewaking.keten, "de tellingen per stap horen erbij te staan");
});
