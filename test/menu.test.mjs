// Het hoofdmenu is op desktop de ENIGE navigatie van nederlanders.fr: de
// tabbalk van Ning is alleen voor beheerders zichtbaar. Een link die bij een
// herbouw sneuvelt, is dus een pagina die voor bezoekers onbereikbaar wordt.
// Daarom staat de volledige URL-inventaris van het oude menu vast in
// test/fixtures/menu-urls-oud.json.
//
// SINDS 07-09-2026 DEKT HET MENU DIE INVENTARIS NIET MEER ZELF. Lezen,
// Meedoen, Vinden en Nieuws zijn vier links naar openbare categoriepagina's
// geworden; de 72 links die in hun laden zaten staan nu op die pagina's, op
// nederlanders.fr, buiten dit bestand. Wat waar hoort te staan ligt vast in
// test/fixtures/menu-urls-verhuisd.json. Deze test bewaakt dus nog maar de
// helft van de oude belofte: dat er geen URL ZOEK is geraakt zonder dat
// iemand heeft opgeschreven waar hij heen ging. Of die pagina hem werkelijk
// bevat, kan een test hier niet zien — daarvoor is een sonde nodig die de
// vier pagina's ophaalt.
//
// De tests lezen de datablokken uit index.html en voeren ze uit, zodat ze de
// echte inhoud toetsen en niet een tweede kopie die kan gaan afwijken.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const OUD = JSON.parse(fs.readFileSync(new URL("./fixtures/menu-urls-oud.json", import.meta.url), "utf8"));
const VERHUISD = JSON.parse(fs.readFileSync(new URL("./fixtures/menu-urls-verhuisd.json", import.meta.url), "utf8"));

const NL = "https://www.nederlanders.fr";

// Uit de opdrachten: deze vijf verdwijnen met opzet.
//   /page/rubrieken .................. vervalt
//   /group/vervoerspagina ............ samengevoegd met /page/lift-en-transportcentrale
//   /profiles/blogs/overzicht-... .... samengevoegd met /page/nederlandse-verenigingen-in-frankrijk
//   communitiesabroad.com ............ corporate communicatie, niet voor deze
//                                      bezoeker; uit de zusterplatforms gehaald
//   /diensten ........................ vervangen door /page/diensten, de pagina
//                                      binnen Ning; de oude stond daarbuiten
const BEWUST_WEG = new Set([
  NL + "/page/rubrieken",
  NL + "/group/vervoerspagina",
  NL + "/profiles/blogs/overzicht-van-nederlandse-verenigingen-in-frankrijk",
  "https://www.communitiesabroad.com",
  NL + "/diensten",
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
    pak("var DEUREN_LINK = {", "// Mijn NLFR is de vijfde kolom") +
    pak("function memberGroups()", "var ADMIN_LINKS") +
    pak("var ADMIN_LINKS =", "var WERVING") +
    pak("var WERVING =", "var ZUSTERS") +
    pak("var ZUSTERS =", "var DEUR_VOLGORDE") +
    pak("var DEUR_VOLGORDE =", "var ACTUEEL = null");

  const fn = new Function("U", "myPage", "uid",
    bron + "\nreturn { DEUREN_LINK, memberGroups, ADMIN_LINKS, WERVING, ZUSTERS, SNELRIJ, PLAATS_KOLOMMEN, DEUR_VOLGORDE };");
  return fn((p) => NL + p, NL + "/profiles/settings/editProfileInfo", "UID");
}

// Alle URL's die in het nieuwe menu voorkomen: uit de datablokken plus de vaste
// links in de body-markup en in msiteHTML().
function nieuweUrls() {
  const d = menuData();
  const set = new Set();
  const voegToe = (u) => { if (u) set.add(String(u).replace(/&amp;/g, "&")); };

  for (const deur of Object.values(d.DEUREN_LINK)) voegToe(deur.url);
  for (const [, links] of d.memberGroups()) for (const l of links) voegToe(l[1]);
  for (const l of d.ADMIN_LINKS) voegToe(l[1]);
  for (const z of d.ZUSTERS) voegToe(z[1]);
  for (const k of d.SNELRIJ) voegToe(k[1]);

  // Vaste links in de markup en in de /m-lijst: die staan letterlijk in het
  // bestand, dus daar zoeken we ze ook letterlijk op.
  for (const m of HTML.matchAll(/href="(https?:\/\/[^"]+)"/g)) voegToe(m[1]);
  for (const m of HTML.matchAll(/U\("([^"]+)"\)/g)) voegToe(NL + m[1]);
  return set;
}

// Elke URL uit het oude menu staat OF nog in het menu, OF in de verhuislijst
// met de categoriepagina die hem hoort te dragen. Wat in geen van beide staat,
// is stilletjes verdwenen — en dat is precies het geval dat niemand merkt.
test("geen enkele URL uit het oude menu is spoorloos", () => {
  const nieuw = nieuweUrls();
  const verhuisd = new Set(VERHUISD.map((v) => v.url));
  const mist = [];
  for (const { url, label } of OUD) {
    if (BEWUST_WEG.has(url)) continue;
    // De ledenlinks bevatten het profiel-id; vergelijk op het vaste deel.
    const kaal = url.replace("UID", "");
    const gevonden =
      nieuw.has(url) || [...nieuw].some((u) => u.replace("UID", "") === kaal) ||
      verhuisd.has(url) || [...verhuisd].some((u) => u.replace("UID", "") === kaal);
    if (!gevonden) mist.push(url + "  <- stond in: " + label);
  }
  assert.deepEqual(mist, [], "deze pagina's zijn onbereikbaar geworden");
});

test("elke verhuisde URL noemt de pagina die hem hoort te bevatten", () => {
  const paginas = new Set([
    NL + "/page/lezen", NL + "/page/meedoen", NL + "/page/vinden", NL + "/page/frankrijknieuws",
  ]);
  assert.ok(VERHUISD.length > 0, "de verhuislijst hoort gevuld te zijn");
  for (const v of VERHUISD) {
    assert.ok(v.url && v.label, "elke regel noemt zijn URL en waar hij stond: " + JSON.stringify(v));
    assert.ok(paginas.has(v.pagina), "onbekende doelpagina: " + v.pagina);
  }
  // En het menu wijst naar alle vier die pagina's, anders is de verhuizing een
  // doodlopende weg.
  const nieuw = nieuweUrls();
  for (const pagina of paginas) assert.ok(nieuw.has(pagina), "het menu wijst niet naar " + pagina);
});

test("de bewust geschrapte URL's staan er ook echt niet meer in", () => {
  const nieuw = nieuweUrls();
  for (const weg of BEWUST_WEG) {
    assert.ok(!nieuw.has(weg), weg + " hoort vervallen te zijn");
  }
  assert.ok(!HTML.includes('U("/page/rubrieken")'), "geen link naar de rubriekenpagina meer");
  assert.ok(!HTML.includes("/page/rubrieken\""), "ook niet als letterlijke URL");
});

test("de TOPICS-items staan op de pagina waar ze thuishoren", () => {
  const d = menuData();
  const op = (url) => VERHUISD.find((v) => v.url === url);
  const lezen = NL + "/page/lezen";
  for (const url of [
    NL + "/profiles/blog/list?tag=Woningen+Aangeboden",     // Huizen aangeboden
    "https://www.facebook.com/groups/kringloopfrankrijk/",  // Kringloopwinkel
    NL + "/profiles/blog/list?tag=Correspondentie",         // Correspondentie
    NL + "/profiles/blog/list?tag=Korte+Verhalen",          // Korte verhalen
  ]) {
    const v = op(url);
    assert.ok(v, "niet in de verhuislijst: " + url);
    assert.equal(v.pagina, lezen, url + " hoorde onder Lezen te vallen");
  }
  // Communities Abroad stond hier bij de zusterplatforms en is er in de
  // opruiming van 07-09-2026 uit gehaald: corporate communicatie, niet waar een
  // bezoeker van dit menu naar op zoek is.
  assert.ok(!d.ZUSTERS.some((z) => z[1] === "https://www.communitiesabroad.com"),
    "Communities Abroad hoort uit de zusterplatforms te zijn");
  assert.deepEqual(d.ZUSTERS.map((z) => z[0]), ["Infofrankrijk", "Café Claude", "Nedergids"]);
});

test("de links uit de vorige opdracht zijn mee verhuisd, niet geschrapt", () => {
  const op = (fn) => VERHUISD.find((v) => fn(v.url));
  assert.equal(op((u) => u === NL + "/profiles/blogs/waarom-zou-u-lid-worden-van-nederlanders-fr").pagina,
    NL + "/page/meedoen", "Waarom aanmelden");
  assert.equal(op((u) => u.includes("/profiles/message/newFromProfile?screenName=3pjypz5h1ilpc")).pagina,
    NL + "/page/vinden", "Contact beheerder");
  assert.equal(op((u) => u === NL + "/profiles/blog/list?promoted=1").pagina,
    NL + "/page/lezen", "In de schijnwerpers");
});

test("de dubbele URL's zijn samengevoegd tot één adres", () => {
  // Menu plus verhuislijst samen: dat is wat er van het oude menu over is.
  const alles = new Set([...nieuweUrls(), ...VERHUISD.map((v) => v.url)]);
  assert.ok(alles.has(NL + "/page/lift-en-transportcentrale"), "Vervoershub");
  assert.ok(!alles.has(NL + "/group/vervoerspagina"), "geen tweede vervoers-URL");
  assert.ok(alles.has(NL + "/page/nederlandse-verenigingen-in-frankrijk"), "Verenigingen");
  assert.ok(!alles.has(NL + "/profiles/blogs/overzicht-van-nederlandse-verenigingen-in-frankrijk"), "geen tweede verenigingen-URL");
  assert.ok(alles.has("https://laposta.nl/f/ssysinmqgflb"), "nieuwsbrief");
  const brieven = [...alles].filter((u) => /nieuwsbrief|laposta/i.test(u));
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
  // nederlanders.fr -> _parent, extern -> _blank rel=noopener.
  assert.ok(HTML.includes('target="_parent"'), "eigen site opent in _parent");
  assert.ok(HTML.includes('rel="noopener"'), "externe links krijgen rel=noopener");
  // "Word abonnee" stond met target _top in Meedoen en is mee verhuisd naar
  // /page/meedoen. Die pagina staat op nederlanders.fr en bepaalt zijn eigen
  // targets; hier ligt alleen nog vast waar hij heen ging.
  const abo = VERHUISD.find((v) => v.url === "https://infofrankrijk.com/abonnement/");
  assert.ok(abo, "Word abonnee is uit de inventaris verdwenen");
  assert.equal(abo.pagina, NL + "/page/meedoen");
});

test("de smalle regel onder de balk telt precies vier links", () => {
  const d = menuData();
  assert.deepEqual(d.SNELRIJ.map((k) => k[0]),
    ["Diensten", "Infofrankrijk", "Café Claude", "Nedergids"],
    "deze vier, in deze volgorde, en geen andere");
  assert.equal(d.SNELRIJ[0][1], NL + "/page/diensten",
    "Diensten wijst naar de pagina binnen Ning, niet naar het oude /diensten");
  // De drie zusterplatforms komen uit ZUSTERS, dus ze staan op één plek.
  assert.deepEqual(d.SNELRIJ.slice(1), d.ZUSTERS);
});

test("de knoppen onderin het paneel zijn vervallen", () => {
  // Plaats bericht en Plaats advertentie stonden dubbel: in de balk en in de
  // tegel Meedoen. De zusterlinks stonden onderin het paneel, waar niemand ze
  // zag die het menu niet uitklapte; die staan nu in de smalle regel.
  assert.ok(!/var PANEELKNOPPEN/.test(HTML), "PANEELKNOPPEN hoort verdwenen te zijn");
  assert.ok(!/class="vlinks"/.test(HTML), "en de rij eromheen ook");
  assert.ok(!/class="zusters"/.test(HTML), "de zusterrij onderin het paneel is verhuisd");
  assert.ok(!/Zusterplatforms:/.test(HTML), "inclusief zijn opschrift");
  // De voetrij draagt op een breed scherm alleen het kruisje; op mobiel staan de
  // vier links uit de subbalk erbij. Wat hij nergens meer draagt, zijn de drie
  // oude knoppen. Zie test/subbalk.test.mjs voor beide standen.
  const voet = HTML.slice(HTML.indexOf("function voetHTML(smal){"), HTML.indexOf("function bouwPaneel(){"));
  assert.match(voet, /smal \? '<div class="voetlinks">' \+ snelrijHTML\(\)/,
    "op mobiel de vier links uit SNELRIJ, uit dezelfde renderer");
  assert.match(voet, /id="sluitbtn"/, "en het kruisje");
  assert.ok(!/PANEELKNOPPEN|vlinks/.test(voet), "en niets van de oude voetrij");
});

test("de vijf kolommen staan in de goede volgorde", () => {
  const d = menuData();
  assert.deepEqual(d.DEUR_VOLGORDE, ["lezen", "doen", "vinden", "mijn", "nieuws"]);
  assert.equal(d.DEUREN_LINK.lezen.naam, "Lezen");
  assert.equal(d.DEUREN_LINK.doen.naam, "Meedoen");
  assert.equal(d.DEUREN_LINK.vinden.naam, "Vinden");
  assert.equal(d.DEUREN_LINK.nieuws.naam, "Nieuws");
  // Mijn NLFR is de enige die geen link is; hij staat niet in DEUREN_LINK.
  assert.ok(!d.DEUREN_LINK.mijn, "Mijn NLFR hoort zijn lade te houden");
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

// De kaartkop met "Nederlanders.fr" en de slogan is weg: op nederlanders.fr
// staat NING's eigen sitekop met dezelfde naam en slogan direct boven dit
// iframe, dus hij stond dubbel.
test("er staat geen kaartkop meer boven de strip", () => {
  assert.ok(!HTML.includes("Hèt netwerk van, voor en door Nederlandstaligen in Frankrijk"),
    "de slogan hoort weg te zijn");
  assert.ok(!/<div class="kop">/.test(HTML), "het kop-blok hoort weg te zijn");
  assert.ok(!/^\s*\.kop\s*\{/m.test(HTML) && !/\.kop \.naam|\.kop \.slogan/.test(HTML),
    "en de bijbehorende CSS ook");
  // De strip is nu het eerste element in de kaart; de afronding komt van de
  // kaart, die overflow:hidden heeft.
  assert.match(HTML, /<div class="card">\s*<div class="strip">/, "de strip volgt meteen op de kaart");
  assert.match(HTML, /\.card \{[^}]*border-radius: 16px/, "de kaart houdt zijn afronding");
  assert.match(HTML, /\.card \{[^}]*overflow: hidden/, "en knipt de strip mee af");
});

test("de strip en de hoogte-sync staan er zoals afgesproken", () => {
  assert.ok(HTML.includes("AI-zoek in forum &amp; Infofrankrijk…"), "zoekplaceholder");
  assert.ok(HTML.includes("nlfrMenuHeight"), "hoogte-sync");
  assert.ok(HTML.includes("noresize"), "noresize-terugval");
  assert.ok(HTML.includes('e.origin !== PARENT_ORIGIN'), "PARENT_ORIGIN-check ongewijzigd");
  assert.ok(HTML.includes('<meta name="color-scheme" content="only light">'), "auto-dark geblokkeerd");
  assert.ok(/color-scheme:\s*only light/.test(HTML), ":root color-scheme");
});
