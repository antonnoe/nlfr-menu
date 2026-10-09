// Het tabblad Evenementen: een vast, ingesloten DATAtourisme-venster met een
// Nederlandse uitleg erboven. Geen tegels, geen voorraad.
//
// Wat hier vastligt: het tabblad staat er altijd, op de plek tussen NL'ers in FR
// en Uitgelegd; het venster wijst naar de aanbieder en schaalt mee; de uitleg is
// Nederlands; de knop "Alles uitklappen" verdwijnt omdat er niets uit te klappen is.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
const blokTussen = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));

test("het tabblad staat er altijd, ook zonder verwijzingen", () => {
  const blok = blokTussen("function renderTabs", "function renderScroller");
  assert.match(blok, /var keys = \["nieuws","overheid","nlers","evenementen"\];/);
});

test("het venster wijst naar DATAtourisme en schaalt mee met het scherm", () => {
  assert.match(html, /var EVENEMENTEN_ADRES = "https:\/\/explore\.datatourisme\.fr\/embed\/[^"]+";/);
  const css = html.slice(html.indexOf(".evenementen .dtframe"), html.indexOf(".evenementen .dtframe") + 250);
  assert.match(css, /width:100%/, "de breedte schaalt mee");
  assert.doesNotMatch(css, /width:1024px/, "de vaste breedte van de aanbieder wordt niet overgenomen");
});

test("de uitleg erboven is Nederlands, noemt een plaats als voorbeeld en vraagt niet om een departementsnummer", () => {
  const blok = blokTussen("function evenementenHTML", "function leegHTML");
  assert.match(blok, /Typ in het zoekvenster de naam van uw plaats/);
  assert.ok(blok.includes("<strong>Bordeaux</strong>"), "een plaatsnaam als voorbeeld");
  // Aanleiding: "62" zoekt op bedrijfsnamen met 62 erin en is geen departementsfilter.
  assert.doesNotMatch(blok, /nummer van uw departement/, "de widget heeft geen departementsfilter");
  assert.match(blok, /Het venster is in het Frans/, "de lezer hoort te weten dat het Frans is");
  assert.match(blok, /Opent het niet\?/, "een uitweg als het venster niet laadt");
});

test("de Franse knoppen worden in het Nederlands uitgelegd", () => {
  const blok = blokTussen("function evenementenHTML", "function leegHTML");
  assert.match(blok, /<details class="evknoppen"><summary>Wat betekenen de Franse knoppen\?<\/summary>/);
  for (const knop of ["Réinitialiser", "Liste", "Carte", "Outils", "aucune image"]) {
    assert.ok(blok.includes(`<strong>${knop}</strong>`), `${knop} ontbreekt in de uitleg`);
  }
});

test("de tekst op dit tabblad is minstens 16 px", () => {
  const css = html.slice(html.indexOf(".evenementen p{"), html.indexOf(".evenementen p{") + 90);
  assert.match(css, /font-size:16px/);
});

test("het venster wordt alleen opgebouwd als het tabblad openstaat, en niet opnieuw bij elke verversing", () => {
  const blok = blokTussen("function renderScroller", "function render(){");
  assert.match(blok, /if \(actief === "evenementen"\)\s*\{\s*if \(!scrollerEl\.querySelector\("\.dtframe"\)\) scrollerEl\.innerHTML = evenementenHTML\(\);/);
});

test("Alles uitklappen verdwijnt ook op dit tabblad", () => {
  const blok = blokTussen("function render(){", "function renderStatus");
  assert.match(blok, /if \(allesBtn && actief === "evenementen"\) allesBtn\.hidden = true;/);
});

test("het hidden-attribuut verbergt de knop ook echt (zonder deze regel bleef hij staan)", () => {
  assert.match(html, /\.bar \.knop\[hidden\]\{\s*display:none;\s*\}/);
});
