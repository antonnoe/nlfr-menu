// Invariant op het cronschema in vercel.json.
// ---------------------------------------------------------------------------
// WAAROM. Op 3 november 2026 ging het schema (PR #63) van elk kwartier naar
// "0 5,17 * * *". Niets in de tests merkte dat: de stroom persconcepten viel
// terug van 40 à 50 naar hooguit 4 per dag en de bewaking bleef groen, omdat
// die alleen na een etmaal zonder concept (I15) afgaat.
//
// HET DAGAANTAL CONCEPTEN IS EEN PRODUCT. MAX_SYNTHESE_PER_RONDE (het aantal
// concepten per ronde) maal het aantal rondes per etmaal bepaalt hoeveel
// persconcepten per dag kunnen ontstaan. Wie het schema versoberd, verlaagt dat
// aantal evenredig, ook als de rondelimiet gelijk blijft. Deze toets leest
// daarom het echte vercel.json en rekent het uit.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { rondesPerEtmaal, rondeMomenten, langsteTussenpoosMin } from "../lib/cronschema.js";
import { MAX_SYNTHESE_PER_RONDE, CRON_INTERVAL_MIN, MIN_RONDES_PER_ETMAAL } from "../lib/config.js";

const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const cron = (vercel.crons || []).find((c) => c.path === "/api/cron");

test("vercel.json heeft een cron voor /api/cron", () => {
  assert.ok(cron, "geen cron voor /api/cron in vercel.json");
});

test("het cronschema levert minstens MIN_RONDES_PER_ETMAAL rondes per etmaal", () => {
  const rondes = rondesPerEtmaal(cron.schedule);
  const concepten = rondes * MAX_SYNTHESE_PER_RONDE;
  assert.ok(
    rondes >= MIN_RONDES_PER_ETMAAL,
    `cronschema "${cron.schedule}" levert ${rondes} ronde(s) per etmaal, minimaal ${MIN_RONDES_PER_ETMAAL} nodig. ` +
      `De rondelimiet (MAX_SYNTHESE_PER_RONDE = ${MAX_SYNTHESE_PER_RONDE}) vermenigvuldigd met het aantal rondes ` +
      `bepaalt het aantal persconcepten per dag: nu hooguit ${concepten}. ` +
      `Op 3 november 2026 viel de stroom zo terug van 40 à 50 naar 4 per dag. ` +
      `Verhoog het aantal rondes in vercel.json, of verhoog bewust de rondelimiet en MIN_RONDES_PER_ETMAAL samen.`
  );
});

test("de rondes liggen gelijkmatig genoeg: de langste tussenpoos is de croninterval van de bewaking", () => {
  const langste = langsteTussenpoosMin(cron.schedule);
  assert.ok(
    langste <= CRON_INTERVAL_MIN,
    `de langste pauze tussen twee rondes is ${langste} min; de bewaking (CRON_INTERVAL_MIN) gaat uit van ${CRON_INTERVAL_MIN} min`
  );
});

test("het schema is elk uur op minuut 7: 24 rondes, ten hoogste 48 modelaanroepen per dag", () => {
  assert.equal(cron.schedule, "7 * * * *");
  assert.equal(rondesPerEtmaal(cron.schedule), 24);
  assert.equal(MAX_SYNTHESE_PER_RONDE, 2);
  assert.equal(rondesPerEtmaal(cron.schedule) * MAX_SYNTHESE_PER_RONDE, 48);
});

// De rekenaar zelf, zodat de invariant niet op een foute telling rust.
test("rondesPerEtmaal telt de gangbare schema's goed", () => {
  assert.equal(rondesPerEtmaal("0 5,17 * * *"), 2);
  assert.equal(rondesPerEtmaal("7 * * * *"), 24);
  assert.equal(rondesPerEtmaal("*/15 * * * *"), 96);
  assert.equal(rondesPerEtmaal("0 */2 * * *"), 12);
  assert.equal(rondesPerEtmaal("0,30 8-17 * * *"), 20);
  assert.deepEqual(rondeMomenten("7 5,17 * * *"), [5 * 60 + 7, 17 * 60 + 7]);
});

test("langsteTussenpoosMin rekent over middernacht heen", () => {
  assert.equal(langsteTussenpoosMin("7 * * * *"), 60);
  assert.equal(langsteTussenpoosMin("0 5,17 * * *"), 12 * 60);
  assert.equal(langsteTussenpoosMin("0 5 * * *"), 1440);
});

test("een schema dat de toets niet kan lezen wordt een fout, geen stille goedkeuring", () => {
  assert.throws(() => rondesPerEtmaal("0 5 * * MON"));
  assert.throws(() => rondesPerEtmaal("0 5 1 * *"));
  assert.throws(() => rondesPerEtmaal("0 5 * *"));
  assert.throws(() => rondesPerEtmaal("61 * * * *"));
});
