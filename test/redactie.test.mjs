// Zelftests voor de redactiehulp in de reviewtool:
//   - gelijkenis met een ander concept / een live artikel (waarschuwing,
//     serverside vangnet, en de bevestigingsvlag om er toch langs te gaan);
//   - de verbrede sport-zeef (uitsluiten én de praktische uitzonderingen);
//   - detectie van outletnamen in de lopende tekst.

import { test } from "node:test";
import assert from "node:assert/strict";

import { gelijkenis, vindGelijkenis, kernVan } from "../lib/gelijkenis.js";
import { sportDoorlaat } from "../lib/feeds.js";
import { outletnamenInTekst, zachteSignalen } from "../lib/poort.js";

const bron = (naam, url, titel) => ({ naam, url, titel: titel || "Kop", datum: "2026-08-03T08:00:00Z" });

// ---- 1) Gelijkenis ----------------------------------------------------------

const brandA = {
  id: "a",
  kop: "Bewoners Aude mogen terug naar huis",
  tekst:
    "De prefectuur van de Aude heft het evacuatiebevel op. Bewoners van Durban en Villesèque " +
    "mogen zondag terugkeren nadat de bosbrand onder controle is gebracht.",
  bronnen: [
    bron("Le Monde — À la une", "https://www.lemonde.fr/aude/evacues"),
    bron("Sud Ouest", "https://www.sudouest.fr/aude/evacues"),
  ],
};
// Zelfde verhaal, andere formulering en deels dezelfde bronlinks.
const brandAbis = {
  id: "a2",
  kop: "Evacuatiebevel Aude opgeheven",
  tekst:
    "Inwoners van Durban en Villesèque keren zondag terug. De brand in de Aude is onder controle " +
    "volgens de prefectuur, die het vertrekbevel introk.",
  bronnen: [
    bron("Le Monde — À la une", "https://www.lemonde.fr/aude/evacues?xtor=RSS-1"),
    bron("Franceinfo — Titres", "https://www.franceinfo.fr/aude/retour"),
  ],
};
// Legitiem vervolgverhaal: zelfde regio en thema, ander nieuwsfeit, eigen bronnen.
const vervolg = {
  id: "b",
  kop: "Aude trekt miljoen uit voor herbebossing",
  tekst:
    "De departementsraad van de Aude maakt een miljoen euro vrij voor herbebossing en het herstel " +
    "van wandelpaden. Het geld komt beschikbaar vanaf oktober en is bedoeld voor gemeenten.",
  bronnen: [
    bron("Midi Libre", "https://www.midilibre.fr/aude/herbebossing"),
    bron("Sud Ouest", "https://www.sudouest.fr/aude/subsidie-bos"),
  ],
};

test("identiek verhaal wordt herkend", () => {
  const g = gelijkenis(brandA, brandAbis);
  assert.equal(g.sterk, true, JSON.stringify(g));
});

test("gedeelde bron-URL's tellen ook met tracking-parameters", () => {
  // Beide verwijzen naar hetzelfde Le Monde-artikel, één met ?xtor=.
  assert.equal(gelijkenis(brandA, brandAbis).gedeeldeUrls >= 1, true);
});

test("twee identieke bronlinks zijn op zichzelf al een sterk signaal", () => {
  const x = { id: "x", kop: "Heel andere woorden hier", tekst: "Volstrekt afwijkende formulering zonder overlap.",
    bronnen: [bron("Le Monde — À la une", "https://www.lemonde.fr/aude/evacues"), bron("Sud Ouest", "https://www.sudouest.fr/aude/evacues")] };
  const g = gelijkenis(brandA, x);
  assert.equal(g.sterk, true);
  assert.equal(g.reden, "bron-urls");
});

test("legitiem vervolgverhaal blijft onder de drempel", () => {
  const g = gelijkenis(brandA, vervolg);
  assert.equal(g.sterk, false, `vervolgverhaal onterecht gemarkeerd: ${JSON.stringify(g)}`);
});

test("vindGelijkenis meldt het lijkende concept én het live artikel", () => {
  const live = { ...brandAbis, id: "p1", gepubliceerdOp: "2026-08-03T10:00:00Z" };
  const r = vindGelijkenis(brandA, [brandA, brandAbis, vervolg], [live]);
  assert.ok(r.concept, "lijkend concept gevonden");
  assert.equal(r.concept.id, "a2");
  assert.ok(r.publicatie, "lijkend live artikel gevonden");
  assert.equal(r.publicatie.gepubliceerdOp, "2026-08-03T10:00:00Z");
});

test("vindGelijkenis vergelijkt een concept niet met zichzelf", () => {
  assert.equal(vindGelijkenis(brandA, [brandA], []).concept, null);
});

test("een schoon concept levert geen enkele melding op", () => {
  const r = vindGelijkenis(vervolg, [vervolg], []);
  assert.equal(r.concept, null);
  assert.equal(r.publicatie, null);
});

test("kernVan gebruikt opgeslagen kernTokens als die er zijn", () => {
  assert.deepEqual(kernVan({ kernTokens: ["aude", "prefectuur"] }), ["aude", "prefectuur"]);
});

// De bevestigingsvlag: dezelfde selectie als api/review.js, zodat de
// overrule-route hier meetest zonder KV of netwerk.
function publicatiePoging(concept, live, bevestigd) {
  if (bevestigd === true) return { gepubliceerd: true };
  for (const p of live) {
    if (gelijkenis(concept, p).sterk) {
      return { gepubliceerd: false, code: "lijkt-op-live", bevestigingNodig: true };
    }
  }
  return { gepubliceerd: true };
}

test("bevestigingsvlag: eerste poging geweigerd, tweede gaat door", () => {
  const live = [{ ...brandAbis, id: "p1", gepubliceerdOp: "2026-08-03T10:00:00Z" }];
  const eerste = publicatiePoging(brandA, live, undefined);
  assert.equal(eerste.gepubliceerd, false);
  assert.equal(eerste.bevestigingNodig, true);
  const tweede = publicatiePoging(brandA, live, true);
  assert.equal(tweede.gepubliceerd, true, "met bevestiging mag het wél");
});

test("zonder lijkend live artikel is er geen bevestiging nodig", () => {
  assert.equal(publicatiePoging(vervolg, [{ ...brandA, id: "p9" }], undefined).gepubliceerd, true);
});

// ---- 2) Sport-zeef ----------------------------------------------------------

test("sportuitslagen worden geweerd", () => {
  const uit = [
    "Tour de France : Pogacar remporte l'étape du Ventoux",
    "Wielrennen: Nederlandse renner wint etappe in de Pyreneeën",
    "Roland-Garros : Alcaraz en finale",
    "Wimbledon: titelverdediger uitgeschakeld",
    "Rugby : le XV de France s'impose à Dublin",
    "Top 14 : Toulouse champion",
    "Formule 1 : Verstappen en pole position au Grand Prix de Monaco",
    "Jeux olympiques : la France décroche l'or",
    "Olympische Spelen: recordaantal medailles",
    "Championnats du monde d'athlétisme : nouvelle finale",
    "Ligue 1 : le PSG s'impose au Parc des Princes",
    "MotoGP : le champion assure son titre au Mans",
  ];
  for (const t of uit) assert.equal(sportDoorlaat(t), false, `had geweerd moeten worden: ${t}`);
});

test("sport met praktische impact komt er wél door", () => {
  const door = [
    "Tour de France : circulation perturbée à Montpellier ce mercredi",
    "Roland-Garros : stationnement interdit autour du stade",
    "Formule 1 : plusieurs rues barrées à Monaco pendant le week-end",
    "Wielerkoers door Bordeaux: meerdere straten afgesloten",
    "Match de Ligue 1 : bousculade à l'entrée du stade, plusieurs blessés",
    "Grand Prix : grève des transports le jour de la course",
    "Jeux olympiques : plan de circulation modifié dans le centre",
  ];
  for (const t of door) assert.equal(sportDoorlaat(t), true, `had door moeten komen: ${t}`);
});

test("gewoon nieuws blijft ongemoeid door de sport-zeef", () => {
  const door = [
    "Grève des contrôleurs aériens : les vols annulés vendredi",
    "Impôts : le barème kilométrique 2027 est publié",
    "Incendie dans l'Aude : les habitants regagnent leur domicile",
    "Le rapport de la Cour des comptes sur les retraites",
  ];
  for (const t of door) assert.equal(sportDoorlaat(t), true, `onterecht geweerd: ${t}`);
});

// ---- 3) Outletnamen in de lopende tekst ------------------------------------

const persBronnen = [
  bron("Le Monde — À la une", "https://www.lemonde.fr/x"),
  bron("Sud Ouest", "https://www.sudouest.fr/x"),
  bron("Franceinfo — Titres", "https://www.franceinfo.fr/x"),
];

test("outletnaam met rubrieksuffix wordt herkend aan de korte vorm in de tekst", () => {
  const gevonden = outletnamenInTekst("Volgens Le Monde stijgt het aantal aanvragen fors.", persBronnen);
  assert.deepEqual(gevonden, ["Le Monde"]);
});

test("meerdere outletnamen worden alle gemeld", () => {
  const gevonden = outletnamenInTekst(
    "Le Monde meldt een stijging; Franceinfo spreekt van een verdubbeling.",
    persBronnen
  );
  assert.equal(gevonden.length, 2);
  assert.ok(gevonden.includes("Le Monde") && gevonden.includes("Franceinfo"));
});

test("hoofdletters en accenten maken niet uit", () => {
  assert.deepEqual(outletnamenInTekst("volgens LE MONDE.", persBronnen), ["Le Monde"]);
});

test("generieke formuleringen leveren geen melding op", () => {
  const tekst =
    "Volgens meerdere Franse media stijgt het aantal aanvragen. Eén bron meldt daarnaast " +
    "dat de regeling in oktober ingaat; dat is nog niet bevestigd.";
  assert.deepEqual(outletnamenInTekst(tekst, persBronnen), []);
});

test("een deel van een naam binnen een ander woord telt niet mee", () => {
  // "monde" komt voor in "wereldwijd"-achtige constructies; alleen de hele naam telt.
  assert.deepEqual(outletnamenInTekst("Een mondement in het dossier bleef uit.", persBronnen), []);
});

test("zachteSignalen meldt de namen bij een persconcept", () => {
  const concept = { tekst: "Sud Ouest schrijft dat de weg dicht blijft.", bronnen: persBronnen };
  assert.deepEqual(zachteSignalen(concept).outletnamen, ["Sud Ouest"]);
});

test("zachteSignalen laat overheidsconcepten met rust", () => {
  const concept = {
    tekst: "Service-Public meldt de nieuwe regeling.",
    bronnen: [bron("Service-Public — particuliers", "https://www.service-public.fr/x")],
  };
  assert.deepEqual(zachteSignalen(concept).outletnamen, []);
});
