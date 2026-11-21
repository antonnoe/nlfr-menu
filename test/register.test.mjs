// Zelftests voor het regelgevingsregister.
//
// Kern van het ontwerp dat hier bewaakt wordt:
//   - overheidsberichten verhuizen na hun live periode naar het register in
//     plaats van te verdwijnen; rubriek en datums blijven behouden;
//   - er is GEEN verwijderpad: "eruit" is status 'vervangen', data intact;
//   - publiek zijn alleen titels — de tekst verlaat de server niet;
//   - pers, Infofrankrijk en verenigingen houden hun bestaande levenscyclus.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  maakRegisterRecord,
  maakSlug,
  datumTag,
  publiekeRij,
  publiekeRubrieken,
  isZichtbaar,
  zoekKeten,
  pasVervangingToe,
  pasAanvullingToe,
} from "../lib/register.js";
import { assembleerTegels } from "../lib/tegels.js";
import { REGISTER_MUURTEKST, REGISTER_ABONNEE_URL, OVERHEID_ARCHIEF_NA_DAGEN } from "../lib/config.js";

const DAG = 24 * 60 * 60 * 1000;
const NU = Date.parse("2026-08-04T12:00:00Z");

const overheidDoc = (over = {}) => ({
  id: "h1",
  sleutel: "A18905",
  thema: "ondernemen",
  bron: "Service-Public — professionnels",
  url: "https://entreprendre.service-public.fr/actualites/A18905?xtor=RSS-112",
  datum: "2026-07-01T06:00:00Z",
  titelBron: "Interdiction du démarchage téléphonique",
  kop: "Verbod telefonische verkoop",
  samenvatting: "Vanaf 1 oktober mag een bedrijf niet meer ongevraagd bellen voor verkoop.",
  gepubliceerdOp: "2026-07-01T08:00:00Z",
  ...over,
});

// ---- 1) Registeropname ------------------------------------------------------

test("registeropname behoudt rubriek, titel, tekst, bron en beide brondatums", () => {
  const r = maakRegisterRecord(overheidDoc(), NU);
  assert.equal(r.rubriek, "ondernemen");
  assert.equal(r.titel, "Verbod telefonische verkoop");
  assert.equal(r.tekst, "Vanaf 1 oktober mag een bedrijf niet meer ongevraagd bellen voor verkoop.");
  assert.equal(r.bronNaam, "Service-Public — professionnels");
  assert.equal(r.bronUrl, "https://entreprendre.service-public.fr/actualites/A18905?xtor=RSS-112");
  assert.equal(r.datumBron, "2026-07-01T06:00:00Z", "bronpublicatie blijft de originele datum");
  assert.equal(r.datumOpname, new Date(NU).toISOString(), "opnamedatum is het moment van opname");
  assert.equal(r.datumKeten, null, "nog geen keten-gebeurtenis");
  assert.equal(r.status, "actueel");
});

test("de onderwerp-slug is de ketensleutel en is stabiel", () => {
  assert.equal(maakSlug("Verbod telefonische verkoop"), "verbod-telefonische-verkoop");
  // Lidwoorden en voorzetsels vallen weg, accenten en hoofdletters ook.
  assert.equal(maakSlug("Het verbod op de telefonische verkoop"), "verbod-telefonische-verkoop");
});

test("ketenverwijzingen en koppelingsvelden bestaan en staan leeg", () => {
  const r = maakRegisterRecord(overheidDoc(), NU);
  for (const veld of ["vervangt", "vervangenDoor", "aanvullingOp", "aangevuldDoor"]) {
    assert.equal(r[veld], null, `${veld} hoort leeg te beginnen`);
  }
  // Gereserveerd voor Infofrankrijk en Café Claude: aanwezig, nog niet gevuld.
  assert.ok("ifSlug" in r && "ccContext" in r);
  assert.equal(r.ifSlug, null);
  assert.equal(r.ccContext, null);
});

test("het A-nummer gaat mee als ketensignaal, ook uit de URL", () => {
  assert.equal(maakRegisterRecord(overheidDoc(), NU).sleutel, "A18905");
  assert.equal(maakRegisterRecord(overheidDoc({ sleutel: null }), NU).sleutel, "A18905");
});

test("een onbekende rubriek valt terug op wetgeving in plaats van te verdwijnen", () => {
  assert.equal(maakRegisterRecord(overheidDoc({ thema: "onzin" }), NU).rubriek, "wetgeving");
});

// ---- 2) Publieke weergave: alleen het triplet ------------------------------

test("de publieke rij bevat het triplet en GEEN tekst of bron-URL", () => {
  const rij = publiekeRij(maakRegisterRecord(overheidDoc(), NU));
  assert.equal(rij.datum, "20260701");
  assert.equal(rij.bron, "Service-Public", "de rubrieksuffix van de feed hoort er niet bij");
  assert.equal(rij.titel, "Verbod telefonische verkoop");
  const velden = Object.keys(rij).sort();
  assert.deepEqual(velden, ["bron", "datum", "id", "rubriek", "titel"]);
  assert.ok(!("tekst" in rij) && !("bronUrl" in rij), "tekst en bron-URL blijven op de server");
});

test("datumtag heeft het formaat 20260804", () => {
  assert.equal(datumTag("2026-08-04T23:30:00Z"), "20260804");
  assert.equal(datumTag("onzin"), "");
});

test("de publieke lijst toont alleen actueel en aangevuld, nieuwste eerst", () => {
  const mk = (id, status, datum, rubriek = "praktisch") => ({
    ...maakRegisterRecord(overheidDoc({ id, thema: rubriek, datum }), NU),
    status,
  });
  const rubrieken = publiekeRubrieken([
    mk("a", "actueel", "2026-07-01T06:00:00Z"),
    mk("b", "vervangen", "2026-07-20T06:00:00Z"),
    mk("c", "aangevuld", "2026-07-10T06:00:00Z"),
  ]);
  const items = rubrieken.find((r) => r.rubriek === "praktisch").items;
  assert.deepEqual(items.map((i) => i.id), ["c", "a"], "vervangen is onzichtbaar, rest nieuwste eerst");
});

test("de muurtekst en de abonneelink staan vast", () => {
  assert.equal(REGISTER_MUURTEKST, "Toegang tot dit archief is uitsluitend voorbehouden aan abonnees.");
  assert.equal(REGISTER_ABONNEE_URL, "https://infofrankrijk.com/abonnement/");
});

// ---- 3) Keten-detectie ------------------------------------------------------

test("gelijk A-nummer levert een voorstel 'vervangen'", () => {
  const bestaand = maakRegisterRecord(overheidDoc({ id: "oud" }), NU);
  const nieuw = maakRegisterRecord(
    overheidDoc({ id: "nieuw", datum: "2026-08-01T06:00:00Z", kop: "Verbod telefonische verkoop uitgesteld" }),
    NU
  );
  const v = zoekKeten(nieuw, [bestaand]);
  assert.ok(v, "er hoort een voorstel te komen");
  assert.equal(v.soort, "vervangen");
  assert.equal(v.doelId, "oud");
  assert.equal(v.doelRubriek, "ondernemen");
});

test("alleen tokenoverlap levert een voorstel 'aanvulling', met beide opties", () => {
  const bestaand = maakRegisterRecord(
    overheidDoc({ id: "oud", sleutel: "A100", url: "https://x/actualites/A100" }),
    NU
  );
  const nieuw = maakRegisterRecord(
    overheidDoc({
      id: "nieuw",
      sleutel: "A200",
      url: "https://x/actualites/A200",
      kop: "Verbod telefonische verkoop: uitzonderingen",
      samenvatting: "Vanaf 1 oktober mag een bedrijf niet meer ongevraagd bellen voor verkoop, op enkele uitzonderingen na.",
    }),
    NU
  );
  const v = zoekKeten(nieuw, [bestaand]);
  assert.ok(v);
  assert.equal(v.soort, "aanvulling");
  assert.equal(v.beideOpties, true, "bij alleen overlap hoort de redacteur beide smaken te zien");
});

test("een ander onderwerp in dezelfde rubriek levert geen voorstel", () => {
  const bestaand = maakRegisterRecord(overheidDoc({ id: "oud", sleutel: "A100", url: "https://x/actualites/A100" }), NU);
  const nieuw = maakRegisterRecord(
    overheidDoc({
      id: "nieuw", sleutel: "A200", url: "https://x/actualites/A200",
      kop: "Nieuwe drempel voor de btw-vrijstelling",
      samenvatting: "De omzetdrempel voor de btw-vrijstelling gaat omhoog per 1 januari.",
    }),
    NU
  );
  assert.equal(zoekKeten(nieuw, [bestaand]), null);
});

test("de keten loopt niet over rubrieken heen", () => {
  const bestaand = maakRegisterRecord(overheidDoc({ id: "oud", thema: "praktisch" }), NU);
  const nieuw = maakRegisterRecord(overheidDoc({ id: "nieuw", thema: "ondernemen" }), NU);
  assert.equal(zoekKeten(nieuw, [bestaand]), null);
});

test("een al vervangen record is geen ketenkandidaat meer", () => {
  const oud = { ...maakRegisterRecord(overheidDoc({ id: "oud" }), NU), status: "vervangen" };
  const nieuw = maakRegisterRecord(overheidDoc({ id: "nieuw" }), NU);
  assert.equal(zoekKeten(nieuw, [oud]), null);
});

// ---- 4) Vervangen en aanvullen ---------------------------------------------

test("VERVANGEN: oude onzichtbaar met keten en gebeurtenisdatum, data intact", () => {
  const oud = maakRegisterRecord(overheidDoc({ id: "oud" }), NU);
  const nieuw = maakRegisterRecord(overheidDoc({ id: "nieuw" }), NU);
  const r = pasVervangingToe(oud, nieuw, NU);

  assert.equal(r.oud.status, "vervangen");
  assert.equal(r.oud.vervangenDoor, "nieuw");
  assert.equal(r.oud.datumKeten, new Date(NU).toISOString());
  assert.equal(r.nieuw.vervangt, "oud");
  assert.equal(r.nieuw.status, "actueel");

  // Publiek onzichtbaar...
  assert.equal(isZichtbaar(r.oud), false);
  assert.equal(isZichtbaar(r.nieuw), true);
  // ...maar de data staat er nog, volledig.
  assert.equal(r.oud.tekst, oud.tekst);
  assert.equal(r.oud.titel, oud.titel);
  assert.equal(r.oud.bronUrl, oud.bronUrl);
  assert.equal(r.oud.datumBron, oud.datumBron);
  assert.equal(r.oud.datumOpname, oud.datumOpname, "de opnamedatum verandert niet door een keten");
});

test("AANVULLEN: beide zichtbaar, keten in twee richtingen", () => {
  const oud = maakRegisterRecord(overheidDoc({ id: "oud" }), NU);
  const nieuw = maakRegisterRecord(overheidDoc({ id: "nieuw" }), NU);
  const r = pasAanvullingToe(oud, nieuw, NU);

  assert.equal(r.oud.status, "aangevuld");
  assert.equal(r.nieuw.status, "aangevuld");
  assert.equal(r.oud.aangevuldDoor, "nieuw");
  assert.equal(r.nieuw.aanvullingOp, "oud");
  assert.equal(isZichtbaar(r.oud), true);
  assert.equal(isZichtbaar(r.nieuw), true);
  assert.equal(r.oud.datumKeten, new Date(NU).toISOString());
});

test("het register kent geen verwijderpad", async () => {
  const mod = await import("../lib/register.js");
  const namen = Object.keys(mod).join(" ").toLowerCase();
  assert.ok(!/verwijder|del(ete)?\b/.test(namen), `onverwachte verwijderfunctie: ${namen}`);
});

// ---- 5) Levenscyclus: overheid uit de Archief-tegel, rest ongewijzigd -------

// Let op: elke publicatie krijgt een eigen onderwerp. De weergave-dedup
// (ontdubbelPers) voegt bijna-gelijke teksten samen, en dat zou de
// levenscyclustest stilletjes leegtrekken.
const PERS_TEKST = {
  vers: "Franse luchtverkeersleiders leggen het werk neer; reizigers moeten rekening houden met geschrapte vluchten.",
  oud: "De aangifteplicht voor eigenaren van een tweede woning verandert per januari volgens de belastingdienst.",
  weg: "Gemeenten in de Gironde krijgen extra geld voor het herstel van wandelpaden na de bosbranden.",
};
const persPub = (id, dagenOud) => ({
  id,
  kop: `Pers ${id}`,
  tekst: PERS_TEKST[id],
  gepubliceerd: true,
  gepubliceerdOp: new Date(NU - dagenOud * DAG).toISOString(),
  bronnen: [{ naam: "Le Monde — À la une", titel: "Kop", url: `https://lemonde.fr/${id}`, datum: "2026-08-01T06:00:00Z" }],
});

test("overheidsberichten staan niet meer in de Archief-tegel", () => {
  const oud = overheidDoc({ id: "oudbericht", datum: new Date(NU - (OVERHEID_ARCHIEF_NA_DAGEN + 3) * DAG).toISOString() });
  const tegels = assembleerTegels({ publicaties: [], overheidDocs: [oud], items: [], nu: NU });
  const archief = tegels.find((t) => t.soort === "archief");
  assert.ok(!archief, "geen archief-tegel als er alleen een oud overheidsbericht is");
  assert.ok(!tegels.some((t) => t.soort === "overheid"), "en ook niet meer live");
});

test("de PERS-levenscyclus is ongewijzigd: live, dan archief, dan weg", () => {
  const tegels = assembleerTegels({
    publicaties: [persPub("vers", 0), persPub("oud", 5), persPub("weg", 20)],
    overheidDocs: [],
    items: [],
    nu: NU,
  });
  const pers = tegels.filter((t) => t.soort === "pers");
  const archief = tegels.find((t) => t.soort === "archief");
  assert.ok(pers.some((t) => t.artikelen.some((a) => a.id === "vers")), "verse publicatie staat live");
  assert.ok(archief && archief.artikelen.some((a) => a.id === "oud"), "publicatie van 5 dagen staat in het archief");
  assert.ok(!archief.artikelen.some((a) => a.id === "weg"), "na 14 dagen is hij weg");
});

test("de Archief-tegel blijft bestaan voor pers", () => {
  const tegels = assembleerTegels({ publicaties: [persPub("oud", 5)], overheidDocs: [], items: [], nu: NU });
  const archief = tegels.find((t) => t.soort === "archief");
  assert.ok(archief, "de Archief-tegel hoort er nog te zijn");
  assert.equal(archief.artikelen.length, 1);
});

test("de INFOFRANKRIJK- en VERENIGINGEN-stromen zijn ongewijzigd", () => {
  const items = [
    { thema: "infofrankrijk", bron: "Infofrankrijk", titel: "Eigen bericht", samenvatting: "Tekst.", url: "https://if/1", datum: new Date(NU - 2 * DAG).toISOString() },
    { thema: "verenigingen", bron: "Vereniging Dordogne", titel: "Zomerborrel", samenvatting: "Tekst.", url: "https://v/1", datum: new Date(NU - 2 * DAG).toISOString() },
    { thema: "infofrankrijk", bron: "Infofrankrijk", titel: "Te oud", samenvatting: "Tekst.", url: "https://if/2", datum: new Date(NU - 40 * DAG).toISOString() },
  ];
  const tegels = assembleerTegels({ publicaties: [], overheidDocs: [], items, nu: NU });
  const info = tegels.find((t) => t.soort === "infofrankrijk");
  const ver = tegels.find((t) => t.soort === "verenigingen");
  assert.ok(info && info.artikelen.length === 1, "verse IF-item live, oude eruit");
  assert.ok(ver && ver.artikelen.length === 1, "verenigingsitem live");
});

test("overheidsberichten binnen hun live periode staan gewoon nog live", () => {
  const vers = overheidDoc({ id: "vers", datum: new Date(NU - 2 * DAG).toISOString() });
  const tegels = assembleerTegels({ publicaties: [], overheidDocs: [vers], items: [], nu: NU });
  const ov = tegels.find((t) => t.soort === "overheid");
  assert.ok(ov, "een vers overheidsbericht hoort in zijn thema-tegel");
  assert.equal(ov.artikelen.length, 1);
});
