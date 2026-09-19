// bestemming() op /login: waar de bezoeker na het inloggen heen gaat.
// ---------------------------------------------------------------------------
// De functie wordt hier uit de pagina GEHAALD en echt aangeroepen, met een
// nagebootste `location`. Een toets die alleen de bron leest zou de fout die
// hieronder staat niet gevonden hebben, want die zat niet in de tekst van het
// patroon maar in wat de BROWSER van die tekst maakt.
//
// DE FOUT (Copilot op PR #51, zie docs/login.md §4.3). Het patroon was
// /^\/[^\/]/ — "begint met één schuine streep". `/\evil.example` kwam daar
// doorheen, want het tweede teken is een backslash. De URL-parser van een
// browser behandelt een backslash in een absoluut pad echter als een schuine
// streep, dus location.replace() maakte daar `//evil.example` van: een
// volledige URL naar een ander domein. Een open redirect op de loginpagina, de
// ene plek waar die het meest schaadt.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const login = readFileSync(new URL("../login.html", import.meta.url), "utf8");

// De functie uit de pagina snijden en in een eigen omgeving draaien. URL en
// URLSearchParams komen van Node en gedragen zich hier hetzelfde als in een
// browser: het zijn allebei implementaties van dezelfde WHATWG-standaard, en
// juist die standaard schrijft de backslash-afhandeling voor.
const bron = login.slice(
  login.indexOf("function bestemming(){"),
  login.indexOf("// De reden waarmee")
);

const ORIGIN = "https://nlfr-menu.vercel.app";
function bestemmingVoor(terug) {
  const zoek = terug === null ? "" : `?terug=${encodeURIComponent(terug)}`;
  const location = { search: zoek, origin: ORIGIN };
  // eslint-disable-next-line no-new-func
  return new Function("location", "URL", "URLSearchParams", `${bron}\nreturn bestemming();`)(
    location,
    URL,
    URLSearchParams
  );
}

test("een gewoon pad op deze site wordt overgenomen", () => {
  assert.equal(bestemmingVoor("/review"), "/review");
  assert.equal(bestemmingVoor("/review?tab=overheid"), "/review?tab=overheid");
});

test("een backslash wordt geweigerd", () => {
  // DIT IS DE REGRESSIE. Zonder de reparatie geeft dit "/\\evil.example" terug,
  // en dat is voor de browser hetzelfde als "//evil.example".
  assert.equal(bestemmingVoor("/\\evil.example"), "/review");
  assert.equal(bestemmingVoor("/\\\\evil.example"), "/review");
  assert.equal(bestemmingVoor("/pad/met\\backslash"), "/review");
});

test("een volledige URL naar een ander domein wordt geweigerd", () => {
  for (const kwaad of [
    "https://evil.example",
    "//evil.example",
    "http://evil.example/review",
    "javascript:alert(1)",
    "https://nlfr-menu.vercel.app.evil.example/review",
  ]) {
    assert.equal(bestemmingVoor(kwaad), "/review", `niet geweigerd: ${kwaad}`);
  }
});

test("een lege of ontbrekende waarde valt terug op /review", () => {
  assert.equal(bestemmingVoor(null), "/review");
  assert.equal(bestemmingVoor(""), "/review");
  assert.equal(bestemmingVoor("   "), "/review");
});

test("een relatief pad zonder beginstreep wordt geweigerd", () => {
  // "review" zou tegen de huidige pagina worden opgelost, en dat is een andere
  // bestemming dan hij lijkt.
  assert.equal(bestemmingVoor("review"), "/review");
  assert.equal(bestemmingVoor("../elders"), "/review");
});

test("wat eruit komt is altijd een pad, nooit een volledige URL", () => {
  for (const invoer of ["/review", "/a/b?c=1#d", "https://evil.example", "/\\evil"]) {
    const uit = bestemmingVoor(invoer);
    assert.ok(uit.startsWith("/"), `geen pad: ${uit}`);
    assert.ok(!uit.startsWith("//"), `protocol-relatief: ${uit}`);
    assert.doesNotMatch(uit, /^[a-z]+:/i, `draagt een schema: ${uit}`);
  }
});
