// Zelftests voor de publicatiepoort en de onafhankelijkheidstelling.
// Draaien met:  node --test test/
//
// De eerste testgroep reconstrueert het incident van 03-08: een synthese uit
// TWEE koppen van ÉÉN krant (Midi Libre), over twee losse vermissings-/
// verdrinkingszaken. Die combinatie moet op drie plekken stuklopen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { telOnafhankelijk, outletId, isWire, outletNamen } from "../lib/cluster.js";
import { beoordeelPublicatie, structureelGeldig, kopGelijkenis } from "../lib/poort.js";

const MIDI_A = {
  naam: "Midi Libre",
  titel: "Disparition inquiétante à Sète : un homme porté disparu depuis mardi",
  url: "https://www.midilibre.fr/a",
};
const MIDI_B = {
  naam: "Midi Libre",
  titel: "Noyade dans l'Hérault : le corps d'un adolescent retrouvé sans vie",
  url: "https://www.midilibre.fr/b",
};

// ---- 1) Onafhankelijkheidstelling ------------------------------------------

test("outletId snijdt de rubrieksuffix eraf", () => {
  assert.equal(outletId("Midi Libre — faits divers"), outletId("Midi Libre"));
  assert.equal(outletId("Le Monde — À la une"), "lemonde");
  assert.notEqual(outletId("Le Monde"), outletId("Le Figaro"));
});

test("twee koppen van dezelfde krant tellen als één onafhankelijke bron", () => {
  const items = [
    { bron: MIDI_A.naam, titel: MIDI_A.titel },
    { bron: MIDI_B.naam, titel: MIDI_B.titel },
  ];
  assert.equal(telOnafhankelijk(items), 1);
  assert.deepEqual(outletNamen(items), ["Midi Libre"]);
});

test("dezelfde krant via twee rubrieksfeeds telt nog steeds als één", () => {
  assert.equal(
    telOnafhankelijk([
      { bron: "Midi Libre", titel: "Grève des transports à Montpellier" },
      { bron: "Midi Libre — faits divers", titel: "Circulation perturbée dans le Gard" },
    ]),
    1
  );
});

test("twee verschillende kranten met eigen koppen tellen als twee", () => {
  assert.equal(
    telOnafhankelijk([
      { bron: "Le Monde — À la une", titel: "Le gouvernement revoit le calcul des retraites" },
      { bron: "Sud Ouest", titel: "Réforme des retraites : ce qui change au 1er janvier" },
    ]),
    2
  );
});

test("letterlijk overgenomen kop (wire) telt als één, ook bij twee kranten", () => {
  const kop = "Le gouvernement annonce un plan de soutien aux agriculteurs";
  assert.equal(
    telOnafhankelijk([
      { bron: "Le Figaro — Actualités", titel: kop },
      { bron: "Franceinfo — Titres", titel: kop },
    ]),
    1
  );
});

test("persbureau-markers worden herkend in kop en bronvermelding", () => {
  assert.equal(isWire({ titel: "Grève SNCF (avec AFP)", bron: "Sud Ouest" }), true);
  assert.equal(isWire({ titel: "Grève SNCF", bron: "Le Monde — AFP" }), true);
  assert.equal(isWire({ titel: "Reuters-bericht over de begroting", bron: "NU.nl" }), true);
  // Geen valse treffers: "ap" binnen een woord of plaatsnaam telt niet mee.
  assert.equal(isWire({ titel: "Incendie au Cap d'Agde", bron: "Midi Libre" }), false);
  assert.equal(isWire({ titel: "Le rapport de la Cour des comptes", bron: "Le Monde" }), false);
});

test("twee persbureau-items over hetzelfde verhaal tellen als één, ongeacht de outlet", () => {
  assert.equal(
    telOnafhankelijk([
      { bron: "Le Figaro — Actualités", titel: "Budget 2027 : Bercy confirme la hausse des taxes (AFP)" },
      { bron: "Franceinfo — Titres", titel: "AFP — Bercy confirme une hausse des taxes dans le budget" },
    ]),
    1
  );
});

test("een persbureau-item en een eigen bericht van een andere krant blijven twee", () => {
  assert.equal(
    telOnafhankelijk([
      { bron: "Le Figaro — Actualités", titel: "Budget 2027 : Bercy confirme la hausse des taxes (AFP)" },
      { bron: "Sud Ouest", titel: "Impôts locaux : les habitants de Gironde face à la nouvelle grille" },
    ]),
    2
  );
});

// ---- 2) Gelijkenis concepttekst <-> bronkop --------------------------------

test("een letterlijk nageschreven kop haalt de drempel", () => {
  const kop = "Le gouvernement revoit le calcul des retraites complementaires";
  const tekst = "Volgens meerdere kranten: Le gouvernement revoit le calcul des retraites complementaires.";
  assert.ok(kopGelijkenis(tekst, kop) >= 0.5);
});

test("een echte parafrase blijft ruim onder de drempel", () => {
  const kop = "Le gouvernement revoit le calcul des retraites complementaires";
  const tekst =
    "De Franse regering past de berekening van de aanvullende pensioenen aan. " +
    "Wie na 2027 met pensioen gaat, krijgt met een andere rekenmethode te maken.";
  assert.ok(kopGelijkenis(tekst, kop) < 0.5);
});

test("koppen korter dan drie woorden leveren geen oordeel op", () => {
  assert.equal(kopGelijkenis("wat dan ook", "Grève SNCF"), 0);
});

// ---- 3) De publicatiepoort --------------------------------------------------

const persConcept = (bronnen, tekst) => ({ id: "t", kop: "Kop", tekst, bronnen });

test("INCIDENT 03-08: twee koppen uit één krant worden geweigerd", () => {
  const c = persConcept([MIDI_A, MIDI_B], "Een nette Nederlandse parafrase over twee zaken.");
  const oordeel = beoordeelPublicatie(c, c.tekst);
  assert.equal(oordeel.ok, false);
  assert.equal(oordeel.code, "te-weinig-outlets");
  assert.match(oordeel.fout, /Midi Libre/);
  // En hij wordt ook door de KV-opschoning opgepikt.
  assert.equal(structureelGeldig(c).ok, false);
});

test("faits-divers-kop wordt geweigerd, ook met twee verschillende kranten", () => {
  const c = persConcept(
    [
      { naam: "Sud Ouest", titel: "Noyade à Arcachon : un homme retrouvé sans vie", url: "u1" },
      { naam: "Midi Libre", titel: "Un corps sans vie découvert sur la plage", url: "u2" },
    ],
    "Nederlandse tekst."
  );
  const oordeel = beoordeelPublicatie(c, c.tekst);
  assert.equal(oordeel.ok, false);
  assert.equal(oordeel.code, "faits-divers");
});

test("te veel overlap met een bronkop wordt geweigerd", () => {
  const kop = "Greve des controleurs aeriens : trafic perturbe dans tous les aeroports";
  const c = persConcept(
    [
      { naam: "Le Monde — À la une", titel: kop, url: "u1" },
      { naam: "Sud Ouest", titel: "Les vols au depart de Bordeaux fortement reduits", url: "u2" },
    ],
    "Greve des controleurs aeriens : trafic perturbe dans tous les aeroports, meldt de pers."
  );
  const oordeel = beoordeelPublicatie(c, c.tekst);
  assert.equal(oordeel.ok, false);
  assert.equal(oordeel.code, "te-veel-kopoverlap");
  // De opschoonvariant gooit hier NIET op weg: de tekst is nog te herschrijven.
  assert.equal(structureelGeldig(c).ok, true);
});

test("een correct concept van twee kranten gaat door de poort", () => {
  const c = persConcept(
    [
      { naam: "Le Monde — À la une", titel: "Greve des controleurs aeriens ce week-end", url: "u1" },
      { naam: "Sud Ouest", titel: "Les vols au depart de Bordeaux fortement reduits", url: "u2" },
    ],
    "Franse luchtverkeersleiders leggen dit weekend het werk neer. Reizigers moeten rekening " +
      "houden met geschrapte vluchten, ook vanaf de regionale luchthavens in het zuidwesten."
  );
  const oordeel = beoordeelPublicatie(c, c.tekst);
  assert.equal(oordeel.ok, true, oordeel.fout);
  assert.equal(oordeel.onafhankelijk, 2);
});

test("overheidsconcepten vallen buiten de poort", () => {
  const c = persConcept(
    [{ naam: "Service-Public — particuliers", titel: "Noyade : les regles de securite", url: "u1" }],
    "Eén bron, een faits-divers-woord in de kop — en toch toegestaan: ander regime."
  );
  assert.equal(beoordeelPublicatie(c, c.tekst).ok, true);
  assert.equal(structureelGeldig(c).ok, true);
});

test("verenigingsconcepten (onbekende bronnaam) vallen buiten de poort", () => {
  const c = persConcept(
    [{ naam: "Nederlandse Vereniging Dordogne", titel: "Zomerborrel in Périgueux", url: "u1" }],
    "Aankondiging van de vereniging."
  );
  assert.equal(beoordeelPublicatie(c, c.tekst).ok, true);
});
