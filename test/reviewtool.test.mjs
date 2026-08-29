// De reviewtool zelf: bedienbaarheid en de gevaarlijke knop.
// ---------------------------------------------------------------------------
// Deze tool wordt op een TELEFOON gebruikt, en niet altijd door dezelfde
// persoon. Twee dingen die daarom niet mogen verslonzen:
//
//   1. TIKDOELEN. Elke knopstijl houdt minstens 44 px aan. Dat is geen
//      willekeurig getal maar de maat die de rest van de tool al hanteert;
//      bij het bouwen van de Infofrankrijk-knoppen was hij drie keer
//      vergeten, en dat zag je op het scherm niet.
//   2. DE ONOMKEERBARE KNOP. "Wachtrij persconcepten wissen" gooit de hele
//      conceptenwachtrij weg. Die hoort niet naast de knoppen te staan die je
//      de hele dag gebruikt; hij zit achter een laatje dat je bewust opent.
//      Bewust GEEN <details>: of dat inklapt hangt af van de browserstijl.
//      Hier doet het `hidden`-attribuut het werk, en dat is toetsbaar.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");
const stijl = review.slice(review.indexOf("<style>"), review.indexOf("</style>"));

test("elke knopstijl houdt minstens 44 px aan", () => {
  // Alle min-height-waarden in de stylesheet die op een knop slaan.
  const regels = stijl.split("\n").filter((r) => /min-height:\s*\d+px/.test(r));
  assert.ok(regels.length >= 5, `verwacht meerdere knopstijlen, gevonden ${regels.length}`);
  for (const regel of regels) {
    const m = regel.match(/min-height:\s*(\d+)px/);
    assert.ok(
      Number(m[1]) >= 44,
      `tikdoel te klein (${m[1]}px): ${regel.trim().slice(0, 90)}`
    );
  }
});

test("de wisknop zit in het laatje en dat laatje begint dicht", () => {
  const lade = review.match(/<div class="opruimlade" id="opruimLade" hidden>[\s\S]*?<\/div>'/);
  assert.ok(lade, "het opruimlaatje ontbreekt of begint niet met hidden");
  assert.ok(lade[0].includes('id="wisAlles"'), "de wisknop hoort in het laatje te staan");
  // En de CSS moet `hidden` ook echt honoreren, want .opruimlade zet display.
  assert.match(stijl, /\.opruimlade\[hidden\]\s*\{\s*display:\s*none/);
});

test("de knop die het laatje opent, zegt met aria wat hij doet", () => {
  assert.match(review, /id="opruimToggle" aria-expanded="false" aria-controls="opruimLade"/);
  assert.match(review, /setAttribute\("aria-expanded"/);
});

test("de tool draagt geen belofte meer die de code niet waarmaakt", async () => {
  const { CONCEPT_TTL_S } = await import("../lib/config.js");
  const uren = CONCEPT_TTL_S / 3600;
  assert.match(
    review,
    new RegExp(`verlopen na ${uren} uur`),
    `de ondertitel noemt niet ${uren} uur, terwijl CONCEPT_TTL_S dat wel is`
  );
});
