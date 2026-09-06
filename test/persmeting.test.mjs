// De meting van de persketen: telt hij elke stap, ook op nul?
// ---------------------------------------------------------------------------
// AANLEIDING. Op 6 september 2026 lagen alle perstegels leeg, stond de
// reviewtool op nul concepten en was er sinds 4 september 16:12 geen concept
// meer aangemaakt. Het draailog van een cronronde bestond uit twintig regels,
// allemaal `[feeds]`, en daarna niets: geen regel over clusteren, geen over de
// drempel, geen over de synthese-aanroep. Er was dus geen enkele manier om te
// zien wáár de keten stilviel — de storing en een rustige nieuwsdag zagen er in
// het log identiek uit.
//
// Deze toetsen leggen vast wat dat moet voorkomen: elke stap heeft een teller,
// elke teller wordt afgedrukt (juist als hij nul is), en de eerste stap die op
// nul staat wordt bij naam genoemd mét het aantal ervóór.

import test from "node:test";
import assert from "node:assert/strict";

import {
  KETEN,
  nieuweMeting,
  eersteNul,
  duiding,
  logRegels,
  weegPersInvoer,
  blokkadeVoor,
  geschiktVoorSynthese,
} from "../lib/persmeting.js";

const NU = Date.parse("2026-09-06T08:15:00.000Z");
const uurGeleden = (h) => new Date(NU - h * 3600e3).toISOString();

// Een realistische ochtend: drie kranten over hetzelfde begrotingsverhaal, drie
// over dezelfde staking, twee losse regionale berichten.
function ochtend() {
  const ruw = [
    ["Le Monde — À la une", "Budget 2027 : le gouvernement présente un plan d'économies de 40 milliards d'euros", 1],
    ["Le Figaro — Actualités", "Budget 2027 : Bercy détaille 40 milliards d'économies", 1],
    ["Franceinfo — Titres", "Budget : ce que contient le plan d'économies présenté par le gouvernement", 2],
    ["Le Monde — À la une", "Grève des contrôleurs aériens : un vol sur trois annulé jeudi", 2],
    ["Franceinfo — Titres", "Grève dans les aéroports : la DGAC demande d'annuler un vol sur trois", 3],
    ["Le Figaro — Actualités", "Trafic aérien perturbé jeudi en raison d'une grève des contrôleurs", 3],
    ["Midi Libre", "Montpellier : la circulation modifiée sur l'avenue de la Liberté", 4],
    ["Sud Ouest", "Bordeaux : le tramway A perturbé toute la journée de vendredi", 4],
  ];
  return ruw.map(([bron, titel, h]) => ({
    bron,
    titel,
    url: `https://example.test/${encodeURIComponent(titel).slice(0, 30)}`,
    datum: uurGeleden(h),
    thema: "landelijk-fr",
    regime: "pers",
  }));
}

test("elke stap uit de keten heeft een teller in een verse meting", () => {
  const m = nieuweMeting(NU);
  for (const stap of KETEN) {
    assert.equal(typeof m[stap.veld], "number", `stap ${stap.veld} heeft geen teller`);
    assert.equal(m[stap.veld], 0);
  }
});

test("logRegels drukt ALLE stappen af, ook als ze nul zijn", () => {
  const regels = logRegels(nieuweMeting(NU)).join("\n");
  for (const stap of KETEN) {
    assert.match(regels, new RegExp(`${stap.naam}: 0`), `stap "${stap.naam}" ontbreekt in het log`);
  }
});

test("eersteNul noemt de stap die nul oplevert én het aantal ervóór", () => {
  const m = nieuweMeting(NU);
  Object.assign(m, {
    itemsTotaal: 210,
    persRuw: 98,
    naZeef: 61,
    binnenVenster: 44,
    clusters: 21,
    bovenDrempel: 5,
    kandidaten: 5,
    beoordeeld: 0,
  });
  const nul = eersteNul(m);
  assert.equal(nul.veld, "beoordeeld");
  assert.equal(nul.ervoor, "kandidaten na de rondelimiet");
  assert.equal(nul.aantalErvoor, 5);
});

test("een keten die helemaal doorloopt levert geen nul-melding op", () => {
  const m = nieuweMeting(NU);
  for (const stap of KETEN) m[stap.veld] = 3;
  assert.equal(eersteNul(m), null);
  assert.match(logRegels(m).join("\n"), /keten volledig doorlopen: 3 concept/);
});

test("de duiding wijst eerdere afwijzingen aan als alle kandidaten blijven liggen", () => {
  const m = nieuweMeting(NU);
  Object.assign(m, { itemsTotaal: 210, persRuw: 98, naZeef: 61, binnenVenster: 44, clusters: 21, bovenDrempel: 5, kandidaten: 5 });
  m.overgeslagen.afgewezen = 4;
  m.overgeslagen.publicatie = 1;
  const tekst = duiding(m);
  assert.match(tekst, /eerder afgewezen/);
  assert.match(tekst, /4×/);
  assert.match(tekst, /al gepubliceerd/);
});

test("de duiding wijst de rondelimiet aan als die op nul staat", () => {
  const m = nieuweMeting(NU);
  Object.assign(m, {
    itemsTotaal: 210, persRuw: 98, naZeef: 61, binnenVenster: 44, clusters: 21,
    bovenDrempel: 5, kandidaten: 0, openstaandeConcepten: 50, ruimte: 0, limiet: 0,
  });
  assert.match(duiding(m), /rondelimiet stond op 0/);
});

test("de duiding verzint niets als de tellingen niets aanwijzen", () => {
  const m = nieuweMeting(NU);
  Object.assign(m, { itemsTotaal: 210, persRuw: 0 });
  assert.equal(duiding(m), null);
});

test("weegPersInvoer telt de trechter van feeditem tot cluster boven de drempel", () => {
  const m = nieuweMeting(NU);
  const items = [...ochtend(), { bron: "Bercy", titel: "Impôts", url: "https://x.test/a", datum: uurGeleden(1), regime: "overheid" }];
  const { geschikt } = weegPersInvoer(items, NU, m);

  assert.equal(m.itemsTotaal, 9);
  assert.equal(m.persRuw, 8, "alleen regime pers telt mee");
  assert.equal(m.naZeef, 8);
  assert.equal(m.binnenVenster, 8);
  assert.ok(m.clusters >= 3, `verwacht minstens drie clusters, kreeg ${m.clusters}`);
  assert.equal(m.bovenDrempel, geschikt.length);
  assert.ok(m.bovenDrempel >= 2, `budget- en stakingscluster horen boven de drempel te komen, kreeg ${m.bovenDrempel}`);
  for (const c of geschikt) assert.ok(geschiktVoorSynthese(c));
  // De stappen ná de drempel vult de cron zelf (rondelimiet, blokkades,
  // synthese). Tot en met de drempel hoort er met dit nieuws nergens een nul te
  // staan; dat is wat deze toets bewaakt.
  assert.equal(eersteNul(m).veld, "kandidaten", "de trechter hoort pas bij de cron-stappen op nul te staan");
});

test("een zeef die alles wegvangt is te onderscheiden van een dode feed", () => {
  const m = nieuweMeting(NU);
  // Pure faits divers: gaan er allemaal uit bij de zeef, niet bij de inname.
  const items = [
    "Nîmes : un homme interpellé après un meurtre",
    "Béziers : une femme tuée par son ex-conjoint",
  ].map((titel, i) => ({
    bron: "Midi Libre", titel, url: `https://x.test/${i}`, datum: uurGeleden(1), regime: "pers",
  }));
  weegPersInvoer(items, NU, m);
  assert.equal(m.persRuw, 2);
  assert.equal(m.naZeef, 0);
  assert.equal(m.gezeefd.faitsDivers, 2);
  assert.equal(eersteNul(m).veld, "naZeef");
  assert.match(duiding(m), /de zeven namen alles weg/);
});

// ---- De blokkades ----------------------------------------------------------
// Eén functie beslist waarom een kandidaat blijft liggen, voor de echte ronde
// én voor de diagnosestand. Dat ze niet uiteen kunnen lopen is het punt: een
// diagnose die een andere reden noemt dan de ronde hanteert, wijst de verkeerde
// stap aan.

const cluster = { kernTokens: ["budget", "bercy", "economies"], items: [{ titel: "Budget 2027 : Bercy détaille 40 milliards d'économies en France" }] };

test("een bestaand concept, een publicatie en een afwijzing worden uit elkaar gehouden", () => {
  assert.equal(blokkadeVoor({ cluster, concept: { aangemaaktOp: "A" } }).teller, "concept");
  assert.equal(blokkadeVoor({ cluster, publicatie: { gepubliceerdOp: "B" } }).teller, "publicatie");
  const af = blokkadeVoor({ cluster, afgewezen: { op: "C", reden: "te-smal" } });
  assert.equal(af.teller, "afgewezen");
  assert.equal(af.sinds, "C");
  assert.match(af.uitleg, /te-smal/, "de afwijsreden hoort in de uitleg te staan");
});

test("de sleutels gaan vóór de vingerafdruk, en de vingerafdruk vóór de buitenlandpoort", () => {
  const beide = blokkadeVoor({ cluster, concept: { aangemaaktOp: "A" }, kernen: [cluster.kernTokens] });
  assert.equal(beide.teller, "concept", "de goedkoopste toets hoort eerst te komen");
  assert.equal(blokkadeVoor({ cluster, kernen: [cluster.kernTokens] }).teller, "duplicaat");
});

test("niets in de weg levert geen blokkade op", () => {
  assert.equal(blokkadeVoor({ cluster, kernen: [] }), null);
});

test("een opschoning die de wachtrij leegtrekt wordt als oorzaak genoemd", () => {
  const m = nieuweMeting(NU);
  Object.assign(m, {
    itemsTotaal: 210, persRuw: 98, naZeef: 61, binnenVenster: 44, clusters: 21,
    bovenDrempel: 3, kandidaten: 3, beoordeeld: 3, syntheseAangeroepen: 3,
    geschreven: 0, opgeruimd: 12, openstaandeConcepten: 0,
  });
  m.opgeruimdeRedenen = { "te-weinig-outlets": 12 };
  assert.match(duiding(m), /opschoning haalde 12 concept/);
  assert.match(logRegels(m).join("\n"), /uit de voorraad: opgeruimd=12 \(te-weinig-outlets=12\)/);
});
