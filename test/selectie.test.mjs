// Nieuwsselectie (vervanger van Feedspot), 7 november 2026.
// ---------------------------------------------------------------------------
// De cyclus: AI scant -> biedt aan met categorie, score en PEIL-koppeling ->
// redactie geeft go of no-go -> goedgekeurde berichten in de sidebar. De tests
// hieronder bewaken wat er stil mis zou kunnen gaan: een bericht dat niet over
// Frankrijk gaat, een PEIL-koppeling op een toevallig woord, een verzonnen
// parameter-id in het modelantwoord, een verlopen weerwaarschuwing in de
// sidebar, of een beslissing die toch een TTL krijgt.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  gaatOverFrankrijk,
  leesPersFeed,
  leesMeteoFeed,
  ontdubbel,
  kandidaatId,
  peilVoorselectie,
  peilKort,
  leesModelAntwoord,
  voorbeeldenVoorModel,
  bouwInvoer,
  bouwFeed,
  bouwRss,
  binnenVenster,
  CATEGORIEEN,
} from "../lib/selectie/kern.js";
import { draaiRonde } from "../lib/selectie/ronde.js";

const NU = Date.parse("2026-11-07T08:00:00Z");

// Een klein stuk PEIL, letterlijk overgenomen uit versie 1.14.5.
const PEIL = [
  { id: "p.xb.cak.woonlandfactor_fr", naam: "Woonlandfactor Frankrijk", naam_fr: "", trefwoorden: "cak verdragsbijdrage woonlandfactor zorg buitenland premie", waarde_weergave: "0,7", verificatiedatum: "2026-11-04", tools: [{ naam: "Financieel Kompas", url: "https://infofrankrijk.com/financieel-kompas/" }] },
  { id: "p.xb.cak.rekenwijze_verdragsbijdrage", naam: "Rekenwijze van de CAK-verdragsbijdrage", naam_fr: "", trefwoorden: "cak verdragsbijdrage woonlandfactor zorg buitenland premie", waarde_weergave: "…", verificatiedatum: "2026-10-22", tools: [{ naam: "Financieel Kompas", url: "https://infofrankrijk.com/financieel-kompas/" }] },
  { id: "p.nl.zorgtoeslag.normpercentage_zonder_partner", naam: "Zorgtoeslag normpercentage zonder partner", naam_fr: "", trefwoorden: "zorgtoeslag toeslag", waarde_weergave: "…", tools: [] },
  { id: "p.fr.ir.quotient_plafond_parent_isole", naam: "Plafond quotient alleenstaande ouder twee halve delen", naam_fr: "Plafond du quotient familial, parent isolé", trefwoorden: "quotient familial parent isole alleenstaande ouder", waarde_weergave: "…", tools: [] },
  { id: "p.fr.elec.tarief_teruglevering_surplus", naam: "Teruglevertarief zonnestroom (surplus)", naam_fr: "Tarif d'achat surplus", trefwoorden: "zonnepanelen teruglevering surplus autoconsommation edf oa", waarde_weergave: "1,1 c euro per kWh", verificatiedatum: "2026-10-26", tools: [{ naam: "EnergiePortaal", url: "https://example.org/energie" }] },
];

test("Frankrijk-filter: Frans Timmermans is geen Frankrijk, Corsica en de TGV wel", () => {
  assert.equal(gaatOverFrankrijk("Frans Timmermans reageert op de verkiezingsuitslag"), false);
  assert.equal(gaatOverFrankrijk("Noodweer op Corsica eist twee levens"), true);
  assert.equal(gaatOverFrankrijk("Nieuwe TGV haalt 320 kilometer per uur"), true);
  assert.equal(gaatOverFrankrijk("Franse vakbond telt 1,6 miljoen betogers"), true);
});

test("Google News: de redactie komt uit <source>, de staart gaat van de kop", () => {
  const xml = `<rss><channel><item><title>Bus vol scholieren botst tegen boom in Frankrijk - AD.nl</title><link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Fri, 06 Nov 2026 15:50:00 GMT</pubDate><source url="https://www.ad.nl">AD.nl</source></item></channel></rss>`;
  const [i] = leesPersFeed(xml, { naam: "Google News NL", land: "NL", googleNews: true });
  assert.equal(i.titel, "Bus vol scholieren botst tegen boom in Frankrijk");
  assert.equal(i.bron, "AD.nl");
  assert.equal(i.viaGoogleNews, true);
  assert.equal(i.datum, "2026-11-06T15:50:00.000Z");
});

test("ontdubbelen: het artikel van de redactie zelf gaat voor op de Google News-doorverwijzing", () => {
  const gn = { soort: "pers", titel: "Twee doden bij busongeluk met scholieren in Frankrijk", url: "https://news.google.com/x", bron: "NOS", viaGoogleNews: true };
  const nos = { soort: "pers", titel: "Twee doden bij busongeluk met scholieren in Frankrijk, meerdere gewonden", url: "https://nos.nl/artikel/1", bron: "NOS", viaGoogleNews: false };
  const uit = ontdubbel([gn, nos]);
  assert.equal(uit.length, 1);
  assert.equal(uit[0].url, "https://nos.nl/artikel/1");
});

const METEO = `<feed>
<entry><title>Orange Rain-flood Warning issued for France - Gard</title><cap:expires>2026-11-07T23:00:00+00:00</cap:expires><cap:onset>2026-11-07T06:00:00+00:00</cap:onset></entry>
<entry><title>Orange Rain-flood Warning issued for France - Hérault</title><cap:expires>2026-11-07T23:00:00+00:00</cap:expires><cap:onset>2026-11-07T06:00:00+00:00</cap:onset></entry>
<entry><title>Yellow Wind Warning issued for France - Finistère</title><cap:expires>2026-11-07T23:00:00+00:00</cap:expires></entry>
<entry><title>Red Wind Warning issued for France - Corse-du-Sud</title><cap:expires>2026-11-06T23:00:00+00:00</cap:expires></entry>
</feed>`;

test("meteo: oranje gegroepeerd per type, geel telt niet, verlopen rood valt weg", () => {
  const uit = leesMeteoFeed(METEO, NU);
  assert.equal(uit.length, 1);
  assert.equal(uit[0].titel, "Oranje waarschuwing voor regen en overstromingen: Gard, Hérault");
  assert.equal(uit[0].url, "https://vigilance.meteofrance.fr/fr");
  assert.equal(uit[0].kleur, "orange");
  // Zelfde kleur, type en dag = zelfde id, ook als er een departement bijkomt.
  const meer = leesMeteoFeed(METEO.replace("</feed>", `<entry><title>Orange Rain-flood Warning issued for France - Gard</title><cap:expires>2026-11-07T23:00:00+00:00</cap:expires><cap:onset>2026-11-07T07:00:00+00:00</cap:onset></entry></feed>`), NU);
  assert.equal(kandidaatId(meer[0]), kandidaatId(uit[0]));
});

test("venster: ongedateerd en te oud persnieuws wordt niet aangeboden, meteo altijd", () => {
  assert.equal(binnenVenster({ soort: "pers", datum: null }, NU), false);
  assert.equal(binnenVenster({ soort: "pers", datum: "2026-11-01T08:00:00Z" }, NU), false);
  assert.equal(binnenVenster({ soort: "pers", datum: "2026-11-06T20:00:00Z" }, NU), true);
  assert.equal(binnenVenster({ soort: "meteo", datum: null }, NU), true);
});

test("PEIL: de CAK-bijdrage koppelt aan CAK, voetbal en ongelukken koppelen nergens aan", () => {
  const cak = peilVoorselectie("Met pensioen in Spanje, Frankrijk of Portugal? Zo verandert je CAK-bijdrage voor zorg in 2027", PEIL).map((p) => p.id);
  assert.ok(cak.includes("p.xb.cak.woonlandfactor_fr"));
  assert.ok(!cak.includes("p.nl.zorgtoeslag.normpercentage_zonder_partner"));
  assert.deepEqual(peilVoorselectie("Frankrijk zonder Dembélé, met Mbappé naar Nations League", PEIL), []);
  assert.deepEqual(peilVoorselectie("Twee doden bij busongeluk met scholieren in Frankrijk", PEIL), []);
  const zon = peilVoorselectie("Mon Parcours Solaire helpt bij zonnepanelen en verkoop van het surplus", PEIL).map((p) => p.id);
  assert.deepEqual(zon, ["p.fr.elec.tarief_teruglevering_surplus"]);
});

test("modelantwoord: onbekende categorie wordt 'geen', een niet voorgelegde PEIL-id verdwijnt", () => {
  const aangeboden = [
    { id: "a1", titel: "CAK", peilAangeboden: [peilKort(PEIL[0])] },
    { id: "b2", titel: "Voetbal", peilAangeboden: [] },
  ];
  const ruw = `Hier is mijn oordeel:
[{"nr":1,"categorie":"regelgeving","score":91,"reden":"Raakt de zorgpremie.","peil":[{"id":"p.xb.cak.woonlandfactor_fr","soort":"mogelijk-gewijzigd","toelichting":"Bericht noemt nieuwe factor."},{"id":"p.verzonnen","soort":"raakt"}],"gat":null},
 {"nr":2,"categorie":"sport","score":140,"reden":"x","peil":[],"gat":null},
 {"nr":9,"categorie":"algemeen","score":50}]`;
  const uit = leesModelAntwoord(ruw, aangeboden);
  assert.equal(uit.size, 2);
  const a = uit.get("a1");
  assert.equal(a.categorie, "regelgeving");
  assert.equal(a.peil.length, 1);
  assert.equal(a.peil[0].soort, "mogelijk-gewijzigd");
  assert.equal(a.peil[0].tools[0].naam, "Financieel Kompas");
  const b = uit.get("b2");
  assert.equal(b.categorie, "geen");
  assert.equal(b.score, 100);
  assert.throws(() => leesModelAntwoord("geen json", aangeboden), /JSON/);
});

test("leren: eerdere go's en no-go's gaan als voorbeelden mee in de invoer", () => {
  const besluiten = [
    { besluit: "go", categorie: "regelgeving", titel: "CAK-bijdrage 2027", besluitOp: "2026-11-06T10:00:00Z" },
    { besluit: "nogo", categorie: null, titel: "Veertien aapjes gestolen", besluitOp: "2026-11-06T11:00:00Z" },
  ];
  const invoer = bouwInvoer([{ soort: "pers", bron: "NOS", land: "NL", titel: "Test", peilAangeboden: [] }], voorbeeldenVoorModel(besluiten));
  assert.match(invoer, /GO \[regelgeving\] CAK-bijdrage 2027/);
  assert.match(invoer, /NO-GO Veertien aapjes gestolen/);
  assert.match(invoer, /#1 \[pers, NOS, NL\] Test/);
});

test("feed: alleen go, binnen het venster, meteo tot de vervaldatum, per categorie", () => {
  const besluiten = [
    { id: "1", besluit: "go", categorie: "regelgeving", titel: "CAK", bron: "NOS", url: "https://nos.nl/1", datum: "2026-11-06T10:00:00Z", ai: { peil: [peilKort(PEIL[0])] } },
    { id: "2", besluit: "nogo", categorie: "algemeen", titel: "Aapjes", datum: "2026-11-06T10:00:00Z" },
    { id: "3", besluit: "go", categorie: "algemeen", titel: "Oud", datum: "2026-10-20T10:00:00Z" },
    { id: "4", besluit: "go", categorie: "meteo", soort: "meteo", titel: "Oranje", verloopt: "2026-11-06T23:00:00Z", datum: "2026-11-06T06:00:00Z" },
    { id: "5", besluit: "go", categorie: "meteo", soort: "meteo", titel: "Rood", verloopt: "2026-11-07T23:00:00Z", datum: "2026-11-07T06:00:00Z", kleur: "red" },
  ];
  const feed = bouwFeed(besluiten, NU);
  const titels = feed.categorieen.flatMap((c) => c.items.map((i) => i.titel));
  assert.deepEqual(titels.sort(), ["CAK", "Rood"]);
  const regel = feed.categorieen.find((c) => c.key === "regelgeving");
  assert.equal(regel.label, "Wet- en regelgeving");
  assert.equal(regel.items[0].peil[0].tools[0].url, "https://infofrankrijk.com/financieel-kompas/");
  assert.ok(!JSON.stringify(feed).includes("door"), "wie besliste gaat niet mee in de openbare feed");
  const rss = bouwRss({ ...feed, categorieen: [{ label: "A & B", items: [{ id: "x", titel: "<kop>", bron: "NOS", url: "https://nos.nl/?a=1&b=2", datum: null, peil: [] }] }] }, "https://nlfr-menu.vercel.app/sidebar-nieuws");
  assert.match(rss, /&lt;kop&gt;/);
  assert.match(rss, /A &amp; B/);
  assert.match(rss, /a=1&amp;b=2/);
});

test("de vijf categorieën van de redactie", () => {
  assert.deepEqual(CATEGORIEEN, ["algemeen", "ondernemers", "reizen", "meteo", "regelgeving"]);
});

test("ronde in diagnose: geen modelaanroep, niets weggeschreven, PEIL en bronnen gemeld", async () => {
  const feeds = {
    "https://feeds.nos.nl/nosnieuwsbuitenland": `<rss><item><title>Frankrijk verhoogt de CAK-bijdrage niet</title><link>https://nos.nl/1</link><pubDate>Sat, 07 Nov 2026 06:00:00 GMT</pubDate><description>Zorg voor Nederlanders in Frankrijk.</description></item><item><title>Brand in Rotterdam</title><link>https://nos.nl/2</link><pubDate>Sat, 07 Nov 2026 06:00:00 GMT</pubDate></item></rss>`,
    "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-france": METEO,
    "https://communitiesabroad.com/manifest/peil-zoek.json": JSON.stringify({ versie: "test", parameters: PEIL }),
  };
  const f = async (url) => (url in feeds ? new Response(feeds[url], { status: 200 }) : new Response("", { status: 404 }));
  let modelAangeroepen = false;
  const j = await draaiRonde({ nu: NU, diagnose: true, f, maakClient: () => { modelAangeroepen = true; return {}; } });
  assert.equal(modelAangeroepen, false);
  assert.equal(j.diagnose, true);
  assert.equal(j.opgeslagen, 0);
  assert.equal(j.peil.aantal, PEIL.length);
  const titels = j.voorbeeld.map((v) => v.titel);
  assert.ok(titels.includes("Frankrijk verhoogt de CAK-bijdrage niet"));
  assert.ok(!titels.includes("Brand in Rotterdam"));
  assert.equal(j.voorbeeld[0].soort, "meteo", "meteo gaat voor");
  const cak = j.voorbeeld.find((v) => v.titel.includes("CAK"));
  assert.ok(cak.peil.includes("p.xb.cak.woonlandfactor_fr"));
});

test("beslissingen krijgen GEEN TTL, kandidaten wel (bron)", () => {
  const api = fs.readFileSync(new URL("../api/selectie.js", import.meta.url), "utf8");
  assert.match(api, /setJSON\(KEY_SEL_BESLUIT\(id\), besluit\);/);
  const ronde = fs.readFileSync(new URL("../lib/selectie/ronde.js", import.meta.url), "utf8");
  assert.match(ronde, /setJSON\(KEY_SEL_KANDIDAAT\(i\.id\), doc, SEL_KANDIDAAT_TTL_S\)/);
});

test("de selectie raakt de actueelketen niet: eigen cron, eigen sleutels", () => {
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/selectie-cron"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron" && c.schedule === "7 * * * *"));
  const kern = fs.readFileSync(new URL("../lib/selectie/kern.js", import.meta.url), "utf8");
  assert.match(kern, /SEL_PREFIX = "selectie:"/);
});

test("/api/selectie zonder sessie geeft geen gegevens prijs", async () => {
  const { default: handler } = await import("../api/selectie.js");
  const req = { method: "GET", headers: {}, query: {} };
  const uit = { status: 0, body: null, headers: {} };
  const res = {
    setHeader(k, v) { uit.headers[k] = v; },
    getHeader(k) { return uit.headers[k]; },
    appendHeader() {},
    status(s) { uit.status = s; return this; },
    json(b) { uit.body = b; return this; },
  };
  await handler(req, res);
  assert.ok([401, 503].includes(uit.status));
  assert.equal(uit.body.ok, false);
  assert.equal(uit.body.kandidaten, undefined);
});
