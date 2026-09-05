// Lettergrootte van het uitgeklapte menu, en het afbreken dat daarbij hoort.
// ---------------------------------------------------------------------------
// WAAROM DEZE TEST BESTAAT. De doelgroep is 60-plus. De menu-items stonden op
// 13,5px, 84% van de standaard browsergrootte van 16px. WCAG kent geen minimum
// lettergrootte, dus dit is geen normovertreding maar een afweging: voor dit
// publiek weegt leesbaarheid zwaarder dan het aantal regels dat past.
//
// DE KOLOM KAN NIET MEE GROEIEN. Het menu draait op nederlanders.fr in een
// iframe van 955px. Daar moeten zes rastersporen passen, want de kolom Lezen
// staat er dubbel in; dat laat 134px per kolom over. Verbreden van de kolom
// betekent dus vijf sporen, en dan valt de indeling om. Die grens wordt in
// test/menu-lade.test.mjs bewaakt en is hier een gegeven.
//
// DUS BREKEN DE LANGE WOORDEN. In Chromium met het echte lettertype gemeten:
// "Ondernemersnieuws" is 155px op 15px en 140px op 13,5px, allebei breder dan
// die 134px. Het stak dus al buiten zijn kolom vóór deze wijziging; de grotere
// letter maakte een bestaand gebrek alleen zichtbaarder, en trok er nog drie
// labels bij.
//
// De afbreekpunten staan als zacht afbreekstreepje (\u00ad) in de labels zelf,
// op de samenstellingsgrens: "Ondernemers-nieuws", niet "Ondernemersnie-uws".
// Niet hyphens:auto, want dat leunt op een Nederlands afbreekwoordenboek dat
// niet in elke browser aanwezig is — in de Chromium waarin dit is nagemeten
// ontbreekt het, en dan breekt de tekst midden in een lettergreep af.
//
// Nagemeten bij 1600, 1200, 969, 955, 900 en 800px: geen van de 168 tekst-
// elementen in het paneel steekt nog buiten zijn kolom, en het paneel heeft
// nergens horizontale schuif. Wat deze test bewaakt is niet die meting maar de
// voorwaarden ervoor: de maten en de afbreekpunten. Wie eraan komt, moet
// opnieuw in een browser meten.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
const SCRIPT = HTML.slice(HTML.indexOf("<script"));

// De maten die in de browser zijn nagemeten.
const ITEM_PX = 15;
const KOP_PX = 12.5;
// Het langste stuk woord dat zonder afbreekpunt in 134px past, gemeten in
// Mulish op 15px. "Vakantie" (8) haalt 71px, "Ondernemers" (11) haalt 100px,
// "Telecommunicati" (15) haalt 145px en past dus niet meer.
const MAX_TEKENS_ZONDER_AFBREEKPUNT = 13;

function regelVan(selector) {
  const start = CSS.indexOf(selector + " {");
  assert.ok(start >= 0, `selector niet gevonden in index.html: ${selector}`);
  const eind = CSS.indexOf("}", start);
  assert.ok(eind > start, `geen sluitaccolade na ${selector}`);
  return CSS.slice(start, eind);
}

function pixels(selector, eigenschap) {
  const m = regelVan(selector).match(new RegExp(`(?:^|[;{\\s])${eigenschap}:\\s*([\\d.]+)px`));
  assert.ok(m, `geen ${eigenschap} in px voor ${selector}`);
  return parseFloat(m[1]);
}

test("menu-items staan op de nagemeten lettergrootte", () => {
  assert.equal(pixels(".grp a", "font-size"), ITEM_PX);
});

test("groepskoppen staan op de nagemeten lettergrootte", () => {
  assert.equal(pixels(".gk", "font-size"), KOP_PX);
});

test("de regelafstand groeit mee met de letter", () => {
  // 1,35 op 13,5px gaf 18px tussen regels. Diezelfde 1,35 op 15px geeft 20px,
  // relatief krapper. Nu items vaker over twee regels lopen, moet die afstand
  // juist ruimer: anders plakken de twee regels van één item aan elkaar vast
  // en zijn ze niet meer van twee losse items te onderscheiden.
  const m = regelVan(".grp a").match(/line-height:\s*([\d.]+)/);
  assert.ok(m, "geen line-height voor .grp a");
  assert.ok(parseFloat(m[1]) >= 1.4, `regelafstand ${m[1]} is krapper dan 1.4`);
});

test("er is een vangnet zodat tekst nooit de buurkolom in loopt", () => {
  // Voor een toekomstig label waar niemand een afbreekpunt in heeft gezet.
  // Lelijk afgebroken is nog altijd beter dan over de buurkolom heen.
  assert.match(regelVan(".grp a"), /overflow-wrap:\s*break-word/);
});

test("hyphens:auto wordt niet gebruikt, de afbreekpunten staan in de labels", () => {
  // Als dit ooit terugkomt, breekt het menu in browsers zonder Nederlands
  // afbreekwoordenboek midden in een lettergreep af. Dat zag er zo uit:
  // "Ondernemersnie-uws", "Vakantiewoninge-n".
  assert.doesNotMatch(regelVan(".grp a"), /hyphens:\s*auto/);
});

test("elk lang menulabel heeft een afbreekpunt op de samenstellingsgrens", () => {
  const zonder = [];
  for (const m of SCRIPT.matchAll(/\[\s*"([^"\\]*(?:\\u00ad[^"\\]*)*)"\s*,/g)) {
    for (const woord of m[1].split(/[\s ]+/)) {
      // Het langste stuk tussen twee afbreekpunten is wat werkelijk moet passen.
      const langste = Math.max(...woord.split("\\u00ad").map((d) => d.replace(/[^A-Za-zÀ-ÿ]/g, "").length));
      if (langste > MAX_TEKENS_ZONDER_AFBREEKPUNT) zonder.push(woord);
    }
  }
  assert.deepEqual(zonder, [],
    "menulabel met een ononderbroken stuk van meer dan " + MAX_TEKENS_ZONDER_AFBREEKPUNT +
    " tekens: zet er een \\u00ad in op de samenstellingsgrens, zoals " +
    '"Ondernemers\\u00adnieuws", en meet de kolom opnieuw na in een browser');
});

test("de afbreekpunten zitten in de labels en niet in de URLs", () => {
  // Dezelfde woorden staan achter ?tag= in de URLs. Een zacht afbreekstreepje
  // daarin maakt de link stuk, en dat is aan de buitenkant niet te zien.
  const stuk = [...SCRIPT.matchAll(/"(https?:[^"]*|\/[^"]*)"/g)]
    .map((m) => m[1]).filter((u) => u.includes("\\u00ad") || u.includes("\u00ad"));
  assert.deepEqual(stuk, [], "URL met een zacht afbreekstreepje erin");
});
