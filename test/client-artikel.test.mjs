// De weergave van één artikel in de pagina, met en zonder de tweede levering.
// ---------------------------------------------------------------------------
// WAAROM DEZE TEST BESTAAT. De pagina rendert nu op de COMPACTE levering en
// vult tekst en bronnen later aan. Drie momenten moeten kloppen:
//   1. tekst-levering binnen  -> precies de weergave van vóór de splitsing;
//   2. nog onderweg           -> de summary staat er, plus een korte laadstaat,
//                                en geen bronnenknop die niets doet;
//   3. mislukt                -> de summary blijft staan; geen lege bak.
// Zonder deze test zou moment 2 en 3 pas op productie opvallen, bij een lezer
// met een trage verbinding — precies degene voor wie de splitsing bedoeld is.
//
// De functies worden UIT actueel.html gehaald en daar uitgevoerd, niet
// overgeschreven: een test op een kopie van de renderlogica zou groen blijven
// terwijl de pagina stuk is.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");

// Het blok met bronHTML, tekstVoor, bronAantalVan en artikelHTML.
const begin = html.indexOf("function bronHTML(b){");
const eind = html.indexOf("function tegelHTML(cat, t){");
assert.ok(begin > 0 && eind > begin, "renderfuncties niet gevonden in actueel.html");
const bron = html.slice(begin, eind);

// De vrije variabelen van dat blok, met de simpelst mogelijke invulling.
function maakRenderer({ teksten, tekstStatus }) {
  const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const ico = (n) => `<svg data-ic="${n}"></svg>`;
  const datum = (d) => String(d || "").slice(0, 10);
  const artOpen = {};
  // eslint-disable-next-line no-new-func
  return new Function(
    "esc", "ico", "datum", "artOpen", "teksten", "tekstStatus",
    `${bron}; return artikelHTML;`
  )(esc, ico, datum, artOpen, teksten, tekstStatus);
}

const TEGEL = { id: "overheid-douane", soort: "overheid" };
const ARTIKEL = {
  id: "a1",
  soort: "overheid",
  titel: "Nieuwe drempel",
  summary: "De drempel gaat omhoog.",
  bronMeta: { naam: "Douane", datum: "2026-08-27" },
  bronAantal: 2,
};
const TEKSTRECORD = {
  tekst: "Eerste alinea.\n\nTweede alinea.",
  bronnen: [
    { naam: "Douane", titel: "Seuil", url: "https://www.douane.gouv.fr/a1", datum: "2026-08-27" },
    { naam: "Bercy", titel: "Note", url: null, urlGeweigerd: "vreemde host" },
  ],
};

test("met de tweede levering: volledige tekst en een werkende bronnenknop", () => {
  const artikelHTML = maakRenderer({
    teksten: { "overheid-douane/a1": TEKSTRECORD },
    tekstStatus: "klaar",
  });
  const uit = artikelHTML("overheid", TEGEL, ARTIKEL);

  assert.ok(uit.includes("<p>Eerste alinea.</p>"), "eerste alinea staat er");
  assert.ok(uit.includes("<p>Tweede alinea.</p>"), "tweede alinea ook");
  assert.ok(uit.includes('class="bronknop" data-bron="overheid-douane/a1"'), "aanklikbare knop");
  assert.ok(uit.includes("Bronnen (2)"), "met het juiste aantal");
  assert.ok(uit.includes('href="https://www.douane.gouv.fr/a1"'), "de bronlink werkt");
  assert.ok(uit.includes("bronzonderlink"), "de geweigerde URL blijft zonder link staan");
  assert.ok(!uit.includes("tekstlaad"), "geen laadstaat als alles er is");
  assert.ok(uit.includes("Douane · 2026-08-27"), "de onderregel");
});

test("tweede levering nog onderweg: summary, laadstaat, geen dode knop", () => {
  const artikelHTML = maakRenderer({ teksten: null, tekstStatus: "laden" });
  const uit = artikelHTML("overheid", TEGEL, ARTIKEL);

  assert.ok(uit.includes("De drempel gaat omhoog."), "de summary staat er");
  assert.ok(uit.includes('class="tekstlaad"'), "met een korte laadstaat");
  assert.ok(uit.includes("Volledige tekst wordt geladen"), "die zegt wat er gebeurt");
  // De knop mag er staan mét het juiste aantal, maar niet aanklikbaar zijn: de
  // klikafhandeling in actueel.html slaat .bronknop.leeg over.
  assert.ok(uit.includes("Bronnen (2)"), "het aantal is al bekend uit bronAantal");
  assert.ok(uit.includes('class="bronknop leeg"'), "maar de knop is niet aanklikbaar");
  assert.ok(!uit.includes('data-bron='), "en heeft geen klikdoel");
  assert.ok(!uit.includes("<ul class=\"bronlijst\">"), "er is nog geen bronnenlijst");
});

test("tweede levering mislukt: de summary blijft staan, geen lege bak", () => {
  const artikelHTML = maakRenderer({ teksten: null, tekstStatus: "mislukt" });
  const uit = artikelHTML("overheid", TEGEL, ARTIKEL);

  assert.ok(uit.includes("De drempel gaat omhoog."), "de summary blijft");
  assert.ok(uit.includes("kon niet worden geladen"), "en zegt eerlijk wat er mis is");
  assert.ok(uit.includes("Bronnen (2) — niet geladen"));
  assert.ok(uit.includes('class="bronknop leeg"'), "opnieuw geen dode knop");
  // Geen lege tekstbak: er staat altijd minstens één alinea met inhoud.
  assert.ok(/<p>De drempel gaat omhoog\.<\/p>/.test(uit));
});

test("artikel zonder bronnen houdt de bestaande 'Geen externe bron'", () => {
  const artikelHTML = maakRenderer({ teksten: null, tekstStatus: "laden" });
  const uit = artikelHTML("overheid", TEGEL, { ...ARTIKEL, bronAantal: 0, bronMeta: null });
  assert.ok(uit.includes("Geen externe bron"));
  assert.ok(!uit.includes("Bronnen ("));
});

test("een perssynthese houdt de NLFR-byline, niet de bronregel", () => {
  const artikelHTML = maakRenderer({ teksten: null, tekstStatus: "laden" });
  const uit = artikelHTML("nieuws", { id: "pers-landelijk", soort: "pers" }, {
    id: "p1",
    soort: "pers",
    titel: "Synthese",
    summary: "Kort.",
    datum: "2026-08-28T09:00:00.000Z",
    bronMeta: { naam: "Le Monde", datum: "2026-08-28" },
    bronAantal: 3,
  });
  assert.ok(uit.includes("Redactie NLFR"), "byline");
  assert.ok(!uit.includes("Le Monde · "), "niet de eerste krant als afzender");
});

test("de volledige oude vorm blijft werken (antwoord uit de browsercache)", () => {
  // Vlak na een deploy kan een browser nog een antwoord van vóór de splitsing
  // hebben liggen (max-age=120). Dat mag niet leiden tot een lege onderregel of
  // een verdwenen bronnenknop.
  const artikelHTML = maakRenderer({ teksten: null, tekstStatus: "laden" });
  const uit = artikelHTML("overheid", TEGEL, {
    id: "a1",
    soort: "overheid",
    titel: "Nieuwe drempel",
    summary: "De drempel gaat omhoog.",
    tekst: "Eerste alinea.\n\nTweede alinea.",
    bronnen: TEKSTRECORD.bronnen,
  });
  assert.ok(uit.includes("<p>Eerste alinea.</p>"));
  assert.ok(uit.includes('class="bronknop" data-bron='), "gewoon een werkende knop");
  assert.ok(uit.includes("Douane · 2026-08-27"), "en de onderregel uit de eerste bron");
  assert.ok(!uit.includes("tekstlaad"));
});
