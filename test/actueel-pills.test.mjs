// "Nu actueel" als pill-knoppen met een tekstlinkje eronder.
// ---------------------------------------------------------------------------
// WAT HIER MISGAAT ALS NIEMAND OPLET. De lade toonde kale tekstlinkjes; nu
// dragen de drie eerste items een bordeaux pill en staat het aanmeldlinkje er
// klein onder. Drie dingen kunnen daarbij stilletjes sneuvelen:
//
// 1. HET STIPJE. Het hoort bij de pill en meldt dat er achter die knop iets
//    bijgewerkt is. Zet iemand het ook op het tekstlinkje, of laat hij het bij
//    live:false staan, dan belooft de lade beweging die er niet is.
// 2. DE GENERIEKE LADEREGEL. `.lade .ladekaart > a` maakt van elke link in elke
//    lade een regel van 44px in #333. Die regel geldt nog steeds voor de andere
//    laden en mag hier niet winnen — anders wordt de pill een grijze balk.
//    Specificiteit is het enige wat dat tegenhoudt, en specificiteit verschuift
//    zodra iemand een selector "opruimt".
// 3. HET TIKOPPERVLAK. De pill is met opzet klein (27px). Zonder het onzichtbare
//    vlak eromheen is hij op een telefoon niet te raken; en wie dat vlak weghaalt
//    ziet daar niets van, want er verandert visueel niets.
//
// De functie wordt UIT index.html gehaald en daar uitgevoerd, met de echte
// esc() en tgt() ernaast: een test op een overgeschreven kopie blijft groen
// terwijl het menu stuk is.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const CSS = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));

function pak(van, tot) {
  const a = HTML.indexOf(van), b = HTML.indexOf(tot);
  assert.ok(a >= 0 && b > a, "blok niet gevonden in index.html: " + van);
  return HTML.slice(a, b);
}
function regelMet(merk) {
  const i = HTML.indexOf(merk);
  assert.ok(i >= 0, "regel niet gevonden in index.html: " + merk);
  return HTML.slice(HTML.lastIndexOf("\n", i) + 1, HTML.indexOf("\n", i));
}

const actueelLink = new Function(
  regelMet("function tgt(href){") + "\n" +
  regelMet("function esc(s){") + "\n" +
  pak("  function actueelLink(k){", "  function actueelHTML(){") +
  "\nreturn actueelLink;"
)();

const DOT = '<span class="dot live" aria-hidden="true"></span>';

// ---- (a) wat actueelLink() van een item maakt ------------------------------

test("vorm 'tekst' geeft een tekstlinkje zonder stipje", () => {
  const uit = actueelLink({
    titel: "Meld je aan voor de nieuwsbrief",
    href: "https://voorbeeld.nl/aanmelden",
    vorm: "tekst",
    live: false,
  });
  assert.match(uit, /^<a class="nal"/, "een tekstlinkje krijgt class nal");
  assert.ok(!uit.includes("dot"), "en nooit een stipje: " + uit);
});

test("vorm 'tekst' houdt het tekstlinkje stipjeloos, ook als live aan staat", () => {
  // De redactie kan live:true laten staan bij een omgezet item. Het stipje
  // hoort bij de pill; op een aanmeldformulier valt niets live te melden.
  const uit = actueelLink({ titel: "Aanmelden", href: "https://voorbeeld.nl/x", vorm: "tekst", live: true });
  assert.match(uit, /^<a class="nal"/);
  assert.ok(!uit.includes("dot"), "geen stipje op een tekstlinkje: " + uit);
});

test("een pill met live:true draagt het stipje vóór de titel", () => {
  const uit = actueelLink({ titel: "Frankrijknieuws", href: "https://voorbeeld.nl/nieuws", live: true });
  assert.match(uit, /^<a class="nap"/, "zonder vorm is het een pill");
  assert.ok(uit.includes(DOT + "Frankrijknieuws"),
    "het stipje hoort direct vóór de titel te staan: " + uit);
});

test("een pill met live:false draagt geen stipje", () => {
  const uit = actueelLink({ titel: "Nieuwsbrief van vandaag", href: "https://voorbeeld.nl/nb", live: false });
  assert.match(uit, /^<a class="nap"/);
  assert.ok(!uit.includes("dot"), "geen stipje bij live:false: " + uit);
});

test("vorm 'pill' doet hetzelfde als een ontbrekend veld vorm", () => {
  const zonder = actueelLink({ titel: "A", href: "https://voorbeeld.nl/a", live: true });
  const met = actueelLink({ titel: "A", href: "https://voorbeeld.nl/a", vorm: "pill", live: true });
  assert.equal(met, zonder);
});

test("href, target, rel en de tooltip blijven werken zoals voorheen", () => {
  // Dit is de bestaande logica die de nieuwe vormen niet mogen slopen.
  const intern = actueelLink({ titel: "Recente activiteiten", tekst: "Wat er nu gebeurt.",
    href: "https://www.nederlanders.fr/#xg_network_activity", live: true });
  assert.match(intern, /target="_parent"/, "nederlanders.fr opent in de moederpagina");
  assert.ok(!intern.includes("rel="), "en dan zonder rel=noopener");
  assert.match(intern, /title="Wat er nu gebeurt\."/, "de tooltip komt uit het veld tekst");

  const extern = actueelLink({ titel: "Aanmelden",
    href: "https://voorbeeld.nl/form/?a=1&l=2", vorm: "tekst" });
  assert.match(extern, /target="_blank"[^>]*rel="noopener"/, "extern opent in een nieuw tabblad");
  assert.match(extern, /href="https:\/\/voorbeeld\.nl\/form\/\?a=1&amp;l=2"/,
    "en de ampersand in de link wordt ontsnapt: " + extern);
});

// ---- (b) de inhoud van actueel.json ---------------------------------------
// LET OP: dit legt redactionele inhoud vast, wat actueel-json.test.mjs met
// opzet NIET doet. Het staat hier omdat deze vier items en hun volgorde deel
// zijn van het afgesproken ontwerp van de lade. Wie de lade herschikt, hoort
// deze lijst mee te veranderen — het is geen bestand dat je stilletjes bijwerkt.

const DOC = JSON.parse(readFileSync(new URL("../actueel.json", import.meta.url), "utf8"));

const AFGESPROKEN = [
  { titel: "Recente activiteiten", href: "https://www.nederlanders.fr/#xg_network_activity", live: true, vorm: undefined },
  { titel: "Frankrijknieuws", href: "https://www.nederlanders.fr/page/actueel-frankrijknieuws", live: true, vorm: undefined },
  { titel: "Nieuwsbrief van vandaag", href: "https://nlfr-nieuwsbrief.vercel.app/api/nieuwsbrief", live: false, vorm: undefined },
  { titel: "Meld je aan voor de nieuwsbrief",
    href: "https://communities-abroad-c.email-provider.eu/memberforms/subscribe/standalone/form/?a=0f1aywezl2&l=ysinmqgflb",
    live: false, vorm: "tekst" },
];

test("de lade toont vier items", () => {
  assert.ok(Array.isArray(DOC.kaarten), "kaarten hoort een lijst te zijn");
  assert.equal(DOC.kaarten.length, 4);
});

test("de vier items staan in de afgesproken volgorde, met de afgesproken links", () => {
  assert.deepEqual(
    DOC.kaarten.map((k) => ({ titel: k.titel, href: k.href, live: k.live, vorm: k.vorm })),
    AFGESPROKEN
  );
});

test("precies twee items staan op live", () => {
  // Drie zou het stipje betekenisloos maken (dan pulseert bijna alles), nul
  // haalt het stipje van de balkknop weg.
  assert.equal(DOC.kaarten.filter((k) => k.live === true).length, 2);
});

test("de nieuwsbriefkaart draagt geen accent meer", () => {
  // Het veld stuurde niets aan en zou als restant blijven rondslingeren.
  assert.ok(!DOC.kaarten.some((k) => "accent" in k), "veld accent hoort weg te zijn");
});

test("het uitlegveld beschrijft de vorm, want daar wordt het bestand mee bijgewerkt", () => {
  // actueel.json wordt met de hand bijgewerkt en _uitleg is het enige wat de
  // redactie daarbij leest. Een nieuw veld dat daar niet in staat, bestaat voor
  // de redactie niet.
  // De losse woorden "vorm", "pill" en "tekst" vallen elders in deze uitleg ook
  // — daar toetsen op laat elke uitleg slagen. Het gaat om de twee waarden die
  // je in het bestand kunt invullen, en om wat live zichtbaar doet.
  assert.match(DOC._uitleg, /'vorm'/, "_uitleg benoemt het veld 'vorm' niet");
  assert.match(DOC._uitleg, /'pill'/, "_uitleg noemt de waarde 'pill' niet");
  assert.match(DOC._uitleg, /'tekst'/, "_uitleg noemt de waarde 'tekst' niet");
  assert.match(DOC._uitleg, /stipje/, "_uitleg legt niet uit wat 'live' zichtbaar doet");
});

// ---- (c) contrast, gemeten tegen de kleuren die er werkelijk staan ---------

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

test("de contrastformule klopt met de ijkpunten uit WCAG", () => {
  // Zonder deze regel is de rest een rekensom die niemand heeft nagekeken.
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.02);
});

const VARIABELEN = (() => {
  const m = CSS.match(/:root \{([^}]*)\}/);
  assert.ok(m, "geen :root-regel in index.html");
  const uit = {};
  for (const [, naam, waarde] of m[1].matchAll(/(--[\w-]+):\s*([^;]+)/g)) uit[naam] = waarde.trim();
  return uit;
})();

// Alle blokken met precies deze selector, aan elkaar. Een selector kan meer dan
// één keer voorkomen — .ladekaart.actueel staat bij de breedtes van de laden én
// bij de opmaak van de pills — en dan is alleen de eerste pakken misleidend:
// de toets zou rood worden op een regel die verderop gewoon staat.
function regel(selector) {
  const merk = selector + " {";
  let uit = "", i = CSS.indexOf(merk);
  assert.ok(i >= 0, `selector niet gevonden in index.html: ${selector}`);
  while (i >= 0) {
    const eind = CSS.indexOf("}", i);
    assert.ok(eind > i, `geen sluitaccolade na ${selector}`);
    uit += CSS.slice(i, eind) + "\n";
    i = CSS.indexOf(merk, eind);
  }
  return uit;
}
function hexVan(selector, eigenschap) {
  const m = regel(selector).match(new RegExp(`(?:^|[;{\\s])${eigenschap}:\\s*([^;]+)`));
  assert.ok(m, `geen ${eigenschap} in de regel voor ${selector}`);
  const waarde = m[1].trim();
  const v = waarde.match(/var\((--[\w-]+)\)/);
  const hex = v ? VARIABELEN[v[1]] : waarde;
  assert.match(hex || "", /^#[0-9a-f]{3,6}$/i, `onverwachte kleur bij ${selector}: ${waarde}`);
  return hex;
}

const EIS = 4.5; // WCAG AA, gewone tekst

test("de tekst op de pill haalt WCAG AA op de pillkleur", () => {
  // Niet tegen een aangenomen #800000 gemeten maar tegen de kleuren die in de
  // regel zelf staan: wordt de pill lichter gemaakt, dan valt dit om.
  const voor = hexVan(".ladekaart.actueel .nap", "color");
  const achter = hexVan(".ladekaart.actueel .nap", "background");
  const r = contrast(voor, achter);
  assert.ok(r >= EIS, `${voor} op ${achter} is ${r.toFixed(2)}:1, onder de eis van ${EIS}:1`);
});

test("de tekst op de pill blijft ook bij hover leesbaar", () => {
  const voor = hexVan(".ladekaart.actueel .nap:hover", "color");
  const achter = hexVan(".ladekaart.actueel .nap:hover", "background");
  const r = contrast(voor, achter);
  assert.ok(r >= EIS, `hover: ${voor} op ${achter} is ${r.toFixed(2)}:1`);
});

test("het tekstlinkje haalt WCAG AA op de witte lade", () => {
  const KAART = hexVan(".ladekaart", "background");
  assert.equal(luminantie(KAART), 1, "de lade hoort wit te zijn, anders meet dit tegen niets");
  for (const sel of [".ladekaart.actueel .nal", ".ladekaart.actueel .nal:hover"]) {
    const voor = hexVan(sel, "color");
    const r = contrast(voor, KAART);
    assert.ok(r >= EIS, `${sel} staat op ${voor}: ${r.toFixed(2)}:1, onder de eis van ${EIS}:1`);
  }
});

// ---- de twee CSS-eigenschappen waar het ontwerp op leunt -------------------

test("de generieke laderegel wint niet meer in deze lade", () => {
  // .lade .ladekaart > a zet min-height, color, padding en background. De
  // pillregel moet ze alle vier zelf zetten, anders lekt de grijze balk terug.
  const generiek = regel(".lade .ladekaart > a");
  const pill = regel(".ladekaart.actueel .nap");
  for (const eigenschap of ["min-height", "color", "padding", "background"]) {
    assert.match(generiek, new RegExp(`(?:^|[;{\\s])${eigenschap}:`),
      `de generieke regel zet ${eigenschap} niet meer — deze toets is dan aan herziening toe`);
    assert.match(pill, new RegExp(`(?:^|[;{\\s])${eigenschap}:`),
      `de pill overschrijft ${eigenschap} niet en erft hem van de generieke laderegel`);
  }
  assert.match(pill, /min-height: 0/, "de pill blijft klein: geen 44px hoge regel");
  assert.match(pill, /display: inline-flex/, "en geen volle-breedte flexregel");
});

test("het tikoppervlak is 44px zonder dat de pill groeit", () => {
  const vlak = regel(".ladekaart.actueel .nap::before,\n  .ladekaart.actueel .nal::before");
  assert.match(vlak, /position: absolute/, "het vlak ligt over de link heen");
  assert.match(vlak, /min-height: 44px/, "en is minstens 44px hoog");
  assert.ok(!/background/.test(vlak), "het vlak hoort onzichtbaar te blijven");
  // De pill zelf blijft klein: 13px tekst met 7px padding boven en onder.
  const pill = regel(".ladekaart.actueel .nap");
  assert.match(pill, /padding: 7px 15px/);
  assert.match(pill, /font-size: 13px/);
});

test("de lade zet de items onder elkaar, links uitgelijnd", () => {
  const kaart = regel(".ladekaart.actueel");
  assert.match(kaart, /flex-direction: column/);
  assert.match(kaart, /align-items: flex-start/, "anders rekken de pills over de volle breedte");
  assert.match(kaart, /gap: 8px/);
  assert.match(regel(".ladekaart.actueel .h"), /margin-bottom: 10px/);
});

test("op compact blijft de opmaak dezelfde", () => {
  // Er hoort geen aparte compactregel te zijn die de pills oprekt of van vorm
  // laat veranderen; align-items:flex-start doet daar hetzelfde werk. Deze
  // toets slaat aan zodra iemand er alsnog een breedte op zet.
  const compact = CSS.match(/html\.compact [^{]*\.(?:nap|nal)[^{]*\{[^}]*\}/g) || [];
  for (const r of compact) {
    assert.ok(!/width|display|font-size/.test(r), "compact verandert de pill: " + r);
  }
});
