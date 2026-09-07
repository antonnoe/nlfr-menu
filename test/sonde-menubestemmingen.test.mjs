// I16: het menu wijst nergens naar een 404.
// ---------------------------------------------------------------------------
// Het menu is op desktop de enige navigatie van nederlanders.fr. Sinds de vier
// laden zijn vervangen door links naar categoriepagina's wijst het naar
// pagina's die BUITEN deze repository staan: vier ingangen en de vier links in
// de smalle regel onder de balk. Hernoemt iemand daar een pagina, dan krijgt
// elke bezoeker een 404 en merkt niemand het — elke andere invariant van de
// sonde kijkt naar /api/actueel.
//
// WAT HIER MISGAAT ALS NIEMAND OPLET.
// 1. De lijst wordt uit index.html gelezen. Wijzigt de opbouw van dat bestand,
//    dan vindt lib/menu-bestemmingen.js zijn blok niet meer. Dat MOET een
//    bevinding worden en geen stille nul: een invariant die niets meer toetst
//    en toch groen blijft, is erger dan geen invariant.
// 2. Er komt een tweede lijst met dezelfde adressen, hier of in de sonde. Die
//    gaat afwijken, en dan bewaakt de sonde adressen die niemand gebruikt.
// 3. Elke niet-200 wordt rood. Dan gaat de sonde af op de uptime van andermans
//    site en leert iedereen hem te negeren.
//
// De netwerkkant is hier niet getoetst: nederlanders.fr is vanuit deze omgeving
// niet bereikbaar. Wat wél getoetst wordt is alles wat kan verschuiven zonder
// dat iemand het merkt — welke adressen eruit komen, en wat een statuscode
// betekent.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { bestemmingenUit, oordeelOverStatus } from "../lib/menu-bestemmingen.js";

const HTML = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const SONDE = fs.readFileSync(new URL("../scripts/sonde.mjs", import.meta.url), "utf8");
const NL = "https://www.nederlanders.fr";

test("de acht bestemmingen komen uit index.html, niet uit een lijst hier", () => {
  const uit = bestemmingenUit(HTML);
  assert.deepEqual(uit.map((b) => b.url), [
    NL + "/page/lezen",
    NL + "/page/meedoen",
    NL + "/page/vinden",
    NL + "/page/frankrijknieuws",
    NL + "/page/diensten",
    "https://infofrankrijk.com/",
    "https://www.cafeclaude.fr/",
    "https://nedergids.nl/",
  ]);
  // Elke bestemming zegt ook waar hij vandaan komt, anders staat er straks een
  // kale URL in een foutmelding en moet iemand gaan zoeken.
  for (const b of uit) assert.match(b.naam, /^(ingang|subbalk) /, "onduidelijke herkomst: " + b.naam);
});

test("de lijst volgt het menu: een gewijzigde ingang komt er meteen uit", () => {
  // Dit is de hele reden dat er uit index.html wordt gelezen. Zou de lijst hier
  // of in de sonde staan, dan bleef de sonde het oude adres bewaken.
  const gewijzigd = HTML.replace('url: U("/page/vinden")', 'url: U("/page/gereedschap")');
  assert.notEqual(gewijzigd, HTML, "de mutatie is niet toegepast");
  const urls = bestemmingenUit(gewijzigd).map((b) => b.url);
  assert.ok(urls.includes(NL + "/page/gereedschap"), "het nieuwe adres wordt bewaakt");
  assert.ok(!urls.includes(NL + "/page/vinden"), "en het oude niet meer");
});

test("een onleesbaar datablok is een fout, geen stille nul", () => {
  const stuk = HTML.replace("  var U = function(p)", "  var Uu = function(p)");
  assert.throws(() => bestemmingenUit(stuk), /datablok van het menu is niet gevonden/);
});

test("dubbele adressen worden één keer bevraagd", () => {
  const dubbel = HTML.replace('["Diensten", U("/page/diensten")]', '["Diensten", U("/page/lezen")]');
  const urls = bestemmingenUit(dubbel).map((b) => b.url);
  assert.equal(urls.filter((u) => u === NL + "/page/lezen").length, 1);
});

test("alleen 404 en 410 zijn rood", () => {
  assert.equal(oordeelOverStatus(404).rood, true);
  assert.equal(oordeelOverStatus(410).rood, true);
  assert.match(oordeelOverStatus(404).reden, /bestaat niet/);
  for (const status of [200, 204, 301, 302]) {
    assert.equal(oordeelOverStatus(status).rood, false, status + " hoort groen te zijn");
    assert.equal(oordeelOverStatus(status).notitie, undefined, status + " hoeft geen notitie");
  }
  // Een 403 of 500 zegt iets over de uptime van andermans site op dat moment.
  // Daar dagelijks rood op gaan maakt de sonde waardeloos; het wordt wel
  // gemeld, zodat het niet volledig onzichtbaar blijft.
  for (const status of [403, 429, 500, 503]) {
    const o = oordeelOverStatus(status);
    assert.equal(o.rood, false, status + " hoort geen rood te geven");
    assert.match(o.notitie, /niet bereikbaar/, status + " hoort wel een notitie te geven");
  }
});

test("de sonde roept de invariant aan en houdt geen eigen lijst bij", () => {
  assert.match(SONDE, /import \{ bestemmingenUit, oordeelOverStatus \} from "\.\.\/lib\/menu-bestemmingen\.js"/);
  // Aan het begin van een regel, dus niet uitgecommentarieerd: een assert op
  // de losse tekst slaagt ook als de aanroep achter twee schuine strepen staat.
  assert.match(SONDE, /^\s*await toetsMenubestemmingen\(\);\s*$/m, "hij draait in main()");
  const blok = SONDE.slice(SONDE.indexOf("async function toetsMenubestemmingen()"));
  assert.match(blok, /bestemmingenUit\(html\)/, "de lijst komt uit index.html");
  assert.match(blok, /meld\("I16 menubestemmingen"/, "en een 404 wordt een bevinding");
  // Geen tweede opsomming in de sonde zelf.
  assert.ok(!/\/page\/(lezen|meedoen|vinden|frankrijknieuws|diensten)/.test(SONDE),
    "de sonde hoort geen enkel menupad letterlijk te bevatten");
});

test("een leesfout van index.html wordt zelf een bevinding", () => {
  const blok = SONDE.slice(SONDE.indexOf("async function toetsMenubestemmingen()"));
  // Alleen de vangst zelf: van "catch" tot de eerste console.log erna. Zoeken op
  // de eerstvolgende meld() in de hele functie vindt ook die van de 404 verderop,
  // en dan slaagt de toets terwijl de vangst leeg is.
  const vangst = blok.slice(blok.indexOf("} catch"), blok.indexOf("console.log("));
  assert.match(vangst, /meld\("I16 menubestemmingen"/,
    "stil overslaan is precies hoe een sonde groen blijft terwijl hij niets doet");
});
