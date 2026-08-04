// Zelftests voor twee redactionele correcties:
//   1. de onderregel (byline) van een perssynthese noemde de eerste krant uit
//      de bronnenlijst, alsof het hún artikel was. Dat wordt "Redactie NLFR ·
//      datum"; items met één afzender (overheid, Infofrankrijk, verenigingen)
//      houden hun bronregel.
//   2. de pers schrijft geregeld een overheidscommuniqué na. Staat dat bericht
//      al live, dan is dát de primaire bron; de reviewtool signaleert het.

import { test } from "node:test";
import assert from "node:assert/strict";

import { assembleerTegels } from "../lib/tegels.js";
import { vindPrimaireBron } from "../lib/gelijkenis.js";
import { maakRegisterRecord } from "../lib/register.js";
import { PRIMAIRE_BRON_VENSTER_DAGEN } from "../lib/config.js";

const NU = Date.parse("2026-08-05T12:00:00Z");
const DAG = 24 * 60 * 60 * 1000;

// ---- 1) Byline per soort ----------------------------------------------------

const persPub = (id, dagenOud, kop, tekst) => ({
  id,
  kop,
  tekst,
  gepubliceerd: true,
  gepubliceerdOp: new Date(NU - dagenOud * DAG).toISOString(),
  bronnen: [
    { naam: "Le Monde — À la une", titel: "Kop A", url: `https://lemonde.fr/${id}`, datum: "2026-08-04T06:00:00Z" },
    { naam: "Sud Ouest", titel: "Kop B", url: `https://sudouest.fr/${id}`, datum: "2026-08-04T07:00:00Z" },
  ],
});

function artikelenVan(tegels, soort) {
  return tegels.filter((t) => t.soort === soort).flatMap((t) => t.artikelen);
}

test("een perssynthese draagt soort 'pers' en de publicatiedatum, niet de eerste krant", () => {
  const tegels = assembleerTegels({
    publicaties: [persPub("p1", 0, "Staking luchtverkeersleiders", "Franse luchtverkeersleiders leggen het werk neer.")],
    overheidDocs: [],
    items: [],
    nu: NU,
  });
  const art = artikelenVan(tegels, "pers")[0];
  assert.ok(art, "de synthese hoort live te staan");
  assert.equal(art.soort, "pers", "de weergave leidt de byline hieruit af");
  assert.equal(art.datum, new Date(NU).toISOString(), "publicatiedatum van het artikel");
  // De bronnenlijst blijft de attributie — die verdwijnt niet.
  assert.equal(art.bronnen.length, 2);
  assert.equal(art.bronnen[0].naam, "Le Monde — À la une");
});

test("ook in de archief-tegel houdt een perssynthese soort 'pers' en zijn datum", () => {
  const tegels = assembleerTegels({
    publicaties: [persPub("p2", 5, "Aangifteplicht tweede woning", "De aangifteplicht voor eigenaren verandert per januari.")],
    overheidDocs: [],
    items: [],
    nu: NU,
  });
  const art = artikelenVan(tegels, "archief")[0];
  assert.ok(art, "na 48 uur staat hij in het archief");
  assert.equal(art.soort, "pers");
  assert.ok(art.datum, "de datum blijft beschikbaar voor de byline");
  assert.ok(art.restDagen > 0, "en de archiefteller blijft bestaan");
});

test("een overheidsbericht houdt zijn enkele bronregel", () => {
  const doc = {
    id: "h1", thema: "praktisch", bron: "Service-Public — particuliers",
    url: "https://www.service-public.fr/particuliers/actualites/A19100",
    datum: new Date(NU - DAG).toISOString(), titelBron: "Allocation de rentrée scolaire",
    kop: "Schooltoelage wordt in augustus uitbetaald",
    samenvatting: "De allocation de rentrée scolaire wordt medio augustus overgemaakt aan gezinnen.",
    gepubliceerdOp: new Date(NU - DAG).toISOString(),
  };
  const art = artikelenVan(assembleerTegels({ publicaties: [], overheidDocs: [doc], items: [], nu: NU }), "overheid")[0];
  assert.equal(art.soort, "overheid");
  assert.equal(art.bronnen.length, 1);
  assert.equal(art.bronnen[0].naam, "Service-Public — particuliers", "één afzender: de bronregel klopt hier");
  assert.equal(art.datum, undefined, "geen NLFR-byline op andermans bericht");
});

test("Infofrankrijk- en verenigingsitems houden hun bronregel", () => {
  const items = [
    { thema: "infofrankrijk", bron: "Infofrankrijk", titel: "Eigen bericht", samenvatting: "Tekst.", url: "https://if/1", datum: new Date(NU - DAG).toISOString() },
    { thema: "verenigingen", bron: "Vereniging Dordogne", titel: "Zomerborrel", samenvatting: "Tekst.", url: "https://v/1", datum: new Date(NU - DAG).toISOString() },
  ];
  const tegels = assembleerTegels({ publicaties: [], overheidDocs: [], items, nu: NU });
  const inf = artikelenVan(tegels, "infofrankrijk")[0];
  const ver = artikelenVan(tegels, "verenigingen")[0];
  assert.equal(inf.soort, "infofrankrijk");
  assert.equal(ver.soort, "verenigingen");
  assert.equal(inf.bronnen[0].naam, "Infofrankrijk");
  assert.equal(ver.bronnen[0].naam, "Vereniging Dordogne");
});

test("de weergave zet de byline op soort, niet op de bronnenlijst", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
  assert.ok(html.includes('a.soort === "pers"'), "de byline hangt aan het soort van het artikel");
  assert.ok(html.includes('"Redactie NLFR"'), "de perssynthese krijgt de redactie-byline");
  // De bronregel bestaat nog steeds — voor de items met één afzender.
  assert.ok(html.includes("bronnen[0].naam"), "de enkele bronregel blijft voor overheid/IF/verenigingen");
});

// ---- 2) Primaire-bron-signalering -------------------------------------------

const overheidBericht = {
  id: "h-ars",
  thema: "praktisch",
  bron: "Service-Public — particuliers",
  url: "https://www.service-public.fr/particuliers/actualites/A19100",
  datum: new Date(NU - 3 * DAG).toISOString(),
  kop: "Schooltoelage wordt medio augustus uitbetaald",
  samenvatting:
    "De schooltoelage voor gezinnen wordt medio augustus overgemaakt. Het bedrag hangt af van de leeftijd " +
    "van het kind en van het inkomen van het gezin over het voorgaande jaar.",
  gepubliceerdOp: new Date(NU - 3 * DAG).toISOString(),
};

const conceptOverZelfdeOnderwerp = {
  id: "c1",
  kop: "Schooltoelage in augustus op de rekening",
  tekst:
    "De schooltoelage wordt medio augustus overgemaakt aan gezinnen. Het bedrag hangt af van de leeftijd " +
    "van het kind en van het inkomen over het voorgaande jaar.",
  // Let op: de kernTokens van een concept komen uit de FRANSE brontitels. De
  // detectie mag daar niet op leunen, anders vindt hij niets.
  kernTokens: ["allocation", "rentree", "scolaire", "versement", "caf"],
  bronnen: [
    { naam: "Le Monde — À la une", titel: "Allocation de rentrée scolaire", url: "https://lemonde.fr/ars" },
    { naam: "Sud Ouest", titel: "Versement de l'ARS", url: "https://sudouest.fr/ars" },
  ],
};

const conceptOverIetsAnders = {
  id: "c2",
  kop: "Luchtverkeersleiders staken vrijdag",
  tekst:
    "Franse luchtverkeersleiders leggen vrijdag het werk neer. Reizigers moeten rekening houden met " +
    "geschrapte vluchten vanaf de regionale luchthavens.",
  kernTokens: ["controleurs", "aeriens", "greve"],
  bronnen: [{ naam: "Le Monde — À la une", titel: "Grève", url: "https://lemonde.fr/greve" }],
};

test("een persconcept dat een live overheidsbericht naschrijft wordt gesignaleerd", () => {
  const t = vindPrimaireBron(conceptOverZelfdeOnderwerp, [overheidBericht], [], NU);
  assert.ok(t, "hier hoort een melding te komen");
  assert.equal(t.titel, "Schooltoelage wordt medio augustus uitbetaald");
  assert.equal(t.bron, "Service-Public — particuliers");
  assert.equal(t.herkomst, "live");
});

test("een persconcept over een ander onderwerp levert geen melding", () => {
  assert.equal(vindPrimaireBron(conceptOverIetsAnders, [overheidBericht], [], NU), null);
});

test("de melding wijst naar het JUISTE bericht als er meerdere overheidsberichten zijn", () => {
  const ander = {
    ...overheidBericht,
    id: "h-anders",
    kop: "Nieuwe drempel voor de btw-vrijstelling",
    samenvatting: "De omzetdrempel voor de btw-vrijstelling gaat per januari omhoog voor kleine ondernemers.",
  };
  const t = vindPrimaireBron(conceptOverZelfdeOnderwerp, [ander, overheidBericht], [], NU);
  assert.ok(t);
  assert.equal(t.id, "h-ars", "de sterkste overlap wint");
});

test("ook een registerrecord telt mee als primaire bron", () => {
  const record = maakRegisterRecord(overheidBericht, NU - 20 * DAG);
  const t = vindPrimaireBron(conceptOverZelfdeOnderwerp, [], [record], NU);
  assert.ok(t, "een recent gearchiveerd bericht telt ook");
  assert.equal(t.herkomst, "register");
  assert.equal(t.bron, "Service-Public — particuliers");
});

test("een vervangen registerrecord telt NIET mee", () => {
  const record = { ...maakRegisterRecord(overheidBericht, NU - 20 * DAG), status: "vervangen" };
  assert.equal(vindPrimaireBron(conceptOverZelfdeOnderwerp, [], [record], NU), null);
});

test("een registerrecord buiten het venster telt niet meer als 'staat al live'", () => {
  const oud = {
    ...overheidBericht,
    datum: new Date(NU - (PRIMAIRE_BRON_VENSTER_DAGEN + 10) * DAG).toISOString(),
  };
  const record = maakRegisterRecord(oud, NU - (PRIMAIRE_BRON_VENSTER_DAGEN + 10) * DAG);
  assert.equal(vindPrimaireBron(conceptOverZelfdeOnderwerp, [], [record], NU), null);
});

test("zonder overheidsberichten is er niets te signaleren", () => {
  assert.equal(vindPrimaireBron(conceptOverZelfdeOnderwerp, [], [], NU), null);
});

test("de reviewtool toont de melding in de gevraagde bewoording", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../review.html", import.meta.url), "utf8");
  assert.ok(html.includes("Over dit onderwerp staat al een overheidsbericht live:"));
  assert.ok(html.includes("primaireBronHtml(c)"), "de melding wordt bij het concept gerenderd");
});
