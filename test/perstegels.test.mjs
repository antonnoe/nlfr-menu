// De indeling van perspublicaties over de tegels op /actueel.
//
// Aanleiding: NOS en NU.nl stonden al actief in bronnen.json met thema
// "nl-nieuws" en stroomden gewoon binnen — maar BRONTHEMA_NAAR_PERSTEGEL zette
// ze op "landelijk", waar ze tussen Le Monde en Le Figaro verdwenen. Voor een
// Nederlander in Frankrijk is "wat meldt Nederland" een andere vraag dan "wat
// meldt Frankrijk". Deze tests leggen die scheiding vast, inclusief het geval
// waarin een verhaal in beide media speelt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { persTegelVoor } from "../lib/tegels.js";
import { PERS_TEGELS, PERS_TEGEL_LABEL, BRONTHEMA_NAAR_PERSTEGEL } from "../lib/config.js";

// De kaart die persTegelVoor() normaal uit bronnen.json opbouwt.
const naamNaarThema = new Map([
  ["NOS — Buitenland", "nl-nieuws"],
  ["NU.nl — Algemeen", "nl-nieuws"],
  ["Le Monde — À la une", "landelijk-fr"],
  ["Le Figaro — Actualités", "landelijk-fr"],
  ["Sud Ouest", "regionaal-fr"],
]);

const pub = (kop, ...bronnen) => ({ kop, tekst: "", bronnen: bronnen.map((naam) => ({ naam })) });

test("een Nederlandse bron komt in de tegel Nederlands nieuws", () => {
  const p = pub("Nederlandse pensioenregels wijzigen voor wie in het buitenland woont", "NOS — Buitenland");
  assert.equal(persTegelVoor(p, naamNaarThema), "nl-nieuws");
});

test("twee Nederlandse bronnen ook", () => {
  const p = pub("Kamer stemt in met wijziging belastingverdrag", "NOS — Buitenland", "NU.nl — Algemeen");
  assert.equal(persTegelVoor(p, naamNaarThema), "nl-nieuws");
});

test("Franse bronnen blijven landelijk", () => {
  const p = pub("Begroting gepresenteerd in de Assemblée", "Le Monde — À la une", "Le Figaro — Actualités");
  assert.equal(persTegelVoor(p, naamNaarThema), "landelijk");
});

// De stemming is het hele punt van de fallback: een cluster kiest de tegel waar
// de MEESTE van zijn bronnen naar wijzen. Een verhaal dat NOS én twee Franse
// kranten haalt is Frans nieuws waarover Nederland ook bericht.
test("een gemengd cluster volgt de meerderheid, niet de eerste bron", () => {
  const frans = pub("Staking bij de SNCF legt treinverkeer plat",
    "NOS — Buitenland", "Le Monde — À la une", "Le Figaro — Actualités");
  // Let op: "trein" is een verkeerswoord, dus die zeef wint terecht.
  assert.equal(persTegelVoor(frans, naamNaarThema), "verkeer");

  const politiek = pub("Nieuwe regering beëdigd in Parijs",
    "NOS — Buitenland", "Le Monde — À la une", "Le Figaro — Actualités");
  assert.equal(persTegelVoor(politiek, naamNaarThema), "landelijk");
});

test("de bosbrand- en verkeerszeef gaan vóór de herkomst van de bron", () => {
  const brand = pub("Bosbrand bij Béziers onder controle", "NOS — Buitenland");
  assert.equal(persTegelVoor(brand, naamNaarThema), "bosbranden");
});

test("elke perstegel heeft een label en een pictogram", () => {
  const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
  const kaart = html.slice(html.indexOf("var THEMA_IC"), html.indexOf("var laatste"));
  for (const tegel of PERS_TEGELS) {
    assert.ok(PERS_TEGEL_LABEL[tegel], `geen label voor ${tegel}`);
    assert.ok(kaart.includes(`${tegel}:"ic-`) || kaart.includes(`"${tegel}":"ic-`),
      `geen pictogram voor ${tegel} in actueel.html`);
  }
});

test("elk brontthema wijst naar een bestaande tegel", () => {
  for (const [brontThema, tegel] of Object.entries(BRONTHEMA_NAAR_PERSTEGEL)) {
    assert.ok(PERS_TEGELS.includes(tegel), `${brontThema} wijst naar onbekende tegel ${tegel}`);
  }
});

// --- woorden met een tweede betekenis ----------------------------------------
// Aanleiding: een bericht over een inbraakpoging bij een 97-jarige zanger
// stond in "Verkeer & reizen". De zeef zocht losse tekenreeksen midden in
// woorden en nam bij "vlucht" en "spoor" de overdrachtelijke betekenis mee.

// Anders dan pub() draagt deze ook de berichttekst; de zeef kijkt naar kop + tekst.
const pubT = (kop, tekst, ...bronnen) => ({ kop, tekst, bronnen: bronnen.map((naam) => ({ naam })) });
const LM = "Le Monde — À la une";

test("een inbraak is geen verkeersbericht, ook niet bij 'op de vlucht' en 'sporen'", () => {
  const p = pubT("Zanger (97) verstoort inbraakpoging in zijn woning",
    "De inbrekers sloegen op de vlucht en lieten sporen van braak achter. De politie profileert de daders.", LM);
  assert.equal(persTegelVoor(p, naamNaarThema), "landelijk");
});

test("'verkeerd' is geen 'verkeer'", () => {
  const p = pubT("Een verkeerde indruk", "Het bericht gaf een verkeerde voorstelling van zaken.", LM);
  assert.equal(persTegelVoor(p, naamNaarThema), "landelijk");
});

test("echt verkeer blijft verkeer: files met context, treinstaking, vluchten met passagiers", () => {
  assert.equal(persTegelVoor(pubT("Files op de autosnelweg", "Lange files voor automobilisten richting het zuiden.", LM), naamNaarThema), "verkeer");
  assert.equal(persTegelVoor(pubT("Treinstaking", "De treinstaking treft duizenden reizigers.", LM), naamNaarThema), "verkeer");
  assert.equal(persTegelVoor(pubT("Vluchten geschrapt", "Meerdere vluchten werden geschrapt, passagiers wachten op het vliegveld.", LM), naamNaarThema), "verkeer");
});

test("een keukenbrand met brandweer is geen bosbrand, een brand met hectares wel", () => {
  assert.equal(persTegelVoor(pubT("Keukenbrand in Lyon", "De brandweer doofde de vlammen snel.", LM), naamNaarThema), "landelijk");
  assert.equal(persTegelVoor(pubT("Brand bij Marseille", "De brandweer bestrijdt de vlammen, al 300 hectare is verwoest.", LM), naamNaarThema), "bosbranden");
});

// --- regionaal vraagt een plaats ----------------------------------------------
// Aanleiding: vier landelijke berichten (Banque de France, droogtesteun,
// prestatiedruk bij jongeren, staking bij TotalEnergies) stonden in "Regionaal
// nieuws", omdat alleen regionale kranten ze meldden.
const SO = "Sud Ouest";

test("landelijk nieuws uit een regionale krant blijft landelijk", () => {
  for (const [kop, tekst] of [
    ["Gouverneur Banque de France weerspreekt Mélenchon", "De gouverneur heeft gereageerd op aanvallen van de leider van La France insoumise."],
    ["Nieuwe steun voor boeren na droogte", "De Franse regering kondigt extra steunmaatregelen aan voor landbouwers."],
    ["Prestatiedruk weegt zwaar op Franse jongeren", "Franse media besteden aandacht aan een studie over de mentale gezondheid van jongeren."],
    ["Stakingsoproep bij TotalEnergies op donderdag", "De vakbond CGT roept het personeel op om in heel Frankrijk het werk neer te leggen."],
  ]) {
    assert.equal(persTegelVoor(pubT(kop, tekst, SO), naamNaarThema), "landelijk", kop);
  }
});

test("een bericht met een plaats uit de regio staat wel onder regionaal", () => {
  assert.equal(persTegelVoor(pubT("Overstroming bij Toulouse", "Na zware regen staan straten onder water in Toulouse.", SO), naamNaarThema), "regionaal");
  assert.equal(persTegelVoor(pubT("Markt in het dorp", "De burgemeester opent de nieuwe markt.", SO), naamNaarThema), "regionaal");
});

test("korte plaatsnamen tellen alleen als heel woord", () => {
  assert.equal(persTegelVoor(pubT("De agenda van de vakbond", "Varkensvlees en een pauze in de onderhandelingen.", SO), naamNaarThema), "landelijk");
  assert.equal(persTegelVoor(pubT("Brand in Pau", "Een brand in Pau trekt aandacht.", SO), naamNaarThema), "regionaal");
});

// --- contextwoorden mogen niet zelf dubbelzinnig zijn (review PR #54) ----------
test("een evacuatie of een bestemming maakt van een misdrijf of woningbrand geen verkeer of bosbrand", () => {
  assert.equal(persTegelVoor(pubT("Verdachte op de vlucht", "De verdachte is op de vlucht; zijn bestemming is onbekend.", LM), naamNaarThema), "landelijk");
  assert.equal(persTegelVoor(pubT("Flatbrand in Lille", "De brandweer evacueerde de bewoners van de flat.", LM), naamNaarThema), "landelijk");
});

test("gewone woorden die met een contextwoord beginnen, tellen niet mee", () => {
  // "natuurlijk", "wegens", "politiestation" begonnen met of bevatten een eerder contextwoord.
  assert.equal(persTegelVoor(pubT("Brand bij een garage", "De brandweer kon het vuur natuurlijk snel doven.", LM), naamNaarThema), "landelijk");
  assert.equal(persTegelVoor(pubT("Spoor van braak", "Wegens sporen van braak sloot de politie het politiestation.", LM), naamNaarThema), "landelijk");
});
