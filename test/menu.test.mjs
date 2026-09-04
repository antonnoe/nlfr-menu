// Het hoofdmenu is op desktop de ENIGE navigatie van nederlanders.fr: de
// tabbalk van Ning is alleen voor beheerders zichtbaar. Een link die bij een
// herbouw sneuvelt, is dus een pagina die voor bezoekers onbereikbaar wordt.
// Daarom staat de volledige URL-inventaris van het oude menu vast in
// test/fixtures/menu-urls-oud.json en bewaakt deze test dat elke URL daaruit
// terugkomt — op de drie na die bewust zijn geschrapt of samengevoegd.
//
// De tests lezen de datablokken uit index.html en voeren ze uit, zodat ze de
// echte inhoud toetsen en niet een tweede kopie die kan gaan afwijken.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const OUD = JSON.parse(fs.readFileSync(new URL("./fixtures/menu-urls-oud.json", import.meta.url), "utf8"));

const NL = "https://www.nederlanders.fr";

// Uit de opdracht: deze drie verdwijnen met opzet.
//   /page/rubrieken .................. vervalt
//   /group/vervoerspagina ............ samengevoegd met /page/lift-en-transportcentrale
//   /profiles/blogs/overzicht-... .... samengevoegd met /page/nederlandse-verenigingen-in-frankrijk
const BEWUST_WEG = new Set([
  NL + "/page/rubrieken",
  NL + "/group/vervoerspagina",
  NL + "/profiles/blogs/overzicht-van-nederlandse-verenigingen-in-frankrijk",
]);

// De datablokken uit index.html uitvoeren. Het menu is één bestand zonder
// bouwstap, dus dit is de enige manier om bij de echte lijsten te komen.
function menuData() {
  const pak = (van, tot) => {
    const a = HTML.indexOf(van), b = HTML.indexOf(tot);
    assert.ok(a >= 0, "blok niet gevonden in index.html: " + van);
    assert.ok(b > a, "eindmarkering niet gevonden in index.html: " + tot);
    return HTML.slice(a, b);
  };
  const bron =
    pak("var DOORS = {", "// Mijn NLFR is de vijfde kolom") +
    pak("function memberGroups()", "var ADMIN_LINKS") +
    pak("var ADMIN_LINKS =", "var PERKS") +
    pak("var PERKS =", "var ZUSTERS") +
    pak("var ZUSTERS =", "var DEUR_VOLGORDE") +
    pak("var DEUR_VOLGORDE =", "var ACTUEEL = null");

  const fn = new Function("U", "myPage", "uid",
    bron + "\nreturn { DOORS, memberGroups, ADMIN_LINKS, PERKS, ZUSTERS, PANEELKNOPPEN, DEUR_VOLGORDE };");
  return fn((p) => NL + p, NL + "/profiles/settings/editProfileInfo", "UID");
}

// Alle URL's die in het nieuwe menu voorkomen: uit de datablokken plus de vaste
// links in de body-markup en in msiteHTML().
function nieuweUrls() {
  const d = menuData();
  const set = new Set();
  const voegToe = (u) => { if (u) set.add(String(u).replace(/&amp;/g, "&")); };

  for (const deur of Object.values(d.DOORS)) {
    for (const [, links] of deur.groups) for (const l of links) voegToe(l[1]);
  }
  for (const [, links] of d.memberGroups()) for (const l of links) voegToe(l[1]);
  for (const l of d.ADMIN_LINKS) voegToe(l[1]);
  for (const z of d.ZUSTERS) voegToe(z[1]);
  for (const k of d.PANEELKNOPPEN) voegToe(k[1]);

  // Vaste links in de markup en in de /m-lijst: die staan letterlijk in het
  // bestand, dus daar zoeken we ze ook letterlijk op.
  for (const m of HTML.matchAll(/href="(https?:\/\/[^"]+)"/g)) voegToe(m[1]);
  for (const m of HTML.matchAll(/U\("([^"]+)"\)/g)) voegToe(NL + m[1]);
  return set;
}

test("elke URL uit het oude menu komt terug in het nieuwe", () => {
  const nieuw = nieuweUrls();
  const mist = [];
  for (const { url, label } of OUD) {
    if (BEWUST_WEG.has(url)) continue;
    // De ledenlinks bevatten het profiel-id; vergelijk op het vaste deel.
    const kaal = url.replace("UID", "");
    const gevonden = nieuw.has(url) || [...nieuw].some((u) => u.replace("UID", "") === kaal);
    if (!gevonden) mist.push(url + "  <- stond in: " + label);
  }
  assert.deepEqual(mist, [], "deze pagina's zijn onbereikbaar geworden");
});

test("de drie bewust geschrapte URL's staan er ook echt niet meer in", () => {
  const nieuw = nieuweUrls();
  for (const weg of BEWUST_WEG) {
    assert.ok(!nieuw.has(weg), weg + " hoort vervallen te zijn");
  }
  assert.ok(!HTML.includes('U("/page/rubrieken")'), "geen link naar de rubriekenpagina meer");
  assert.ok(!HTML.includes("/page/rubrieken\""), "ook niet als letterlijke URL");
});

test("de TOPICS-items zijn naar hun nieuwe deur verhuisd", () => {
  const d = menuData();
  const inGroep = (deur, groep, url) => {
    const g = d.DOORS[deur].groups.find((x) => x[0].replace(/&amp;/g, "&") === groep);
    assert.ok(g, "groep niet gevonden: " + deur + " > " + groep);
    return g[1].some((l) => l[1] === url);
  };
  assert.ok(inGroep("lezen", "Marktplaats", NL + "/profiles/blog/list?tag=Woningen+Aangeboden"), "Huizen aangeboden");
  assert.ok(inGroep("lezen", "Marktplaats", "https://www.facebook.com/groups/kringloopfrankrijk/"), "Kringloopwinkel");
  assert.ok(inGroep("lezen", "Leren & taal", NL + "/profiles/blog/list?tag=Correspondentie"), "Correspondentie");
  assert.ok(inGroep("lezen", "Ontmoeten & cultuur", NL + "/profiles/blog/list?tag=Korte+Verhalen"), "Korte verhalen");
  assert.ok(d.ZUSTERS.some((z) => z[1] === "https://www.communitiesabroad.com"), "Communities Abroad hoort bij de zusterplatforms");
});

test("de nieuwe links uit de opdracht staan erin", () => {
  const d = menuData();
  const urls = new Set();
  for (const deur of Object.values(d.DOORS)) for (const [, links] of deur.groups) for (const l of links) urls.add(l[1]);
  assert.ok(urls.has(NL + "/profiles/blogs/waarom-zou-u-lid-worden-van-nederlanders-fr"), "Waarom aanmelden");
  assert.ok([...urls].some((u) => u.includes("/profiles/message/newFromProfile?screenName=3pjypz5h1ilpc")), "Contact beheerder");
  const uitgelicht = d.DOORS.vinden.groups.find((g) => g[0] === "Uitgelicht");
  assert.ok(uitgelicht[1].some((l) => l[1] === NL + "/profiles/blog/list?promoted=1"), "In de schijnwerpers in Vinden > Uitgelicht");
});

test("de dubbele URL's zijn samengevoegd tot één adres", () => {
  const nieuw = nieuweUrls();
  assert.ok(nieuw.has(NL + "/page/lift-en-transportcentrale"), "Vervoershub");
  assert.ok(!nieuw.has(NL + "/group/vervoerspagina"), "geen tweede vervoers-URL");
  assert.ok(nieuw.has(NL + "/page/nederlandse-verenigingen-in-frankrijk"), "Verenigingen");
  assert.ok(!nieuw.has(NL + "/profiles/blogs/overzicht-van-nederlandse-verenigingen-in-frankrijk"), "geen tweede verenigingen-URL");
  assert.ok(nieuw.has("https://laposta.nl/f/ssysinmqgflb"), "nieuwsbrief");
  const brieven = [...nieuw].filter((u) => /nieuwsbrief|laposta/i.test(u));
  assert.equal(brieven.length, 1, "de nieuwsbrief hoort maar op één adres te staan: " + brieven.join(", "));
});

// Op de code toetsen, niet op de prozatekst: de commentaarkop hierboven noemt
// deze namen juist omdat ze zijn vervallen.
test("het Onderwerpen-menu, de CTA's en de mobiele uitzonderingen zijn weg", () => {
  const restanten = [
    "var TOPICS", "var CTAS", "var TOPICS_MOBILE_MAX", "var MOBILE_QUICK", "var MOBILE_HIDE",
    'id="pullbtn"', 'id="bandleft"', 'id="ecotoggle"', ">Onderwerpen<", "quickHTML", "DOOR_DEFS",
  ];
  for (const restant of restanten) {
    assert.ok(!HTML.includes(restant), "restant van het oude menu gevonden: " + restant);
  }
});

test("alle links hebben hetzelfde gewicht: geen accent-, support- of emph-klasse", () => {
  const css = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
  for (const klasse of ["accent", "support", "emph"]) {
    assert.ok(!new RegExp("\\." + klasse + "\\b").test(css),
      "CSS-klasse ." + klasse + " hoort te zijn vervallen");
    assert.ok(!new RegExp('class="[^"]*\\b' + klasse + '\\b').test(HTML),
      "class=\"" + klasse + "\" hoort te zijn vervallen");
  }
  // link() zet geen klasse meer op een menu-link: het derde argument is het
  // target, niet een klasse.
  assert.ok(/function link\(href, label, forceT\)/.test(HTML),
    "link() hoort alleen nog href, label en een target te kennen");
  // Geen emoji in de labels (die zaten in TOPICS).
  const emoji = HTML.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
  assert.deepEqual(emoji, [], "geen emoji meer in het menu");
});

test("geen enkele uitklapper is een position:absolute-overlay", () => {
  // In een iframe met hoogte-sync wordt een overlay afgeknipt; alle laden en
  // panelen staan daarom in de flow.
  const css = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
  for (const sel of [".lade", ".paneel", ".deurbody", ".bnr-uitleg"]) {
    const re = new RegExp("\\" + sel + "\\s*\\{[^}]*position:\\s*absolute", "i");
    assert.ok(!re.test(css), sel + " hoort in de flow te staan, niet absoluut");
  }
  assert.ok(!/position:\s*fixed/i.test(css), "ook geen fixed overlay");
});

test("de link-targetregels zijn ongewijzigd", () => {
  const d = menuData();
  // nederlanders.fr -> _parent, extern -> _blank rel=noopener, abonnement -> _top
  const abo = d.DOORS.doen.groups.find((g) => g[0] === "Steunen")[1]
    .find((l) => l[1] === "https://infofrankrijk.com/abonnement/");
  assert.ok(abo, "Word abonnee ontbreekt");
  assert.equal(abo[2], "_top", "het abonnement opent de hele pagina");
  assert.ok(HTML.includes('target="_parent"'), "eigen site opent in _parent");
  assert.ok(HTML.includes('rel="noopener"'), "externe links krijgen rel=noopener");
});

test("de vijf kolommen staan in de goede volgorde", () => {
  const d = menuData();
  assert.deepEqual(d.DEUR_VOLGORDE, ["lezen", "doen", "vinden", "mijn", "nieuws"]);
  assert.equal(d.DOORS.lezen.naam, "Lezen");
  assert.equal(d.DOORS.doen.naam, "Meedoen");
  assert.equal(d.DOORS.vinden.naam, "Vinden");
  assert.equal(d.DOORS.nieuws.naam, "Nieuws");
});

test("de beheerlade begint met Banner beheren", () => {
  const d = menuData();
  assert.equal(d.ADMIN_LINKS[0][0], "Banner beheren");
  assert.equal(d.ADMIN_LINKS[0][1], "/banner-beheer");
  assert.equal(d.ADMIN_LINKS[0][2], "_blank", "de beheerpagina opent in een nieuw tabblad");
  assert.ok(!/BANNER_TOKEN/.test(HTML), "er hoort geen token in de menu-HTML te staan");
});

test("/m houdt zijn korte lijst en krijgt NLFR Mobiel bovenaan", () => {
  assert.ok(HTML.includes("msiteHTML"), "de /m-lijst bestaat nog");
  assert.ok(HTML.includes("https://www.nederlanders.fr/m?id=3295325%3AMobilePage%3A1374046"),
    "NLFR Mobiel hoort bovenaan de /m-lijst");
  assert.ok(HTML.includes('"NLFR Mobiel"'), "met het label NLFR Mobiel");
});

test("de kaartkop, de strip en de hoogte-sync staan er zoals afgesproken", () => {
  assert.ok(HTML.includes("Hèt netwerk van, voor en door Nederlandstaligen in Frankrijk - zegt het voort!"), "slogan");
  assert.ok(HTML.includes("AI-zoek in forum &amp; Infofrankrijk…"), "zoekplaceholder");
  assert.ok(HTML.includes("nlfrMenuHeight"), "hoogte-sync");
  assert.ok(HTML.includes("noresize"), "noresize-terugval");
  assert.ok(HTML.includes('e.origin !== PARENT_ORIGIN'), "PARENT_ORIGIN-check ongewijzigd");
  assert.ok(HTML.includes('<meta name="color-scheme" content="only light">'), "auto-dark geblokkeerd");
  assert.ok(/color-scheme:\s*only light/.test(HTML), ":root color-scheme");
});
