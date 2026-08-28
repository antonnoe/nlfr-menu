// De redactionele verwijzing naar Infofrankrijk, van opslag tot weergave.
// ---------------------------------------------------------------------------
// De keten die hier wordt afgelopen:
//   KV-record {id, items[]}  ->  lib/tegels.js hangt het aan het artikel
//                            ->  lib/levering.js zet het in de TEKST-levering
//                            ->  actueel.html rendert het onder de bronnen.
//
// Wat er niet mag gebeuren, en waarom dat hier staat:
//   * een verwijzing die als BRON wordt getoond. De bronnenlijst is attributie
//     — de Franse originelen waar de synthese op steunt. Een eigen
//     achtergrondartikel is "verder lezen". Door elkaar zetten misleidt de
//     lezer en vertroebelt de attributie.
//   * een verwijzing naar een andere host dan infofrankrijk.com. Dezelfde toets
//     als voor bronlinks (lib/bronurl.js) — de laag die is gebouwd nadat
//     Infofrankrijk-items naar fonts.googleapis.com bleken te wijzen.
//   * dezelfde verwijzing vier keer onder elkaar in één tegel.
//   * verwijzingen in de COMPACTE levering: die staan onder de bronnen en zijn
//     dus pas zichtbaar als de lezer het artikel openklapt.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assembleerTegels } from "../lib/tegels.js";
import { splitsAntwoord, artikelSleutel } from "../lib/levering.js";
import { IF_VERWIJZING_KOP, IF_VERWIJZING_MAX } from "../lib/config.js";

const NU = Date.parse("2026-08-28T12:00:00Z");
const DAG = 24 * 60 * 60 * 1000;
const VERS = new Date(NU - 2 * DAG).toISOString();

const IF1 = { ifId: 101, titel: "Belastingaangifte in Frankrijk", url: "https://infofrankrijk.com/belastingaangifte/" };
const IF2 = { ifId: 102, titel: "De SCI", url: "https://infofrankrijk.com/de-sci/" };

const overheidDoc = (over = {}) => ({
  id: "o1",
  thema: "geld-belasting",
  bron: "Bercy — Ministère de l'Économie",
  url: "https://www.economie.gouv.fr/actualites/nieuw",
  datum: VERS,
  titelBron: "Nouveau",
  kop: "Bercy kondigt nieuwe aangiftetermijn aan",
  samenvatting: "De termijn voor de aangifte verschuift.",
  gepubliceerdOp: VERS,
  ...over,
});

// Elke publicatie krijgt een EIGEN kop en tekst: lib/tegels.js ontdubbelt
// bijna-gelijke syntheses, en met drie keer dezelfde tekst zou deze test één
// artikel overhouden en niets bewijzen.
const persPub = (id, kop, tekst, over = {}) => ({
  id,
  kop,
  tekst,
  gepubliceerd: true,
  gepubliceerdOp: new Date(NU).toISOString(),
  bronnen: [
    { naam: "Le Monde — À la une", titel: `Kop ${id} A`, url: `https://lemonde.fr/${id}`, datum: VERS },
    { naam: "Sud Ouest", titel: `Kop ${id} B`, url: `https://sudouest.fr/${id}`, datum: VERS },
  ],
  ...over,
});

const alle = (tegels) => tegels.flatMap((t) => t.artikelen || []);

// ---- lib/tegels.js: de verwijzing aan het juiste artikel hangen -------------

test("zonder gekozen verwijzingen staat er niets — dat is de hoofdregel", () => {
  const tegels = assembleerTegels({ overheidDocs: [overheidDoc()], nu: NU });
  const a = alle(tegels).find((x) => x.id === "o1");
  assert.equal(a.verwijzingen, undefined, "geen klik, geen verwijzing");
});

test("een gekozen verwijzing komt bij het artikel met dat id te staan", () => {
  const tegels = assembleerTegels({
    overheidDocs: [
      overheidDoc(),
      // Een écht ander bericht: eigen URL en eigen tekst, anders ontdubbelt
      // lib/tegels.js de twee tot één.
      overheidDoc({
        id: "o2",
        kop: "Douane verandert de invoerregels",
        samenvatting: "Voor pakketten uit Nederland gelden andere drempels.",
        url: "https://www.douane.gouv.fr/actualites/drempels",
      }),
    ],
    verwijzingen: [{ id: "o1", items: [IF1] }],
    nu: NU,
  });
  const o1 = alle(tegels).find((x) => x.id === "o1");
  const o2 = alle(tegels).find((x) => x.id === "o2");
  assert.deepEqual(o1.verwijzingen, [{ titel: IF1.titel, url: IF1.url }]);
  assert.equal(o2.verwijzingen, undefined, "en niet bij het andere bericht");
});

test("een verwijzing naar een andere host wordt geweigerd, niet stil getoond", () => {
  const tegels = assembleerTegels({
    overheidDocs: [overheidDoc()],
    verwijzingen: [
      {
        id: "o1",
        items: [
          { ifId: 1, titel: "Vreemde host", url: "https://fonts.googleapis.com/css" },
          { ifId: 2, titel: "Geen URL", url: null },
          IF1,
        ],
      },
    ],
    nu: NU,
  });
  const a = alle(tegels).find((x) => x.id === "o1");
  assert.deepEqual(a.verwijzingen, [{ titel: IF1.titel, url: IF1.url }]);
});

test("binnen één tegel verschijnt dezelfde verwijzing maar één keer", () => {
  // Vier persartikelen in dezelfde tegel, alle vier met dezelfde verwijzing:
  // dat is ruis. De bovenste houdt hem.
  const publicaties = [
    persPub("p1", "Aangiftetermijn verschuift", "De belastingdienst verlengt de termijn voor de jaarlijkse aangifte met twee weken."),
    persPub("p2", "Energieprijzen dalen", "Huishoudens betalen komende winter minder voor gas; de regulering wordt aangepast."),
    // Alle drie moeten in DEZELFDE tegel belanden — vandaar geen brand- of
    // verkeerstrefwoorden, die zouden een eigen tegel openen (lib/tegels.js).
    persPub("p3", "Schoolboeken duurder", "Ouders betalen dit jaar meer voor lesmateriaal, blijkt uit een rondgang langs winkels."),
  ];
  const tegels = assembleerTegels({
    publicaties,
    verwijzingen: publicaties.map((p) => ({ id: p.id, items: [IF1] })),
    nu: NU,
  });
  const arts = alle(tegels);
  assert.equal(arts.length, 3, "alle drie de syntheses staan er (geen dedup)");
  const metVerwijzing = arts.filter((a) => a.verwijzingen);
  assert.equal(metVerwijzing.length, 1, "één keer per tegel");
  assert.equal(metVerwijzing[0].id, arts[0].id, "en wel bij de bovenste");
});

test("een tweede, andere verwijzing in dezelfde tegel blijft wél staan", () => {
  const publicaties = [
    persPub("p1", "Aangiftetermijn verschuift", "De belastingdienst verlengt de termijn voor de jaarlijkse aangifte met twee weken."),
    persPub("p2", "Energieprijzen dalen", "Huishoudens betalen komende winter minder voor gas; de regulering wordt aangepast."),
  ];
  const tegels = assembleerTegels({
    publicaties,
    verwijzingen: [
      { id: "p1", items: [IF1] },
      { id: "p2", items: [IF2] },
    ],
    nu: NU,
  });
  assert.equal(alle(tegels).filter((a) => a.verwijzingen).length, 2);
});

test(`hooguit ${IF_VERWIJZING_MAX} verwijzingen onder één bericht`, () => {
  const items = Array.from({ length: IF_VERWIJZING_MAX + 2 }, (_, i) => ({
    ifId: 200 + i,
    titel: `Artikel ${i}`,
    url: `https://infofrankrijk.com/artikel-${i}/`,
  }));
  const tegels = assembleerTegels({
    overheidDocs: [overheidDoc()],
    verwijzingen: [{ id: "o1", items }],
    nu: NU,
  });
  assert.equal(alle(tegels).find((x) => x.id === "o1").verwijzingen.length, IF_VERWIJZING_MAX);
});

test("een verwijzing bij een artikel dat er niet (meer) is, doet niets", () => {
  const tegels = assembleerTegels({
    overheidDocs: [overheidDoc()],
    verwijzingen: [{ id: "verlopen-artikel", items: [IF1] }],
    nu: NU,
  });
  assert.equal(alle(tegels).find((x) => x.id === "o1").verwijzingen, undefined);
});

// ---- lib/levering.js: in welke levering komt hij terecht --------------------

test("de verwijzing reist mee met de tekst, niet met de compacte levering", () => {
  const vol = {
    bijgewerkt: "2026-08-28T12:00:00.000Z",
    gebakkenOp: "2026-08-28T12:00:00.000Z",
    agenda: [],
    bronStatus: [],
    tegels: [
      {
        soort: "overheid",
        id: "overheid-geld-belasting",
        label: "Geld & belasting",
        artikelen: [
          {
            id: "o1",
            soort: "overheid",
            titel: "Bercy",
            summary: "S.",
            tekst: "De tekst.",
            bronnen: [{ naam: "Bercy", titel: "t", url: "https://www.economie.gouv.fr/a", datum: VERS }],
            verwijzingen: [{ titel: IF1.titel, url: IF1.url }],
          },
        ],
      },
    ],
  };
  const { compact, tekst } = splitsAntwoord(vol);
  const compactArt = compact.tegels[0].artikelen[0];
  assert.equal(compactArt.verwijzingen, undefined, "de dichte staat toont hem niet");
  const record = tekst.artikelen[artikelSleutel("overheid-geld-belasting", "o1")];
  assert.deepEqual(record.verwijzingen, [{ titel: IF1.titel, url: IF1.url }]);
  // En de bronnen blijven waar ze horen: een verwijzing is geen bron.
  assert.equal(record.bronnen.length, 1);
  assert.ok(!record.bronnen.some((b) => String(b.url).includes("infofrankrijk.com")));

  // Samenvoegen levert het volledige artikel weer op.
  const hersteld = { ...compactArt, tekst: record.tekst, bronnen: record.bronnen, verwijzingen: record.verwijzingen };
  delete hersteld.bronMeta;
  delete hersteld.bronAantal;
  assert.deepEqual(hersteld, vol.tegels[0].artikelen[0]);
});

test("een artikel zonder verwijzing krijgt geen leeg veld in de levering", () => {
  const vol = {
    bijgewerkt: "x",
    gebakkenOp: "x",
    tegels: [
      {
        id: "pers-landelijk",
        artikelen: [{ id: "p1", titel: "T", summary: "s", tekst: "t", bronnen: [] }],
      },
    ],
  };
  const { tekst } = splitsAntwoord(vol);
  const record = tekst.artikelen["pers-landelijk/p1"];
  assert.deepEqual(Object.keys(record).sort(), ["bronnen", "tekst"]);
});

// ---- actueel.html: hoe de lezer het ziet -----------------------------------
// Zelfde aanpak als test/client-artikel.test.mjs: de renderfuncties worden UIT
// de pagina gehaald en daar uitgevoerd, zodat de test de echte bron toetst en
// niet een kopie die uit de pas kan lopen.

const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
const begin = html.indexOf("function bronHTML(b){");
const eind = html.indexOf("function leegHTML(){");
assert.ok(begin > 0 && eind > begin, "renderfuncties niet gevonden in actueel.html");
const bron = html.slice(begin, eind);

function maakArtikelHTML(teksten) {
  const esc = (x) =>
    String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const ico = (n) => `<svg data-ic="${n}"></svg>`;
  const datum = (d) => String(d || "").slice(0, 10);
  // eslint-disable-next-line no-new-func
  return new Function(
    "esc", "ico", "datum", "artOpen", "teksten", "tekstStatus",
    "archiefArtikelen", "archiefStatus", "open", "themaIco", "meerv", "CATS", "VERWIJS_KOP",
    `${bron}; return artikelHTML;`
  )(esc, ico, datum, {}, teksten, "klaar", null, "niet-nodig", {}, () => "ic", (n) => `${n}`, [], IF_VERWIJZING_KOP);
}

const TEGEL = { id: "overheid-geld-belasting", soort: "overheid" };
const ARTIKEL = { id: "o1", soort: "overheid", titel: "Bercy", summary: "S.", bronMeta: { naam: "Bercy", datum: VERS }, bronAantal: 1 };

test("de pagina zet de verwijzing in een eigen blok onder de bronnen", () => {
  const artikelHTML = maakArtikelHTML({
    "overheid-geld-belasting/o1": {
      tekst: "De tekst.",
      bronnen: [{ naam: "Bercy", titel: "Nouveau", url: "https://www.economie.gouv.fr/a", datum: VERS }],
      verwijzingen: [{ titel: IF1.titel, url: IF1.url }],
    },
  });
  const uit = artikelHTML("nieuws", TEGEL, ARTIKEL);

  assert.ok(uit.includes(IF_VERWIJZING_KOP), "de kop staat erboven");
  assert.ok(uit.includes(`<a href="${IF1.url}" target="_blank" rel="noopener">${IF1.titel}</a>`));
  // Eigen blok, en ONDER de bronnen — niet ertussen.
  assert.ok(uit.indexOf('class="verwijs"') > uit.indexOf("bronknop"), "het blok staat onder de bronnen");
  assert.ok(!uit.includes('<li><a href="https://infofrankrijk.com'.replace("<li>", "<li><span")),
    "de verwijzing staat niet als bron in de bronnenlijst");
  // De bronnenknop telt alleen de echte bronnen.
  assert.ok(uit.includes("Bronnen (1)"));
});

test("zonder verwijzing komt het blok er niet, ook niet leeg", () => {
  const artikelHTML = maakArtikelHTML({
    "overheid-geld-belasting/o1": { tekst: "De tekst.", bronnen: [] },
  });
  const uit = artikelHTML("nieuws", TEGEL, ARTIKEL);
  assert.ok(!uit.includes('class="verwijs"'));
  assert.ok(!uit.includes(IF_VERWIJZING_KOP));
});

test("de kop in de pagina en die in de configuratie zijn dezelfde tekst", () => {
  // De pagina is losstaande HTML en kan lib/config.js niet importeren; deze
  // toets houdt de twee gelijk zonder dat iemand het hoeft te onthouden.
  assert.ok(
    html.includes(`var VERWIJS_KOP = "${IF_VERWIJZING_KOP}";`),
    "actueel.html en IF_VERWIJZING_KOP lopen uit elkaar"
  );
});

// ---- review.html: de keuzelijst van de redactie ----------------------------
// Zelfde aanpak als hierboven: de renderfuncties worden UIT de reviewtool
// gehaald en daar uitgevoerd. Wat hier wordt vastgelegd is vooral dat de
// knoppen de acties aanroepen die api/review.js ook echt kent — een typefout in
// een `data-`attribuut zou anders pas op productie opvallen.

const reviewHtml = readFileSync(new URL("../review.html", import.meta.url), "utf8");
const rBegin = reviewHtml.indexOf("function ifDatum(iso){");
const rEind = reviewHtml.indexOf("// ---- Geweigerde bron-URL's");
assert.ok(rBegin > 0 && rEind > rBegin, "IF-renderfuncties niet gevonden in review.html");
const rBron = reviewHtml.slice(rBegin, rEind);

function maakReviewRenderer(state) {
  const esc = (x) =>
    String(x == null ? "" : x)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // eslint-disable-next-line no-new-func
  return new Function(
    "esc", "state",
    `${rBron}; return { ifBlokHtml: ifBlokHtml, nakijkenHtml: nakijkenHtml, bijnaVerlopenHtml: bijnaVerlopenHtml };`
  )(esc, state);
}

test("zonder gekozen verwijzing staat er alleen een zoekknop", () => {
  const { ifBlokHtml } = maakReviewRenderer({ verwijzingen: {}, ifPaneel: null });
  const uit = ifBlokHtml("o1");
  assert.ok(uit.includes('data-if-open="o1"'), "de knop om de lijst te openen");
  assert.ok(!uit.includes("data-if-verwijs"), "en nog geen kandidaten");
});

test("de kandidatenlijst toont per regel de twee knoppen, met de acties die de server kent", () => {
  const { ifBlokHtml } = maakReviewRenderer({
    verwijzingen: {},
    ifPaneel: {
      id: "o1",
      zoek: "",
      alles: false,
      data: {
        bericht: { thema: "geld-belasting" },
        categorieen: [{ id: 18, naam: "Belastingen" }],
        maanden: 12,
        standaardAantal: 2,
        totaal: 3,
        kandidaten: [
          { ifId: 1, titel: "Oudste", url: "https://infofrankrijk.com/a/", modified: "2025-11-05T10:00:00.000Z", gekozen: false },
          { ifId: 2, titel: "Middelste", url: "https://infofrankrijk.com/b/", modified: "2026-01-05T10:00:00.000Z", gekozen: true },
          { ifId: 3, titel: "Jongste", url: "https://infofrankrijk.com/c/", modified: "2026-08-05T10:00:00.000Z", gekozen: false },
        ],
      },
    },
  });
  const uit = ifBlokHtml("o1");
  assert.ok(uit.includes('data-if-verwijs="1"'), "verwijzen");
  assert.ok(uit.includes('data-if-nakijk="1"'), "nakijken");
  assert.ok(uit.includes('data-if-af="2"'), "een al gekozen artikel biedt weghalen aan, geen tweede keer verwijzen");
  assert.ok(uit.includes("2025-11-05"), "de wijzigingsdatum staat erbij");
  assert.ok(uit.includes("Belastingen"), "en de gebruikte categorie");
  // Standaard tien (hier twee), met de rest achter een knop.
  assert.ok(!uit.includes(">Jongste<"), "de derde staat nog niet in de lijst");
  assert.ok(uit.includes("Toon alle 3"));
});

test("gekozen verwijzingen staan bovenaan, met een knop om ze weg te halen", () => {
  const { ifBlokHtml } = maakReviewRenderer({
    verwijzingen: { o1: [{ ifId: 7, titel: "De SCI", url: "https://infofrankrijk.com/de-sci/" }] },
    ifPaneel: null,
  });
  const uit = ifBlokHtml("o1");
  assert.ok(uit.includes("De SCI"));
  assert.ok(uit.includes('data-if-af="7"'));
});

test("de auditlijst noemt de aanleiding en biedt afvinken", () => {
  const { nakijkenHtml } = maakReviewRenderer({
    nakijken: [
      {
        ifId: 9,
        titel: "Fiscale uitleg",
        url: "https://infofrankrijk.com/fiscaal/",
        modified: "2025-12-01T10:00:00.000Z",
        aanleidingen: [{ id: "o1", kop: "Bercy verschuift de aangiftetermijn", bron: "Bercy" }],
      },
    ],
  });
  const uit = nakijkenHtml();
  assert.ok(uit.includes("Nakijken op Infofrankrijk (1)"));
  assert.ok(uit.includes("Bercy verschuift de aangiftetermijn"));
  assert.ok(uit.includes('data-nakijk-klaar="9"'));
});

test("wat bijna uit het venster valt, krijgt een eigen lijst", () => {
  const { bijnaVerlopenHtml } = maakReviewRenderer({
    bijnaVerlopen: [{ ifId: 4, titel: "Bijna verlopen", url: "https://infofrankrijk.com/x/", modified: "2025-09-01T10:00:00.000Z" }],
  });
  const uit = bijnaVerlopenHtml();
  assert.ok(uit.includes("Bijna niet meer verwijsbaar (1)"));
  assert.ok(uit.includes("Bijna verlopen"));
  // Leeg is leeg: geen kop zonder inhoud.
  assert.equal(maakReviewRenderer({ bijnaVerlopen: [] }).bijnaVerlopenHtml(), "");
});
