// Welke redactiehandelingen de voorgebakken momentopname ongeldig maken.
// ---------------------------------------------------------------------------
// WAAROM DIT ER APART STAAT. /api/actueel serveert een voorgebakken
// momentopname uit KV en laat die pas los na SNAPSHOT_MAX_LEEFTIJD_S (een uur),
// of zodra de cron een nieuwe bakt. Elke redactiehandeling die verandert wat de
// lezer op /actueel ziet, moet die momentopname dus weggooien — anders werkt de
// handeling tot een uur (zonder cron: tot zes uur) na.
//
// Het zwaarst weegt dat bij "Van de site halen". Wie een bericht weghaalt omdat
// het fout of schadelijk is, haalt het nu weg. Een kill-switch die een uur
// nawerkt is geen ongemak maar een redactioneel risico, en precies daarom is
// het de moeite waard om per actie vast te leggen wat er gebeurt.
//
// NET ZO BELANGRIJK: de acties die het NIET doen. Concepten staan niet op
// /actueel, en de nakijklijst ziet de lezer nooit. Die onnodig laten vervallen
// zou elke redactieklik een verse bak kosten (alle feeds ophalen, ~10 s), en dat
// is de reden dat deze test ook de negatieve kant vastlegt.
//
// De echte route draait hier tegen een namaak-KV; er wordt geen logica nagedaan.

import test from "node:test";
import assert from "node:assert/strict";

import { startNepKv, roeper } from "./fixtures/nep-kv.mjs";

const { db, sluit } = await startNepKv();
process.env.REVIEW_TOKEN = "geheim";
test.after(sluit);

const C = await import("../lib/config.js");
const review = (await import("../api/review.js")).default;
const roep = roeper(review, "geheim");

const SNAPSHOTS = [C.KEY_ACTUEEL_SNAPSHOT, C.KEY_ACTUEEL_TEKST_SNAPSHOT, C.KEY_ACTUEEL_ARCHIEF_SNAPSHOT];
const NU = Date.now();
const iso = (msGeleden = 0) => new Date(NU - msGeleden).toISOString();

// Een geldig persconcept: twee onafhankelijke outlets, anders weigert de poort
// het publiceren en meet deze test niets.
const concept = () => ({
  id: "c1",
  kop: "Aangiftetermijn verschuift met twee weken",
  tekst: "De belastingdienst verlengt de termijn voor de jaarlijkse aangifte met twee weken. Dat maakte het ministerie bekend.",
  aangemaaktOp: iso(3600e3),
  aantalBronnen: 2,
  bronnen: [
    { naam: "Le Monde — À la une", titel: "Impots: le delai recule", url: "https://lemonde.fr/impots", datum: iso(7200e3) },
    { naam: "Sud Ouest", titel: "Declaration: deux semaines de plus", url: "https://sudouest.fr/impots", datum: iso(7200e3) },
  ],
});

// Een ANDER verhaal dan het concept, met eigen bronlinks. Met een kopie zou de
// gelijkenistoets in de poort het publiceren blokkeren (409 "lijkt op live") en
// meet deze test niets — dat gebeurde bij het schrijven ook echt.
const publicatie = () => ({
  id: "p1",
  kop: "Energieprijzen dalen komende winter",
  tekst: "Huishoudens betalen komende winter minder voor gas. De regulering van de tarieven wordt aangepast.",
  aangemaaktOp: iso(7200e3),
  aantalBronnen: 2,
  bronnen: [
    { naam: "Le Figaro", titel: "Le gaz baisse", url: "https://lefigaro.fr/gaz", datum: iso(10800e3) },
    { naam: "Ouest-France", titel: "Tarifs du gaz en baisse", url: "https://ouest-france.fr/gaz", datum: iso(10800e3) },
  ],
  gepubliceerd: true,
  gepubliceerdOp: iso(3600e3),
});

const overheidDoc = () => ({
  id: "o1",
  thema: "nl-overheid",
  bron: "Rijksoverheid",
  url: "https://www.rijksoverheid.nl/actueel/nieuws/2026/09/05/paspoort",
  datum: iso(3600e3),
  kop: "Paspoort aanvragen wordt eenvoudiger",
  samenvatting: "Nederlanders in Frankrijk kunnen hun paspoort bij meer loketten aanvragen.",
  gepubliceerdOp: iso(3600e3),
});

// De momentopnames hoeven voor deze toets geen echte inhoud te hebben: het gaat
// om de vraag of de sleutels blijven staan of verdwijnen.
function zetVulling() {
  db.clear();
  db.set(C.KEY_CONCEPT("c1"), JSON.stringify(concept()));
  db.set(C.KEY_PUBLICATIE("p1"), JSON.stringify(publicatie()));
  db.set(C.KEY_OVERHEID("o1"), JSON.stringify(overheidDoc()));
  db.set(C.KEY_IF_INDEX, JSON.stringify({
    opgehaaldOp: iso(), categorieen: {},
    artikelen: [{ ifId: 9, titel: "Belastingaangifte", url: "https://infofrankrijk.com/belastingaangifte/", modified: iso(30 * 864e5), categorieen: [] }],
  }));
  for (const s of SNAPSHOTS) db.set(s, JSON.stringify({ gebakkenOp: iso(600e3), tegels: [], artikelen: {} }));
}

const staanEr = () => SNAPSHOTS.filter((s) => db.has(s)).length;

// ---- Wel vervallen ---------------------------------------------------------

for (const [naam, actie, body] of [
  ['"Publiceer"', "publiceer", { id: "c1" }],
  ['"Van de site halen" (perssynthese)', "depubliceer", { id: "p1" }],
  ['"Van de site halen" (overheidsbericht)', "verwijder-overheid", { id: "o1" }],
  ['"Toevoegen aan archief"', "archiveer", { id: "p1" }],
  ['een verwijzing zetten', "verwijs", { id: "o1", ifId: 9 }],
]) {
  test(`${naam} maakt alle drie de momentopnames ongeldig`, async () => {
    zetVulling();
    assert.equal(staanEr(), 3, "vooraf staan ze er alle drie");
    const res = await roep("POST", { actie, ...body });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(res.body.snapshotVervallen, true, "het antwoord zegt het ook");
    assert.equal(staanEr(), 0, "alle drie weg, nooit één — ze horen hetzelfde bakmoment te dragen (sonde I10)");
  });
}

test('"Van de site halen" haalt het record weg vóór de momentopname', async () => {
  // De volgorde is niet willekeurig: staat het record er nog terwijl de
  // momentopname al weg is, dan kan een gelijktijdige aanvraag van /api/actueel
  // opnieuw bakken mét het artikel dat net is weggehaald.
  zetVulling();
  await roep("POST", { actie: "verwijder-overheid", id: "o1" });
  assert.equal(db.has(C.KEY_OVERHEID("o1")), false, "het bericht is weg");
  assert.equal(staanEr(), 0, "en de momentopnames ook");
});

// ---- Niet vervallen --------------------------------------------------------

for (const [naam, actie, body] of [
  ['"Weg" (een concept afwijzen)', "weg", { id: "c1" }],
  ['"Bewaar tekst"', "bewerk", { id: "c1", tekst: "Een bijgewerkte concepttekst voor de wachtrij." }],
  ['"Nakijken"', "nakijken", { id: "o1", ifId: 9 }],
  ['afvinken op de nakijklijst', "nakijken-klaar", { id: "9", ifId: 9 }],
]) {
  test(`${naam} laat de momentopnames staan`, async () => {
    zetVulling();
    const res = await roep("POST", { actie, ...body });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(staanEr(), 3,
      "dit verandert niets aan wat de lezer op /actueel ziet; onnodig vervallen kost elke klik een verse bak");
  });
}

test("een geweigerde publicatie laat de momentopnames staan", async () => {
  // Weigert de poort, dan is er niets veranderd — en dan hoort er ook niets
  // weggegooid te worden. Eén bron is te weinig (SYNTHESE_MIN_BRONNEN).
  zetVulling();
  db.set(C.KEY_CONCEPT("c2"), JSON.stringify({
    ...concept(),
    id: "c2",
    aantalBronnen: 1,
    bronnen: [concept().bronnen[0]],
  }));
  const res = await roep("POST", { actie: "publiceer", id: "c2" });
  assert.notEqual(res.code, 200, "de poort hoort dit te weigeren");
  assert.equal(staanEr(), 3, "en dan blijft de momentopname ongemoeid");
});
