// Het voorgebakken antwoord: wanneer vertrouwt /api/actueel de snapshot?
// ---------------------------------------------------------------------------
// De route leest actueel:snapshot:v1 en antwoordt daarmee. Deze test legt de
// beslissing vast die daaraan voorafgaat: vorm én leeftijd. Wordt de snapshot
// afgekeurd, dan stelt de route het antwoord alsnog zelf samen (live feeds plus
// KV) — het oude gedrag — en schrijft dat als nieuwe snapshot weg.

import test from "node:test";
import assert from "node:assert/strict";

import { snapshotBruikbaar } from "../lib/antwoord.js";
import { SNAPSHOT_MAX_LEEFTIJD_S, SNAPSHOT_TTL_S } from "../lib/config.js";

const NU = Date.parse("2026-08-28T12:00:00.000Z");
const gebakken = (msGeleden) => ({
  bijgewerkt: new Date(NU - msGeleden).toISOString(),
  gebakkenOp: new Date(NU - msGeleden).toISOString(),
  tegels: [{ id: "pers", artikelen: [] }],
  agenda: [],
  bronStatus: [],
});

test("een verse snapshot is bruikbaar", () => {
  assert.equal(snapshotBruikbaar(gebakken(0), NU), true);
  assert.equal(snapshotBruikbaar(gebakken(14 * 60 * 1000), NU), true, "14 min oud");
});

test("op de grens van 60 minuten nog net wel, daarboven niet meer", () => {
  const grensMs = SNAPSHOT_MAX_LEEFTIJD_S * 1000;
  assert.equal(snapshotBruikbaar(gebakken(grensMs), NU), true);
  assert.equal(snapshotBruikbaar(gebakken(grensMs + 1000), NU), false);
});

test("ontbrekende of vormloze snapshot wordt afgekeurd", () => {
  assert.equal(snapshotBruikbaar(null, NU), false, "geen snapshot in KV");
  assert.equal(snapshotBruikbaar(undefined, NU), false);
  assert.equal(snapshotBruikbaar("een string", NU), false);
  assert.equal(snapshotBruikbaar({ gebakkenOp: new Date(NU).toISOString() }, NU), false, "geen tegels");
  assert.equal(
    snapshotBruikbaar({ ...gebakken(0), tegels: "geen lijst" }, NU),
    false
  );
});

test("een snapshot zonder leesbaar bakmoment wordt afgekeurd", () => {
  const s = gebakken(0);
  assert.equal(snapshotBruikbaar({ ...s, gebakkenOp: "", bijgewerkt: "" }, NU), false);
  assert.equal(snapshotBruikbaar({ ...s, gebakkenOp: "gisteren", bijgewerkt: "gisteren" }, NU), false);
});

test("een oudere snapshot zonder gebakkenOp valt terug op bijgewerkt", () => {
  // Zo blijft een snapshot die door een eerdere versie is geschreven leesbaar.
  const oud = { ...gebakken(5 * 60 * 1000) };
  delete oud.gebakkenOp;
  assert.equal(snapshotBruikbaar(oud, NU), true);
});

test("de TTL is ruimer dan de vertrouwensgrens", () => {
  // Anders zou een snapshot verlopen zijn nog vóór de route hem afkeurt, en zou
  // een kapotte cron meteen een lege pagina geven in plaats van een oude.
  assert.ok(SNAPSHOT_TTL_S > SNAPSHOT_MAX_LEEFTIJD_S);
  assert.equal(SNAPSHOT_TTL_S, 6 * 60 * 60);
});
