// De uitlegpagina bij de reviewtool (/uitleg).
// ---------------------------------------------------------------------------
// WAAROM DEZE TEST BESTAAT. Deze pagina is er voor iemand die de curatie
// overneemt terwijl de vaste redacteur weg is. Juist dan is er niemand om te
// vragen waarom een plaatje ontbreekt of waar de knop heen gaat. Twee dingen
// mogen daarom nooit stilletjes breken:
//   1. elke schermafdruk waarnaar de pagina verwijst, bestaat ook echt;
//   2. de knop "?" in de reviewtool wijst naar deze pagina.
// Allebei zijn ze het soort fout dat je pas ontdekt op het moment dat het niet
// uitkomt.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";

const wortel = new URL("../", import.meta.url);
const uitleg = readFileSync(new URL("uitleg.html", wortel), "utf8");
const review = readFileSync(new URL("review.html", wortel), "utf8");

test("elke schermafdruk waarnaar de uitleg verwijst, bestaat", () => {
  const verwezen = [...uitleg.matchAll(/src="\/schermen\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(verwezen.length >= 4, `verwacht meerdere schermen, gevonden ${verwezen.length}`);
  for (const bestand of verwezen) {
    const pad = new URL(`schermen/${bestand}`, wortel);
    assert.ok(existsSync(pad), `ontbreekt: schermen/${bestand}`);
    assert.ok(statSync(pad).size > 1000, `verdacht klein bestand: schermen/${bestand}`);
  }
});

test("elke afbeelding heeft afmetingen en wordt lui geladen", () => {
  // Zonder width/height springt de pagina tijdens het laden; zonder lazy haalt
  // een telefoon een halve megabyte binnen voor iets wat onder de vouw staat.
  const plaatjes = [...uitleg.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  assert.ok(plaatjes.length >= 4);
  for (const tag of plaatjes) {
    assert.match(tag, /width="\d+"/, `geen breedte: ${tag.slice(0, 70)}`);
    assert.match(tag, /height="\d+"/, `geen hoogte: ${tag.slice(0, 70)}`);
    assert.match(tag, /loading="lazy"/, `niet lui geladen: ${tag.slice(0, 70)}`);
    assert.match(tag, /alt="[^"]+"/, `geen alt-tekst: ${tag.slice(0, 70)}`);
  }
});

test("de reviewtool heeft een knop die hierheen wijst", () => {
  assert.match(review, /class="hulp-link" href="\/uitleg"/, 'de "?"-knop ontbreekt in review.html');
  assert.match(review, /target="_blank"/, "de uitleg hoort in een nieuw tabblad te openen");
});

test("de uitleg staat niet in zoekmachines en is een volledig document", () => {
  assert.match(uitleg, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(uitleg.startsWith("<!DOCTYPE html>"));
  assert.match(uitleg, /<html lang="nl">/);
});

test("de getallen in de uitleg kloppen met de configuratie", async () => {
  // Een uitlegpagina die iets anders beweert dan de code doet, is erger dan
  // geen uitlegpagina: de invaller rekent zich rijk.
  const { CONCEPT_TTL_S, ARCHIEF_NA_UREN, PUBLICATIE_TTL_S, IF_MAX_LEEFTIJD_MAANDEN, IF_VERWIJZING_MAX } =
    await import("../lib/config.js");
  assert.equal(CONCEPT_TTL_S / 3600, 36, "de uitleg noemt 36 uur voor een concept");
  assert.ok(uitleg.includes("vervalt na 36 uur"));
  assert.equal(ARCHIEF_NA_UREN, 36);
  assert.ok(uitleg.includes("36 u, dan archief"));
  assert.equal(PUBLICATIE_TTL_S / 86400, 14);
  assert.ok(uitleg.includes("na 14 d weg"));
  assert.equal(IF_MAX_LEEFTIJD_MAANDEN, 12);
  assert.ok(uitleg.includes("twaalf maanden"));
  assert.equal(IF_VERWIJZING_MAX, 3);
});
