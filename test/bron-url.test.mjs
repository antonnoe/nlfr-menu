// Elk artikel in /api/actueel moet één expliciete, absolute bron-URL meeleveren.
// Zonder dat veld vond een afnemer die per artikel één link wil (de Actueel-tab
// van IF-Mobiel) niets en viel terug op href="#" — een item dat eruitziet als
// link maar nergens heen gaat.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleerTegels } from "../lib/tegels.js";

const NU = Date.parse("2026-08-25T12:00:00Z");
const DAG = 24 * 60 * 60 * 1000;
const VERS = new Date(NU - 2 * DAG).toISOString();

const overheidDoc = (over = {}) => ({
  id: "o1",
  thema: "natuur-milieu",
  bron: "OFB — Office français de la biodiversité",
  url: "https://ofb.gouv.fr/actualites/nouvelles-regles-peche",
  datum: VERS,
  titelBron: "Nouvelles règles",
  kop: "Nieuwe regels voor zoetwatervissen",
  samenvatting: "Vanaf januari gelden nieuwe regels voor het vissen in binnenwateren.",
  gepubliceerdOp: VERS,
  ...over,
});

const persPub = (over = {}) => ({
  id: "p1",
  kop: "Staking luchtverkeersleiders",
  tekst: "Franse luchtverkeersleiders leggen het werk neer.",
  gepubliceerd: true,
  gepubliceerdOp: new Date(NU).toISOString(),
  bronnen: [
    { naam: "Le Monde — À la une", titel: "Kop A", url: "https://lemonde.fr/p1", datum: VERS },
    { naam: "Sud Ouest", titel: "Kop B", url: "https://sudouest.fr/p1", datum: VERS },
  ],
  ...over,
});

const alleArtikelen = (tegels) => tegels.flatMap((t) => t.artikelen || []);

test("een overheidsbericht krijgt de bron-URL op artikelniveau", () => {
  const tegels = assembleerTegels({ overheidDocs: [overheidDoc()], nu: NU });
  const a = alleArtikelen(tegels).find((x) => x.id === "o1");
  assert.ok(a, "overheidsartikel ontbreekt");
  assert.equal(a.url, "https://ofb.gouv.fr/actualites/nouvelles-regles-peche");
});

test("een perssynthese linkt naar de eerste bruikbare bron, met de lijst intact", () => {
  const tegels = assembleerTegels({ publicaties: [persPub()], nu: NU });
  const a = alleArtikelen(tegels).find((x) => x.id === "p1");
  assert.ok(a, "persartikel ontbreekt");
  assert.equal(a.url, "https://lemonde.fr/p1");
  assert.equal(a.bronnen.length, 2, "de volledige bronnenlijst blijft de attributie");
});

test("een relatieve of lege bron-URL levert null op, niet een dode link", () => {
  const tegels = assembleerTegels({
    publicaties: [persPub({
      bronnen: [
        { naam: "Kapot", titel: "x", url: "/relatief/pad", datum: VERS },
        { naam: "Leeg", titel: "y", url: "", datum: VERS },
      ],
    })],
    nu: NU,
  });
  const a = alleArtikelen(tegels).find((x) => x.id === "p1");
  assert.ok(a, "persartikel ontbreekt");
  assert.equal(a.url, null, "een relatieve of lege URL hoort null te worden");
});

test("een javascript:-URL wordt geweigerd", () => {
  const tegels = assembleerTegels({
    // eslint-disable-next-line no-script-url
    overheidDocs: [overheidDoc({ url: "javascript:alert(1)" })],
    nu: NU,
  });
  const a = alleArtikelen(tegels).find((x) => x.id === "o1");
  assert.ok(a, "overheidsartikel ontbreekt");
  assert.equal(a.url, null, "alleen http(s) telt als bruikbare bron-URL");
});

test("de eerste kapotte bron blokkeert de volgende bruikbare niet", () => {
  const tegels = assembleerTegels({
    publicaties: [persPub({
      bronnen: [
        { naam: "Kapot", titel: "x", url: "/relatief", datum: VERS },
        { naam: "Sud Ouest", titel: "y", url: "https://sudouest.fr/p1", datum: VERS },
      ],
    })],
    nu: NU,
  });
  const a = alleArtikelen(tegels).find((x) => x.id === "p1");
  assert.equal(a.url, "https://sudouest.fr/p1");
});

test("elk artikel draagt het veld url — absoluut of null, nooit ontbrekend", () => {
  const tegels = assembleerTegels({
    overheidDocs: [overheidDoc()],
    publicaties: [persPub()],
    items: [
      { thema: "infofrankrijk", titel: "IF-bericht", samenvatting: "Tekst.", url: "https://infofrankrijk.com/p", datum: VERS, bron: "Infofrankrijk" },
      { thema: "verenigingen", titel: "Ver-bericht", samenvatting: "Tekst.", url: "https://verenigingen.example/p", datum: VERS, bron: "Vereniging" },
    ],
    nu: NU,
  });
  const artikelen = alleArtikelen(tegels);
  assert.ok(artikelen.length >= 2, `verwacht artikelen, kreeg ${artikelen.length}`);
  for (const a of artikelen) {
    assert.ok("url" in a, `artikel ${a.id} mist het veld url`);
    if (a.url !== null) {
      assert.match(a.url, /^https?:\/\//, `artikel ${a.id} heeft een niet-absolute url: ${a.url}`);
    }
  }
});
