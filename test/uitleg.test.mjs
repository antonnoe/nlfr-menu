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

// ---- De getallen in het schema ---------------------------------------------
// Deze waren meegedreven: er stond "16 persfeeds" en "5 overheidsfeeds" terwijl
// het er 7 en 8 waren. Een uitlegpagina die niet klopt is erger dan geen
// uitlegpagina — wie de curatie overneemt gelooft wat er staat. Vandaar deze
// toets: de getallen komen uit bronnen.json, niet uit een herinnering.
test("het schema noemt het werkelijke aantal actieve feeds per regime", () => {
  const bronnen = JSON.parse(
    readFileSync(new URL("../bronnen.json", import.meta.url), "utf8")
  ).bronnen.filter((b) => b.actief);
  const pers = bronnen.filter((b) => b.regime === "pers").length;
  const overheid = bronnen.filter((b) => b.regime === "overheid").length;

  assert.ok(uitleg.includes(`${pers} persfeeds`),
    `het schema noemt niet "${pers} persfeeds" — bronnen.json telt er ${pers}`);
  assert.ok(uitleg.includes(`${overheid} overheidsfeeds`),
    `het schema noemt niet "${overheid} overheidsfeeds" — bronnen.json telt er ${overheid}`);
});

test("de uitleg noemt de versiestempel en de twee nieuwe tegels", () => {
  assert.match(uitleg, /versie 2\.1/, "de stempel hoort uitgelegd te worden");
  assert.match(uitleg, /Nederlandse overheid/);
  assert.match(uitleg, /Nederlands nieuws/);
});

test("de uitleg zegt waar het Infofrankrijk-blok bij overheidsberichten staat", () => {
  assert.match(uitleg, /Overheid — automatisch live/,
    "wie het blok zoekt, moet lezen onder welke kop het staat");
});
