// Zelftests voor de bronnenlijst onder een perssynthese.
//
// Achtergrond: de synthese geeft op welke aangeleverde bronnen ze echt heeft
// gebruikt. Ging dat mis, dan viel de lijst stilzwijgend terug op ALLE
// clusteritems en verscheen bijvangst onder het artikel (een verkiezingskop
// onder een stuk over evacués, een Tour-kop onder een stuk over treinverkeer).
// Deze tests bewaken het parsen van die opgave, het matchen op URL en de
// samenhang met de publicatiepoort.

import { test } from "node:test";
import assert from "node:assert/strict";

import { scheidGebruikt, bouwBronnen, urlSleutel } from "../lib/synthese.js";
import { beoordeelPublicatie } from "../lib/poort.js";

const CLUSTER = {
  items: [
    { bron: "Le Monde — À la une", titel: "Retour des habitants évacués dans l'Aude", url: "https://www.lemonde.fr/a/evacues", datum: "2026-08-03T08:00:00Z" },
    { bron: "Sud Ouest", titel: "Les évacués regagnent leur domicile ce dimanche", url: "https://www.sudouest.fr/b/evacues", datum: "2026-08-03T09:00:00Z" },
    { bron: "Midi Libre", titel: "Xavier Bertrand se déclare candidat", url: "https://www.midilibre.fr/c/bertrand", datum: "2026-08-03T07:00:00Z" },
    { bron: "Franceinfo — Titres", titel: "Tour de France : l'étape de demain", url: "https://www.franceinfo.fr/d/tour", datum: "2026-08-03T06:00:00Z" },
  ],
};
const antwoord = (staart) => `Evacués keren terug\n\nDe bewoners mogen terug naar huis.\n\n${staart}`;

// ---- 1) Parsen van de GEBRUIKT-opgave --------------------------------------

test("GEBRUIKT met links wordt geparseerd", () => {
  const r = scheidGebruikt(
    antwoord("GEBRUIKT: https://www.lemonde.fr/a/evacues, https://www.sudouest.fr/b/evacues"),
    4
  );
  assert.equal(r.urls.length, 2);
  assert.ok(!/GEBRUIKT/i.test(r.tekst), "de GEBRUIKT-regel hoort uit de tekst te zijn");
});

test("rommelige varianten worden nu óók geparseerd (waren stille terugvallen)", () => {
  const varianten = [
    "GEBRUIKT: 1, 3, 4.",                    // afsluitende punt
    "**GEBRUIKT: 1, 3**",                    // vetgedrukt
    "GEBRUIKT: 1, 3 (Le Monde, Sud Ouest)",  // toelichting achter de nummers
    "- GEBRUIKT: bron 1 en 2",               // opsommingsstreepje + het woord "bron"
    "GEBRUIKT: #1, #2",                      // nummertekens
    "Gebruikt: 1, 2",                        // kleine letters
  ];
  for (const v of varianten) {
    const r = scheidGebruikt(antwoord(v), 4);
    assert.ok(r.nummers && r.nummers.length, `niet geparseerd: ${v}`);
    assert.ok(!/gebruikt/i.test(r.tekst), `regel bleef in de tekst staan: ${v}`);
  }
});

test("geen GEBRUIKT-regel -> niets opgegeven", () => {
  const r = scheidGebruikt(antwoord("Zonder opgave."), 4);
  assert.equal(r.urls, null);
  assert.equal(r.nummers, null);
});

test("nummers buiten het bereik van het cluster worden genegeerd", () => {
  assert.equal(scheidGebruikt(antwoord("GEBRUIKT: 9, 12"), 4).nummers, null);
});

test("urlSleutel negeert tracking-parameters, hoofdletters en trailing slash", () => {
  assert.equal(
    urlSleutel("https://WWW.Lemonde.fr/a/evacues/?xtor=RSS-1#top"),
    urlSleutel("https://www.lemonde.fr/a/evacues")
  );
});

// ---- 2) Matchen op URL ------------------------------------------------------

test("model gebruikt een subset: alleen die bronnen blijven over", () => {
  const keuze = scheidGebruikt(
    antwoord("GEBRUIKT: https://www.lemonde.fr/a/evacues, https://www.sudouest.fr/b/evacues"),
    4
  );
  const { bronnen, gefilterd } = bouwBronnen(CLUSTER, keuze);
  assert.equal(gefilterd, true);
  assert.deepEqual(bronnen.map((b) => b.naam), ["Le Monde — À la une", "Sud Ouest"]);
  // De bijvangst is weg.
  assert.ok(!bronnen.some((b) => /bertrand|tour/.test(b.url)));
  // En de bewaarde velden blijven compleet.
  assert.deepEqual(Object.keys(bronnen[0]).sort(), ["datum", "naam", "titel", "url"]);
});

test("markdown en leestekens rond de links breken het matchen niet", () => {
  // Realistische modeluitvoer: de hele regel vetgedrukt, of een punt erachter.
  // Zonder opschoning kleeft "**" aan de LAATSTE url en valt die bron weg.
  for (const staart of [
    "**GEBRUIKT: https://www.lemonde.fr/a/evacues, https://www.sudouest.fr/b/evacues**",
    "GEBRUIKT: https://www.lemonde.fr/a/evacues, https://www.sudouest.fr/b/evacues.",
    "GEBRUIKT: (https://www.lemonde.fr/a/evacues), (https://www.sudouest.fr/b/evacues)",
  ]) {
    const { bronnen, gefilterd } = bouwBronnen(CLUSTER, scheidGebruikt(antwoord(staart), 4));
    assert.equal(gefilterd, true, staart);
    assert.deepEqual(bronnen.map((b) => b.naam), ["Le Monde — À la une", "Sud Ouest"], staart);
  }
});

test("links met tracking-parameters matchen nog steeds op het clusteritem", () => {
  const keuze = scheidGebruikt(antwoord("GEBRUIKT: https://www.lemonde.fr/a/evacues?xtor=RSS-9"), 4);
  const { bronnen, gefilterd } = bouwBronnen(CLUSTER, keuze);
  assert.equal(gefilterd, true);
  assert.deepEqual(bronnen.map((b) => b.naam), ["Le Monde — À la une"]);
});

test("volgnummers werken als terugval wanneer er geen links staan", () => {
  const keuze = scheidGebruikt(antwoord("GEBRUIKT: 1, 2"), 4);
  const { bronnen, gefilterd } = bouwBronnen(CLUSTER, keuze);
  assert.equal(gefilterd, true);
  assert.deepEqual(bronnen.map((b) => b.naam), ["Le Monde — À la une", "Sud Ouest"]);
});

test("model levert niets bruikbaars: volledige clusterlijst + terugval-markering", () => {
  const keuze = scheidGebruikt(antwoord("Zonder opgave."), 4);
  const { bronnen, gefilterd } = bouwBronnen(CLUSTER, keuze);
  assert.equal(gefilterd, false, "geen filtering, dus terugval");
  assert.equal(bronnen.length, 4);
});

test("onbekende links (hallucinatie) tellen niet als filtering", () => {
  const keuze = scheidGebruikt(antwoord("GEBRUIKT: https://www.verzonnen.fr/x"), 4);
  const { bronnen, gefilterd } = bouwBronnen(CLUSTER, keuze);
  assert.equal(gefilterd, false);
  assert.equal(bronnen.length, 4);
});

test("dubbele URL's in het cluster leveren één bronregel op", () => {
  const dubbel = { items: [CLUSTER.items[0], { ...CLUSTER.items[0] }, CLUSTER.items[1]] };
  const { bronnen } = bouwBronnen(dubbel, { urls: [CLUSTER.items[0].url], nummers: null });
  assert.equal(bronnen.length, 1);
});

// ---- 3) Samenhang met de publicatiepoort ------------------------------------

test("na filtering blijft één outlet over -> de gate weigert publicatie", () => {
  // Cluster met twee Le Monde-koppen en één losse Midi Libre-kop (bijvangst).
  const cluster = {
    items: [
      { bron: "Le Monde — À la une", titel: "Reprise du trafic ferroviaire dans le Sud", url: "https://www.lemonde.fr/t1", datum: "2026-08-03T08:00:00Z" },
      { bron: "Le Monde — À la une", titel: "SNCF : les trains circulent de nouveau", url: "https://www.lemonde.fr/t2", datum: "2026-08-03T09:00:00Z" },
      { bron: "Midi Libre", titel: "Tour de France : l'étape de demain", url: "https://www.midilibre.fr/t3", datum: "2026-08-03T06:00:00Z" },
    ],
  };
  const keuze = scheidGebruikt(antwoord("GEBRUIKT: https://www.lemonde.fr/t1, https://www.lemonde.fr/t2"), 3);
  const { bronnen, gefilterd } = bouwBronnen(cluster, keuze);
  assert.equal(gefilterd, true);
  assert.equal(bronnen.length, 2);

  // Ongefilterd zou het cluster twee outlets tellen; de gate rekent op de
  // GEFILTERDE lijst en houdt er dus één over -> weigeren.
  const oordeel = beoordeelPublicatie(
    { bronnen, tekst: "Nederlandse parafrase over het treinverkeer." },
    "Nederlandse parafrase over het treinverkeer."
  );
  assert.equal(oordeel.ok, false);
  assert.equal(oordeel.code, "te-weinig-outlets");
});

test("gefilterde lijst met twee echte outlets komt wél door de gate", () => {
  const keuze = scheidGebruikt(
    antwoord("GEBRUIKT: https://www.lemonde.fr/a/evacues, https://www.sudouest.fr/b/evacues"),
    4
  );
  const { bronnen } = bouwBronnen(CLUSTER, keuze);
  const tekst =
    "Bewoners van verschillende dorpen in de Aude mogen terug naar huis. " +
    "De prefectuur hief het vertrek-bevel zondag op nadat de brand onder controle kwam.";
  const oordeel = beoordeelPublicatie({ bronnen, tekst }, tekst);
  assert.equal(oordeel.ok, true, oordeel.fout);
  assert.equal(oordeel.onafhankelijk, 2);
});
