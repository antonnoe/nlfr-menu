// De laden onder de knoppen, en de kolom Lezen (correcties 04-09-2026).
//
// TWEE DINGEN DIE HIER MISGAAN ALS NIEMAND OPLET.
// 1. De laden van "Plaats bericht" en "Nu actueel" hingen als een volle-breedte
//    balk onder de strip in plaats van als kaart onder hun eigen knop. De
//    verleiding is dan om position:absolute te gebruiken — maar dit menu staat
//    in een iframe dat precies zo hoog is als het meldt, dus alles buiten de
//    documentstroom wordt afgeknipt. De kaart wordt daarom met een MARGE onder
//    zijn knop geschoven.
// 2. Lezen heeft 43 links en maakte het paneel drie keer zo hoog als nodig.
//    Die groepen staan nu in twee kolommen onder één deurkop.
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
  const bron = pak("var DOORS = {", "// Mijn NLFR is de vijfde kolom") +
               pak("var PLAATS_KOLOMMEN = [", "var DEUR_VOLGORDE");
  return new Function("U", bron + "\nreturn { DOORS, PLAATS_KOLOMMEN };")((p) => NL + p);
}

function verdeelGroepen() {
  return new Function(
    pak("  function verdeelGroepen(groups){", "  function kolomHTML(sleutel){") +
    "\nreturn verdeelGroepen;"
  )();
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
  assert.ok(!/position:\s*absolute/.test(CSS_KAAL), "geen position:absolute in de menu-CSS");
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

// --- de kolom Lezen --------------------------------------------------------

test("Lezen verdeelt zijn groepen evenwichtig over twee kolommen", () => {
  const verdeel = verdeelGroepen();
  const groepen = data().DOORS.lezen.groups;
  const [a, b] = verdeel(groepen);

  assert.ok(a.length && b.length, "twee gevulde kolommen");
  assert.equal(a.length + b.length, groepen.length, "geen groep kwijt of dubbel");
  // De volgorde blijft: kolom A is het begin, kolom B de rest. Op mobiel staan
  // ze onder elkaar en moet de lijst gewoon in de oude volgorde staan.
  assert.deepEqual(a.concat(b).map((g) => g[0]), groepen.map((g) => g[0]));

  const gewicht = (kolom) => kolom.reduce((s, g) => s + g[1].length + 1, 0);
  const wa = gewicht(a), wb = gewicht(b);
  assert.ok(Math.abs(wa - wb) <= Math.max(wa, wb) * 0.2,
    "de kolommen horen binnen 20% van elkaar te liggen, waren " + wa + " en " + wb);
  // En de langste kolom is korter dan de hele lijst — dat was de hele reden.
  assert.ok(Math.max(wa, wb) < gewicht(groepen) * 0.6, "de langste kolom is ruim korter dan het geheel");
});

test("verdeelGroepen houdt een groep heel en laat nooit een kolom leeg", () => {
  const verdeel = verdeelGroepen();
  // Een groep splitsen zou de kop van zijn links scheiden; dat mag niet.
  const [a1, b1] = verdeel([["Groot", new Array(20).fill(["x", "y"])], ["Klein", [["a", "b"]]]]);
  assert.equal(a1.length + b1.length, 2, "beide groepen blijven heel");
  assert.ok(a1.length >= 1 && b1.length >= 1, "geen lege kolom");
  const [a2, b2] = verdeel([["Enige", [["a", "b"], ["c", "d"]]]]);
  assert.equal(a2.length + b2.length, 1, "één groep blijft één groep");
});

test("Lezen pakt twee sporen op desktop en valt terug op één op mobiel", () => {
  assert.match(CSS_KAAL, /\.deur\[data-deur="lezen"\] \{ grid-column: span 2/, "twee sporen op desktop");
  assert.match(CSS_KAAL, /\.deurbody\.tweekolommen \{ display: grid; grid-template-columns: 1fr 1fr/,
    "en twee kolommen daarbinnen");
  assert.match(CSS, /html\.compact \.deur\[data-deur="lezen"\] \{ grid-column: auto/, "op mobiel één spoor");
  assert.match(CSS, /html\.compact \.deurbody\.tweekolommen \{ display: block/, "en gewoon onder elkaar");
  // Eén deurkop boven beide kolommen: de klasse zit op de deurbody, niet op de deur.
  assert.match(HTML, /var tweekolommen = \(sleutel === "lezen"\) && groups;/);
  assert.match(HTML, /'<div class="deurbody' \+ \(tweekolommen \? " tweekolommen" : ""\)/);
});

test("het raster laat zes sporen toe, anders past Lezen er niet dubbel in", () => {
  const m = CSS_KAAL.match(/\.kolommen \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\((\d+)px, 1fr\)\); gap: (\d+)px/);
  assert.ok(m, "de rasterregel hoort herkenbaar te blijven");
  const min = Number(m[1]), gap = Number(m[2]);
  // Bij 955px iframe: 12px body-padding, 2px rand, 48px paneelpadding.
  const ruimte = 955 - 12 - 2 - 48;
  const sporen = Math.floor((ruimte + gap) / (min + gap));
  assert.ok(sporen >= 6, "bij 955px horen er minstens zes sporen te passen, waren " + sporen);
});

// --- groepen als accordeon op mobiel ---------------------------------------

test("op mobiel zijn de groepen zelf accordeons, één tegelijk, de eerste open", () => {
  assert.match(CSS, /html\.compact \.gl \{ display: none/, "groepen dicht");
  assert.match(CSS, /html\.compact \.grp\.open \.gl \{ display: block/, "open als je ze aantikt");
  assert.match(CSS, /html\.compact \.gk \{[^}]*min-height: 44px/, "raakvlak van 44px");
  assert.match(CSS, /html\.compact \.gk \.gc \{ display: inline-block/, "met het aantal erachter");
  assert.match(CSS, /html\.compact \.gk \.gcaret \{ display: inline-flex/, "en een caret");
  assert.match(HTML, /function bindGroepen\(\)/, "de accordeon wordt gebonden");
  assert.match(HTML, /grp\.closest \? grp\.closest\("\.deur"\) : null/, "één open binnen dezelfde deur");
  assert.match(HTML, /function openEersteGroep\(deur\)/, "en de eerste staat open");
  assert.match(HTML, /openEersteGroep\(deur\);/, "ook als je een deur opent");
});

test("op desktop staan alle groepen gewoon open, zonder teller of caret", () => {
  assert.match(CSS_KAAL, /\.gk \.gc, \.gk \.gcaret \{ display: none/, "geen teller of caret");
  assert.match(CSS_KAAL, /\.gl \{ display: block/, "alle groepen open");
});

test("de groepskop draagt het aantal links en is bedienbaar met het toetsenbord", () => {
  assert.match(HTML, /<span class="gc">' \+ g\[1\]\.length \+ '<\/span>/, "het aantal komt uit de data");
  assert.match(HTML, /<div class="gk" role="button" tabindex="0" aria-expanded="false">/, "toegankelijk");
  assert.match(HTML, /if \(e\.key === "Enter" \|\| e\.key === " "\) \{ e\.preventDefault\(\); toggle\(\); \}/,
    "Enter en spatie bedienen hem");
});
