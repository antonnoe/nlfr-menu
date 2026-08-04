// Zelftests voor de instroomzeven.
//
// Drie lekken die in productie zichtbaar werden:
//   1. de vulkaanuitbarsting in Guatemala en de burgeroorlogwaarschuwing van de
//      Colombiaanse president Petro passeerden beide buitenlandlagen;
//   2. de aanhouding van chef Jean Imbert (NL-kop) passeerde de faits-divers-
//      zeef, want die kende alleen Franse termen;
//   3. een verhaal dat in NL- én FR-media speelt clusterde niet samen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buitenlandDoorlaat, buitenlandDoorlaatNL, faitsDiversDoorlaat } from "../lib/feeds.js";
import { clusterItems, eigennamen, eigennaamBrug, isNavertelling, telOnafhankelijk } from "../lib/cluster.js";

// ---- 1) Buitenland-zeef -----------------------------------------------------

test("LEK 1: vulkaan Fuego (Guatemala) wordt geweerd, in beide lagen", () => {
  const fr = "Guatemala : le volcan Fuego entre en éruption, des milliers d'évacués";
  const nl = "Vulkaan Fuego in Guatemala uitgebarsten; duizenden mensen geëvacueerd";
  assert.equal(buitenlandDoorlaat(fr), false);
  assert.equal(buitenlandDoorlaatNL(nl), false);
});

test("LEK 2: burgeroorlogwaarschuwing Petro (Colombia) wordt geweerd", () => {
  const fr = "Le président colombien Petro met en garde contre une guerre civile";
  const nl = "Colombiaanse president Petro waarschuwt voor burgeroorlog in het land";
  assert.equal(buitenlandDoorlaat(fr), false);
  assert.equal(buitenlandDoorlaatNL(nl), false);
});

test("meer wereldnieuws zonder Frankrijk-link valt weg", () => {
  const weg = [
    "Séisme au Népal : le bilan s'alourdit",
    "Nigeria : des dizaines d'enlèvements dans le nord du pays",
    "Aardbeving in Indonesië eist tientallen levens",
    "Peru : nouvelles manifestations contre le gouvernement",
    "Verkiezingen in Argentinië: peiling wijst op nek-aan-nekrace",
  ];
  for (const t of weg) {
    assert.equal(buitenlandDoorlaat(t), false, `had geweerd moeten worden: ${t}`);
    assert.equal(buitenlandDoorlaatNL(t), false, `laag 2 liet door: ${t}`);
  }
});

test("TEGENVOORBEELD: EU-besluit dat Frankrijk raakt blijft staan", () => {
  const gevallen = [
    "Bruxelles impose de nouvelles règles aux banques, la France devra adapter sa loi",
    "La Commission européenne ouvre une procédure contre la France",
    "Europese Commissie scherpt regels aan; ook Nederland moet aanpassen",
  ];
  for (const t of gevallen) {
    assert.equal(buitenlandDoorlaat(t), true, `onterecht geweerd: ${t}`);
    assert.equal(buitenlandDoorlaatNL(t), true, `laag 2 weerde onterecht: ${t}`);
  }
});

test("TEGENVOORBEELD: branden net over de Spaanse grens blijven staan", () => {
  const gevallen = [
    "Incendies en Catalogne près de la frontière française, des renforts envoyés",
    "Branden in Spanje vlak over de grens met Frankrijk, Franse brandweer helpt",
  ];
  for (const t of gevallen) {
    assert.equal(buitenlandDoorlaat(t), true, `onterecht geweerd: ${t}`);
    assert.equal(buitenlandDoorlaatNL(t), true, `laag 2 weerde onterecht: ${t}`);
  }
});

test("TEGENVOORBEELD: nieuws over Nederlanders blijft staan", () => {
  const t = "Nederlandse toeristen gestrand in Spanje na staking van luchtverkeersleiders";
  assert.equal(buitenlandDoorlaatNL(t), true);
});

test("gewoon Frans binnenlands nieuws raakt de buitenlandzeef niet", () => {
  const door = [
    "Grève des contrôleurs aériens : les vols annulés vendredi",
    "Impôts : le barème kilométrique 2027 est publié",
    "Incendie dans l'Aude : les habitants regagnent leur domicile",
  ];
  for (const t of door) assert.equal(buitenlandDoorlaat(t), true, `onterecht geweerd: ${t}`);
});

test("landnaam binnen een gewoon woord telt niet mee (woordgrens)", () => {
  // "chine" in "machine", "inde" in "industrie", "oman" in "roman".
  const door = [
    "Une machine à laver rappelée pour risque d'incendie",
    "L'industrie française face à la hausse de l'énergie",
    "Un roman français primé à la rentrée littéraire",
  ];
  for (const t of door) assert.equal(buitenlandDoorlaat(t), true, `onterecht geweerd: ${t}`);
});

// ---- 2) Faits-divers-zeef in het Nederlands --------------------------------

test("LEK 3: aanhouding van chef Jean Imbert wordt geweerd", () => {
  assert.equal(faitsDiversDoorlaat("Chef-kok Jean Imbert aangehouden wegens huiselijk geweld"), false);
  assert.equal(faitsDiversDoorlaat("Sterrenchef Jean Imbert opgepakt na aangifte van mishandeling"), false);
});

test("Nederlandse misdaadkoppen worden geweerd", () => {
  const weg = [
    "Man doodgestoken in Marseille, verdachte aangehouden",
    "Vrouw dood aangetroffen in woning in Lyon",
    "Vermiste tiener verdronken teruggevonden in de Rhône",
    "Nederlander opgepakt voor drugssmokkel in Perpignan",
    "Verdachte van dubbelmoord blijft langer in voorarrest",
    "Bekende Fransman veroordeeld wegens seksueel misbruik",
  ];
  for (const t of weg) assert.equal(faitsDiversDoorlaat(t), false, `had geweerd moeten worden: ${t}`);
});

test("Nederlandse insluitlijst wint, net als de Franse", () => {
  const door = [
    "Bosbrand in de Var: brandweerman om het leven gekomen",
    "Staking bij de spoorwegen: reiziger aangehouden na incident",
    "Code rood door hittegolf, ouderen overleden in tehuis",
  ];
  for (const t of door) assert.equal(faitsDiversDoorlaat(t), true, `onterecht geweerd: ${t}`);
});

test("substring-valkuilen: 'dood' binnen een gewoon woord filtert niets weg", () => {
  const door = [
    "Doodgewone maatregel: belasting op tweede woning omhoog",
    "Doodlopende weg in Bordeaux wordt heringericht",
    "Verdachte stilte rond de begroting blijft aanhouden",
  ];
  for (const t of door) assert.equal(faitsDiversDoorlaat(t), true, `onterecht geweerd: ${t}`);
});

test("Franse zeef blijft ongewijzigd werken", () => {
  assert.equal(faitsDiversDoorlaat("Noyade à Arcachon : un homme retrouvé sans vie"), false);
  assert.equal(faitsDiversDoorlaat("Grève des transports à Montpellier ce jeudi"), true);
});

// ---- 3) Cross-taal-clustering ----------------------------------------------

test("eigennamen worden uit de ruwe kop gehaald, zonder lidwoorden en zonder 'Frankrijk'", () => {
  const n = eigennamen("Le chef Jean Imbert placé en garde à vue à Paris, en France");
  assert.ok(n.enkel.includes("jean") && n.enkel.includes("imbert"));
  assert.ok(!n.enkel.includes("paris"), "Paris is te algemeen en staat in de stoplijst");
  assert.ok(!n.enkel.includes("france"), "France is te algemeen");
  assert.ok(n.meerwoordig.includes("jean imbert"));
});

test("NL- en FR-kop over hetzelfde verhaal vormen een brug", () => {
  const nl = eigennamen("Chef-kok Jean Imbert aangehouden wegens huiselijk geweld");
  const fr = eigennamen("Le chef Jean Imbert placé en garde à vue");
  assert.equal(eigennaamBrug(nl, fr), true);
});

test("twee losse verhalen met één gedeelde naam smelten NIET samen", () => {
  const a = eigennamen("Jean Imbert opent nieuw restaurant in Lyon");
  const b = eigennamen("Jean Castex benoemd tot voorzitter van de RATP");
  assert.equal(eigennaamBrug(a, b), false, "alleen de voornaam 'Jean' is geen brug");
});

test("een gedeelde plaatsnaam alleen is geen brug", () => {
  const a = eigennamen("Brand verwoest loods in Narbonne");
  const b = eigennamen("Nieuwe fietsbrug geopend in Narbonne");
  assert.equal(eigennaamBrug(a, b), false);
});

test("cross-taal cluster: NL- en FR-item over hetzelfde verhaal komen samen", () => {
  const nu = Date.parse("2026-08-04T12:00:00Z");
  const items = [
    { bron: "Le Monde — À la une", regime: "pers", titel: "Le chef Jean Imbert placé en garde à vue", url: "u1", datum: "2026-08-04T09:00:00Z" },
    { bron: "NOS — Buitenland", regime: "pers", titel: "Chef-kok Jean Imbert aangehouden in Frankrijk", url: "u2", datum: "2026-08-04T10:00:00Z" },
  ];
  const clusters = clusterItems(items, nu);
  assert.equal(clusters.length, 1, "de twee items horen in één cluster");
  assert.equal(clusters[0].items.length, 2);
});

test("twee verschillende verhalen blijven twee clusters", () => {
  const nu = Date.parse("2026-08-04T12:00:00Z");
  const items = [
    { bron: "Le Monde — À la une", regime: "pers", titel: "Jean Imbert ouvre un restaurant à Lyon", url: "u1", datum: "2026-08-04T09:00:00Z" },
    { bron: "NOS — Buitenland", regime: "pers", titel: "Jean Castex wordt voorzitter van vervoerbedrijf RATP", url: "u2", datum: "2026-08-04T10:00:00Z" },
  ];
  assert.equal(clusterItems(items, nu).length, 2);
});

// ---- Navertelling: NL-media die de Franse pers naschrijven -----------------

test("navertelling-frasen worden herkend", () => {
  assert.equal(isNavertelling({ titel: "Chef aangehouden, op basis van Franse berichtgeving" }), true);
  assert.equal(isNavertelling({ titel: "Chef aangehouden", tekst: "Volgens Franse media gaat het om huiselijk geweld." }), true);
  assert.equal(isNavertelling({ titel: "Chef aangehouden na aangifte" }), false);
});

test("een NL-navertelling telt niet als tweede onafhankelijke bron naast de Franse pers", () => {
  const items = [
    { bron: "Le Monde — À la une", titel: "Le chef Jean Imbert placé en garde à vue" },
    { bron: "NOS — Buitenland", titel: "Chef-kok Jean Imbert aangehouden, volgens Franse media" },
  ];
  assert.equal(telOnafhankelijk(items), 1);
});

test("eigen NL-berichtgeving zonder navertelling telt wél mee", () => {
  const items = [
    { bron: "Le Monde — À la une", titel: "Le chef Jean Imbert placé en garde à vue" },
    { bron: "NOS — Buitenland", titel: "Chef-kok Jean Imbert aangehouden na aangifte van zijn ex-partner" },
  ];
  assert.equal(telOnafhankelijk(items), 2);
});

// ---- 4) bronnen.json --------------------------------------------------------

test("bronnen.json documenteert alle regimes die in de lijst voorkomen", async () => {
  const doc = (await import("../bronnen.json", { with: { type: "json" } })).default;
  const gebruikt = [...new Set(doc.bronnen.map((b) => b.regime))];
  for (const r of gebruikt) {
    assert.ok(doc._uitleg.includes(`'${r}'`), `regime '${r}' ontbreekt in de _uitleg`);
  }
});

test("de verenigingenfeed heeft een eigen regime en houdt zijn ruime venster", async () => {
  const doc = (await import("../bronnen.json", { with: { type: "json" } })).default;
  const v = doc.bronnen.find((b) => b.thema === "verenigingen");
  assert.equal(v.regime, "verenigingen");
  assert.equal(v.vensterDagen, 30, "vensterDagen stuurt het datumvenster, niet het regime");
});
