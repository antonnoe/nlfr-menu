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
} from "../lib/selectie/kern.js";

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

test("synthese alleen in de zijbalk: link naar de eerste krant, rubriek verplicht", () => {
  assert.match(redactieBesluit({ herkomst: "concept", doc: CONCEPT }).fout, /rubriek/);
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
  assert.match(api, /opgenomen: uit\.besluit\.id/);
  assert.match(api, /b\.redactie\.ook/);
});

test("/redactie toont gepubliceerde syntheses zonder zijbalkkeuze", () => {
  const html = fs.readFileSync(new URL("../redactie.html", import.meta.url), "utf8");
  assert.match(html, /rev\.publicaties/);
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
