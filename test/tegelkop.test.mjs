// De kop van een tegel op /actueel: geen woord dat de lezer al weet.
// ---------------------------------------------------------------------------
// WAT ER WEG IS EN WAAROM. Boven elke tegelnaam stond de naam van het TABBLAD
// waar de lezer al op staat: boven elke overheidstegel "OVERHEID", boven elke
// nieuwstegel "NIEUWS", en zo verder. In kapitalen, pal boven de naam die je
// wél moet lezen. Vier tabbladen, dus vier keer hetzelfde woord op elk scherm.
//
// De valkuil bij het weghalen is de HOT-MARKERING. Die stond in dezelfde regel
// als de categorienaam; wie de regel in zijn geheel weggooit, gooit "Actueel"
// er ongemerkt bij weg. En wie de regel laat staan zonder inhoud, houdt een
// lege regel over die de kop scheef zet. Vandaar dat hier allebei de kanten
// vastliggen: het woord weg, de markering intact, en geen lege regel.
//
// De renderfunctie komt UIT actueel.html, net als in test/client-artikel.test.mjs
// en test/client-archieftegel.test.mjs — een kopie zou groen blijven terwijl de
// pagina anders rendert.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
const begin = html.indexOf("function bronHTML(b){");
const eind = html.indexOf("function leegHTML(){");
assert.ok(begin > 0 && eind > begin, "renderfuncties niet gevonden in actueel.html");
const bron = html.slice(begin, eind);

// De vier tabbladen zoals actueel.html ze zelf definieert. Uit de pagina lezen
// in plaats van overtypen: verandert daar een label, dan verandert deze test
// mee in plaats van langs de werkelijkheid heen te toetsen. Uitvoeren en niet
// als JSON parsen, want "NL'ers in FR" is geen JSON-vriendelijke tekst.
const catsBron = html.slice(html.indexOf("var CATS = ["), html.indexOf("var THEMA_IC"));
// eslint-disable-next-line no-new-func
const CATS = new Function(`${catsBron}; return CATS;`)();

function maakTegelHTML() {
  const esc = (x) =>
    String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  // eslint-disable-next-line no-new-func
  return new Function(
    "esc", "ico", "datum", "artOpen", "teksten", "tekstStatus",
    "archiefArtikelen", "archiefStatus", "open", "themaIco", "meerv", "CATS", "VERWIJS_KOP",
    `${bron}; return tegelHTML;`
  )(
    esc, (n) => `<svg data-ic="${n}"></svg>`, (d) => String(d || "").slice(0, 10), {}, null, "klaar",
    null, "niet-nodig", {}, () => "ic-thema", (n) => `${n} artikel${n === 1 ? "" : "en"}`, CATS, "Meer hierover"
  );
}

const tegel = (over = {}) => ({
  id: "overheid-douane",
  soort: "overheid",
  thema: "douane",
  label: "Douane",
  artikelen: [
    { id: "a1", soort: "overheid", titel: "Nieuwe drempel", summary: "De drempel gaat omhoog.",
      bronMeta: { naam: "Douane", datum: "2026-09-01" }, bronAantal: 1 },
  ],
  ...over,
});

// De kop van de tegel: alles vóór de body. Daar gaat het om — verderop in het
// artikel mag "Overheid" natuurlijk gewoon voorkomen.
const kopVan = (uit) => uit.slice(0, uit.indexOf('<div class="body">'));
// Alleen wat de LEZER ziet. De categorie zit ook in machinerie die moet blijven
// staan: de klasse `cat-overheid` stuurt de kleur, en `data-tegel` het
// openklappen. Zonder deze stap zou de test die twee aanzien voor het woord dat
// weg moest.
const zichtbaar = (kop) => kop.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

test("de tegelnaam staat er, de naam van het tabblad niet", () => {
  const tegelHTML = maakTegelHTML();
  const kop = kopVan(tegelHTML("overheid", tegel()));
  assert.ok(kop.includes("<h3>Douane</h3>"), "de tegelnaam hoort er wel te staan");
  assert.equal(zichtbaar(kop), "Douane 1 artikel", "meer dan dit hoort er niet te staan");
});

test("geen enkel tabblad zet zijn eigen naam boven de tegelnaam", () => {
  // Nieuws, Overheid, NL'ers in FR en Archief, alle vier langs dezelfde meetlat.
  const tegelHTML = maakTegelHTML();
  assert.equal(CATS.length, 4, "er horen vier tabbladen te zijn");
  for (const cat of CATS) {
    const kop = kopVan(tegelHTML(cat.key, tegel({ label: "Tegelnaam" })));
    assert.ok(kop.includes("<h3>Tegelnaam</h3>"), `${cat.key}: de tegelnaam ontbreekt`);
    assert.ok(
      !zichtbaar(kop).includes(cat.label),
      `${cat.key}: "${cat.label}" staat nog boven de tegelnaam — ${zichtbaar(kop)}`
    );
  }
});

test("de hot-markering blijft staan, en houdt zijn eigen regel", () => {
  const tegelHTML = maakTegelHTML();
  const kop = kopVan(tegelHTML("nieuws", tegel({ hot: true, label: "Landelijk" })));
  assert.ok(kop.includes("Actueel"), "de markering hoort te blijven");
  assert.ok(kop.includes("hotdot"), "met zijn stip");
  assert.ok(
    kop.indexOf("Actueel") < kop.indexOf("<h3>"),
    "en boven de tegelnaam, niet erachter"
  );
  assert.ok(kop.includes('class="catlabel"'), "in de regel die daarvoor bedoeld is");
});

test("zonder markering blijft er geen lege regel over", () => {
  // Een lege <span class="catlabel"> zou de kop scheef zetten: de koptekst is
  // een grid met een gat van 2px tussen de regels.
  const tegelHTML = maakTegelHTML();
  const kop = kopVan(tegelHTML("overheid", tegel()));
  assert.ok(!kop.includes("catlabel"), `lege regel blijft over: ${kop}`);
});

test("de telling en de chevron zijn ongemoeid gebleven", () => {
  const tegelHTML = maakTegelHTML();
  const kop = kopVan(tegelHTML("overheid", tegel()));
  assert.ok(kop.includes("1 artikel"), "de telling");
  assert.ok(kop.includes('aria-expanded="false"'), "de openklapstaat");
  assert.ok(kop.includes("ic-chevron"), "de chevron");
});
