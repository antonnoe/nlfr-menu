// De Infofrankrijk-index: ophalen, de twee filters, en de sortering.
// ---------------------------------------------------------------------------
// Deze module beslist niets — hij levert kandidaten waaruit de REDACTIE kiest.
// Wat hij wel moet garanderen, en wat hier dus getoetst wordt:
//   1. de wijzigingsdatum klopt (WordPress levert `modified` ZONDER tijdzone);
//   2. het datumfilter laat niets door dat ouder is dan twaalf maanden;
//   3. het categoriefilter volgt de koppeltabel uit lib/config.js;
//   4. een zoekterm negeert de categorieën, maar NOOIT de twaalf maanden;
//   5. de volgorde is oudste wijziging eerst — dat is de auditvolgorde.
//
// TZ=UTC, net als de productieruntime: zou de code de tijdzone van `modified`
// negeren, dan verschuiven de datums hier zichtbaar (zie test/schoolvakanties).

process.env.TZ = "UTC";

import test from "node:test";
import assert from "node:assert/strict";

import {
  ontHtml,
  wijzigingsdatum,
  venstergrens,
  binnenVenster,
  kandidaten,
  bijnaVerlopen,
  categorieIdsVoorThema,
  artikelUitIndex,
  haalIfIndex,
  postsUrl,
} from "../lib/ifindex.js";
import { IF_CATEGORIE_PER_THEMA, OVERHEID_THEMAS, PERS_TEGELS } from "../lib/config.js";

const NU = Date.parse("2026-08-28T12:00:00Z");

function art(ifId, titel, modified, categorieen) {
  return { ifId, titel, url: `https://infofrankrijk.com/${ifId}/`, modified, categorieen };
}

// Een miniatuur-index. De categorieën zijn de echte id's van infofrankrijk.com:
// 18 Belastingen, 12 Geldzaken, 26 Overheden, 39 Verbouwen.
const INDEX = {
  opgehaaldOp: "2026-08-28T06:00:00.000Z",
  categorieen: { 18: "Belastingen", 12: "Geldzaken", 26: "Overheden", 39: "Verbouwen" },
  artikelen: [
    art(1, "Belastingaangifte in Frankrijk", "2026-08-01T10:00:00.000Z", [18]),
    art(2, "Kinderbijslag", "2025-11-05T10:00:00.000Z", [18, 12]),
    art(3, "Dakkapel plaatsen", "2026-07-20T10:00:00.000Z", [39]),
    art(4, "Gemeentelijke heffingen", "2026-02-10T10:00:00.000Z", [26, 18]),
    // Buiten het venster: 28 augustus 2026 min twaalf maanden is 28 augustus 2025.
    art(5, "Oude belastinguitleg", "2025-08-27T10:00:00.000Z", [18]),
    // Randgeval: precies op de grens hoort er nog bij.
    art(6, "Precies op de grens", "2025-08-28T12:00:00.000Z", [18]),
    // Zonder bruikbare datum: doet niet mee (zie binnenVenster).
    art(7, "Zonder datum", null, [18]),
  ],
};

// ---- Tekst en datum uit WordPress -----------------------------------------

test("HTML-entiteiten in een titel worden omgezet, niet doorgegeven", () => {
  assert.equal(ontHtml("Frankrijk &#8217;s fiscus &amp; u"), "Frankrijk ’s fiscus & u");
  assert.equal(ontHtml("<b>Vet</b> gedrukt"), "Vet gedrukt");
  assert.equal(ontHtml("Caf&eacute; &laquo;Claude&raquo;"), "Café «Claude»");
  assert.equal(ontHtml(null), "");
});

test("de wijzigingsdatum komt uit modified_gmt, niet uit het tijdzoneloze modified", () => {
  // WordPress levert `modified` in de tijdzone van de site (hier CEST, +2) maar
  // ZONDER aanduiding. Wie die string in Node parseert, krijgt hem als UTC
  // binnen en zit er twee uur naast — precies genoeg om over een datumgrens te
  // stappen. `modified_gmt` is de juiste bron.
  const post = { modified: "2026-08-24T01:30:00", modified_gmt: "2026-08-23T23:30:00" };
  assert.equal(wijzigingsdatum(post), "2026-08-23T23:30:00.000Z");
  // Terugval als de API alleen `modified` levert.
  assert.equal(wijzigingsdatum({ modified: "2026-08-23T12:00:00" }), "2026-08-23T12:00:00.000Z");
  assert.equal(wijzigingsdatum({}), null);
  assert.equal(wijzigingsdatum({ modified_gmt: "onzin" }), null);
});

// ---- Filter 1: de datum ----------------------------------------------------

test("twaalf maanden is een kalenderjaar terug, niet 365 dagen", () => {
  assert.equal(new Date(venstergrens(NU, 12)).toISOString(), "2025-08-28T12:00:00.000Z");
  // En de maandgrens klopt ook als de doelmaand korter is.
  assert.equal(
    new Date(venstergrens(Date.parse("2026-03-31T00:00:00Z"), 1)).toISOString().slice(0, 10),
    "2026-03-03" // 31 februari bestaat niet; JS rolt door naar maart
  );
});

test("het datumfilter laat niets door dat ouder is dan twaalf maanden", () => {
  assert.equal(binnenVenster(INDEX.artikelen[0], NU), true, "1 augustus 2026");
  assert.equal(binnenVenster(INDEX.artikelen[4], NU), false, "27 augustus 2025 valt af");
  assert.equal(binnenVenster(INDEX.artikelen[5], NU), true, "precies op de grens blijft");
  assert.equal(binnenVenster(INDEX.artikelen[6], NU), false, "zonder datum: niet verwijzen");
});

// ---- Filter 2: de categorielijst -------------------------------------------

test("de koppeltabel dekt elk overheids- en persthema", () => {
  for (const thema of [...OVERHEID_THEMAS, ...PERS_TEGELS]) {
    const ids = categorieIdsVoorThema(thema);
    assert.ok(ids.length, `thema ${thema} heeft geen categorieën in IF_CATEGORIE_PER_THEMA`);
    assert.ok(ids.every((n) => Number.isInteger(n) && n > 0), `thema ${thema} heeft een raar id`);
  }
  // Andersom: geen thema's in de tabel die nergens bestaan — dan zou een
  // hernoeming van een thema stilletjes de verwijzingen uitschakelen.
  const bekend = new Set([...OVERHEID_THEMAS, ...PERS_TEGELS]);
  for (const thema of Object.keys(IF_CATEGORIE_PER_THEMA)) {
    assert.ok(bekend.has(thema), `onbekend thema in de koppeltabel: ${thema}`);
  }
});

test("kandidaten komen uit de gekoppelde categorieën, oudste wijziging eerst", () => {
  // geld-belasting -> [18, 12, 362]
  const uit = kandidaten({ index: INDEX, thema: "geld-belasting", nu: NU });
  // Oudste eerst: 6 (precies op de grens), 2, 4, 1.
  assert.deepEqual(uit.map((a) => a.ifId), [6, 2, 4, 1]);
  assert.ok(!uit.some((a) => a.ifId === 3), "Verbouwen hoort hier niet bij");
  assert.ok(!uit.some((a) => a.ifId === 5), "en het oude artikel evenmin");
  assert.ok(!uit.some((a) => a.ifId === 7), "en het artikel zonder datum ook niet");
});

test("een thema zonder categorieën levert geen kandidaten (en geen fout)", () => {
  assert.deepEqual(kandidaten({ index: INDEX, thema: "bestaat-niet", nu: NU }), []);
  assert.deepEqual(kandidaten({ index: INDEX, thema: null, nu: NU }), []);
  assert.deepEqual(kandidaten({ index: null, thema: "geld-belasting", nu: NU }), []);
});

test("een zoekterm negeert het categoriefilter, maar nooit de twaalf maanden", () => {
  const uit = kandidaten({ index: INDEX, thema: "geld-belasting", zoek: "belasting", nu: NU });
  const ids = uit.map((a) => a.ifId);
  assert.ok(ids.includes(1), "de fiscale artikelen blijven");
  assert.ok(!ids.includes(5), "maar het te oude artikel komt ook via zoeken niet terug");
  // Buiten de gekoppelde categorieën zoeken werkt wel — daar is het veld voor.
  assert.deepEqual(kandidaten({ index: INDEX, thema: "geld-belasting", zoek: "dakkapel", nu: NU })
    .map((a) => a.ifId), [3]);
});

test("zoeken is ongevoelig voor hoofdletters en accenten", () => {
  const index = { artikelen: [art(9, "Café en terras", "2026-08-01T10:00:00.000Z", [1])] };
  assert.equal(kandidaten({ index, zoek: "CAFE", nu: NU }).length, 1);
  assert.equal(kandidaten({ index, zoek: "café", nu: NU }).length, 1);
});

test("max begrenst de lijst zonder de volgorde te veranderen", () => {
  const uit = kandidaten({ index: INDEX, thema: "geld-belasting", nu: NU, max: 2 });
  assert.deepEqual(uit.map((a) => a.ifId), [6, 2]);
});

// ---- Wat er bijna uit valt --------------------------------------------------

test("bijnaVerlopen toont wat binnen twee maanden buiten het venster valt", () => {
  const uit = bijnaVerlopen({ index: INDEX, nu: NU });
  // De waarschuwzone loopt van 12 maanden terug (28-08-2025) tot 10 maanden
  // terug (28-10-2025). Daarin valt alleen het grensgeval; Kinderbijslag
  // (05-11-2025) heeft nog ruim tien weken.
  assert.deepEqual(uit.map((a) => a.ifId), [6]);
  const ruimer = bijnaVerlopen({ index: INDEX, nu: NU, waarschuwMaanden: 4 });
  assert.deepEqual(ruimer.map((a) => a.ifId), [6, 2], "met vier maanden komt Kinderbijslag erbij");
  // Wat al buiten het venster ligt, hoort hier NIET in: dat is geen
  // waarschuwing meer maar een gepasseerd station.
  assert.ok(!ruimer.some((a) => a.ifId === 5));
});

test("artikelUitIndex zoekt op id, ook als het als string binnenkomt", () => {
  assert.equal(artikelUitIndex(INDEX, 3).titel, "Dakkapel plaatsen");
  assert.equal(artikelUitIndex(INDEX, "3").titel, "Dakkapel plaatsen");
  assert.equal(artikelUitIndex(INDEX, 999), null);
  assert.equal(artikelUitIndex(null, 3), null);
});

// ---- Ophalen ---------------------------------------------------------------

test("haalIfIndex pagineert en stopt bij de 400 van WordPress", async () => {
  const opgevraagd = [];
  const post = (id, cats) => ({
    id,
    link: `https://infofrankrijk.com/post-${id}/`,
    title: { rendered: `Titel &amp; ${id}` },
    modified: "2026-08-24T01:30:00",
    modified_gmt: "2026-08-23T23:30:00",
    categories: cats,
  });
  const nep = async (url) => {
    opgevraagd.push(url);
    if (url.includes("/posts")) {
      const pagina = Number(new URL(url).searchParams.get("page"));
      if (pagina === 1) {
        // Een volle pagina: de code moet dóórgaan naar pagina 2.
        return { ok: true, status: 200, json: async () => Array.from({ length: 100 }, (_, i) => post(i + 1, [18])) };
      }
      if (pagina === 2) {
        return { ok: true, status: 200, json: async () => [post(101, [26])] };
      }
      return { ok: false, status: 400, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [{ id: 18, name: "Belastingen &amp; co", count: 24 }],
    };
  };

  const index = await haalIfIndex({ nu: NU, fetchImpl: nep });
  assert.equal(index.aantal, 101);
  assert.equal(index.artikelen[0].titel, "Titel & 1", "entiteiten zijn omgezet");
  assert.equal(index.artikelen[0].modified, "2026-08-23T23:30:00.000Z", "GMT, niet lokaal");
  assert.deepEqual(index.artikelen[100].categorieen, [26]);
  assert.equal(index.categorieen["18"], "Belastingen & co");
  assert.equal(index.opgehaaldOp, new Date(NU).toISOString());
  // Na de korte pagina 2 mag er geen derde postspagina meer worden opgehaald.
  assert.equal(opgevraagd.filter((u) => u.includes("/posts")).length, 2);
});

test("een fout van infofrankrijk.com wordt gegooid, niet stil ingeslikt", async () => {
  const nep = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => haalIfIndex({ nu: NU, fetchImpl: nep }), /HTTP 503/);
});

test("de postsUrl vraagt precies de velden op die we gebruiken", () => {
  const u = new URL(postsUrl(1));
  assert.equal(u.searchParams.get("_fields"), "id,link,title,modified,modified_gmt,categories");
  assert.equal(u.searchParams.get("per_page"), "100");
});

test("verversIfIndex gooit nooit — zonder KV is het een nette mislukking", async () => {
  // Losse module-instantie zonder KV-configuratie (zie test/actueel-zonder-kv).
  const zonderKv = await import("../lib/ifindex.js?zonder-kv");
  const uit = await zonderKv.verversIfIndex({
    nu: NU,
    fetchImpl: async () => {
      throw new Error("netwerk dicht");
    },
  });
  assert.equal(uit.ok, false);
  assert.match(uit.reden, /netwerk dicht/);
  assert.equal(uit.aantal, 0);
});
