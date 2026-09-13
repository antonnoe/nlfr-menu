// De meetlogica: welke dag, welke naam, en wat er buiten de deur blijft.
// ---------------------------------------------------------------------------
// DRIE DINGEN GAAN HIER STIL MIS ALS NIEMAND OPLET.
//
// 1. DE DAGGRENS. Een teller per dag is alleen te vergelijken als "de dag" elke
//    keer hetzelfde betekent. Stempel je in UTC, dan valt de Franse avond na
//    22:00 (zomertijd) in de volgende dag en zie je een dip die er niet is. De
//    reeks moet daarbij aaneengesloten blijven, ook in de week van de
//    klokwissel.
// 2. DE NAAM VAN EEN INGANG. Die komt van buiten: het endpoint staat open, want
//    het wordt aangeroepen vanuit de browser van elke bezoeker. Een ruime
//    tekenverzameling of een onbegrensde lengte laat iemand rommel in de
//    dagsleutel schrijven die daarna blijft staan.
// 3. DE AFBAKENING VAN DE HERKOMSTCHECK. "nederlanders.fr" mag, maar
//    "nederlanders.fr.kwaadaardig.nl" is een andere site. Een check met
//    includes() haalt die twee door elkaar.

import test from "node:test";
import assert from "node:assert/strict";

import {
  dagStempel,
  laatsteDagen,
  normaliseerId,
  veldVan,
  veldenUitBody,
  herkomstDeugt,
  hashNaarObject,
  dagUitHash,
  doorklik,
  ID_MAX,
  GEBEURTENIS_MAX,
} from "../lib/meting.js";

// ---- De daggrens ------------------------------------------------------------

test("de dag loopt op Franse tijd, niet op UTC", () => {
  // Zomertijd: Parijs is UTC+2. Half elf 's avonds UTC is dan half één 's
  // nachts in Frankrijk, dus de volgende dag.
  assert.equal(dagStempel(new Date("2026-09-13T22:30:00Z")), "2026-09-14");
  assert.equal(dagStempel(new Date("2026-09-13T21:30:00Z")), "2026-09-13");
  // Wintertijd: UTC+1, dus de grens ligt een uur later.
  assert.equal(dagStempel(new Date("2026-02-01T23:30:00Z")), "2026-02-02");
  assert.equal(dagStempel(new Date("2026-02-01T22:30:00Z")), "2026-02-01");
});

test("een onbruikbare datum levert een lege stempel, geen 'NaN-NaN-NaN'", () => {
  // Anders komt er een sleutel in KV te staan waar niemand ooit meer bij kan.
  assert.equal(dagStempel(new Date("onzin")), "");
});

test("de reeks loopt aaneengesloten terug, ook in de week van de klokwissel", () => {
  // In de nacht van 25 op 26 oktober 2025 gaat de klok terug. De reeks hoort
  // daar gewoon doorheen te lopen: geen overgeslagen dag, geen dubbele.
  const dagen = laatsteDagen(4, new Date("2025-10-27T12:00:00Z"));
  assert.deepEqual(dagen, ["2025-10-27", "2025-10-26", "2025-10-25", "2025-10-24"]);
});

test("laatsteDagen geeft de nieuwste dag eerst en nooit een dubbele", () => {
  const dagen = laatsteDagen(31, new Date("2026-03-02T12:00:00Z"));
  assert.equal(dagen[0], "2026-03-02", "nieuwste eerst");
  assert.equal(dagen[1], "2026-03-01", "en netjes over de maandgrens");
  assert.equal(new Set(dagen).size, dagen.length, "geen dubbele dagen");
});

// ---- De naam van een ingang -------------------------------------------------

test("een id wordt kleingeschreven en ontdaan van wat er niet in hoort", () => {
  assert.equal(normaliseerId("Paneel/NLFR/page/Onroerend-Goed"), "paneel/nlfr/page/onroerend-goed");
  assert.equal(normaliseerId("  lade-actueel/nlfr~xg_network_activity  "), "lade-actueel/nlfr~xg_network_activity");
  assert.equal(normaliseerId("paneel/<script>alert(1)</script>"), "paneel/scriptalert1/script");
  assert.equal(normaliseerId("paneel//dubbel///slash"), "paneel/dubbel/slash");
});

test("een id is begrensd en houdt geen los scheidingsteken over", () => {
  const lang = "paneel/" + "a".repeat(200);
  const uit = normaliseerId(lang);
  assert.equal(uit.length, ID_MAX, `een id hoort op ${ID_MAX} tekens te worden afgekapt`);
  const opRand = normaliseerId("paneel/" + "a".repeat(ID_MAX - 8) + "/xyz");
  assert.ok(!/[/_.~:-]$/.test(opRand), "geen scheidingsteken op het eind: " + opRand);
});

test("een id dat niets overhoudt, wordt geweigerd in plaats van leeg geteld", () => {
  assert.equal(normaliseerId("///"), "");
  assert.equal(normaliseerId("!!!"), "");
  assert.equal(normaliseerId("-abc"), "", "een id hoort met een letter of cijfer te beginnen");
  assert.equal(normaliseerId(""), "");
  assert.equal(normaliseerId(null), "");
});

test("het veld draagt de soort, zodat de telling later te scheiden is", () => {
  assert.equal(veldVan({ soort: "weergave" }), "weergave");
  assert.equal(veldVan({ soort: "lade", id: "actueel" }), "lade:actueel");
  assert.equal(veldVan({ soort: "klik", id: "paneel/nlfr/page/x" }), "klik:paneel/nlfr/page/x");
});

test("een onbekende soort of een lege id telt niet mee", () => {
  // Zonder deze grens bepaalt de aanroeper zelf hoe de velden in de dagsleutel
  // heten, en dan is de hash niet meer te lezen.
  assert.equal(veldVan({ soort: "verzin", id: "x" }), "");
  assert.equal(veldVan({ soort: "klik" }), "");
  assert.equal(veldVan({ soort: "lade", id: "!!!" }), "");
  assert.equal(veldVan(null), "");
});

test("gelijke gebeurtenissen in één verzoek worden opgeteld", () => {
  const velden = veldenUitBody({
    gebeurtenissen: [
      { soort: "weergave" },
      { soort: "klik", id: "strip/nlfr/page/a" },
      { soort: "klik", id: "strip/nlfr/page/a" },
      { soort: "onzin", id: "x" },
    ],
  });
  assert.equal(velden.get("weergave"), 1);
  assert.equal(velden.get("klik:strip/nlfr/page/a"), 2, "twee kliks op dezelfde ingang");
  assert.equal(velden.size, 2, "de onzin-gebeurtenis valt eruit");
});

test("een verzoek met te veel gebeurtenissen wordt afgekapt", () => {
  // Eén paginabezoek levert er een handvol. Wie er honderden stuurt, is geen
  // bezoeker maar iemand die de teller volloopt.
  const lijst = [];
  for (let i = 0; i < 100; i += 1) lijst.push({ soort: "klik", id: "strip/nlfr/page/p" + i });
  const velden = veldenUitBody({ gebeurtenissen: lijst });
  assert.equal(velden.size, GEBEURTENIS_MAX);
});

test("een body zonder lijst levert niets op in plaats van een fout", () => {
  assert.equal(veldenUitBody(null).size, 0);
  assert.equal(veldenUitBody({}).size, 0);
  assert.equal(veldenUitBody({ gebeurtenissen: "veel" }).size, 0);
});

// ---- Herkomst ---------------------------------------------------------------

test("de herkomstcheck kijkt naar het einde van de hostnaam", () => {
  assert.ok(herkomstDeugt({ origin: "https://www.nederlanders.fr" }));
  assert.ok(herkomstDeugt({ referer: "https://nlfr-menu.vercel.app/index.html" }));
  assert.ok(!herkomstDeugt({ origin: "https://nederlanders.fr.kwaadaardig.nl" }),
    "een hostnaam die er alleen mee BEGINT hoort niet mee te tellen");
  assert.ok(!herkomstDeugt({ origin: "https://kwaadaardig.nl" }));
  assert.ok(!herkomstDeugt({}), "zonder herkomst tellen we niet");
  assert.ok(!herkomstDeugt({ origin: "geen-url" }));
});

// ---- De vorm van het antwoord -----------------------------------------------

test("een platte Upstash-hash wordt weer een object", () => {
  assert.deepEqual(hashNaarObject(["a", "1", "b", "2"]), { a: "1", b: "2" });
  assert.deepEqual(hashNaarObject({ a: "1" }), { a: "1" });
  assert.deepEqual(hashNaarObject(null), {});
});

test("een dag valt uiteen in weergaven, laden en kliks", () => {
  const dag = dagUitHash("2026-09-13", [
    "weergave", "500",
    "lade:actueel", "80",
    "klik:lade-actueel/nlfr/page/actueel-frankrijknieuws", "12",
  ]);
  assert.equal(dag.weergaven, 500);
  assert.deepEqual(dag.laden, { actueel: 80 });
  assert.deepEqual(dag.kliks, { "lade-actueel/nlfr/page/actueel-frankrijknieuws": 12 });
});

test("een veld uit een vorige menuversie verdwijnt niet stil", () => {
  // Een getal dat je niet meer kunt plaatsen is beter dan een getal dat weg is:
  // anders daalt een totaal zonder dat iemand weet waarom.
  const dag = dagUitHash("2026-09-13", ["ouderwets", "7"]);
  assert.deepEqual(dag.overig, { ouderwets: 7 });
});

test("het doorklikpercentage is null zonder weergaven, niet nul", () => {
  // "Niet te zeggen" is iets anders dan "niemand klikte", en juist dat verschil
  // bepaalt of je een alarm moet geloven.
  assert.equal(doorklik({ weergaven: 0, kliks: { a: 3 } }), null);
  assert.equal(doorklik({ weergaven: 200, kliks: { a: 30, b: 10 } }), 20);
});
