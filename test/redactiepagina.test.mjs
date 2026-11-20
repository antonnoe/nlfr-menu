// Eén redactiepagina (20-11-2026): Café Claude per kennisdomein, prio en plek
// uit het modelantwoord, en het besluit dat een synthese of overheidsbericht
// uit /review naar de zijbalk brengt.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  cafeDomeinen,
  leesModelAntwoord,
  bouwInvoer,
  bouwFeed,
  zoekGekoppeld,
  zoekGekoppeldAlle,
  redactieBesluit,
  urlSleutel,
  FRANKRIJKNIEUWS_URL,
  leesKanalen,
  kanalenVan,
} from "../lib/selectie/kern.js";
import { normActueelKanalen, assembleerTegels } from "../lib/tegels.js";

const DOC = {
  modules: [{ id: "cafeclaude", url: "https://cafeclaude.fr/app" }],
  themas: [
    { cafe: { domein: "geld", tekst: "Vraag het Café Claude over belasting, pensioen en vermogen" } },
    { cafe: { domein: "zorg", tekst: "Vraag het Café Claude over zorg en verzekeren" } },
  ],
  groepen: [{ cafe: { domein: "geld", tekst: "dubbel" } }, { cafe: { domein: "x y", tekst: "ongeldig" } }],
};

test("Café Claude: alleen de kennisdomeinen uit modules.json, met diepe link", () => {
  const c = cafeDomeinen(DOC);
  assert.deepEqual(c.map((x) => x.domein), ["geld", "zorg"]);
  assert.equal(c[0].url, "https://cafeclaude.fr/app?domain=geld");
  assert.deepEqual(cafeDomeinen({ themas: DOC.themas }), [], "zonder Café Claude-module geen domeinen");
});

test("modelantwoord: prio, plek en Café Claude-domein; onbekend domein valt weg", () => {
  const items = [{ id: "a1", titel: "a", peilAangeboden: [] }, { id: "b2", titel: "b", peilAangeboden: [] }];
  const cafe = cafeDomeinen(DOC);
  const ruw = JSON.stringify([
    { nr: 1, score: 85, prio: "1", plek: "beide", categorie: "regelgeving", cafe: "geld" },
    { nr: 2, score: 20, prio: "zz", cafe: "bestaat-niet" },
  ]);
  const uit = leesModelAntwoord(ruw, items, { tools: [], cafe });
  const a = uit.get("a1");
  const b = uit.get("b2");
  assert.equal(a.prio, "1");
  assert.equal(a.plek, "beide");
  assert.equal(a.cafe.url, "https://cafeclaude.fr/app?domain=geld");
  assert.equal(b.prio, null);
  assert.equal(b.plek, "weg", "lage score zonder plek = weg");
  assert.equal(b.cafe, null);
});

test("de invoer voor het model noemt de Café Claude-domeinen", () => {
  const tekst = JSON.stringify(bouwInvoer([{ id: "a1", titel: "x", bron: "y", peilAangeboden: [] }], { go: [], nogo: [] }, { tools: [], cafe: cafeDomeinen(DOC) }));
  assert.match(tekst, /CAFÉ CLAUDE/);
  assert.match(tekst, /geld/);
});

test("feed geeft de Café Claude-regel mee, alleen met https", () => {
  const b = (id, cafe) => ({ id, besluit: "go", categorie: "algemeen", titel: "t", url: "https://x.fr/" + id, datum: new Date().toISOString(), ai: { cafe } });
  const feed = bouwFeed([b("a", { tekst: "Vraag", url: "https://cafeclaude.fr/app?domain=geld" }), b("c", { tekst: "x", url: "javascript:alert(1)" })]);
  const items = feed.categorieen[0].items;
  assert.equal(items.find((i) => i.id === "a").cafe.url, "https://cafeclaude.fr/app?domain=geld");
  assert.equal(items.find((i) => i.id === "c").cafe, null);
});

test("koppeling op bronlink: www, slash en querystring tellen niet", () => {
  assert.equal(urlSleutel("https://www.lemonde.fr/a/b/?x=1#y"), "lemonde.fr/a/b");
  const kandidaten = [
    { id: "k1", url: "https://lemonde.fr/a/b", ai: { score: 50 } },
    { id: "k2", url: "https://nos.nl/c", ai: { score: 90 } },
  ];
  const concept = { id: "c1", bronnen: [{ naam: "Le Monde", url: "https://www.lemonde.fr/a/b/" }, { naam: "NOS", url: "https://nos.nl/c?utm=1" }] };
  assert.equal(zoekGekoppeld(concept, kandidaten).id, "k2", "hoogste score wint");
  assert.equal(zoekGekoppeld({ id: "z", bronnen: [] }, kandidaten), null);
  assert.deepEqual(zoekGekoppeldAlle(concept, kandidaten).map((k) => k.id), ["k2", "k1"], "alle bronartikelen, beste eerst");
});

const CONCEPT = { id: "abc12", kop: "Kop van de synthese", bronnen: [{ naam: "Le Monde", url: "https://www.lemonde.fr/a" }], aangemaaktOp: "2026-11-20T10:00:00Z" };

test("synthese alleen in de zijbalk: link naar de eerste krant, rubriek nooit verplicht", () => {
  assert.equal(redactieBesluit({ herkomst: "concept", doc: CONCEPT }).besluit.categorie, "algemeen", "zonder rubriek een standaardrubriek, geen weigering");
  const { besluit } = redactieBesluit({ herkomst: "concept", doc: CONCEPT, categorie: "algemeen" });
  assert.equal(besluit.id, "rabc12");
  assert.equal(besluit.url, "https://www.lemonde.fr/a");
  assert.equal(besluit.bron, "Le Monde");
  assert.equal(besluit.besluit, "go");
  assert.equal(besluit.redactie.reviewId, "abc12");
});

test("synthese op beide plekken: zijbalk linkt naar de nieuwspagina en neemt het AI-oordeel over", () => {
  const gekoppeld = { id: "k9", url: "https://lemonde.fr/a", ai: { categorie: "regelgeving", peil: [{ naam: "p" }], cafe: { tekst: "t", url: "https://cafeclaude.fr/app?domain=geld" } } };
  const { besluit } = redactieBesluit({ herkomst: "publicatie", doc: CONCEPT, gekoppeld });
  assert.equal(besluit.id, "k9", "het besluit vervangt de kandidaat");
  assert.equal(besluit.url, FRANKRIJKNIEUWS_URL);
  assert.equal(besluit.categorie, "regelgeving");
  assert.equal(besluit.ai.cafe.url, "https://cafeclaude.fr/app?domain=geld");
  assert.equal(besluit.redactie.kandidaat.id, "k9", "herstel kan de kandidaat terugzetten");
});

test("alleen nieuwspagina of Weg: een no-go zonder verplichte rubriek", () => {
  const { besluit } = redactieBesluit({ herkomst: "concept", doc: CONCEPT, zijbalk: false });
  assert.equal(besluit.besluit, "nogo");
  assert.equal(besluit.redactie.reviewId, "abc12");
  assert.equal(bouwFeed([besluit]).categorieen.length, 0, "no-go komt nooit in de zijbalk");
});

test("overheidsbericht krijgt standaard de rubriek Wet- en regelgeving", () => {
  const { besluit } = redactieBesluit({ herkomst: "overheid", doc: { id: "o1", kop: "Overheid", url: "https://www.service-public.gouv.fr/x" } });
  assert.equal(besluit.categorie, "regelgeving");
  assert.equal(besluit.soort, "overheid");
  assert.equal(besluit.url, FRANKRIJKNIEUWS_URL);
});

test("selectie-API: opgenomen bronartikelen niet los op het scherm, terugdraaien geeft ze vrij", () => {
  const api = fs.readFileSync(new URL("../api/selectie.js", import.meta.url), "utf8");
  assert.match(api, /kandidaten\.filter\(\(k\) => !k\.opgenomen\)/);
  assert.match(fs.readFileSync(new URL("../lib/selectie/redactie-opslag.js", import.meta.url), "utf8"), /opgenomen: uit\.besluit\.id/);
  assert.match(api, /b\.redactie\.ook/);
});

test("/redactie toont gepubliceerde syntheses zonder zijbalkkeuze", () => {
  const html = fs.readFileSync(new URL("../redactie.html", import.meta.url), "utf8");
  assert.match(html, /weg: weg || undefined/);
  assert.match(html, /actie: "depubliceer"/);
});

test("/redactie staat achter de login en roept beide backends aan", () => {
  const html = fs.readFileSync(new URL("../redactie.html", import.meta.url), "utf8");
  assert.match(html, /\/api\/review/);
  assert.match(html, /\/api\/selectie/);
  assert.match(html, /noindex/);
  const mw = fs.readFileSync(new URL("../middleware.js", import.meta.url), "utf8");
  assert.match(mw, /"\/redactie"/);
});

// ---- Vijf plekken (20-11-2026) -----------------------------------------------
test("kanalen: alleen zijbalk en infofrankrijk; oud besluit zonder veld = zijbalk", () => {
  assert.deepEqual(leesKanalen(["infofrankrijk", "x", "zijbalk"]), ["zijbalk", "infofrankrijk"]);
  assert.equal(leesKanalen(undefined), null);
  assert.deepEqual(kanalenVan({ besluit: "go" }), ["zijbalk"]);
  assert.deepEqual(kanalenVan({ besluit: "nogo", kanalen: ["zijbalk"] }), []);
});

test("feed per kanaal: zijbalk en Infofrankrijk los te kiezen", () => {
  const b = (id, kanalen) => ({ id, besluit: "go", categorie: "algemeen", titel: "t", url: "https://x.fr/" + id, datum: new Date().toISOString(), ...(kanalen ? { kanalen } : {}) });
  const lijst = [b("oud"), b("zij", ["zijbalk"]), b("if", ["infofrankrijk"]), b("beide", ["zijbalk", "infofrankrijk"])];
  const ids = (f) => f.categorieen.flatMap((c) => c.items.map((i) => i.id)).sort();
  assert.deepEqual(ids(bouwFeed(lijst)), ["beide", "oud", "zij"]);
  assert.deepEqual(ids(bouwFeed(lijst, Date.now(), undefined, "infofrankrijk")), ["beide", "if"]);
});

test("redactiebesluit met kanalen: leeg is no-go, anders go met die kanalen", () => {
  const leeg = redactieBesluit({ herkomst: "concept", doc: CONCEPT, kanalen: [] }).besluit;
  assert.equal(leeg.besluit, "nogo");
  assert.deepEqual(leeg.kanalen, []);
  const ifAlleen = redactieBesluit({ herkomst: "concept", doc: CONCEPT, categorie: "algemeen", kanalen: ["infofrankrijk"] }).besluit;
  assert.equal(ifAlleen.besluit, "go");
  assert.deepEqual(ifAlleen.kanalen, ["infofrankrijk"]);
});

test("nieuwsbrief en Infopoche: alleen booleans voor die twee sleutels gaan mee naar /api/actueel", () => {
  assert.deepEqual(normActueelKanalen({ nieuwsbrief: false, infopoche: true, zijbalk: false, x: 1 }), { nieuwsbrief: false, infopoche: true });
  assert.equal(normActueelKanalen({ nieuwsbrief: "nee" }), null);
  assert.equal(normActueelKanalen(null), null);
});

test("/redactie heeft vijf plekken, Ja/Alleen zijbalk/Nee en Plaats zo, en beheer- en voorbeeldlinks", () => {
  const html = fs.readFileSync(new URL("../redactie.html", import.meta.url), "utf8");
  for (const p of ["nieuwspagina", "zijbalk", "nieuwsbrief", "infopoche", "infofrankrijk"]) assert.ok(html.includes(`["${p}", "`), p);
  for (const t of ["Ja, zoals voorgesteld", "Alleen zijbalk", "Rest van vandaag: nee", "Al automatisch live vandaag", "Door de AI niet voorgesteld", "Anders: plekken, rubriek of tekst", "Plaats zo", "Ongedaan maken", "Opnieuw proberen", "Bekijken en beheer"]) assert.ok(html.includes(t), t);
  for (const u of ["/sidebar-nieuws", "nlfr-nieuwsbrief.vercel.app/api/nieuwsbrief", "https://infopoche.fr", "https://infofrankrijk.com/#open", 'href="/review"']) assert.ok(html.includes(u), u);
});

test("/redactie is de ene ingang: tandwiel, login en /selectie verwijzen ernaar; /review blijft", () => {
  const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(rd("../index.html"), /\["Redactie","\/redactie"/);
  assert.match(rd("../login.html"), /return "\/redactie"/);
  assert.match(rd("../api/auth-callback.js"), /stuurDoor\(res, "\/redactie"\)/);
  assert.match(rd("../selectie.html"), /url=\/redactie/);
  assert.ok(fs.existsSync(new URL("../review.html", import.meta.url)));
});

test("/api/actueel: een publicatie met kanalen geeft ze mee per artikel, zonder kanalen geen veld", () => {
  const nu = Date.now();
  const pub = (id, extra) => ({ id, gepubliceerd: true, kop: "Kop " + id, tekst: "Tekst over iets in Frankrijk " + id + ". Meer tekst.", gepubliceerdOp: new Date(nu - 3600e3).toISOString(), bronnen: [{ naam: "Le Monde", url: "https://www.lemonde.fr/" + id }, { naam: "NOS", url: "https://nos.nl/" + id }], ...extra });
  const tegels = assembleerTegels({ publicaties: [pub("p1", { kanalen: { nieuwsbrief: false } }), pub("p2", { kop: "Iets heel anders", tekst: "Volkomen ander onderwerp over treinen. Nog meer." })], nu });
  const alle = tegels.flatMap((t) => t.artikelen || []);
  assert.deepEqual(alle.find((a) => a.id === "p1").kanalen, { nieuwsbrief: false });
  assert.equal("kanalen" in alle.find((a) => a.id === "p2"), false);
});

test("zijbalknieuws met ?kanaal=infofrankrijk leest de Infofrankrijk-feed", () => {
  const html = fs.readFileSync(new URL("../sidebar-nieuws.html", import.meta.url), "utf8");
  assert.ok(html.includes('"/api/selectie-feed" + kanaal'));
  assert.ok(html.includes('get("kanaal") === "infofrankrijk"'));
});

test("Rijksoverheid: alleen Caribisch Nederland is hard uitgesloten; de rest beslist de modelscore (poort)", async () => {
  const { nlOverheidUitgesloten } = await import("../lib/feeds.js");
  assert.equal(nlOverheidUitgesloten("Verbetering leefomgeving Bonaire, Sint Eustatius en Saba"), true);
  assert.equal(nlOverheidUitgesloten("Belasting in Caribisch Nederland omlaag"), true);
  assert.equal(nlOverheidUitgesloten("AOW-leeftijd stijgt in 2032"), false);
  assert.equal(nlOverheidUitgesloten("Openstelling burgemeestersvacature Lingewaard"), false, "geen trefwoordenlijst meer: dit regelt de poort");
  const feeds = fs.readFileSync(new URL("../lib/feeds.js", import.meta.url), "utf8");
  assert.ok(!feeds.includes("NL_OVERHEID_DOEL"), "de te zwakke doellijst is vervallen");
});

