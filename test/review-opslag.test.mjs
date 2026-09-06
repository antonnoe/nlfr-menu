// Bewaart de reviewtool het beheertoken echt, en zegt hij het als dat niet lukt?
// ---------------------------------------------------------------------------
// AANLEIDING. Op desktop werkte het: token invoeren, bewaren, en bij een volgend
// bezoek was de redactie meteen bereikbaar. Op mobiel moest het bij élk bezoek
// opnieuw worden ingevoerd, terwijl het scherm intussen zei: "Het beheertoken is
// in deze browser bewaard."
//
// Die zin was een aanname. Hij stond er zodra het token in het GEHEUGEN zat, en
// het wegschrijven zag er zo uit:
//
//     try { localStorage.setItem(TOKENSLEUTEL, t); } catch(e){}
//
// Een lege catch. Weigert de browser te schrijven — privémodus op iOS gooit een
// QuotaExceededError bij de eerste setItem, een ingebedde pagina krijgt in
// Safari helemaal geen opslag — dan gebeurde er niets en zei de pagina dat het
// gelukt was. Juist die onwaarheid maakte het onvindbaar: er was geen verschil
// zichtbaar tussen "bewaard" en "weggegooid".
//
// DEZE TOETSEN DRAAIEN DE ECHTE OPSLAGLAAG UIT review.html, uitgeknipt en
// uitgevoerd tegen browsers die op de bekende manieren stuk zijn. Geen nagedane
// logica: als de pagina verandert, verandert wat hier draait mee.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");

// De module uit de pagina knippen. Faalt dit, dan is de opslaglaag hernoemd of
// verplaatst en moet deze toets mee — beter dan stilzwijgend niets meten.
const start = review.indexOf("var opslag = (function(){");
assert.ok(start > -1, "de opslaglaag is niet meer te vinden in review.html");
const eind = review.indexOf("\n  })();", start);
assert.ok(eind > start, "het einde van de opslaglaag is niet te vinden");
const BRON = review.slice(start, eind + "\n  })();".length);

// Bouwt `opslag` met een zelf samengestelde window. Zo is elke stand van een
// mobiele browser na te spelen zonder browser.
function maakOpslag(window) {
  const fn = new Function("window", `${BRON} return opslag;`);
  return fn(window);
}

// Een opslag die gewoon werkt.
function werkendeBak() {
  const db = new Map();
  return {
    getItem: (k) => (db.has(k) ? db.get(k) : null),
    setItem: (k, v) => db.set(k, String(v)),
    removeItem: (k) => db.delete(k),
    _db: db,
  };
}

// iOS privémodus: het object bestaat, maar setItem gooit meteen.
function gooiendeBak(naam = "QuotaExceededError") {
  return {
    getItem: () => null,
    setItem: () => {
      const e = new Error("The quota has been exceeded.");
      e.name = naam;
      throw e;
    },
    removeItem: () => {},
  };
}

// De vervelendste variant: geen fout, maar de waarde valt stil weg.
function zwijgendeBak() {
  return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

const zelfde = {}; // window.top === window.self: niet ingebed
function venster({ local, session, top }) {
  const w = { localStorage: local, sessionStorage: session };
  w.self = w;
  w.top = top === undefined ? w : top;
  return w;
}

test("een werkende browser bewaart blijvend en leest terug", () => {
  const local = werkendeBak();
  const o = maakOpslag(venster({ local, session: werkendeBak() }));
  assert.equal(o.diagnose.waar, "local");
  assert.equal(o.blijvend(), true);
  const uit = o.schrijf("nlfr_review_token", "geheim123");
  assert.equal(uit.ok, true);
  assert.equal(o.lees("nlfr_review_token"), "geheim123");
  assert.equal(local._db.get("nlfr_review_token"), "geheim123");
});

test("privémodus: de fout wordt herkend en bij naam genoemd", () => {
  const o = maakOpslag(venster({ local: gooiendeBak("QuotaExceededError"), session: werkendeBak() }));
  assert.equal(o.diagnose.local.ok, false);
  assert.match(o.diagnose.local.reden, /QuotaExceededError/,
    "de naam van de fout is het bruikbare deel; 'er ging iets mis' helpt niemand");
  // Terugval, zodat het binnen dit bezoek tenminste werkt.
  assert.equal(o.diagnose.waar, "session");
  assert.equal(o.blijvend(), false, "en de pagina hoort dat NIET als bewaard te presenteren");
  assert.equal(o.schrijf("nlfr_review_token", "x").ok, true);
});

test("een browser die niets gooit maar ook niets bewaart, valt door de mand", () => {
  const o = maakOpslag(venster({ local: zwijgendeBak(), session: werkendeBak() }));
  assert.equal(o.diagnose.local.ok, false);
  assert.match(o.diagnose.local.reden, /schrijft niets weg/);
  assert.equal(o.diagnose.waar, "session");
});

test("geen enkele opslag: schrijven meldt dat, in plaats van te zwijgen", () => {
  const o = maakOpslag(venster({ local: gooiendeBak("SecurityError"), session: gooiendeBak("SecurityError") }));
  assert.equal(o.diagnose.waar, "geheugen");
  assert.equal(o.blijvend(), false);
  const uit = o.schrijf("nlfr_review_token", "x");
  assert.equal(uit.ok, false, "dit is precies het geval dat stil mislukte");
  assert.match(uit.reden, /geen opslag/);
  assert.equal(o.lees("nlfr_review_token"), "");
});

test("een browser die het opslagobject zelf weigert, neemt de pagina niet mee", () => {
  // Safari met geblokkeerde site-gegevens gooit al bij het AANRAKEN van
  // window.localStorage, niet pas bij setItem.
  const w = { sessionStorage: werkendeBak() };
  Object.defineProperty(w, "localStorage", {
    get() {
      const e = new Error("The operation is insecure.");
      e.name = "SecurityError";
      throw e;
    },
  });
  w.self = w;
  w.top = w;
  const o = maakOpslag(w);
  assert.equal(o.diagnose.local.ok, false);
  assert.match(o.diagnose.local.reden, /SecurityError/);
  assert.equal(o.diagnose.waar, "session");
});

test("een pagina in een kader herkent dat zelf", () => {
  const buiten = {};
  const o = maakOpslag(venster({ local: werkendeBak(), session: werkendeBak(), top: buiten }));
  assert.equal(o.diagnose.ingebed, true,
    "opslag in een kader wordt op mobiel apart gehouden of geweigerd");
});

test("een kader dat window.top niet eens laat lezen, telt als ingebed", () => {
  const w = { localStorage: werkendeBak(), sessionStorage: werkendeBak() };
  w.self = w;
  Object.defineProperty(w, "top", {
    get() { throw new Error("cross-origin"); },
  });
  const o = maakOpslag(w);
  assert.equal(o.diagnose.ingebed, true, "bij twijfel is het antwoord ingebed, niet 'nee'");
});

test("de proefsleutel blijft nooit achter", () => {
  const local = werkendeBak();
  maakOpslag(venster({ local, session: werkendeBak() }));
  assert.equal(local._db.size, 0, "de toets van de opslag ruimt zichzelf op");
});

// ---- Wat het scherm ervan zegt ---------------------------------------------
// De opslaglaag kan kloppen terwijl het scherm nog steeds "bewaard" beweert.
// Deze drie toetsen gaan over de zin die de gebruiker leest.

test("de standregel is niet langer een vaste zin", () => {
  assert.match(review, /id="tokenstandtekst"/, "de zin moet aanpasbaar zijn");
  assert.match(review, /if \(!opslagUitslag\.ok\)/, "en volgt de uitslag van de schrijfpoging");
  assert.match(review, /NIET bewaard/, "bij een mislukking staat dat er ook");
  assert.match(review, /tot je dit tabblad sluit/, "en bij de terugval wat er dan geldt");
});

test("Bewaren meldt het meteen als het niet bewaard is", () => {
  const blok = review.slice(review.indexOf("function bewaarUitVeld"), review.indexOf("var tokenokEl"));
  assert.match(blok, /if \(!opslagUitslag\.ok\)/,
    "anders hoort de redacteur het pas bij zijn volgende bezoek, zonder oorzaak erbij");
  assert.match(blok, /opslagUitslag\.reden/, "met de reden erbij");
});

test("de diagnose is op de telefoon zelf te lezen", () => {
  // Op een telefoon is er geen ontwikkelaarsgereedschap. Wat er misgaat moet
  // dus op de pagina staan, in overtikbare vorm.
  assert.match(review, /id="opslagstand"/);
  const blok = review.slice(review.indexOf("function tekenOpslagstand"), review.indexOf("function tekenToken"));
  for (const veld of ["d.waar", "d.local", "d.session", "d.ingebed", "vorigBaken"]) {
    assert.ok(blok.includes(veld), `de diagnose toont ${veld} niet`);
  }
});

test("het baken van het vorige bezoek wordt gelezen vóór dat van nu wordt gezet", () => {
  const leesPlek = review.indexOf("var vorigBaken = opslag.lees(BAKENSLEUTEL)");
  const schrijfPlek = review.indexOf("opslag.schrijf(BAKENSLEUTEL");
  assert.ok(leesPlek > -1 && schrijfPlek > leesPlek,
    "andersom overschrijft het bezoek van nu het spoor dat we juist wilden meten");
});

test("de terugval op sessionStorage wordt niet als mislukking gepresenteerd", () => {
  // Met sessionStorage IS er weggeschreven — alleen niet voor na het sluiten
  // van het tabblad. Dat is een andere mededeling dan "niet bewaard", en de
  // beginwaarde van opslagUitslag mag ze niet op één hoop gooien.
  assert.match(
    review,
    /var opslagUitslag = \{ ok: opslag\.diagnose\.waar !== "geheugen", reden: null \};/,
    "beginnen op blijvend() zou een geslaagde terugval als mislukking tonen"
  );
});
