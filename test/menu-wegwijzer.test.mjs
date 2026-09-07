// Het menu als WEGWIJZER (07-09-2026).
//
// Lezen, Meedoen, Vinden en Nieuws droegen samen 72 links in vier laden. Die
// inhoud staat nu op openbare categoriepagina's op nederlanders.fr; het menu
// wijst er alleen nog naartoe. Mijn NLFR houdt zijn lade, want die verschilt
// per bezoeker en kan dus geen openbare pagina zijn.
//
// WAT HIER MISGAAT ALS NIEMAND OPLET.
// 1. Een van de vier URL's verschrijft zich. Het menu wijst dan naar een 404 en
//    niemand merkt dat, want de sonde toetst /api/actueel en niet het menu.
//    Daarom staat elke URL hier VOLUIT in de assert. Een toets op "/page/" of
//    op een fragment slaagt ook bij /page/leezen, en dan bewaakt hij niets.
// 2. De lade van Mijn NLFR sneuvelt mee bij het opruimen van de andere vier.
//    Dan verliest een ingelogd lid zijn eigen menu en een bezoeker de werving.
// 3. Een van de vier laden komt bij een latere wijziging terug. Twee plekken
//    met dezelfde links lopen uit elkaar; de categoriepagina is de bron.
//
// De renderfunctie wordt UIT index.html gehaald en hier uitgevoerd: een test op
// een nagebouwde kopie blijft groen terwijl het menu stuk is.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
const NL = "https://www.nederlanders.fr";

const PAGINA = {
  lezen: "https://www.nederlanders.fr/page/lezen",
  doen: "https://www.nederlanders.fr/page/meedoen",
  vinden: "https://www.nederlanders.fr/page/vinden",
  nieuws: "https://www.nederlanders.fr/page/frankrijknieuws",
};

function pak(van, tot) {
  const a = HTML.indexOf(van), b = HTML.indexOf(tot);
  assert.ok(a >= 0 && b > a, "blok niet gevonden in index.html: " + van);
  return HTML.slice(a, b);
}

// kolomHTML() met alles wat hij nodig heeft, uitgevoerd uit het echte bestand.
function menu(ingelogd) {
  const bron =
    pak("  function tgt(href)", "  // ---- Data ----") +
    pak("  var U = function(p)", "  // ---- De vier ingangen") +
    pak("  var DEUREN_LINK = {", "  // Mijn NLFR is de vijfde kolom") +
    pak("  function memberGroups()", "  // De beheerlade") +
    pak("  var WERVING = {", "  var ZUSTERS") +
    pak("  var caretSvg =", "  // ---- Hoogte melden") +
    pak("  function groepHTML(g){", "  // ---- Eén kolom in het paneel") +
    pak("  function linkKolomHTML(sleutel){", "  function bouwPaneel(){");
  // eslint-disable-next-line no-new-func
  const fn = new Function("NL", "isMember", "myPage", "uid",
    bron + "\nreturn { kolomHTML: kolomHTML, DEUREN_LINK: DEUREN_LINK, WERVING: WERVING };");
  return fn(NL, ingelogd, NL + "/profiles/profile/show?id=UID", "UID");
}

// De <a> van de kop van één ingang, uit elkaar getrokken op zijn attributen.
// Niet met één vaste regex over de hele tag: dan valt de toets om met een
// TypeError zodra de volgorde van de attributen wijzigt, en zegt hij niet meer
// wat er mis is.
function kop(html) {
  const m = html.match(/<a\b([^>]*)>/);
  assert.ok(m, "de ingang hoort een <a> als kop te hebben, gevonden: " + html.slice(0, 120));
  const attr = (naam) => {
    const a = m[1].match(new RegExp(naam + '="([^"]*)"'));
    return a ? a[1] : null;
  };
  return { href: attr("href"), target: attr("target"), klasse: attr("class") };
}

// --- 1. de vier nieuwe links ------------------------------------------------

test("de vier ingangen wijzen voluit naar hun categoriepagina", () => {
  const m = menu(false);
  // Voluit vergelijken, niet met includes(): /page/leezen bevat óók "/page/".
  assert.equal(kop(m.kolomHTML("lezen")).href, "https://www.nederlanders.fr/page/lezen");
  assert.equal(kop(m.kolomHTML("doen")).href, "https://www.nederlanders.fr/page/meedoen");
  assert.equal(kop(m.kolomHTML("vinden")).href, "https://www.nederlanders.fr/page/vinden");
  assert.equal(kop(m.kolomHTML("nieuws")).href, "https://www.nederlanders.fr/page/frankrijknieuws");
  // En de labels erboven, want een goede URL onder de verkeerde naam is net zo
  // stuk als andersom.
  assert.equal(m.DEUREN_LINK.lezen.naam, "Lezen");
  assert.equal(m.DEUREN_LINK.doen.naam, "Meedoen");
  assert.equal(m.DEUREN_LINK.vinden.naam, "Vinden");
  assert.equal(m.DEUREN_LINK.nieuws.naam, "Nieuws");
});

test("de vier links openen in het bovenliggende venster, niet in de iframe", () => {
  const m = menu(false);
  for (const sleutel of ["lezen", "doen", "vinden", "nieuws"]) {
    const k = kop(m.kolomHTML(sleutel));
    assert.equal(k.target, "_parent", sleutel + " hoort in _parent te openen");
  }
  // Dat komt uit tgt(), dus die regel moet blijven doen wat hij deed.
  // eslint-disable-next-line no-new-func
  const tgt = new Function(pak("  function tgt(href)", "  function link(href") + "\nreturn tgt;")();
  assert.equal(tgt("https://www.nederlanders.fr/page/lezen"), "_parent");
  assert.equal(tgt("https://infofrankrijk.com/"), "_blank");
});

test("een ingang die doorverwijst is een link, geen knop", () => {
  const m = menu(false);
  const h = m.kolomHTML("lezen");
  assert.match(h, /<a class="deurkop deurlink"/, "de kop is een <a>");
  assert.ok(!/role="button"/.test(h), "geen knoprol op iets dat navigeert");
  assert.ok(!/aria-expanded/.test(h), "en geen open-stand op iets dat niet openklapt");
  assert.ok(!/class="deurbody"/.test(h), "en geen body");
});

// --- 2. Mijn NLFR houdt zijn lade ------------------------------------------

test("Mijn NLFR houdt zijn lade in beide standen", () => {
  for (const ingelogd of [true, false]) {
    const h = menu(ingelogd).kolomHTML("mijn");
    assert.match(h, /<div class="deur" data-deur="mijn">/, "een gewone deur, geen link");
    assert.match(h, /<div class="deurkop" role="button" tabindex="0" aria-expanded="false">/,
      "met een kop die openklapt (ingelogd: " + ingelogd + ")");
    assert.match(h, /<div class="deurbody">/, "en een body (ingelogd: " + ingelogd + ")");
    assert.ok(h.length > 200, "de body hoort gevuld te zijn (ingelogd: " + ingelogd + ")");
  }
});

test("een ingelogd lid ziet zijn eigen links, ongewijzigd", () => {
  const h = menu(true).kolomHTML("mijn");
  for (const url of [
    NL + "/profiles/members/",
    NL + "/profiles/members/advancedSearch",
    NL + "/page/veelgestelde-vragen-en-goede-antwoorden",
    NL + "/profiles/blog/list?tag=Ledenservice",
    NL + "/boite-a-idees",
    NL + "/profiles/settings/editProfileInfo",
    NL + "/photo/photo/listForContributor?screenName=UID",
    NL + "/profiles/blog/list?user=UID",
    NL + "/profiles/friend/list?user=UID",
  ]) {
    assert.ok(h.includes('href="' + url + '"'), "ledenlink ontbreekt: " + url);
  }
  assert.ok(!h.includes("Word gratis lid"), "een lid krijgt geen wervende tekst");
});

test("een bezoeker die niet is ingelogd krijgt de vijf wervende punten, letterlijk", () => {
  const h = menu(false).kolomHTML("mijn");
  assert.ok(h.includes("<h3>Word gratis lid</h3>"), "de kop");
  assert.ok(h.includes('<p class="tsub">Vraag het aan wie het al heeft meegemaakt</p>'), "de ondertitel");
  const punten = [
    "24 jaar aan vragen en antwoorden, van meer dan 25.000 leden",
    "Stel uw eigen vraag aan Nederlandstaligen die hier wonen",
    "Vind landgenoten en verenigingen bij u in de buurt",
    "Dagelijks officieel Frankrijknieuws, in het Nederlands samengevat",
    "Plaats gratis berichten, advertenties en foto's",
  ];
  for (const punt of punten) assert.ok(h.includes(punt), "punt ontbreekt: " + punt);
  // En in deze volgorde: de plek in de rij is een redactionele keuze.
  const plek = punten.map((p) => h.indexOf(p));
  assert.deepEqual(plek, [...plek].sort((a, b) => a - b), "de punten staan in de verkeerde volgorde");
  assert.equal(menu(false).WERVING.punten.length, 5, "precies vijf punten");
});

test("de twee knoppen onder de wervende tekst staan er allebei", () => {
  const h = menu(false).kolomHTML("mijn");
  assert.ok(h.includes('href="' + NL + '/main/authorization/signUp" target="_parent">Word lid, gratis</a>'),
    "de aanmeldknop met zijn nieuwe tekst");
  assert.ok(h.includes('href="' + NL + '/main/authorization/signIn" target="_parent">Meld je aan</a>'),
    "en de bestaande tweede knop");
});

// --- 3. de vier laden zijn echt weg ----------------------------------------

test("de vier vervallen laden komen niet ongemerkt terug", () => {
  const m = menu(false);
  for (const sleutel of ["lezen", "doen", "vinden", "nieuws"]) {
    const h = m.kolomHTML(sleutel);
    assert.ok(!h.includes("deurbody"), sleutel + " hoort geen body meer te hebben");
    assert.ok(!h.includes('class="grp"'), sleutel + " hoort geen groepen meer te hebben");
    assert.ok(!h.includes('class="gl"'), sleutel + " hoort geen linklijst meer te hebben");
  }
  // En de data waaruit die laden werden gevuld bestaat niet meer.
  assert.ok(!/var DOORS\s*=/.test(HTML), "de DOORS-tabel hoort verdwenen te zijn");
  assert.ok(!/\.groups/.test(HTML.slice(HTML.indexOf("var DEUREN_LINK"))),
    "geen groups meer buiten memberGroups");
});

test("een van de vier openen doet niets, want er valt niets te openen", () => {
  // bindDeuren() bindt alleen div.deurkop. Zou hij .deurkop binden, dan kreeg de
  // <a> er een klapbeweging bij en zou een tik twee dingen tegelijk doen.
  const blok = HTML.slice(HTML.indexOf("function bindDeuren()"), HTML.indexOf("function zetPaneel"));
  assert.match(blok, /querySelectorAll\("\.deur > div\.deurkop"\)/,
    "alleen de kop die werkelijk openklapt wordt gebonden");
});

test("op mobiel staat er bij het openen van het menu niets open", () => {
  // De eerste ingang die nog openklapt is Mijn NLFR, met 440px wervende tekst.
  // Automatisch openzetten duwt Nieuws een halve schermlengte onder de vouw.
  const blok = HTML.slice(HTML.indexOf("function zetPaneel(open){"), HTML.indexOf("// ---- Lade (in-flow"));
  assert.ok(!/classList\.add\("open"\)/.test(blok), "geen enkele ingang gaat vanzelf open");
  assert.match(blok, /report\(\);/, "de hoogte wordt wel gemeld");
});

// --- 4. de rest van de strip is onaangeroerd -------------------------------

test("de zoekbalk, Nu actueel en de beheerknop staan er ongewijzigd", () => {
  assert.ok(HTML.includes('<form class="szoek" id="searchform">'), "het zoekformulier");
  assert.ok(HTML.includes('placeholder="AI-zoek in forum &amp; Infofrankrijk…"'), "met zijn placeholder");
  assert.ok(HTML.includes('id="loepbtn"'), "en de loep ernaast");
  assert.ok(HTML.includes('id="actueelbtn"'), "Nu actueel");
  assert.ok(HTML.includes("Nu actueel</button>"), "met zijn label");
  assert.ok(HTML.includes('id="actueeldot"'), "en zijn stiplampje");
  assert.ok(HTML.includes('id="adminbtn"'), "de beheerknop");
  assert.ok(HTML.includes("function syncAdmin"), "die alleen voor de beheerder zichtbaar is");
  assert.ok(HTML.includes('id="plaatsbtn"'), "en Plaats bericht met zijn eigen lade");
});

test("de knop Onderwerpen is en blijft verdwenen", () => {
  // Die was al weg; deze wijziging mag hem niet terugbrengen als vervanging
  // voor de vier laden.
  assert.ok(!HTML.includes(">Onderwerpen<"), "geen Onderwerpen-knop");
  assert.ok(!/var TOPICS/.test(HTML), "en geen TOPICS-tabel");
});

// --- 5. de vormgeving van de vijf regels -----------------------------------

test("de vijf ingangen houden hun tikdoel op mobiel", () => {
  assert.match(CSS, /html\.compact \.deurkop \{[^}]*min-height: 52px/,
    "52px voor alle vijf, ruim boven de eis van 44");
  assert.match(CSS, /html\.compact \.deurlink \.dpijl \{ display: inline-flex/,
    "de vier links krijgen een pijl naar rechts");
  assert.match(CSS, /a\.deurlink \{ text-decoration: none/, "en zijn op desktop niet onderstreept");
});

test("de doelpagina's staan op één plek in het bestand", () => {
  // Een tweede plek met dezelfde URL's loopt uit elkaar. Ze horen alleen in
  // DEUREN_LINK te staan.
  for (const [sleutel, url] of Object.entries(PAGINA)) {
    const pad = url.slice(NL.length);
    const treffers = HTML.split('U("' + pad + '")').length - 1;
    assert.equal(treffers, 1, sleutel + " (" + pad + ") hoort precies één keer in het bestand te staan");
  }
});
