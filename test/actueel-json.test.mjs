// De vorm van actueel.json, het enige bestand dat met de hand wordt bijgewerkt.
// ---------------------------------------------------------------------------
// WAT HIER NIET IN STAAT: welke items erin horen. Dat is redactie, en de README
// zegt met zoveel woorden dat dit bestand zonder code aan te raken wordt
// bijgewerkt. Een toets die de titels vastlegt zou elke redactionele wijziging
// rood maken, en dan wordt hij weggehaald in plaats van gevolgd.
//
// WAT ER WÉL IN STAAT: de vorm. Dit is handwerk in JSON, en de twee manieren
// waarop dat stilzwijgend misgaat zijn een komma te veel (dan toont de knop
// "op dit moment niets bijzonders" alsof er niets te melden is) en een item
// zonder href (dan rendert index.html een link naar "#", die eruitziet als een
// link en nergens heen gaat — precies de storing waar lib/bronurl.js voor is
// gebouwd, hier op een plek die geen server aanraakt).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ruw = readFileSync(new URL("../actueel.json", import.meta.url), "utf8");

test("het bestand is geldige JSON", () => {
  // Een komma te veel maakt de knop leeg zonder dat er iets meldt dat er iets
  // stuk is: de fetch slaagt, de parse faalt, en index.html valt terug op een
  // lege lijst.
  assert.doesNotThrow(() => JSON.parse(ruw));
});

const doc = JSON.parse(ruw);

test("er is een niet-lege lijst kaarten", () => {
  assert.ok(Array.isArray(doc.kaarten), "kaarten hoort een lijst te zijn");
  assert.ok(doc.kaarten.length > 0, "een lege lijst toont 'op dit moment niets bijzonders'");
});

test("elk item heeft een zichtbare titel en een echte link", () => {
  for (const k of doc.kaarten) {
    assert.ok(k && String(k.titel || "").trim(), `item zonder titel: ${JSON.stringify(k)}`);
    const href = String((k && k.href) || "");
    assert.ok(href, `"${k.titel}" heeft geen href — index.html maakt daar een link naar "#" van`);
    assert.doesNotThrow(() => new URL(href), `"${k.titel}" heeft geen geldige URL: ${href}`);
    assert.match(href, /^https:\/\//, `"${k.titel}" hoort over https te gaan: ${href}`);
  }
});

test("geen twee items wijzen naar dezelfde plek", () => {
  const hrefs = doc.kaarten.map((k) => String(k.href || ""));
  assert.equal(new Set(hrefs).size, hrefs.length, `dubbele link in de lijst: ${hrefs.join(", ")}`);
});

test("de tooltip is een zin, geen herhaling van de titel", () => {
  // `tekst` verschijnt als title-attribuut. Daar de titel nog eens neerzetten
  // levert een tooltip op die niets toevoegt aan wat er al staat.
  for (const k of doc.kaarten) {
    if (!k.tekst) continue;
    assert.notEqual(
      String(k.tekst).trim().toLowerCase(),
      String(k.titel).trim().toLowerCase(),
      `"${k.titel}": de tooltip herhaalt alleen de titel`
    );
  }
});
