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
