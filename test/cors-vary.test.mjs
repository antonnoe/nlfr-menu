// De CDN bewaart antwoorden. Zonder "Vary: Origin" op elk antwoord krijgt een
// eigen app (Infopoche) een opgeslagen antwoord zonder Allow-Origin terug.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cors, toegestaan } from "../lib/lever.js";

function nep(origin) {
  const h = {};
  cors({ headers: origin ? { origin } : {} }, { setHeader: (k, v) => { h[k.toLowerCase()] = v; } });
  return h;
}

test("Vary: Origin staat ook op een antwoord zonder Origin", () => {
  assert.equal(nep(undefined).vary, "Origin");
  assert.equal(nep(undefined)["access-control-allow-origin"], undefined);
});

test("Vary: Origin staat ook bij een vreemde Origin", () => {
  const h = nep("https://kwaadnederlanders.fr");
  assert.equal(h.vary, "Origin");
  assert.equal(h["access-control-allow-origin"], undefined);
});

test("eigen apps krijgen Allow-Origin", () => {
  for (const o of ["https://if-mobiel.vercel.app", "https://infopoche.fr", "https://www.nederlanders.fr"]) {
    assert.ok(toegestaan(o), o);
    assert.equal(nep(o)["access-control-allow-origin"], o);
  }
});
