// Het teruggelezen token is identiek aan het weggeschreven token.
// ---------------------------------------------------------------------------
// AANLEIDING. Anton plakt zijn beheertoken van 22 tekens, de tool werkt. Hij
// sluit de browser af, opent /review opnieuw, en krijgt "Ongeldig of ontbrekend
// token. Er ging een token van 32 tekens mee." Er wordt dus wél iets bewaard en
// meegestuurd, maar niet wat erin ging.
//
// Sterkste verdachte was het baken uit de opslagdiagnose (#37): een tweede
// waarde in dezelfde opslag, die als token teruggelezen zou worden. Deze
// toetsen leggen vast dat dat niet kan — en ze draaien de ECHTE bootstrapcode
// uit review.html, twee keer tegen dezelfde opslag, zoals een tweede bezoek.
//
// Ze zijn er ook voor de volgende sleutel die iemand aan deze pagina toevoegt.
// Er staan er inmiddels drie (token, baken, tokenvorm) plus die van /actueel op
// hetzelfde domein; dat de juiste eruit komt hoort vast te liggen en niet te
// berusten op wie er het laatst iets bijzette.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");

// Het bootstrapblok: van de sleutelnamen tot en met de plek waar `token` is
// bepaald. Faalt dit, dan is de opzet veranderd en moet deze toets mee — beter
// dan stilzwijgend niets meten.
const start = review.indexOf('  var TOKENSLEUTEL = "nlfr_review_token";');
assert.ok(start > 0, "het bootstrapblok is niet gevonden in review.html");
const naUrl = review.indexOf("history.replaceState", start);
assert.ok(naUrl > start, "het URL-blok is niet gevonden");
const eind = review.indexOf("\n\n", review.indexOf("\n", naUrl));
const BRON = review.slice(start, eind);

function maakStore(db) {
  return {
    getItem: (k) => (db.has(k) ? db.get(k) : null),
    setItem: (k, v) => db.set(k, String(v)),
    removeItem: (k) => db.delete(k),
  };
}

// Eén paginabezoek tegen een meegegeven opslag.
function bezoek(db, { zoek = "", sessionDb = new Map() } = {}) {
  const window = { localStorage: maakStore(db), sessionStorage: maakStore(sessionDb) };
  window.self = window;
  window.top = window;
  const doc = { getElementById: () => null, addEventListener() {}, querySelector: () => null };
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "window", "location", "history", "URLSearchParams", "document",
    "state", "render", "inhoudEl", "melding", "tekenToken", "tekenMeldingen", "laad",
    `${BRON}
     return { token: token, bewaardRuw: bewaardRuw, tokenGewijzigd: tokenGewijzigd,
              vormBijOpslaan: vormBijOpslaan, vormTeruggelezen: vormTeruggelezen,
              tokenVorm: tokenVorm, zetToken: zetToken, bewaardToken: bewaardToken };`
  );
  return fn(
    window, { search: zoek, pathname: "/review", hash: "" }, { replaceState() {} }, URLSearchParams, doc,
    { concepten: [], publicaties: [], overheid: [], verwijzingen: {}, nakijken: [], bijnaVerlopen: [] },
    () => {}, { innerHTML: "" }, () => {}, () => {}, () => {}, () => {}
  );
}

// Precies de lengte van het token van Anton.
const TOKEN = "aBcDeFgHiJkLmNoPqRsTuV";
assert.equal(TOKEN.length, 22);

test("wat je bewaart, komt er bij een volgend bezoek identiek uit", () => {
  const db = new Map();
  bezoek(db).zetToken(TOKEN);
  const tweede = bezoek(db);
  assert.equal(tweede.token, TOKEN, "dit is de hele storing in één regel");
  assert.equal(tweede.token.length, 22, "geen 32, geen 24");
});

test("het baken van de opslagdiagnose wordt niet als token gelezen", () => {
  // De sterkste verdachte. Het baken is een ISO-tijdstip van 24 tekens en staat
  // in dezelfde opslag; het wordt bovendien geschreven vóórdat het token wordt
  // gelezen.
  const db = new Map();
  bezoek(db).zetToken(TOKEN);
  const baken = db.get("nlfr_review_baken");
  assert.ok(baken, "het baken hoort er te staan, anders meet deze toets niets");
  assert.notEqual(baken, TOKEN);
  const tweede = bezoek(db);
  assert.equal(tweede.token, TOKEN);
  assert.notEqual(tweede.token, baken, "het baken staat op de plek van het token");
});

test("andere waarden van dit domein raken het token niet", () => {
  // /actueel bewaart onder hetzelfde domein zijn open tegels, tabblad en
  // scrollstand; /banner-beheer zijn eigen token. Alles hier is een sleutel die
  // er ooit bij kan komen zonder dat iemand aan /review denkt.
  const db = new Map([
    ["nlfr_open", '{"archief":true}'],
    ["nlfr_art", '{"pers-landelijk/a1":true}'],
    ["nlfr_tab", '"nieuws"'],
    ["nlfr_scroll", "420"],
    ["nlfr_arch_open", "true"],
    ["nlfr_banner_token", "eenTotaalAnderTokenVan32Tekens!!"],
  ]);
  assert.equal(db.get("nlfr_banner_token").length, 32, "juist die lengte, want dat is wat er meeging");
  bezoek(db).zetToken(TOKEN);
  const tweede = bezoek(db);
  assert.equal(tweede.token, TOKEN, "de sleutel van de bannerbeheerpagina is niet die van de reviewtool");
});

test("de drie sleutels van deze pagina hebben verschillende namen", () => {
  const db = new Map();
  bezoek(db).zetToken(TOKEN);
  const namen = [...db.keys()].sort();
  assert.deepEqual(namen, ["nlfr_review_baken", "nlfr_review_token", "nlfr_review_tokenvorm"]);
  assert.equal(new Set(namen).size, namen.length, "geen twee waarden onder dezelfde naam");
});

test("de proefsleutel van de opslagtoets blijft niet achter", () => {
  const db = new Map();
  bezoek(db);
  assert.equal([...db.keys()].filter((k) => k.indexOf("nlfr_proef_") === 0).length, 0);
});

test("localStorage wordt voorgetrokken boven sessionStorage", () => {
  // Als de terugval uit #37 zou winnen, verdween het token bij het afsluiten van
  // het tabblad — hetzelfde beeld als "hij bewaart niets".
  const db = new Map();
  const sessie = new Map();
  bezoek(db, { sessionDb: sessie }).zetToken(TOKEN);
  assert.equal(db.get("nlfr_review_token"), TOKEN, "hoort in localStorage te staan");
  assert.equal(sessie.has("nlfr_review_token"), false, "en niet in sessionStorage");
});

// ---- De vergelijking die de storing aanwijst --------------------------------

test("een token dat tussen twee bezoeken verandert, wordt herkend", () => {
  const db = new Map();
  bezoek(db).zetToken(TOKEN);
  // Iets zet er een andere waarde overheen: een oude snelkoppeling, autovullen,
  // een andere pagina. Van 22 naar 32 tekens, precies wat Anton zag.
  db.set("nlfr_review_token", "eenTotaalAnderTokenVan32Tekens!!");
  const tweede = bezoek(db);
  assert.equal(tweede.tokenGewijzigd, true, "dit is wat er gemeld moet worden");
  assert.equal(tweede.vormBijOpslaan.len, 22);
  assert.equal(tweede.vormTeruggelezen.len, 32);
  assert.notEqual(tweede.vormBijOpslaan.vinger, tweede.vormTeruggelezen.vinger);
});

test("een ongewijzigd token levert geen valse melding op", () => {
  const db = new Map();
  bezoek(db).zetToken(TOKEN);
  assert.equal(bezoek(db).tokenGewijzigd, false);
});

test("een token uit de adresbalk overschrijft het bewaarde token", () => {
  // Dat is bestaand en bedoeld gedrag, maar het is ook een val: een oude
  // snelkoppeling met een verlopen token doet dit bij élk bezoek opnieuw. De
  // melding zegt dat nu met zoveel woorden; deze toets legt het gedrag vast.
  const db = new Map();
  bezoek(db).zetToken(TOKEN);
  const uit = bezoek(db, { zoek: "?token=eenTotaalAnderTokenVan32Tekens!!" });
  assert.equal(uit.token, "eenTotaalAnderTokenVan32Tekens!!");
  assert.equal(db.get("nlfr_review_token"), "eenTotaalAnderTokenVan32Tekens!!");
});

test("de vingerafdruk verraadt het token niet", () => {
  // Deze waarde gaat het scherm op en de opslag van de server in. Een
  // beheertoken hoort daar niet terecht te komen, en van een VERKEERD token
  // weten we niet eens wat het is: het kan een wachtwoord uit een kluis zijn.
  const { tokenVorm } = bezoek(new Map());
  const v = tokenVorm(TOKEN);
  assert.equal(v.len, 22);
  assert.ok(v.vinger && v.vinger.length <= 8, `de vingerafdruk is kort: ${v.vinger}`);
  assert.ok(!TOKEN.includes(v.vinger), "geen stuk van het token zelf");
  for (const teken of TOKEN.slice(0, 3) + TOKEN.slice(-3)) {
    assert.ok(v.vinger.indexOf(teken) === -1 || v.vinger.length < 3, "geen eerste- of laatste-tekens");
  }
  // Verschillende tokens, verschillende vingerafdruk: anders meet hij niets.
  assert.notEqual(tokenVorm(TOKEN).vinger, tokenVorm(TOKEN + "x").vinger);
  assert.equal(tokenVorm("").vinger, "leeg");
});
