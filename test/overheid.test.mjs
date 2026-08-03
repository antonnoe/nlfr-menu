// Zelftests voor de overheid-dedup en de ingeperkte wisroute.
//
// Achtergrond: Service-Public zet dezelfde actualité op de particuliers- én de
// professionnels-feed, elk met een eigen URL. Op de oude URL-sleutel werden dat
// twee records met elk een eigen AI-samenvatting, en stond hetzelfde bericht
// dubbel op /actueel (brandstofsteun bouwsector, DUERP-boete, kwartaalaangifte
// micro-ondernemers, …). Het actualité-nummer (A18905) is over alle feeds heen
// gelijk en is daarom de dedupsleutel.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  overheidSleutel,
  docSleutel,
  zelfdeOverheidBericht,
  kiesBehoud,
  dedupOverheid,
  alBekend,
} from "../lib/overheid.js";
import { isPersConcept } from "../lib/poort.js";

// ---- 1) A-nummer uit de URL -------------------------------------------------

test("A-nummer wordt uit alle Service-Public-URL-varianten gehaald", () => {
  const gevallen = [
    "https://www.service-public.fr/particuliers/actualites/A18905",
    "https://www.service-public.fr/particuliers/actualites/A18905?xtor=RSS-111",
    "https://entreprendre.service-public.fr/actualites/A18905?xtor=RSS-112",
    "https://entreprendre.service-public.fr/actualites/A18905/",
    "https://www.service-public.fr/professionnels-entreprises/actualites/A18905#top",
    "https://www.service-public.fr/particuliers/actualites/a18905", // kleine letter
  ];
  for (const u of gevallen) assert.equal(overheidSleutel(u), "A18905", u);
});

test("URL's zonder actualité-nummer leveren null", () => {
  assert.equal(overheidSleutel("https://www.economie.gouv.fr/actualites/budget-2027"), null);
  assert.equal(overheidSleutel("https://www.douane.gouv.fr/rss/artikel-123"), null);
  assert.equal(overheidSleutel(""), null);
  assert.equal(overheidSleutel(undefined), null);
});

test("A-nummer onderscheidt verschillende berichten", () => {
  assert.notEqual(
    overheidSleutel("https://www.service-public.fr/particuliers/actualites/A18905"),
    overheidSleutel("https://www.service-public.fr/particuliers/actualites/A18906")
  );
});

// ---- 2) Tweelingen herkennen ------------------------------------------------

const tweelingA = {
  id: "oud", sleutel: "A18905", bron: "Service-Public — particuliers",
  url: "https://www.service-public.fr/particuliers/actualites/A18905?xtor=RSS-111",
  titelBron: "Aide au carburant pour les entreprises du bâtiment",
  gepubliceerdOp: "2026-08-01T06:00:00Z",
};
const tweelingB = {
  id: "nieuw", sleutel: "A18905", bron: "Service-Public — professionnels",
  url: "https://entreprendre.service-public.fr/actualites/A18905?xtor=RSS-112",
  titelBron: "Aide au carburant pour les entreprises du bâtiment",
  gepubliceerdOp: "2026-08-03T06:00:00Z",
};
const ander = {
  id: "x", sleutel: "A19013", bron: "Service-Public — particuliers",
  url: "https://www.service-public.fr/particuliers/actualites/A19013",
  titelBron: "Déclaration trimestrielle des micro-entrepreneurs",
  gepubliceerdOp: "2026-08-02T06:00:00Z",
};

test("twee feedvarianten van dezelfde actualité zijn hetzelfde bericht", () => {
  assert.equal(zelfdeOverheidBericht(tweelingA, tweelingB), true);
});

test("verschillende A-nummers worden nooit samengevoegd, ook niet bij lijkende titels", () => {
  const a = { sleutel: "A1", titelBron: "Déclaration trimestrielle des micro-entrepreneurs 2027" };
  const b = { sleutel: "A2", titelBron: "Déclaration trimestrielle des micro-entrepreneurs 2028" };
  assert.equal(zelfdeOverheidBericht(a, b), false);
});

test("sleutel wordt ook uit de URL afgeleid als het veld ontbreekt (oude records)", () => {
  const oud = { id: "z", url: "https://www.service-public.fr/particuliers/actualites/A18905?xtor=RSS-111" };
  assert.equal(docSleutel(oud), "A18905");
  assert.equal(zelfdeOverheidBericht(oud, tweelingB), true);
});

// ---- 3) Titelvangnet (bronnen zonder A-nummer) ------------------------------

test("titelvangnet vangt tweelingen zonder A-nummer", () => {
  const a = { id: "a", bron: "Bercy — Ministère de l'Économie", url: "https://www.economie.gouv.fr/x1",
    titelBron: "Nouvelle amende pour absence de document unique DUERP", gepubliceerdOp: "2026-08-01T06:00:00Z" };
  const b = { id: "b", bron: "Bercy — Ministère de l'Économie", url: "https://www.economie.gouv.fr/x2",
    titelBron: "Nouvelle amende pour absence de document unique DUERP", gepubliceerdOp: "2026-08-02T06:00:00Z" };
  assert.equal(zelfdeOverheidBericht(a, b), true);
});

test("titelvangnet voegt verschillende berichten NIET samen", () => {
  const a = { id: "a", url: "https://www.economie.gouv.fr/x1", titelBron: "Le barème kilométrique 2027 est publié" };
  const b = { id: "b", url: "https://www.economie.gouv.fr/x2", titelBron: "Douane : nouvelles règles pour les colis postaux" };
  assert.equal(zelfdeOverheidBericht(a, b), false);
});

// ---- 4) Welk exemplaar blijft staan? ----------------------------------------

test("het OUDSTE record wint (levenscyclus blijft intact)", () => {
  assert.equal(kiesBehoud(tweelingA, tweelingB).id, "oud");
  assert.equal(kiesBehoud(tweelingB, tweelingA).id, "oud", "volgorde mag niet uitmaken");
});

test("bij gelijke datum wint de bron met de hoogste prioriteit in bronnen.json", () => {
  // Service-Public particuliers = prioriteit 1, professionnels = prioriteit 2.
  const p1 = { id: "b", bron: "Service-Public — particuliers", sleutel: "A1", gepubliceerdOp: "2026-08-01T06:00:00Z" };
  const p2 = { id: "a", bron: "Service-Public — professionnels", sleutel: "A1", gepubliceerdOp: "2026-08-01T06:00:00Z" };
  assert.equal(kiesBehoud(p1, p2).bron, "Service-Public — particuliers");
  assert.equal(kiesBehoud(p2, p1).bron, "Service-Public — particuliers");
});

test("bij gelijke datum én prioriteit beslist het id, zodat de uitkomst stabiel is", () => {
  const a = { id: "aaa", bron: "Onbekend", gepubliceerdOp: "2026-08-01T06:00:00Z", titelBron: "Zelfde kop hier" };
  const b = { id: "bbb", bron: "Onbekend", gepubliceerdOp: "2026-08-01T06:00:00Z", titelBron: "Zelfde kop hier" };
  assert.equal(kiesBehoud(a, b).id, "aaa");
  assert.equal(kiesBehoud(b, a).id, "aaa");
});

// ---- 5) Dedup over de hele voorraad ----------------------------------------

test("dedupOverheid houdt per bericht één record over", () => {
  const { behouden, weg } = dedupOverheid([tweelingB, tweelingA, ander]);
  assert.equal(behouden.length, 2);
  assert.equal(weg.length, 1);
  assert.equal(weg[0].id, "nieuw", "het jongste duplicaat gaat weg");
  assert.ok(behouden.some((d) => d.id === "oud"));
  assert.ok(behouden.some((d) => d.id === "x"));
});

test("dedupOverheid is stabiel ongeacht de scanvolgorde", () => {
  const een = dedupOverheid([tweelingA, tweelingB, ander]).behouden.map((d) => d.id).sort();
  const twee = dedupOverheid([ander, tweelingB, tweelingA]).behouden.map((d) => d.id).sort();
  assert.deepEqual(een, twee);
});

test("een schone voorraad blijft ongemoeid", () => {
  const { behouden, weg } = dedupOverheid([tweelingA, ander]);
  assert.equal(behouden.length, 2);
  assert.equal(weg.length, 0);
});

// ---- 6) Instroom: bestaand bericht op een andere feed of met andere xtor ----

test("binnenkomend item van de andere feed wordt niet nogmaals aangemaakt", () => {
  const item = {
    url: "https://entreprendre.service-public.fr/actualites/A18905?xtor=RSS-112",
    titel: "Aide au carburant pour les entreprises du bâtiment",
  };
  assert.equal(alBekend(item, [tweelingA]), true);
});

test("gewijzigde tracking-parameter maakt geen nieuw bericht (geen levenscyclus-reset)", () => {
  const item = {
    url: "https://www.service-public.fr/particuliers/actualites/A18905?xtor=RSS-999",
    titel: "Aide au carburant pour les entreprises du bâtiment",
  };
  assert.equal(alBekend(item, [tweelingA]), true);
});

test("een echt nieuw bericht wordt wél aangemaakt", () => {
  const item = {
    url: "https://www.service-public.fr/particuliers/actualites/A20001",
    titel: "Le sapeur-pompier volontaire et son employeur",
  };
  assert.equal(alBekend(item, [tweelingA, ander]), false);
});

// ---- 7) Wisroute: alleen persconcepten -------------------------------------
// Bootst de lus uit api/review.js na op een nep-KV, zodat de reikwijdte
// getoetst wordt zonder netwerk of echte opslag.

test("wisroute verwijdert persconcepten en laat de rest staan", async () => {
  const kv = new Map([
    ["actueel:concept:p1", { id: "p1", bronnen: [{ naam: "Le Monde — À la une", titel: "Kop", url: "u1" }] }],
    ["actueel:concept:p2", { id: "p2", bronnen: [{ naam: "Sud Ouest", titel: "Kop", url: "u2" }] }],
    ["actueel:concept:v1", { id: "v1", bronnen: [{ naam: "Nederlandse Vereniging Dordogne", titel: "Borrel", url: "u3" }] }],
    ["actueel:concept:o1", { id: "o1", bronnen: [{ naam: "Service-Public — particuliers", titel: "Actu", url: "u4" }] }],
    ["actueel:publicatie:g1", { id: "g1" }],
    ["actueel:overheid:h1", { id: "h1", gepubliceerdOp: "2026-07-01T06:00:00Z" }],
  ]);

  // Zelfde selectie als de route: scan op concept:*, dan de persconcept-toets.
  let verwijderd = 0;
  let overgeslagen = 0;
  for (const [key, doc] of [...kv]) {
    if (!key.startsWith("actueel:concept:")) continue;
    if (!isPersConcept(doc)) { overgeslagen += 1; continue; }
    kv.delete(key);
    verwijderd += 1;
  }

  assert.equal(verwijderd, 2, "beide persconcepten weg");
  assert.equal(overgeslagen, 2, "vereniging en overheid overgeslagen");
  assert.ok(!kv.has("actueel:concept:p1") && !kv.has("actueel:concept:p2"));
  assert.ok(kv.has("actueel:concept:v1"), "verenigingsconcept blijft");
  assert.ok(kv.has("actueel:concept:o1"), "overheidsconcept blijft");
  assert.ok(kv.has("actueel:publicatie:g1"), "gepubliceerd persartikel blijft");
  const overheid = kv.get("actueel:overheid:h1");
  assert.ok(overheid, "overheidsrecord blijft");
  assert.equal(overheid.gepubliceerdOp, "2026-07-01T06:00:00Z", "levenscyclus ongewijzigd");
});
