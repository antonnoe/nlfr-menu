// De hoogte die /actueel aan de moederpagina meldt.
//
// WAAROM DEZE TEST BESTAAT. Onder de tegels stond op nederlanders.fr een lap
// lege ruimte. Oorzaak: natuur() telde scrollerEl.scrollHeight mee. De scroller
// vult de 1fr-rij van een paneel dat op height:100% staat, dus scrollHeight is
// nooit kleiner dan de scroller zelf al is. Met dichte tegels meldde de pagina
// daardoor zo ongeveer de vensterhoogte en groeide het iframe door tot cap().
//
// De functies worden UIT actueel.html gehaald en daar uitgevoerd, niet
// overgeschreven: een test op een kopie zou groen blijven terwijl de pagina
// stuk is.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");

const begin = html.indexOf("  function inhoudHoogte(){");
const eind = html.indexOf("  function meldHoogte(){");
assert.ok(begin > 0 && eind > begin, "inhoudHoogte/natuur niet gevonden in actueel.html");
const bron = html.slice(begin, eind);

// Een scroller met `aantal` kinderen van `tegelHoogte` px, in een paneel met
// min-height 420. De maten komen uit de CSS van actueel.html: padding 20,
// gap 12 (>= 600px breed).
function maakPagina({ aantal, tegelHoogte, barH = 56, tabsH = 60, statusH = 40, minPaneel = 420 }) {
  const kind = (h) => ({ getBoundingClientRect: () => ({ height: h }), offsetHeight: h });
  const scrollerEl = {
    children: Array.from({ length: aantal }, () => kind(tegelHoogte)),
    // Zoals de echte scroller: nooit kleiner dan zijn eigen venster. Dit is
    // precies de waarde waar de oude natuur() op leunde.
    scrollHeight: Math.max(aantal * tegelHoogte + 40 + 12 * (aantal - 1), 900),
  };
  const tabsEl = { offsetHeight: tabsH };
  const statusEl = { offsetHeight: statusH };
  const document = {
    querySelector: (sel) =>
      sel === ".bar" ? { offsetHeight: barH } :
      sel === ".panel" ? { _min: minPaneel } : null,
  };
  const window = {
    getComputedStyle: (el) =>
      el === scrollerEl ? { paddingTop: "20px", paddingBottom: "20px", rowGap: "12px", gap: "12px" }
                        : { minHeight: (el && el._min ? el._min : 0) + "px" },
  };
  const fn = new Function("scrollerEl", "tabsEl", "statusEl", "document", "window",
    bron + "\nreturn { inhoudHoogte, natuur };");
  return fn(scrollerEl, tabsEl, statusEl, document, window);
}

// De cap() uit actueel.html, met de vensterhoogte die de moederpagina doorgeeft.
const cap = (parentVenster) => Math.max(420, parentVenster);
const gemeld = (natuur, parentVenster) => Math.round(Math.min(natuur, cap(parentVenster)) / 8) * 8;

test("dichte tegels: de gemelde hoogte blijft ruim onder de cap", () => {
  // 8 dichte tegels van 62px is een normale feed.
  const { natuur } = maakPagina({ aantal: 8, tegelHoogte: 62 });
  const h = gemeld(natuur(), 1200);
  assert.ok(h < 900, "met dichte tegels hoort de gemelde hoogte < 900px te zijn, was " + h);
  // En hij hoort ook echt ergens op te slaan: bar + tabs + tegels + voet.
  // 56 + 60 + 40 + 4 = 160 vast, tegels 8*62 + 2*20 padding + 7*12 gap = 620.
  assert.equal(natuur(), 160 + 620);
});

test("de oude meting zou hier wél tegen de cap aan lopen", () => {
  // Het bewijs dat de test iets bewaakt: met scrollHeight (>= 900) erbij komt
  // de melding op de cap uit en krijg je de lege ruimte terug.
  const { natuur } = maakPagina({ aantal: 8, tegelHoogte: 62 });
  const oud = 160 + 900;                     // zoals natuur() vóór de correctie
  assert.ok(gemeld(oud, 1200) >= 1000, "de oude meting liep tegen de cap");
  assert.ok(natuur() < oud, "de nieuwe meting is korter");
});

test("weinig tegels: het paneel wordt niet korter dan zijn min-height", () => {
  const { natuur } = maakPagina({ aantal: 1, tegelHoogte: 62 });
  assert.equal(natuur(), 424, "min-height 420 + 4, anders knip je de onderkant af");
});

test("opengeklapte artikelen laten de hoogte gewoon meegroeien, tot de cap", () => {
  const dicht = maakPagina({ aantal: 8, tegelHoogte: 62 }).natuur();
  const open = maakPagina({ aantal: 8, tegelHoogte: 62, }).natuur();
  assert.equal(dicht, open);

  // Eén tegel opengeklapt (1200px inhoud) tilt de hoogte omhoog...
  const eenOpen = maakPagina({ aantal: 8, tegelHoogte: 62 });
  const groot = maakPagina({ aantal: 2, tegelHoogte: 900 });
  assert.ok(groot.natuur() > eenOpen.natuur(), "meer inhoud is meer hoogte");
  // ...en wordt daarboven afgetopt op de cap, waarna de scroller intern scrollt.
  assert.equal(gemeld(groot.natuur(), 1200), 1200);
});

test("een lege scroller levert alleen de vaste onderdelen, met de min-height", () => {
  const { inhoudHoogte, natuur } = maakPagina({ aantal: 0, tegelHoogte: 0 });
  assert.equal(inhoudHoogte(), 0);
  assert.equal(natuur(), 424);
});

test("natuur() leunt niet meer op scrollHeight", () => {
  assert.ok(!/scrollerEl\.scrollHeight/.test(bron),
    "scrollHeight hoort niet meer in de hoogtemeting te zitten");
  assert.ok(/getBoundingClientRect|offsetHeight/.test(bron), "de kinderen worden gemeten");
});

test("de vervaag-rand en de interne scroll blijven op scrollHeight leunen", () => {
  // Die twee gaan juist WEL over de scrollcontainer: is er meer inhoud dan
  // zichtbaar, dan moet de rand aan en moet er gescrold kunnen worden.
  assert.match(html, /scrollerEl\.scrollHeight - scrollerEl\.clientHeight/,
    "werkVervaagBij() hoort ongewijzigd te blijven");
  assert.match(html, /\.scroller\{[^}]*overflow-y:auto/, "de scroller scrollt nog steeds intern");
});
