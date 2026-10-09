// De knop "Alles uitklappen" moet echt verdwijnen als de code hem verbergt.
//
// Aanleiding: op het tabblad Uitgelegd zet de code allesBtn.hidden op true, maar
// .bar .knop heeft zelf een display en won daarvan: de knop bleef staan terwijl er
// niets uit te klappen is. Een knop die niets doet is erger dan geen knop.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../actueel.html", import.meta.url), "utf8");

test("het hidden-attribuut verbergt de knoppen in de balk ook echt", () => {
  assert.match(html, /\.bar \.knop\[hidden\]\{\s*display:none;\s*\}/);
});

test("de regel is specifieker dan die de knop zichtbaar maakt", () => {
  // .bar .knop heeft specificiteit (0,2,0); .bar .knop[hidden] (0,3,0) wint daarvan,
  // ongeacht de volgorde in het bestand. Een kale .knop[hidden] (0,2,0) verloor, omdat
  // .bar .knop later in het bestand staat.
  assert.match(html, /\.bar \.knop\{ display:inline-flex;/, "de regel die de knop zichtbaar maakt bestaat nog");
  assert.doesNotMatch(html, /(^|\n)\s*\.knop\[hidden\]/, "geen kale .knop[hidden]: die verliest van .bar .knop");
});
