// De laden onder de knoppen, en de kolom Lezen (correcties 04-09-2026).
//
// TWEE DINGEN DIE HIER MISGAAN ALS NIEMAND OPLET.
// 1. De laden van "Plaats bericht" en "Nu actueel" hingen als een volle-breedte
//    balk onder de strip in plaats van als kaart onder hun eigen knop. De
//    verleiding is dan om position:absolute te gebruiken — maar dit menu staat
//    in een iframe dat precies zo hoog is als het meldt, dus alles buiten de
//    documentstroom wordt afgeknipt. De kaart wordt daarom met een MARGE onder
//    zijn knop geschoven.
// 2. Lezen had 43 links en maakte het paneel drie keer zo hoog als nodig. Dat
//    is met zijn lade vervallen (07-09-2026): Lezen is nu een link naar
//    /page/lezen. De tweekolomtruc en verdeelGroepen() zijn daarmee weg, en
//    deze test bewaakt dat ze niet terugkomen.
//
// De datablokken worden UIT index.html gehaald en daar uitgevoerd: een test op
// een kopie zou groen blijven terwijl het menu stuk is.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
const CSS_KAAL = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");   // zonder commentaar
const NL = "https://www.nederlanders.fr";

function pak(van, tot) {
  const a = HTML.indexOf(van), b = HTML.indexOf(tot);
  assert.ok(a >= 0 && b > a, "blok niet gevonden in index.html: " + van);
  return HTML.slice(a, b);
}

function data() {
  const bron = pak("var DEUREN_LINK = {", "// Mijn NLFR is de vijfde kolom") +
               pak("var PLAATS_KOLOMMEN = [", "var DEUR_VOLGORDE");
  return new Function("U", bron + "\nreturn { DEUREN_LINK, PLAATS_KOLOMMEN };")((p) => NL + p);
}

// --- de laden --------------------------------------------------------------

test("de lade is een kaart met een pijlpunt, geen volle-breedte balk", () => {
  assert.match(CSS_KAAL, /\.ladekaart \{[^}]*border-radius: 12px/, "radius 12px");
  assert.match(CSS_KAAL, /\.ladekaart \{[^}]*border: 1px solid rgba\(128,0,0,\.14\)/, "de afgesproken rand");
  assert.match(CSS_KAAL, /\.ladekaart \{[^}]*box-shadow/, "een schaduw");
  assert.match(CSS_KAAL, /\.ladekaart \{[^}]*background: #fff/, "een witte kaart");
  assert.match(CSS_KAAL, /\.ladepijl \{/, "en een pijlpunt naar de knop");
  assert.match(HTML, /'<div class="ladepijl"><\/div><div class="ladekaart '/, "beide staan in de lade");
});

test("de kaart blijft in de documentstroom", () => {
  // Dit iframe is precies zo hoog als het meldt; alles daarbuiten wordt
  // afgeknipt. position:relative mag: dat haalt niets uit de stroom.
  //
  // ÉÉN uitzondering, en die staat hier met naam omdat een uitzondering die
  // niemand opschrijft er morgen twee zijn: het tikoppervlak van de pills in
  // "Nu actueel". Dat is een leeg ::before zonder achtergrond dat binnen de
  // padding van de ladekaart valt. Het toont niets, dus er valt niets aan af te
  // knippen, en het telt niet mee in de hoogte die het iframe meldt. Alles wat
  // wél iets laat zien, hoort in de stroom te blijven.
  const absoluut = CSS_KAAL.match(/[^{}]+\{[^}]*position:\s*absolute[^}]*\}/g) || [];
  assert.equal(absoluut.length, 1,
    "onverwachte position:absolute in de menu-CSS: " + absoluut.map((r) => r.trim().slice(0, 80)).join(" | "));
  assert.match(absoluut[0], /::before/, "alleen een pseudo-element mag hier absoluut staan");
  assert.ok(!/background|border|content:\s*"[^"]/.test(absoluut[0]),
    "en dat vlak hoort leeg en onzichtbaar te blijven: " + absoluut[0].trim());
  assert.ok(!/position:\s*fixed/.test(CSS_KAAL), "en geen position:fixed");
  assert.match(CSS_KAAL, /\.ladepijl \{[^}]*position: relative/, "de pijl staat relatief, dus in de stroom");
  assert.ok(!/style\.position\s*=/.test(HTML), "en het script haalt niets uit de stroom");
});

test("de kaart wordt met een marge onder zijn eigen knop gelegd", () => {
  assert.match(HTML, /var LADE_RECHTS = \{ actueel: 1, admin: 1 \};/,
    "Nu actueel en het tandwiel lijnen rechts uit; Plaats bericht links");
  assert.match(HTML, /kaart\.style\.marginLeft = Math\.round\(x\) \+ "px"/, "uitlijnen met een marge");
  assert.match(HTML, /pijl\.style\.marginLeft/, "het pijltje wijst naar de knop");
  assert.match(HTML, /richtLade\(\);/, "en dat gebeurt bij het openen");
  assert.match(HTML, /addEventListener\("resize", function\(\)\{ richtLade\(\); report\(\); \}\)/,
    "en opnieuw als het venster verandert");
});

test("op mobiel neemt de kaart de volle breedte en vervalt het pijltje", () => {
  assert.match(CSS, /html\.compact \.ladekaart \{[^}]*width: auto !important/, "volle breedte");
  assert.match(CSS, /html\.compact \.ladepijl \{ display: none/, "geen pijltje");
  assert.match(CSS, /html\.compact \.plaatskolommen \{ grid-template-columns: 1fr/, "kolommen onder elkaar");
  assert.match(HTML, /if \(isNarrow\(\) \|\| !ladeKnop \|\| !ladeNu\) return;/, "en geen uitlijning");
});

test("Plaats bericht heeft twee kolommen met precies de afgesproken teksten", () => {
  const k = data().PLAATS_KOLOMMEN;
  assert.equal(k.length, 2, "twee kolommen");

  assert.equal(k[0].kop, "Plaats een forumbijdrage");
  assert.equal(k[0].label, "GRATIS");
  assert.equal(k[0].pil, "gratis");
  assert.equal(k[0].tekst,
    "Uw forumbijdrage wordt bijzonder op prijs gesteld. Vragen worden beantwoord in het forum, " +
    "van ervaringen leren we allemaal, en korte verhalen krijgen een eigen rubriek. Ook roerende " +
    "goederen te koop (auto’s, campers, caravans) plaatst u hier gratis."
      .replace("’", "'"));
  assert.equal(k[0].knop, "Naar het forum");
  assert.equal(k[0].url, NL + "/profiles/blog/new");

  assert.equal(k[1].kop, "Plaats een advertentie");
  assert.equal(k[1].label, "BETAALD");
  assert.equal(k[1].pil, "betaald");
  assert.equal(k[1].tekst, "Vacatures, vastgoed en bedrijfsberichten worden alleen geplaatst na betaling.");
  assert.equal(k[1].knop, "Naar de betaalpagina");
  assert.equal(k[1].url, NL + "/page/betaalpagina-berichten");
});

test("de knoppen van beide kolommen openen de hele pagina, niet het iframe", () => {
  assert.match(HTML, /<a class="plaatsknop" href="' \+ k\.url \+ '" target="_parent">/);
});

test("GRATIS is groen, BETAALD is bordeaux", () => {
  assert.match(CSS_KAAL, /\.pil\.gratis \{ background: var\(--actueel\)/);
  assert.match(CSS_KAAL, /--actueel: #2f6b3a/, "en dat groen is #2f6b3a");
  assert.match(CSS_KAAL, /\.pil\.betaald \{ background: var\(--brand\)/);
  assert.match(CSS_KAAL, /--brand: #800000/);
});

test("Nu actueel houdt zijn kop en zijn items uit actueel.json", () => {
  assert.match(HTML, /var kop = '<span class="h">Nu actueel<\/span>'/);
  assert.match(HTML, /items\.map\(actueelLink\)/, "de items komen uit actueel.json");
  assert.match(HTML, /kaart\.innerHTML = actueelHTML\(\)/,
    "een verse levering vult de kaart, niet de hele lade");
});

test("een lade tegelijk; Escape en nogmaals klikken sluiten", () => {
  assert.match(HTML, /if \(!naam \|\| ladeNu === naam\) \{ sluitLade\(\); report\(\); return; \}/,
    "nogmaals op dezelfde knop sluit");
  assert.match(HTML, /ladeNu = naam;/, "en er is er maar één tegelijk");
  assert.match(HTML, /if \(ladeNu\) \{ sluitLade\(\); report\(\); return; \}/, "Escape sluit");
  assert.match(HTML, /if \(open\) sluitLade\(\);/, "het paneel openen sluit de lade");
});

test("de strook onder de strip blijft verder leeg", () => {
  // Geen randen of vlakken over de volle breedte: alleen de kaart is te zien.
  assert.match(CSS_KAAL, /\.lade \{ display: none; background: #fff;/, "de strook is gewoon de kaart");
  assert.ok(!/\.lade \{[^}]*border-top/.test(CSS_KAAL), "geen streep over de volle breedte");
});

// --- de kolom Lezen is een link geworden -----------------------------------

test("de tweekolomtruc van Lezen is met zijn lade verdwenen", () => {
  // Deze machinerie bestond alleen omdat Lezen 43 links droeg. Blijft hij
  // staan, dan staat er dode code in een bestand dat op elke pagina van
  // nederlanders.fr wordt geladen.
  assert.doesNotMatch(HTML, /function verdeelGroepen/, "verdeelGroepen is weg");
  assert.doesNotMatch(HTML, /tweekolommen/, "en de klasse die hij zette ook");
  assert.doesNotMatch(CSS_KAAL, /\.deur\[data-deur="lezen"\]/, "geen dubbel spoor meer voor Lezen");
  assert.doesNotMatch(CSS_KAAL, /\.abonneer/, "en de abonneerknop uit de lade van Nieuws is mee vervallen");
});

test("het raster laat de vijf ingangen naast elkaar toe", () => {
  const m = CSS_KAAL.match(/\.kolommen \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\((\d+)px, 1fr\)\); gap: (\d+)px/);
  assert.ok(m, "de rasterregel hoort herkenbaar te blijven");
  const min = Number(m[1]), gap = Number(m[2]);
  // Bij 955px iframe: 12px body-padding, 2px rand, 48px paneelpadding.
  const ruimte = 955 - 12 - 2 - 48;
  const sporen = Math.floor((ruimte + gap) / (min + gap));
  assert.ok(sporen >= 5, "bij 955px horen er minstens vijf sporen te passen, waren " + sporen);
});

// --- binnen een geopende ingang staat alles open ----------------------------
// ER ZAT EEN TWEEDE ACCORDEON ONDER DE EERSTE. Je tikte "Lezen" open en kreeg
// zestien dichte groepen waarvan er één openstond: twee tikken per link, en
// geen overzicht van wat er in die ingang zit. Voor een doelgroep van 60-plus
// is dat precies het verkeerde ruilmiddel — het scherm wordt korter, maar de
// weg naar een link wordt langer en onzichtbaarder.
//
// Eén laag klapwerk is genoeg, en die zit op de vijf ingangen zelf.

test("binnen een geopende ingang klapt niets meer dicht", () => {
  assert.match(CSS, /html\.compact \.gl \{ display: block/, "alle items zichtbaar");
  assert.doesNotMatch(CSS, /html\.compact \.gl \{ display: none/, "geen dichte groepen meer");
  assert.doesNotMatch(CSS, /html\.compact \.grp\.open/, "en dus ook geen open-stand per groep");
  assert.doesNotMatch(HTML, /function bindGroepen\(\)/, "de tweede accordeon is weg");
  assert.doesNotMatch(HTML, /openEersteGroep/, "en het openzetten van de eerste groep ook");
});

test("de groepskop is een kop, geen knop", () => {
  // Een pijltje naast een kop die niet opengaat belooft iets wat er niet is, en
  // een aantal naast een lijst die er volledig onder staat telt wat je al ziet.
  assert.match(HTML, /<div class="gk"><span class="gn">' \+ g\[0\] \+ '<\/span><\/div>/,
    "alleen de naam");
  assert.doesNotMatch(HTML, /class="gk" role="button"/, "geen knoprol");
  assert.doesNotMatch(HTML, /<span class="gc">/, "geen teller");
  assert.doesNotMatch(HTML, /class="gcaret"/, "geen caret");
  assert.doesNotMatch(CSS, /html\.compact \.gk \{[^}]*cursor: pointer/, "en geen tikvlak");
});

test("de links binnen een groep houden hun tikdoel van 44 px", () => {
  assert.match(CSS, /html\.compact \.grp a \{ min-height: 44px/);
});

test("de vijf ingangen zijn regels van 52 px, waarvan er nog één openklapt", () => {
  assert.match(CSS, /html\.compact \.deurkop \{[^}]*min-height: 52px/, "ruim boven de 44");
  assert.match(CSS, /html\.compact \.deurbody \{ display: none/, "dicht");
  assert.match(CSS, /html\.compact \.deur\.open \.deurbody \{ display: block/, "open bij aantikken");
  assert.match(CSS, /html\.compact \.kolommen \{ grid-template-columns: 1fr/, "vijf regels onder elkaar");
});

test("het openen van een ingang sluit de vorige", () => {
  const blok = HTML.slice(HTML.indexOf("function bindDeuren()"), HTML.indexOf("function zetPaneel"));
  assert.match(blok, /paneel\.querySelectorAll\("\.deur"\)/, "alle deuren worden langsgelopen");
  assert.match(blok, /d\.classList\.remove\("open"\)/, "en dichtgezet");
  assert.match(blok, /if \(!wasOpen\) \{/, "opnieuw aantikken sluit hem, in plaats van hem open te laten");
  assert.match(blok, /report\(\);/, "de iframe-hoogte gaat mee");
});

test("draaien van het toestel laat de open ingang staan", () => {
  // bouwPaneel() tekent het paneel opnieuw en gooide daarmee de stand van de
  // accordeon weg: wie draaide terwijl "Vinden" openstond, keek daarna naar
  // vijf dichte regels en moest opnieuw zoeken waar hij was.
  const blok = HTML.slice(HTML.indexOf("var bijWissel = function()"), HTML.indexOf("if (mq.addEventListener)"));
  assert.match(blok, /paneel\.querySelector\("\.deur\.open"\)/, "de open deur wordt onthouden");
  assert.match(blok, /getAttribute\("data-deur"\)/, "op zijn sleutel, niet op zijn plek in de lijst");
  assert.ok(
    blok.indexOf("bouwPaneel()") < blok.indexOf('terug.classList.add("open")'),
    "en pas ná het opnieuw tekenen teruggezet"
  );
  assert.match(blok, /kop\.setAttribute\("aria-expanded", "true"\)/, "inclusief de toegankelijke stand");
  assert.match(blok, /report\(\);/, "en de hoogte wordt opnieuw gemeld");
});

test("op desktop staan alle groepen gewoon open, zonder teller of caret", () => {
  assert.match(CSS_KAAL, /\.gk \.gc, \.gk \.gcaret \{ display: none/, "geen teller of caret");
  assert.match(CSS_KAAL, /\.gl \{ display: block/, "alle groepen open");
});
