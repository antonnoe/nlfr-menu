// De jaartal-in-pad-zeef: een oude uitlegpagina met een verse feeddatum.
// ---------------------------------------------------------------------------
// AANLEIDING. De sonde van 16 september 2026 meldde I5 op twee DG
// Trésor-items in overheid-economie: "Les réserves nettes de change"
// (/Articles/2021/01/15/…) en "Les réserves officielles de change"
// (/Articles/2018/07/06/…), beide met feeddatum september 2026. Dat zijn
// tijdloze uitlegpagina's die de feed met een verse datum opnieuw aanbiedt —
// geen nieuws. De feeddatum alleen kan dat niet zien; het pad van de uitgever
// wél.
//
// DE TEGENKANT WEEGT HIER ZWAARDER DAN DE ZEEF. Een pad-zeef die te gretig is
// gooit de hele overheidsstroom leeg, en dat merkt niemand: er staat dan
// minder. Daarom staat hieronder vooral vast wat er NIET weg mag — een jaartal
// dat bij het ONDERWERP hoort ("pass-sport-2026-2027"), een artikel-id
// (-30476791), een datumstempel achteraan een Figaro-slug (-20260904) en een
// pad van dit jaar. Alleen hele padsegmenten tellen.

import test from "node:test";
import assert from "node:assert/strict";

import { padDatering, verouderdPad, normaliseerBron } from "../lib/feeds.js";

// De dag waarop de sonde de melding deed. Vast, want "vandaag" zou deze test
// elk jaar een andere maken.
const FEED = "2026-09-15T06:00:00.000Z";

const RESERVES_NETTES =
  "https://www.tresor.economie.gouv.fr/Articles/2021/01/15/les-reserves-nettes-de-change";
const RESERVES_OFFICIELLES =
  "https://www.tresor.economie.gouv.fr/Articles/2018/07/06/les-reserves-officielles-de-change";

// ---- 1. De twee gemelde DG Trésor-items ------------------------------------

test("de twee DG Trésor-uitlegpagina's worden geweigerd, met leesbare reden", () => {
  assert.equal(
    verouderdPad(RESERVES_NETTES, FEED),
    "pad dateert van 2021-01-15, ouder dan een jaar"
  );
  assert.equal(
    verouderdPad(RESERVES_OFFICIELLES, FEED),
    "pad dateert van 2018-07-06, ouder dan een jaar"
  );
});

// ---- 2. Wat er NIET weg mag -------------------------------------------------

test("een vers DG Trésor-artikel op een pad van vandaag blijft staan", () => {
  const url =
    "https://www.tresor.economie.gouv.fr/Articles/2026/09/03/la-foret-et-la-filiere-bois-un-atout-pour-la-france";
  assert.deepEqual(padDatering(url), { jaar: 2026, datum: "2026-09-03" });
  assert.equal(verouderdPad(url, "2026-09-03T08:00:00.000Z"), null);
});

test("een Rijksoverheid-bericht op /2026/09/04/ blijft staan", () => {
  const url =
    "https://www.rijksoverheid.nl/actueel/nieuws/2026/09/04/benoeming-bij-raad-van-state";
  assert.deepEqual(padDatering(url), { jaar: 2026, datum: "2026-09-04" });
  assert.equal(verouderdPad(url, "2026-09-04T09:30:00.000Z"), null);
});

test("een jaartal in de INHOUD telt niet: service-public heeft geen jaar in zijn pad", () => {
  // De pagina gaat over de pass Sport 2026-2027; het pad zelf dateert niets,
  // en de querystring (?xtor=RSS-111) hoort bij de levering, niet bij de pagina.
  const url = "https://www.service-public.gouv.fr/particuliers/actualites/A15850?xtor=RSS-111";
  assert.equal(padDatering(url), null);
  assert.equal(verouderdPad(url, FEED), null);
});

test("een jaartal binnen een slug telt niet", () => {
  // Artikel-id achteraan een Sud Ouest-slug, en een datumstempel achteraan een
  // Figaro-slug: allebei binnen één segment, dus geen uitspraak over datering.
  const sudouest =
    "https://www.sudouest.fr/politique/budget-le-gouvernement-sous-pression-30476791.php";
  const figaro =
    "https://www.lefigaro.fr/conjoncture/le-budget-2026-sous-pression-20260904";
  assert.equal(padDatering(sudouest), null);
  assert.equal(padDatering(figaro), null);
  assert.equal(verouderdPad(sudouest, FEED), null);
  assert.equal(verouderdPad(figaro, FEED), null);
  // Ook de klassieke onderwerpsjaren in een slug blijven buiten schot.
  assert.equal(padDatering("https://www.example.fr/aides/pass-sport-2026-2027"), null);
  assert.equal(padDatering("https://www.example.fr/fiscalite/loi-de-finances-2026"), null);
});

// ---- 3. De grens: 365 dagen bij een datum, twee kalenderjaren bij een jaar --

test("een volledige paddatum van meer dan een jaar terug valt af", () => {
  const url = "https://www.example.fr/2025/01/10/een-uitlegpagina";
  assert.deepEqual(padDatering(url), { jaar: 2025, datum: "2025-01-10" });
  assert.equal(verouderdPad(url, FEED), "pad dateert van 2025-01-10, ouder dan een jaar");
});

test("een los jaarsegment van één kalenderjaar terug blijft staan", () => {
  // Zonder maand en dag is /2025/ te grof om zeker te zijn: een pagina van
  // december 2025 die in januari 2026 terugkomt is gewoon nieuws. Pas vanaf
  // twee kalenderjaren verschil is het onmiskenbaar oud.
  const url = "https://www.example.fr/2025/een-uitlegpagina";
  assert.deepEqual(padDatering(url), { jaar: 2025, datum: null });
  assert.equal(verouderdPad(url, FEED), null);
  assert.equal(
    verouderdPad("https://www.example.fr/2024/een-uitlegpagina", FEED),
    "pad dateert van 2024"
  );
});

test("bij twijfel doorlaten: toekomst, onleesbare feeddatum, onzinnige datum", () => {
  assert.equal(verouderdPad("https://www.example.fr/2028/03/01/vooruitblik", FEED), null);
  assert.equal(verouderdPad(RESERVES_OFFICIELLES, "geen datum"), null);
  assert.equal(verouderdPad(RESERVES_OFFICIELLES, null), null);
  // Buiten 1990–2099 is een viercijferig segment geen jaartal maar een nummer.
  assert.equal(padDatering("https://www.example.fr/dossier/1789/vrijheid"), null);
  assert.equal(padDatering("https://www.example.fr/rubriek/2100/vooruit"), null);
  // 31 februari bestaat niet: dan telt alleen het jaarsegment.
  assert.deepEqual(padDatering("https://www.example.fr/2019/02/31/typfout"), {
    jaar: 2019,
    datum: null,
  });
});

// ---- 4. Integratie: de weigering loopt via de bestaande route ---------------

test("normaliseerBron zet het 2018-item in geweigerd, niet in items", () => {
  const bron = {
    naam: "DG Trésor",
    feed: "https://www.tresor.economie.gouv.fr/Flux/Atom/Articles/Home",
    thema: "economie",
    regime: "overheid",
    taal: "fr",
    actief: true,
  };
  const ruw = [
    {
      titel: "Les réserves officielles de change",
      url: RESERVES_OFFICIELLES,
      datum: FEED,
      samenvatting: "Les réserves officielles de change de la France.",
    },
    {
      titel: "La forêt et la filière bois",
      url: "https://www.tresor.economie.gouv.fr/Articles/2026/09/14/la-foret-et-la-filiere-bois",
      datum: FEED,
      samenvatting: "Un atout pour la France.",
    },
  ];
  const { items, geweigerd } = normaliseerBron(ruw, bron, Date.parse(FEED) + 3600 * 1000);
  assert.deepEqual(
    items.map((i) => i.titel),
    ["La forêt et la filière bois"]
  );
  assert.equal(geweigerd.length, 1);
  assert.equal(geweigerd[0].titel, "Les réserves officielles de change");
  assert.equal(geweigerd[0].url, RESERVES_OFFICIELLES);
  assert.equal(geweigerd[0].reden, "pad dateert van 2018-07-06, ouder dan een jaar");
});
