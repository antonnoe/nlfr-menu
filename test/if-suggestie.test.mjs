// De IF-suggesties: passen ze, en houden ze zich in als ze niet passen?
// ---------------------------------------------------------------------------
// GEMETEN TEGEN ECHT MATERIAAL, niet tegen verzonnen invoer. Twee fixtures:
//   test/fixtures/if-index.json         349 echte artikelen van infofrankrijk.com,
//                                       opgehaald 6 september 2026, met de echte
//                                       WordPress-excerpts.
//   test/fixtures/actueel-levering.json 75 echte artikelen uit 14 tegels van
//                                       /actueel, zoals de lezer ze zag.
//
// WAAROM DAT NODIG WAS. Met verzonnen invoer was deze module er heel anders uit
// gaan zien. Drie dingen kwamen alleen uit de echte data:
//   1. IDF werkt hier niet. 70% van alle termen komt in precies één artikel
//      voor, dus zeldzaamheid scheidt onderwerp niet van toeval.
//   2. Eén gedeeld woord is altijd toeval ("december" -> moestuinkalender).
//   3. De SCORE scheidt wél: raak zat boven 6, ruis onder 4,5.
//
// Deze test legt de UITKOMST vast, niet de tussenstappen: welke artikelen een
// suggestie krijgen, en dat de bekende valse treffers er niet meer bij zitten.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { suggesties, tokens, bouwIdf, MIN_GEDEELD, MIN_SCORE } from "../lib/ifsuggestie.js";

const index = JSON.parse(readFileSync(new URL("./fixtures/if-index.json", import.meta.url), "utf8"));
const levering = JSON.parse(
  readFileSync(new URL("./fixtures/actueel-levering.json", import.meta.url), "utf8")
);
const ARTIKELEN = index.artikelen;
const IDF = bouwIdf(ARTIKELEN);

const berichten = [];
for (const tegel of levering.tegels || []) {
  for (const a of tegel.artikelen || []) {
    if (a && a.titel) berichten.push({ tegel: tegel.label, kop: a.titel, samenvatting: a.summary || "", url: a.url });
  }
}

function voorstel(bericht, max = 5) {
  return suggesties({ bericht, artikelen: ARTIKELEN, idfTabel: IDF, max });
}

test("de fixtures zijn het echte materiaal, niet een handvol voorbeelden", () => {
  // Zonder deze toets kan iemand de fixture uitkleden tot hij toevallig past,
  // en dan meet de rest van dit bestand niets meer.
  assert.ok(ARTIKELEN.length >= 300, `IF-index te klein: ${ARTIKELEN.length}`);
  assert.ok(berichten.length >= 70, `te weinig testberichten: ${berichten.length}`);
  assert.ok(
    ARTIKELEN.filter((a) => a.samenvatting).length > ARTIKELEN.length * 0.9,
    "vrijwel elk IF-artikel hoort een samenvatting te hebben; die draagt de overlap"
  );
});

// ---- De acht suggesties die de meting opleverde ----------------------------

test("een bericht over de bouwvergunning stelt de bouwvergunningartikelen voor", () => {
  const b = berichten.find((x) => /^melding, bouwvergunning/i.test(x.kop));
  assert.ok(b, "testbericht over de bouwvergunning niet gevonden in de fixture");
  const uit = voorstel(b);
  assert.ok(uit.length, "hier hoort een suggestie te komen");
  assert.match(uit[0].titel, /bouwvergunning/i, `bovenste suggestie: ${uit[0].titel}`);
});

test("een MIJNbouwvergunning krijgt niet de artikelen over de bouwvergunning", () => {
  // Uit de fixture, en precies het soort treffer waar een woordzeef intrapt:
  // "mijnbouwvergunning" bevat "bouwvergunning" als deelwoord. De tokenisatie
  // splitst op woordgrenzen en niet op deelwoorden, dus dit hoort niets op te
  // leveren — de tegenkant van de toets hierboven.
  const b = berichten.find((x) => /mijnbouwvergunning/i.test(x.kop));
  assert.ok(b, "testbericht over de mijnbouwvergunning niet gevonden");
  const titels = voorstel(b).map((s) => s.titel);
  assert.ok(!titels.some((t) => /^de bouwvergunning/i.test(t)),
    `de bouwvergunningartikelen horen hier niet: ${titels.join(" | ")}`);
});

test("een bericht over leegstaande woningen stelt de taxe d'habitation voor", () => {
  const b = berichten.find((x) => /leegstaande woningen/i.test(x.kop));
  assert.ok(b);
  const uit = voorstel(b);
  assert.match(uit[0].titel, /habitation/i, `bovenste suggestie: ${uit[0] && uit[0].titel}`);
});

test("een bericht over online banken stelt het artikel over een bankrekening voor", () => {
  const b = berichten.find((x) => /online banken/i.test(x.kop));
  assert.ok(b);
  const uit = voorstel(b);
  assert.match(uit[0].titel, /bankrekening/i, `bovenste suggestie: ${uit[0] && uit[0].titel}`);
});

test("een bericht over een elektrische auto stelt de subsidieregeling voor", () => {
  const b = berichten.find((x) => /elektrische auto/i.test(x.kop));
  assert.ok(b);
  const uit = voorstel(b);
  assert.match(uit[0].titel, /elektrisch/i, `bovenste suggestie: ${uit[0] && uit[0].titel}`);
});

// ---- En de valse treffers die eruit moesten -------------------------------

test("de valse treffers uit de eerste meting komen niet meer terug", () => {
  // Elk van deze paren kwam in een eerdere versie als suggestie boven. Ze zijn
  // stuk voor stuk overlap op een functiewoord, niet op een onderwerp. De namen
  // staan erbij zodat een volgende wijziging niet stil dezelfde fout maakt.
  const valsePaar = [
    [/foto ter wereld/i, /terugkeren naar nederland/i],   // via "keert, terug"
    [/franstaligheid/i, /verdragsbijdrage/i],             // via "laat, zien"
    [/biodiversiteitsbureau/i, /brommer, scooter/i],      // via "gepubliceerd, overzicht"
    [/presidentsverkiezing/i, /juridische bijstand/i],    // via "rond, regels"
  ];
  for (const [kopPatroon, foutPatroon] of valsePaar) {
    const b = berichten.find((x) => kopPatroon.test(x.kop));
    assert.ok(b, `testbericht niet gevonden: ${kopPatroon}`);
    const titels = voorstel(b).map((s) => s.titel);
    assert.ok(
      !titels.some((t) => foutPatroon.test(t)),
      `valse treffer terug bij "${b.kop}": ${titels.join(" | ")}`
    );
  }
});

test("nieuws waar geen achtergrondartikel bij bestaat, krijgt geen suggestie", () => {
  // Een cocaïnevangst, een reorganisatie bij Volkswagen en een kandidatuur van
  // Zemmour hebben op Infofrankrijk geen tegenhanger. Vijf willekeurige
  // treffers tonen is dan erger dan niets tonen: de redactie klikt ze aan.
  for (const patroon of [/cocaïne|cocaine/i, /volkswagen/i, /zemmour/i]) {
    const b = berichten.find((x) => patroon.test(x.kop));
    assert.ok(b, `testbericht niet gevonden: ${patroon}`);
    const uit = voorstel(b);
    assert.deepEqual(uit.map((s) => s.titel), [], `onverwachte suggestie bij "${b.kop}"`);
  }
});

// ---- De drempels zelf -------------------------------------------------------

test("één gedeeld woord is nooit genoeg", () => {
  const uit = suggesties({
    bericht: { kop: "Bouwvergunning aangevraagd", samenvatting: "" },
    artikelen: [
      { ifId: 1, titel: "Bouwvergunning en verder niets gemeenschappelijks", url: "u1", samenvatting: "" },
    ],
  });
  assert.deepEqual(uit, [], "met één gedeelde term hoort er geen suggestie te komen");
  assert.equal(MIN_GEDEELD, 2);
});

test("een lang artikel wint niet doordat het meer woorden bevat", () => {
  // De lengtenormalisatie. Twee artikelen delen precies dezelfde twee termen met
  // het bericht; het ene is kort en gaat erover, het andere is lang en noemt ze
  // terloops. Zonder normalisatie scoren ze gelijk en komt het lange artikel er
  // net zo goed doorheen.
  //
  // De vulling is UNIEK per artikel, niet één herhaald woord: een woord dat
  // maar in één artikel staat heeft de hoogste idf, dus dit is de zwaarste
  // vorm van de valstrik en niet de makkelijkste.
  const ruis = (n) => Array.from({ length: n }, (_, i) => `vulwoord${i}`).join(" ");
  // Een corpus dat groot genoeg is om positieve idf te geven; met één artikel
  // is log(n/(1+df)) negatief en valt élke term weg vóór de drempel. Precies
  // dáárop slaagde een eerdere versie van deze toets, zonder iets te bewijzen.
  const vulling = Array.from({ length: 30 }, (_, i) => ({
    ifId: 100 + i, titel: `Onderwerp ${i}`, url: `v${i}`, samenvatting: ruis(5),
  }));
  const kort = { ifId: 1, titel: "Bouwvergunning declaration prealable", url: "kort", samenvatting: "" };
  const lang = { ifId: 2, titel: "Bouwvergunning declaration prealable", url: "lang", samenvatting: ruis(80) };
  const bericht = { kop: "Bouwvergunning declaration prealable", samenvatting: "" };

  const uit = suggesties({ bericht, artikelen: [kort, lang, ...vulling], max: 5 });
  const perUrl = new Map(uit.map((s) => [s.url, s.score]));
  assert.ok(perUrl.has("kort"), `het korte artikel hoort voorgesteld te worden: ${JSON.stringify(uit)}`);
  assert.ok(
    (perUrl.get("kort") || 0) > (perUrl.get("lang") || 0),
    `kort (${perUrl.get("kort")}) hoort boven lang (${perUrl.get("lang")}) te staan`
  );
});

test("de ondergrens op de score houdt de zwakke treffers tegen", () => {
  // MIN_GEDEELD alleen is niet genoeg: twee gedeelde woorden met weinig gewicht
  // komen er zonder deze grens gewoon door.
  assert.equal(MIN_SCORE, 5);
  const b = berichten.find((x) => /franstaligheid/i.test(x.kop));
  assert.ok(b);
  // Dit bericht had in de meting twee gedeelde woorden ("laat", "zien") met een
  // score van 2,19 — boven MIN_GEDEELD, onder MIN_SCORE.
  assert.deepEqual(voorstel(b).map((s) => s.titel), []);
});

test("het bericht wordt niet aan zichzelf voorgesteld", () => {
  const zelf = ARTIKELEN.find((a) => /bouwvergunning/i.test(a.titel));
  assert.ok(zelf);
  const uit = suggesties({
    bericht: { kop: zelf.titel, samenvatting: zelf.samenvatting, url: zelf.url },
    artikelen: ARTIKELEN,
    idfTabel: IDF,
  });
  assert.ok(!uit.some((s) => s.url === zelf.url), "een artikel hoort zichzelf niet voor te stellen");
});

test("elke suggestie draagt de woorden waarop hij matchte", () => {
  // Zonder die verantwoording is een rare treffer niet te beoordelen zonder in
  // de code te kijken, en dat is precies wat deze aanpak boven een AI-aanroep
  // moet hebben.
  const b = berichten.find((x) => /bouwvergunning/i.test(x.kop));
  for (const s of voorstel(b)) {
    assert.ok(Array.isArray(s.gedeeld) && s.gedeeld.length >= MIN_GEDEELD,
      `suggestie zonder verantwoording: ${s.titel}`);
    assert.ok(typeof s.score === "number" && s.score >= MIN_SCORE);
  }
});

test("stopwoorden, getallen en het woord Frankrijk vallen weg", () => {
  // "regels" blijft staan en dat is met opzet: het KAN het onderwerp zijn
  // ("nieuwe regels voor rijbewijzen"). Dat het toch weinig oplevert regelt de
  // idf-weging, want het staat in 18 van de 349 IF-artikelen.
  assert.deepEqual(tokens("De nieuwe regels van 2027 in Frankrijk"), ["regels"]);
  assert.deepEqual(tokens("Bouwvergunning aanvragen"), ["bouwvergunning", "aanvragen"]);
  assert.deepEqual(tokens("2027 2026 5 12"), [], "getallen dragen geen onderwerp");
});

test("ligaturen worden woorden, geen brokstukken", () => {
  // Uit de ECHTE index: "main d\u2019\u0153uvre" en "\u0153uf". Zonder deze
  // omzetting werd het eerste ["main","uvre","nodig"] — niet leeg, maar een
  // onzinwoord dat aan een ander verminkt woord kan blijven haken.
  //
  // NFKD alleen is niet genoeg en dat is het addertje: Unicode kent voor
  // \u0153 en \u00e6 geen compatibiliteitsdecompositie, dus die blijven staan.
  // Voor \ufb01 en \ufb02 doet NFKD het werk wél.
  assert.deepEqual(tokens("main d\u2019\u0153uvre nodig"), ["main", "oeuvre", "nodig"]);
  assert.deepEqual(tokens("\u0152uvre collective"), ["oeuvre", "collective"]);
  assert.deepEqual(tokens("\ufb01che pratique"), ["fiche", "pratique"]);
  // En de woorden uit de fixture komen er ook echt doorheen.
  const metLigatuur = ARTIKELEN.filter((a) => /[\u0153\u0152\u00e6\u00c6]/.test(`${a.titel} ${a.samenvatting}`));
  assert.ok(metLigatuur.length > 0, "de fixture hoort ligaturen te bevatten; anders toetst dit niets");
  for (const a of metLigatuur) {
    assert.ok(
      !tokens(`${a.titel} ${a.samenvatting}`).some((w) => w === "uvre" || w === "ther"),
      `brokstuk in de tokens van: ${a.titel}`
    );
  }
});

test("zonder index of zonder bericht komt er een lege lijst, geen fout", () => {
  assert.deepEqual(suggesties({ bericht: { kop: "x" }, artikelen: [] }), []);
  assert.deepEqual(suggesties({ bericht: null, artikelen: ARTIKELEN, idfTabel: IDF }), []);
  assert.deepEqual(suggesties({}), []);
});

// ---- De meting zelf, als vangrail ------------------------------------------

test("de suggesties blijven zeldzaam en dus betekenisvol", () => {
  // De gemeten uitkomst: 7 van de 75 artikelen krijgen een suggestie. Zakt dat
  // naar nul, dan is de zeef stuk; loopt het op naar een kwart, dan zijn de
  // drempels verwaterd en komt de ruis terug. Allebei stil, zonder deze toets.
  const met = berichten.filter((b) => voorstel(b).length > 0).length;
  assert.ok(met >= 4, `bijna niets krijgt nog een suggestie (${met} van ${berichten.length})`);
  assert.ok(met <= 15, `te veel suggesties (${met} van ${berichten.length}): de ruis is terug`);
});
