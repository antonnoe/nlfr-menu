// Rubriek Merkwaardig (besluit Anton 20-11-2026) en de kop met een citaat.
import test from "node:test";
import assert from "node:assert/strict";
import { bouwFeed, CATEGORIEEN, PRIOS, SYSTEM_SELECTIE } from "../lib/selectie/kern.js";
import { schoonKop } from "../lib/synthese.js";

test("merkwaardig is een rubriek, als laatste (onderaan de zijbalk)", () => {
  assert.equal(CATEGORIEEN[CATEGORIEEN.length - 1], "merkwaardig");
  assert.ok(PRIOS.includes("m"));
  assert.match(SYSTEM_SELECTIE, /"merkwaardig" \(prio m\)/);
  assert.doesNotMatch(SYSTEM_SELECTIE, /curiosa/);
});

test("zijbalk toont hooguit één merkwaardig bericht, het nieuwste", () => {
  const nu = Date.parse("2026-11-20T22:00:00Z");
  const b = (id, uur) => ({ id, besluit: "go", categorie: "merkwaardig", titel: id, bron: "x", url: "https://x", datum: `2026-11-20T${uur}:00:00Z` });
  const feed = bouwFeed([b("oud", "08"), b("nieuw", "20"), { ...b("alg", "10"), categorie: "algemeen" }], nu);
  const m = feed.categorieen.find((c) => c.key === "merkwaardig");
  assert.equal(m.label, "Merkwaardig");
  assert.deepEqual(m.items.map((i) => i.id), ["nieuw"]);
  assert.equal(feed.categorieen[feed.categorieen.length - 1].key, "merkwaardig");
});

test("kop met citaat houdt het sluitende aanhalingsteken", () => {
  assert.equal(schoonKop("Sjamaan ontdoet politiebureau in Lourdes van 'boze geesten'"), "Sjamaan ontdoet politiebureau in Lourdes van 'boze geesten'");
  assert.equal(schoonKop('"Kop tussen tekens".'), "Kop tussen tekens");
  assert.equal(schoonKop("'Boze geesten' verdreven"), "'Boze geesten' verdreven");
});
