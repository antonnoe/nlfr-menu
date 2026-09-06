// De reviewtool laat zien WAAROM er geen concepten zijn.
// ---------------------------------------------------------------------------
// AANLEIDING. Op 6 september 2026 stond deze lijst op nul terwijl er elke
// cronronde tientallen persartikelen binnenkwamen. Wat de redactie op het
// scherm kreeg was: "Geen concepten om te beoordelen. Nieuwe verschijnen zodra
// een verhaal door 2+ onafhankelijke bronnen wordt gemeld." Die zin belooft dat
// het aan het nieuws ligt. Dat was het niet — de keten lag stil sinds
// 4 september 16:12 — en de zin hield veertig uur lang de verkeerde verklaring
// overeind.
//
// Wat hier wordt vastgelegd: de lege lijst toont de GEMETEN stand uit het
// cronjournaal, en de route levert dat journaal ook echt mee.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { startNepKv, roeper } from "./fixtures/nep-kv.mjs";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");

test("de lege conceptlijst belooft niet langer dat het aan het nieuws ligt", () => {
  assert.doesNotMatch(
    review,
    /Nieuwe verschijnen zodra een verhaal door 2\+ onafhankelijke bronnen wordt gemeld/,
    "deze zin verklaarde een storing als een rustige nieuwsdag"
  );
  assert.match(review, /Geen concepten om te beoordelen\.' \+ ketenStandHtml\(\)/);
});

test("de stand noemt onbekend als er geen journaal is, en verzint geen nul", () => {
  const fn = review.slice(review.indexOf("function ketenStandHtml"), review.indexOf("// ---- Geweigerde bron-URL"));
  assert.match(fn, /onbekend/);
  // De vier tellingen die de storing hadden verraden, plus het moment van het
  // laatste concept.
  for (const veld of ["naZeef", "clusters", "bovenDrempel", "syntheseAangeroepen", "geschreven", "laatsteConceptOp"]) {
    assert.match(fn, new RegExp(veld), `de stand toont ${veld} niet`);
  }
  assert.match(fn, /eersteNul/, "de stap die op nul staat hoort erbij");
});

// ---- De route ---------------------------------------------------------------

const { db, sluit } = await startNepKv();
process.env.REVIEW_TOKEN = "geheim";
test.after(sluit);

const C = await import("../lib/config.js");
const handler = (await import("../api/review.js")).default;
const roep = roeper(handler, "geheim");

test("GET /api/review levert het journaal van de laatste cronronde mee", async () => {
  const journaal = {
    op: "2026-09-06T08:15:00.000Z",
    laatsteConceptOp: "2026-09-04T16:12:00.000Z",
    persItemsLaatsteRonde: 61,
    pers: { naZeef: 61, clusters: 21, bovenDrempel: 5, syntheseAangeroepen: 0, geschreven: 0 },
    eersteNul: { veld: "beoordeeld", stap: "kandidaten die aan de synthese toekwamen", ervoor: "kandidaten na de rondelimiet", aantalErvoor: 5 },
    duiding: "alle kandidaten overgeslagen vóór de synthese: 5× eerder afgewezen",
    tegels: {},
  };
  db.set(C.KEY_CRON_RONDE, JSON.stringify(journaal));

  const res = await roep("GET");
  assert.equal(res.code, 200);
  assert.equal(res.body.totaalConcepten, 0, "de opzet van deze toets is juist een lege wachtrij");
  assert.deepEqual(res.body.journaal, journaal);
});

test("zonder journaal komt er null terug, geen verzonnen nulmeting", async () => {
  db.delete(C.KEY_CRON_RONDE);
  const res = await roep("GET");
  assert.equal(res.code, 200);
  assert.equal(res.body.journaal, null);
});
