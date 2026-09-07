// De smalle regel onder de balk, en de opgeruimde voetrij (07-09-2026).
// ---------------------------------------------------------------------------
// De voetrij van het uitgeklapte paneel droeg drie knoppen, vier zusterlinks en
// een sluitknop met tekst. Twee van die knoppen stonden dubbel — in de balk én
// in de tegel Meedoen — en de zusterlinks zag alleen wie het menu uitklapte.
//
// WAT HIER MISGAAT ALS NIEMAND OPLET.
// 1. Een van de vier links komt onderin het paneel terug, zodat er weer twee
//    plekken zijn met dezelfde adressen die uit elkaar gaan lopen.
// 2. Het kruisje verliest zijn aria-label of zijn maat. Een knop zonder tekst
//    heeft dan voor een schermlezer geen naam, en voor een duim geen doel.
// 3. Een zusterplatform verliest zijn target="_blank" en opent binnen de
//    iframe, die maar een paar honderd pixels hoog is.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
const CSS_KAAL = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");
const NL = "https://www.nederlanders.fr";

// De renderfuncties uit het echte bestand, met wat ze nodig hebben.
function renderers() {
  const pak = (van, tot) => {
    const a = HTML.indexOf(van), b = HTML.indexOf(tot);
    assert.ok(a >= 0 && b > a, "blok niet gevonden in index.html: " + van);
    return HTML.slice(a, b);
  };
  const bron =
    pak("  function tgt(href)", "  // ---- Data ----") +
    pak("  var U = function(p)", "  // ---- De vier ingangen") +
    pak("  var ZUSTERS =", "  // De twee kolommen achter de knop") +
    pak("  var kruisSvg =", "  // ---- Hoogte melden") +
    pak("  function snelrijHTML(){", "  function bouwPaneel(){");
  // eslint-disable-next-line no-new-func
  const fn = new Function("NL", "subbalk",
    bron + "\nbouwSubbalk();\nreturn { subbalk: subbalk.innerHTML, voetHTML: voetHTML };");
  return fn(NL, { innerHTML: "" });
}

function subbalkHTML() {
  return renderers().subbalk;
}

// De voetrij van het paneel, smal (mobiel) of breed (desktop).
function voetHTML(smal) {
  return renderers().voetHTML(smal);
}

function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => {
    const attr = (naam) => {
      const a = m[1].match(new RegExp(naam + '="([^"]*)"'));
      return a ? a[1] : null;
    };
    return {
      href: attr("href"),
      target: attr("target"),
      rel: attr("rel"),
      klasse: attr("class"),
      tekst: m[2].replace(/<[^>]*>/g, "").trim(),
    };
  });
}

// --- de vier links ----------------------------------------------------------

test("de smalle regel draagt precies vier links, in deze volgorde", () => {
  const l = links(subbalkHTML());
  assert.deepEqual(l.map((x) => x.tekst),
    ["Diensten", "Infofrankrijk", "Café Claude", "Nedergids"]);
});

test("de vier adressen staan voluit, en Diensten wijst binnen Ning", () => {
  const l = links(subbalkHTML());
  // Voluit vergelijken: een toets op "/diensten" slaagt ook bij het oude adres
  // buiten Ning, en dat is nu juist wat hier is rechtgezet.
  assert.equal(l[0].href, NL + "/page/diensten");
  assert.equal(l[1].href, "https://infofrankrijk.com/");
  assert.equal(l[2].href, "https://www.cafeclaude.fr/");
  assert.equal(l[3].href, "https://nedergids.nl/");
  assert.ok(!HTML.includes('U("/diensten")'), "het oude /diensten hoort nergens meer te staan");
});

test("nederlanders.fr opent in het bovenliggende venster, de zusters in een tabblad", () => {
  const l = links(subbalkHTML());
  assert.equal(l[0].target, "_parent", "Diensten blijft binnen de site");
  for (const zuster of l.slice(1)) {
    assert.equal(zuster.target, "_blank", zuster.tekst + " opent in een nieuw tabblad");
    assert.equal(zuster.rel, "noopener", zuster.tekst + " krijgt rel=noopener");
  }
});

test("de zusterplatforms zijn als extern herkenbaar, Diensten niet", () => {
  const html = subbalkHTML();
  const l = links(html);
  assert.ok(!l[0].klasse.includes("sbl-ext"), "Diensten is geen externe link");
  for (const zuster of l.slice(1)) {
    assert.ok(zuster.klasse.includes("sbl-ext"), zuster.tekst + " hoort als extern gemarkeerd");
  }
  assert.equal(html.split('class="sbx"').length - 1, 3, "drie pijltjes, één per zusterplatform");
  assert.match(CSS_KAAL, /\.sbl-ext \{ color: var\(--actueel\)/, "en in een eigen kleur");
});

// --- altijd zichtbaar, en de hoogte gaat mee -------------------------------

test("op een breed scherm staat de regel buiten het paneel, dus altijd in beeld", () => {
  // In de markup: tussen de strip en de lade, niet in .paneel. Stond hij in het
  // paneel, dan zag je hem pas na het uitklappen — precies het probleem dat
  // deze regel oplost.
  assert.match(HTML, /<div class="subbalk" id="subbalk"><\/div>\s*\n\s*\n?\s*<div class="lade" id="lade">/,
    "de subbalk staat tussen de strip en de lade");
  assert.ok(!/class="paneel"[^>]*>\s*<div class="subbalk"/.test(HTML), "en niet in het paneel");
  const regel = CSS_KAAL.slice(CSS_KAAL.indexOf(".subbalk {"), CSS_KAAL.indexOf("}", CSS_KAAL.indexOf(".subbalk {")));
  assert.ok(!/display: none/.test(regel), "op breed wordt hij niet verborgen: " + regel);
});

test("op mobiel is de regel weg en staan de vier links in de voetrij", () => {
  // 89 pixels op elke pagina van de site, want de vier links wikkelen daar naar
  // twee regels. Ze zijn niet verdwenen maar verhuisd: één tik op Menu.
  assert.match(CSS_KAAL, /html\.compact \.subbalk \{ display: none/, "de regel is weg op mobiel");
  const smal = links(voetHTML(true));
  assert.deepEqual(smal.map((x) => x.tekst),
    ["Diensten", "Infofrankrijk", "Café Claude", "Nedergids"],
    "alle vier staan in de voetrij van het paneel");
  // En met dezelfde adressen en targets als in de regel: één renderer, één lijst.
  assert.deepEqual(smal.map((x) => [x.href, x.target]),
    links(subbalkHTML()).map((x) => [x.href, x.target]));
});

test("de grens is dezelfde die het menu overal gebruikt", () => {
  // Geen tweede drempel: html.compact in de CSS, isNarrow() in de code. Een
  // eigen breekpunt zou bij de volgende wijziging uit de pas gaan lopen.
  const bouw = HTML.slice(HTML.indexOf("function bouwPaneel(){"), HTML.indexOf("function bindDeuren()"));
  assert.match(bouw, /voetHTML\(isNarrow\(\)\)/, "de voetrij volgt isNarrow()");
  const eigen = [...CSS_KAAL.matchAll(/@media[^{]*max-width:\s*(\d+)/g)].map((m) => m[1]);
  for (const px of eigen) {
    assert.equal(px, "700", "onverwacht breekpunt in de CSS: " + px + "px");
  }
  assert.match(HTML, /var MOBILE_MQ = "\(max-width: 700px\)"/, "en dat is de grens van het menu zelf");
});

test("de regel wordt bij het opstarten gevuld en wikkelt op smalle schermen", () => {
  const opstart = HTML.slice(HTML.indexOf("---- Opstarten"));
  assert.match(opstart, /bouwSubbalk\(\);/, "bouwSubbalk draait bij het opstarten");
  assert.match(CSS_KAAL, /\.subbalk \{[^}]*flex-wrap: wrap/,
    "vier links passen op een telefoon niet naast elkaar; ze horen te wikkelen");
  // De iframe-hoogte gaat mee via het bestaande kanaal: report() meet het hele
  // document, dus een regel die erbij komt of wikkelt telt vanzelf mee.
  assert.match(HTML, /nlfrMenuHeight/, "het postMessage-kanaal staat er nog");
  assert.match(HTML, /window\.addEventListener\("resize", function\(\)\{ richtLade\(\); report\(\); \}\)/,
    "en bij een breedtewissel wordt de hoogte opnieuw gemeld");
});

test("de links zijn op mobiel ruimer aantikbaar dan op desktop", () => {
  assert.match(CSS_KAAL, /\.sbl \{[^}]*min-height: 30px/, "compact op desktop");
  assert.match(CSS_KAAL, /html\.compact \.sbl \{ min-height: 38px/, "ruimer onder een duim");
  assert.match(CSS_KAAL, /\.sbl \{[^}]*font-size: 12\.5px/, "leesbaar, niet kleiner dan de rest");
});

// --- de opgeruimde voetrij --------------------------------------------------

test("op een breed scherm draagt de voetrij alleen een kruisje", () => {
  // De vier links staan daar al in de regel onder de balk; twee keer hetzelfde
  // in beeld is geen wegwijzer maar ruis.
  const breed = voetHTML(false);
  assert.match(breed, /^<div class="paneelvoet">/, "de voetrij bestaat nog");
  assert.equal(breed.split("<a ").length - 1, 0, "en bevat geen enkele link");
  assert.equal(breed.split("<button").length - 1, 1, "precies één knop");
  assert.match(breed, /id="sluitbtn"/, "de sluitknop");
  assert.ok(!breed.includes("Menu sluiten<"), "zonder tekstlabel");
  // De drie oude knoppen komen ook op mobiel niet terug.
  for (const h of [breed, voetHTML(true)]) {
    for (const weg of ["Plaats bericht", "Plaats advertentie", "Zusterplatforms:"]) {
      assert.ok(!h.includes(weg), weg + " hoort uit de voetrij te zijn");
    }
  }
});

test("het kruisje houdt zijn naam en zijn tikdoel", () => {
  const bouw = HTML.slice(HTML.indexOf("function voetHTML(smal){"), HTML.indexOf("function bouwPaneel(){"));
  // Een knop die alleen een tekening is, heeft zonder aria-label geen naam.
  assert.match(bouw, /aria-label="Menu sluiten"/, "een schermlezer hoort te weten wat dit doet");
  assert.match(bouw, /title="Menu sluiten"/, "en een muisgebruiker ook");
  assert.match(bouw, /kruisSvg/, "de tekening komt uit één plek");
  assert.match(CSS_KAAL, /\.pknop \{[^}]*min-height: 44px/, "44 hoog");
  assert.match(CSS_KAAL, /\.sluitknop \{ width: 44px; min-width: 44px/, "en 44 breed");
  assert.match(CSS_KAAL, /html\.compact \.sluitknop \{ width: 44px/,
    "ook op mobiel, waar .pknop normaal de volle breedte pakt");
  assert.match(HTML, /var kruisSvg = '<svg[^']*aria-hidden="true"/,
    "de tekening zelf blijft voor een schermlezer verborgen");
});

test("de kaart heeft geen slagschaduw meer", () => {
  const kaart = CSS_KAAL.slice(CSS_KAAL.indexOf(".card {"), CSS_KAAL.indexOf("}", CSS_KAAL.indexOf(".card {")));
  assert.ok(!/box-shadow/.test(kaart), "de rode waas onder het paneel hoort weg te zijn: " + kaart);
  assert.match(kaart, /border: 1px solid rgba\(128,0,0,\.12\)/, "de rand zet het blok al af");
});
