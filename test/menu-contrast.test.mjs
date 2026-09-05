// Leesbaarheid van het uitgeklapte menu: contrast en rangschikking.
// ---------------------------------------------------------------------------
// WAAROM DEZE TEST BESTAAT. De doelgroep van dit menu is 60-plus. Het paneel
// was één ononderscheiden vlak: de groepskoppen stonden op #a99e9a — 2,53:1 op
// de paneelachtergrond, ver onder de 4,5:1 die WCAG AA voor gewone tekst vraagt
// en in de praktijk gewoon niet te lezen. De items eronder stonden op een warm
// grijsbruin dat op die warme achtergrond roodachtig oogt, waardoor kop en item
// nauwelijks van elkaar verschilden.
//
// Kleur schuift ongemerkt: één "iets zachter" van iemand die het mooier vindt,
// en de koppen zijn weer weg. Daarom wordt de verhouding hier gerekend en niet
// de hex vergeleken — een andere kleur mag, te weinig contrast niet.
//
// De formule is die van WCAG 2.x (relatieve luminantie), niet een benadering.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

// ---- WCAG-contrast ---------------------------------------------------------
function kanaal(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminantie(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * kanaal(r) + 0.7152 * kanaal(g) + 0.0722 * kanaal(b);
}
function contrast(voor, achter) {
  const [hoog, laag] = [luminantie(voor), luminantie(achter)].sort((a, b) => b - a);
  return (hoog + 0.05) / (laag + 0.05);
}

test("de contrastformule klopt met de bekende ijkpunten uit WCAG", () => {
  // Zwart op wit is per definitie 21:1, wit op wit 1:1. Zonder deze twee is de
  // rest van dit bestand een rekensom die niemand heeft nagekeken.
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(Math.round(contrast("#ffffff", "#ffffff")), 1);
  // Een middengrijs waarvan de waarde in de WCAG-documentatie staat.
  assert.ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.02);
});

// ---- De kleuren uit index.html zelf lezen ----------------------------------
// Uit de echte stylesheet, niet overgetypt: een test op een kopie blijft groen
// terwijl het menu verandert.
const VARIABELEN = { "--brand": "#800000", "--brand-dark": "#5c0f0f", "--actueel": "#2f6b3a" };

function kleurVan(selector) {
  // De regel begint bij de selector en loopt tot de sluitaccolade.
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, `selector niet gevonden in index.html: ${selector}`);
  const eind = css.indexOf("}", start);
  assert.ok(eind > start, `geen sluitaccolade na ${selector}`);
  const regel = css.slice(start, eind);
  const m = regel.match(/(?:^|[;{\s])color:\s*([^;]+)/);
  assert.ok(m, `geen color in de regel voor ${selector}: ${regel.slice(0, 120)}`);
  const waarde = m[1].trim();
  const varMatch = waarde.match(/var\((--[\w-]+)\)/);
  const hex = varMatch ? VARIABELEN[varMatch[1]] : waarde;
  assert.ok(/^#[0-9a-f]{3,6}$/i.test(hex), `onverwachte kleurwaarde bij ${selector}: ${waarde}`);
  return hex;
}

const PANEEL = "#fdfbfa"; // .paneel
const KAART = "#ffffff";  // .ladekaart

test("de achtergronden waar tegen gemeten wordt, staan er ook echt zo", () => {
  // Anders rekent alles hieronder tegen een achtergrond die niet bestaat.
  assert.match(css, /\.paneel \{[^}]*background: #fdfbfa/);
  assert.match(css, /\.ladekaart \{[^}]*background: #fff\b/);
});

const EIS = 4.5; // WCAG AA, gewone tekst

for (const [naam, selector, achter] of [
  ["menu-items", ".grp a", PANEEL],
  ["groepskoppen", ".gk", PANEEL],
  ["ondertitels onder de kolomkop", ".deurkop .ds", PANEEL],
  ["kolomkoppen", ".deurkop .dn", PANEEL],
  ["koppen in de laden", ".lade .h", KAART],
  ["links in de laden", ".lade .ladekaart > a", KAART],
  ["lege lade", ".lade .leeg", KAART],
  ["uitleg bij Plaats bericht", ".plaatskolom p", KAART],
]) {
  test(`${naam} halen WCAG AA (${EIS}:1)`, () => {
    const kleur = kleurVan(selector);
    const r = contrast(kleur, achter);
    assert.ok(r >= EIS, `${selector} staat op ${kleur}: ${r.toFixed(2)}:1, onder de eis van ${EIS}:1`);
  });
}

test("de groepskoppen staan in het bordeaux van de huisstijl", () => {
  // Punt 2 van de opdracht, en HUISSTIJL.md: koppen in #800000. Contrast alleen
  // is niet genoeg — zwarte koppen zouden ook slagen, maar dan is het onderscheid
  // tussen kop en item weg en begint het probleem opnieuw.
  assert.equal(kleurVan(".gk"), "#800000");
});

test("menu-items staan in donkergrijs of zwart, niet in een roodtint", () => {
  // Punt 1 van de opdracht, en het is de kleur waar de klacht over ging.
  // Twee eisen, want contrast alleen laat de oude kleur er gewoon weer in:
  // #5b524f haalt 7,36:1 en zou op een enkele AA-toets slagen, terwijl het juist
  // dát warme grijsbruin was dat op de warme achtergrond roodachtig oogde.
  const hex = kleurVan(".grp a").replace("#", "");
  const [r, g, b] = hex.length === 3
    ? hex.split("").map((c) => parseInt(c + c, 16))
    : [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

  // 1. NEUTRAAL: rood, groen en blauw liggen dicht bij elkaar. Bij #5b524f is
  //    dat verschil 12 (R91 G82 B79) en zie je de warme tint; bij een echte
  //    grijstint is het 0. Zes laat een nuance toe zonder een kleur door te
  //    laten die als tint herkenbaar is.
  const spreiding = Math.max(r, g, b) - Math.min(r, g, b);
  assert.ok(spreiding <= 6, `#${hex} is niet neutraal genoeg: R${r} G${g} B${b}, spreiding ${spreiding}`);

  // 2. DONKER: minstens 10:1 op de paneelachtergrond. "Donkergrijs of zwart",
  //    niet een middengrijs dat de AA-drempel net haalt.
  const r10 = contrast(`#${hex}`, PANEEL);
  assert.ok(r10 >= 10, `#${hex} is met ${r10.toFixed(2)}:1 niet donker genoeg voor deze doelgroep`);
});

test("tussen groepen staat meer wit dan tussen regels", () => {
  // Punt 4. Veertien groepen lopen als één lijst in elkaar over zolang de
  // ruimte tussen groepen niet duidelijk groter is dan die tussen items.
  const grp = css.slice(css.indexOf(".grp {"), css.indexOf("}", css.indexOf(".grp {")));
  const groepMarge = Number(grp.match(/margin-bottom:\s*(\d+)px/)[1]);
  const item = css.slice(css.indexOf(".grp a {"), css.indexOf("}", css.indexOf(".grp a {")));
  const itemPadding = Number(item.match(/padding:\s*(\d+)px/)[1]);
  const regelafstand = itemPadding * 2; // boven + onder, tussen twee items
  assert.ok(groepMarge >= regelafstand * 2,
    `groepen staan ${groepMarge}px uit elkaar, regels ${regelafstand}px — dat verschil ziet niemand`);
});

test("op mobiel scheiden lijnen de groepen, niet marges", () => {
  // Daar is de groep een accordeonrij; een marge zou de lijnen laten zweven.
  // Deze toets voorkomt dat iemand de desktopmarge "voor de consistentie"
  // ook op compact zet.
  assert.match(css, /html\.compact \.grp \{[^}]*margin-bottom: 0/);
  assert.match(css, /html\.compact \.grp \{[^}]*border-top: 1px solid/);
});
