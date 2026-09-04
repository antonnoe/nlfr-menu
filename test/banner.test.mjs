// De Café Jeudi-banner: datumlogica, validatie en opmaak.
//
// De datumlogica is het deel dat stil fout kan gaan: hij rekent in
// Europe/Paris terwijl de server in UTC draait en de bezoeker overal kan
// zitten. De tests prikken daarom op vaste momenten rond de donderdagavond —
// ervoor, eronder en erna — plus rond middernacht en over een zomertijdgrens.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  STANDAARD, KLEUREN, ONDERSCHRIFTEN,
  volgendeDatum, datumRegel, onderschriftTekst,
  valideer, normaliseer, bannerHTML, inParijs,
} from "../lib/banner.js";

const STARTWAARDE = JSON.parse(fs.readFileSync(new URL("../banner.json", import.meta.url), "utf8"));

// Een moment in Parijse tijd. In september is Parijs UTC+2, dus 18:00 in
// Parijs is 16:00Z. De tests noemen de UTC-tijd expliciet zodat er geen
// verborgen aanname in zit.
const donderdag10sep = (utc) => new Date("2026-09-10T" + utc + "Z");

// --- datumlogica -----------------------------------------------------------

test("vóór donderdag wijst hij naar de komende donderdag", () => {
  // Maandag 7 september 2026, 12:00 Parijs (10:00Z).
  assert.equal(volgendeDatum(STANDAARD, new Date("2026-09-07T10:00Z")), "2026-09-10");
});

test("op donderdag vóór de eindtijd is het vandaag", () => {
  // 18:30 Parijs = 16:30Z: de bijeenkomst is bezig.
  assert.equal(volgendeDatum(STANDAARD, donderdag10sep("16:30")), "2026-09-10");
  // En vlak vóór 19:30 Parijs (17:29Z) nog steeds.
  assert.equal(volgendeDatum(STANDAARD, donderdag10sep("17:29")), "2026-09-10");
});

test("na de eindtijd op donderdag schuift hij een week op", () => {
  // 19:30 Parijs = 17:30Z: afgelopen, dus volgende week.
  assert.equal(volgendeDatum(STANDAARD, donderdag10sep("17:30")), "2026-09-17");
  assert.equal(volgendeDatum(STANDAARD, donderdag10sep("21:00")), "2026-09-17");
});

test("de dag ná donderdag wijst naar de week erop", () => {
  assert.equal(volgendeDatum(STANDAARD, new Date("2026-09-11T08:00Z")), "2026-09-17");
});

test("een datum in overslaan wordt overgeslagen, ook meerdere achter elkaar", () => {
  const een = { ...STANDAARD, overslaan: ["2026-09-10"] };
  assert.equal(volgendeDatum(een, new Date("2026-09-07T10:00Z")), "2026-09-17");
  const twee = { ...STANDAARD, overslaan: ["2026-09-10", "2026-09-17"] };
  assert.equal(volgendeDatum(twee, new Date("2026-09-07T10:00Z")), "2026-09-24");
});

test("de datumregel staat er in het Nederlands en zonder jaar", () => {
  assert.equal(
    datumRegel(STANDAARD, new Date("2026-09-07T10:00Z")),
    "Donderdag 10 september van 18:00 tot +/- 19:30"
  );
});

test("een ingevulde datumtekst wint van de berekende regel", () => {
  const rec = { ...STANDAARD, datumtekst: "Kerstborrel — zaterdag 20 december, 20:00" };
  assert.equal(datumRegel(rec, new Date("2026-09-07T10:00Z")), "Kerstborrel — zaterdag 20 december, 20:00");
  // Een lege of enkel-witruimte datumtekst telt niet als override.
  assert.match(datumRegel({ ...STANDAARD, datumtekst: "   " }, new Date("2026-09-07T10:00Z")), /^Donderdag 10 september/);
});

test("zonder weekschema en zonder datumtekst is er geen datumregel", () => {
  assert.equal(datumRegel({ ...STANDAARD, wekelijks: null }, new Date("2026-09-07T10:00Z")), "");
  assert.equal(volgendeDatum({ ...STANDAARD, wekelijks: null }), null);
});

test("de klok is die van Parijs, niet die van de server", () => {
  // 23:30Z op woensdag 9 september is in Parijs al donderdag 10 september 01:30.
  const p = inParijs(new Date("2026-09-09T23:30Z"));
  assert.equal(p.iso, "2026-09-10");
  assert.equal(p.weekdag, 4, "donderdag");
  assert.equal(volgendeDatum(STANDAARD, new Date("2026-09-09T23:30Z")), "2026-09-10");
});

test("over de zomertijdgrens blijft de donderdag een donderdag", () => {
  // Parijs gaat in de nacht van 24 op 25 oktober 2026 naar wintertijd.
  assert.equal(volgendeDatum(STANDAARD, new Date("2026-10-22T20:00Z")), "2026-10-29");
  assert.equal(
    datumRegel(STANDAARD, new Date("2026-10-26T09:00Z")),
    "Donderdag 29 oktober van 18:00 tot +/- 19:30"
  );
});

test("een ander weekschema werkt net zo goed", () => {
  const dinsdag = { ...STANDAARD, wekelijks: { weekdag: 2, begin: "20:00", eind: "21:00" } };
  assert.equal(volgendeDatum(dinsdag, new Date("2026-09-07T10:00Z")), "2026-09-08");
  assert.equal(datumRegel(dinsdag, new Date("2026-09-07T10:00Z")), "Dinsdag 8 september van 20:00 tot +/- 21:00");
});

// --- opmaak ----------------------------------------------------------------

test("staat de banner uit, dan is er geen banner", () => {
  assert.equal(bannerHTML({ ...STANDAARD, aan: false }), "");
});

test("de banner toont titel, datumregel, onderschrift en knop", () => {
  const h = bannerHTML(STANDAARD, new Date("2026-09-07T10:00Z"));
  assert.match(h, /Café Jeudi/);
  assert.match(h, /Donderdag 10 september van 18:00 tot \+\/- 19:30/);
  assert.match(h, /Iedereen is van harte welkom \| Soyez les bienvenus/);
  assert.match(h, /ENTREZ/);
  assert.match(h, /https:\/\/meet\.google\.com\/gea-tjsy-gwk/);
  assert.match(h, /border-left-color:#2f6b3a/);
  assert.match(h, /class="bnr-vraag"/, "de [?]-knop hoort erbij");
});

test("zonder datumregel wordt de knop 'Lees meer…' en opent hij de uitleg", () => {
  const h = bannerHTML({ ...STANDAARD, wekelijks: null, datumtekst: null });
  assert.match(h, /Lees meer…/);
  assert.match(h, /<button[^>]+class="bnr-knop"/, "een knop, geen link naar de Meet");
  assert.ok(!/bnr-datum/.test(h), "geen lege datumregel");
});

test("de uitleg is een in-flow blok, geen overlay of window.open", () => {
  const h = bannerHTML(STANDAARD, new Date("2026-09-07T10:00Z"));
  assert.match(h, /<div class="bnr-uitleg" id="bnruitleg" hidden>/);
  assert.ok(!/position:\s*(absolute|fixed)/.test(h), "de uitleg staat in de flow");
});

test("soort 'boek' zet titel en auteur onder de banner-titel", () => {
  const rec = { ...STANDAARD, soort: "boek", boek: { titel: "De aanslag", auteur: "Harry Mulisch" } };
  const h = bannerHTML(rec, new Date("2026-09-07T10:00Z"));
  assert.match(h, /class="bnr-boek">De aanslag — Harry Mulisch</);
  // Bij soort cafe blijft dat blok weg, ook als er boekgegevens staan.
  assert.ok(!/bnr-boek/.test(bannerHTML({ ...rec, soort: "cafe" }, new Date("2026-09-07T10:00Z"))));
});

test("een afbeelding komt als klein icoon links van de titel", () => {
  const h = bannerHTML({ ...STANDAARD, afbeelding: "https://example.org/logo.png" }, new Date("2026-09-07T10:00Z"));
  assert.match(h, /<img class="bnr-afb" src="https:\/\/example\.org\/logo\.png"/);
});

test("de opmaak ontsnapt aan HTML in de tekstvelden", () => {
  const h = bannerHTML({ ...STANDAARD, titel: '<script>alert(1)</script>' }, new Date("2026-09-07T10:00Z"));
  assert.ok(!/<script>/.test(h), "geen ruwe HTML uit een tekstveld");
  assert.match(h, /&lt;script&gt;/);
});

test("onderschrift: de twee vaste teksten en een vrije tekst", () => {
  assert.equal(onderschriftTekst({ onderschrift: "open" }), ONDERSCHRIFTEN.open);
  assert.equal(onderschriftTekst({ onderschrift: "leden" }), "Alleen voor geregistreerde leden");
  assert.equal(onderschriftTekst({ onderschrift: "Eigen tekst" }), "Eigen tekst");
  assert.equal(onderschriftTekst({ onderschrift: "" }), "");
});

// --- validatie -------------------------------------------------------------

test("de startwaarde in banner.json is geldig en komt overeen met het schema", () => {
  const uit = valideer(STARTWAARDE);
  assert.ok(uit.ok, uit.fout);
  assert.equal(uit.record.aan, true);
  assert.equal(uit.record.soort, "cafe");
  assert.deepEqual(uit.record.wekelijks, { weekdag: 4, begin: "18:00", eind: "19:30" });
  assert.deepEqual(uit.record.overslaan, []);
  assert.equal(uit.record.kleur, "#2f6b3a");
  assert.equal(uit.record.onderschrift, "open");
  assert.equal(uit.record.knop.tekst, "ENTREZ");
  assert.match(uit.record.uitleg, /^Café Jeudi is een wekelijkse/);
});

test("validatie weigert wat niet klopt", () => {
  const slecht = [
    [null, "geen object"],
    [{}, "aan ontbreekt"],
    [{ aan: "ja" }, "aan is geen boolean"],
    [{ aan: true, soort: "film" }, "onbekende soort"],
    [{ aan: true, wekelijks: { weekdag: 9, begin: "18:00", eind: "19:30" } }, "weekdag buiten bereik"],
    [{ aan: true, wekelijks: { weekdag: 4, begin: "18u", eind: "19:30" } }, "tijd geen UU:MM"],
    [{ aan: true, wekelijks: { weekdag: 4, begin: "20:00", eind: "19:30" } }, "eind vóór begin"],
    [{ aan: true, overslaan: ["10-09-2026"] }, "datum verkeerd om"],
    [{ aan: true, overslaan: ["2026-02-30"] }, "datum bestaat niet"],
    [{ aan: true, kleur: "groen" }, "kleur geen hex"],
    [{ aan: true, knop: { url: "javascript:alert(1)" } }, "knop-URL geen http(s)"],
    [{ aan: true, afbeelding: "ftp://x/y.png" }, "afbeelding geen http(s)"],
  ];
  for (const [ruw, waarom] of slecht) {
    const uit = valideer(ruw);
    assert.equal(uit.ok, false, "had geweigerd moeten worden: " + waarom);
    assert.ok(uit.fout && uit.fout.length > 5, "met een leesbare reden: " + waarom);
  }
});

test("validatie vult standaardwaarden aan en gooit onbekende velden weg", () => {
  const uit = valideer({ aan: true, stiekem: "veld", titel: "" });
  assert.ok(uit.ok, uit.fout);
  assert.ok(!("stiekem" in uit.record), "onbekende velden komen er niet in");
  assert.equal(uit.record.titel, "Café Jeudi", "lege titel valt terug op de standaard");
  assert.equal(uit.record.kleur, "#2f6b3a");
  assert.deepEqual(uit.record.overslaan, []);
});

test("wekelijks mag expliciet null zijn", () => {
  const uit = valideer({ aan: true, wekelijks: null, datumtekst: "Eenmalig, 3 oktober" });
  assert.ok(uit.ok, uit.fout);
  assert.equal(uit.record.wekelijks, null);
  assert.equal(uit.record.datumtekst, "Eenmalig, 3 oktober");
});

test("de vier kleuren uit de beheerpagina zijn allemaal geldig", () => {
  assert.equal(KLEUREN.length, 4);
  for (const k of KLEUREN) {
    const uit = valideer({ aan: true, kleur: k });
    assert.ok(uit.ok, k + " hoort geldig te zijn");
  }
});

test("normaliseer vult een half record aan tot het hele schema", () => {
  const uit = normaliseer({ aan: true, titel: "Boekenclub" });
  for (const veld of Object.keys(STANDAARD)) assert.ok(veld in uit, "veld ontbreekt: " + veld);
  assert.equal(uit.titel, "Boekenclub");
  assert.equal(uit.knop.tekst, "ENTREZ");
  assert.deepEqual(uit.overslaan, []);
  // Ook een leeg of onzinnig record levert een bruikbaar schema.
  assert.deepEqual(Object.keys(normaliseer(null)).sort(), Object.keys(STANDAARD).sort());
});
