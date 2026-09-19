// Twee dingen die op een telefoon te veel ruimte namen, of te dicht bij de duim.
// ---------------------------------------------------------------------------
// 1. DE BRONNENREGEL op /actueel. Zeventien bronnen achter elkaar vullen op een
//    telefoon ongeveer de halve schermhoogte, pal onder de lijst die de lezer
//    juist wil zien. Op mobiel staat er nu één knop; op een breed scherm blijft
//    de regel zoals hij was.
//
// 2. UITLOGGEN op /review. Hier stond ooit "Token vergeten", pal boven de
//    inhoud, één duimbreedte van de knoppen die de redactie de hele dag
//    gebruikt; twee keer per ongeluk aangeraakt en de toegang was weg. Sinds de
//    login op Supabase draait, zit uitloggen in de apparaatlade, en die lade
//    staat DICHT. Eén klik om hem te openen is precies de rem die de knop
//    nodig heeft — en de prijs van een misklik is bovendien veel lager
//    geworden: opnieuw inloggen kost een vingerafdruk, geen opgezocht token.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actueel = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");
const actueelStijl = actueel.slice(actueel.indexOf("<style>"), actueel.indexOf("</style>"));
const reviewStijl = review.slice(review.indexOf("<style>"), review.indexOf("</style>"));

// ---- 1. De bronnenregel -----------------------------------------------------

const esc = (x) =>
  String(x == null ? "" : x)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// renderStatus draait tegen een minimale DOM: het gaat om de markup die eruit
// komt, en die is precies wat de mediaquery hieronder in- en uitklapt.
const RS_BEGIN = actueel.indexOf("var statusOpen = false;");
const RS_EIND = actueel.indexOf("// ---- Scroll-zichtbaarheid");
assert.ok(RS_BEGIN > 0 && RS_EIND > RS_BEGIN, "renderStatus niet gevonden in actueel.html");

// Geeft de markup terug die renderStatus in de statusregel zet.
function render(lijst, beginInhoud = "") {
  const el = { innerHTML: beginInhoud };
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "statusEl", "esc", "ico", "document", "meldHoogte",
    `${actueel.slice(RS_BEGIN, RS_EIND)}; return renderStatus;`
  )(el, esc, (n, c) => `<svg data-ic="${n}" class="${c || ""}"></svg>`, { getElementById: () => null }, () => {});
  fn(lijst);
  return el.innerHTML;
}

const bronnen = Array.from({ length: 17 }, (_, i) => ({ naam: `Bron ${i + 1}`, aantal: i, ok: true }));

test("de bronnenregel krijgt een knop met het aantal erin", () => {
  const uit = render(bronnen);
  assert.match(uit, /class="statusknop"/);
  assert.match(uit, /Bronnen \(17\)/, "het aantal hoort op de knop te staan");
  assert.match(uit, /aria-expanded="false"/, "standaard ingeklapt");
  assert.match(uit, /aria-controls="bronnenlijst"/, "en gekoppeld aan wat hij opent");
});

test("alle zeventien bronnen staan er nog, alleen verborgen", () => {
  const uit = render(bronnen);
  for (const b of bronnen) assert.ok(uit.includes(b.naam), `${b.naam} ontbreekt`);
  assert.match(uit, /class="bronnenlijst"/, "in een blok dat de mediaquery kan verbergen");
});

test("een lege bronlijst levert een lege regel op, geen knop met nul erin", () => {
  assert.equal(render([], "vorige inhoud"), "");
});

test("het inklappen gebeurt in CSS op de breedte, niet met een meting in JavaScript", () => {
  // Een gemeten breedte klopt niet meer zodra het venster draait of het paneel
  // in het iframe van hoogte verandert. De mediaquery volgt de werkelijke
  // breedte, altijd.
  assert.match(actueelStijl, /@media \(max-width:599\.98px\)\{[\s\S]*?\.status \.statusknop\{ display:inline-flex; \}/);
  assert.match(actueelStijl, /\.status \.statusknop\{ display:none;/, "op breed scherm staat de knop er niet");
  assert.doesNotMatch(
    actueel.slice(RS_BEGIN, RS_EIND),
    /innerWidth|matchMedia|clientWidth/,
    "geen breedtemeting in JavaScript"
  );
});

test("de grens is dezelfde 600px die de tabs en de scroller al gebruiken", () => {
  assert.match(actueelStijl, /@media \(min-width:600px\)\{ \.tab\{/, "de bestaande grens");
  assert.match(actueelStijl, /@media \(max-width:599\.98px\)\{/, "en de bronnenregel sluit erop aan");
});

test("uitklappen meldt de nieuwe hoogte aan de omhullende pagina", () => {
  // Het paneel staat in een iframe met hoogte-synchronisatie; zonder deze
  // melding valt de uitgeklapte lijst achter de rand.
  assert.match(actueel.slice(RS_BEGIN, RS_EIND), /meldHoogte\(\);/);
});

// ---- 2. "Token vergeten" ----------------------------------------------------

test("de apparaatbalk staat boven de inhoud, de lade eronder en dicht", () => {
  const balk = review.indexOf('<div class="apparaatbalk"');
  const lade = review.indexOf('<div class="apparaatlade"');
  const inhoud = review.indexOf('<div id="inhoud"');
  assert.ok(balk > -1 && lade > balk, "de lade hoort bij de balk");
  assert.ok(lade < inhoud, "allebei boven de inhoud: uitloggen moet je zonder scrollen vinden");
  // DICHT. Dat is de rem: de knop die je toegang opheft, kost eerst een klik om
  // hem zichtbaar te maken.
  const ladeTag = review.slice(lade, review.indexOf(">", lade) + 1);
  assert.match(ladeTag, /hidden/, "de apparaatlade hoort dicht te beginnen");
});

test("uitloggen zit in de lade, niet los boven de inhoud", () => {
  const lade = review.indexOf('<div class="apparaatlade"');
  const inhoud = review.indexOf('<div id="inhoud"');
  const knop = review.indexOf('id="uitlogknop"');
  assert.ok(knop > lade && knop < inhoud, "de uitlogknop staat binnen de apparaatlade");
  // De balk zelf draagt hem niet: die is altijd zichtbaar.
  const balk = review.slice(review.indexOf('<div class="apparaatbalk"'), lade);
  assert.doesNotMatch(balk, /uitlogknop/, "de altijd zichtbare balk draagt de uitlogknop niet");
});

test("de voettekst houdt afstand van de laatste kaart", () => {
  // De ruimte erboven is wat hem onbereikbaar maakt voor een duim die op de
  // laatste kaart mikt.
  const regel = reviewStijl.split("\n").find((r) => r.includes(".voet {"));
  assert.ok(regel, ".voet niet gevonden in de stylesheet");
  const m = regel.match(/margin-top:(\d+)px/);
  assert.ok(m && Number(m[1]) >= 32, `te weinig ruimte boven de voettekst: ${regel.trim()}`);
});

test("het scherm gaat pas open als de server de sessie heeft goedgekeurd", () => {
  const blok = review.slice(review.indexOf("function laad(behoudMelding){"), review.indexOf("zetVerborgen(apparaatBalkEl, true);"));
  assert.match(blok, /zetVerborgen\(apparaatBalkEl, false\);/, "de balk verschijnt pas na een geslaagde GET");
  assert.match(blok, /tabsEl\.hidden = false/, "en de tabbladen ook");
  // En het begint dicht.
  assert.match(review, /zetVerborgen\(apparaatBalkEl, true\);/);
});

test("de knoppen houden hun tikdoel van 44 px", () => {
  for (const kiezer of [".uitlogknop {", ".apparaatknop {", ".apparaatlade .weg {"]) {
    const regel = reviewStijl.split("\n").find((r) => r.includes(kiezer));
    assert.ok(regel, `${kiezer} niet gevonden in de stylesheet`);
    assert.match(regel, /min-height:44px/, `${kiezer} mist het tikdoel`);
  }
});
