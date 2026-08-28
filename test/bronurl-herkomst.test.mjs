// Bron-URL's moeten van de BRON komen, niet uit de artikel-HTML die de feed
// meelevert.
// ---------------------------------------------------------------------------
// STORING DIE HIERONDER WORDT BEWAAKT. Op /actueel wezen de bronlinks onder
// Infofrankrijk-items naar https://fonts.googleapis.com en naar de Google-
// Fonts-stylesheet. Oorzaak: leesLink() in lib/feeds.js zocht met één regex het
// eerste <link ... href="..."> in het HELE <item>-blok, en bij WordPress zit de
// volledige artikel-HTML in <content:encoded>. Artikelen die met een ingesloten
// Divi-blok beginnen leverden zo hun font-links aan als bron.
//
// De fixture is een ECHT fragment van de live feed (zie de kop van het bestand
// voor bron-URL en ophaaldatum), ingekort tot de twee items die de storing op
// productie veroorzaakten. De <link>-elementen zijn onveranderd.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseerFeed, laadBronnen } from "../lib/feeds.js";
import { assembleerTegels } from "../lib/tegels.js";
import {
  bronUrlOordeel,
  isAssetHost,
  registreerbaarDomein,
  keurBronnen,
} from "../lib/bronurl.js";

const FRAGMENT = readFileSync(
  fileURLToPath(new URL("./fixtures/infofrankrijk-feed-fragment.xml", import.meta.url)),
  "utf8"
);
const INFOFRANKRIJK = laadBronnen().find((b) => b.thema === "infofrankrijk");

// ---- De regressie zelf ------------------------------------------------------

test("fonts.googleapis.com kan nooit als bron-URL uit de feed komen", () => {
  const items = parseerFeed(FRAGMENT);
  assert.equal(items.length, 2, "de fixture hoort twee items te bevatten");
  for (const item of items) {
    assert.ok(
      !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(item.url),
      `asset-URL als bron gelekt bij "${item.titel}": ${item.url}`
    );
    assert.ok(
      item.url.startsWith("https://infofrankrijk.com/"),
      `bron-URL hoort op infofrankrijk.com te staan, kreeg: ${item.url}`
    );
  }
});

test("de itemlink is de <link> van het item, niet iets uit content:encoded", () => {
  const perTitel = new Map(parseerFeed(FRAGMENT).map((i) => [i.titel, i.url]));
  assert.equal(
    perTitel.get("Handleiding voor een woning opgetrokken uit leem"),
    "https://infofrankrijk.com/handleiding-voor-een-woning-opgetrokken-uit-leem/"
  );
  assert.equal(
    perTitel.get("CAK, vroegpensioen en zorg in Frankrijk"),
    "https://infofrankrijk.com/cak-vroegpensioen-en-zorg-in-frankrijk/"
  );
});

test("de twee URL's uit de storing worden ook door de validatie geweigerd", () => {
  // Tweede lijn: ook als een parser ze ooit weer zou aanleveren.
  const preconnect = bronUrlOordeel("https://fonts.googleapis.com", INFOFRANKRIJK);
  assert.equal(preconnect.ok, false);
  assert.match(preconnect.reden, /leeg pad/);

  const stylesheet = bronUrlOordeel(
    "https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Mulish:wght@400;600;700&display=swap",
    INFOFRANKRIJK
  );
  assert.equal(stylesheet.ok, false);
  assert.match(stylesheet.reden, /asset-host/);
});

test("een besmet item levert op /actueel geen klikbare link op", () => {
  const nu = Date.parse("2026-08-25T12:00:00Z");
  const items = [
    {
      titel: "Handleiding voor een woning opgetrokken uit leem",
      url: "https://fonts.googleapis.com",
      bron: "Infofrankrijk",
      datum: new Date(nu - 2 * 24 * 60 * 60 * 1000).toISOString(),
      thema: "infofrankrijk",
      regime: "eigen",
      samenvatting: "Over leembouw.",
    },
  ];
  const tegels = assembleerTegels({ items, nu });
  const tegel = tegels.find((t) => t.soort === "infofrankrijk");
  const art = tegel.artikelen[0];
  assert.equal(art.url, null, "geen klikbare artikel-URL");
  // De bron blijft staan als attributie, met een leesbare reden — niet stil weg.
  assert.equal(art.bronnen.length, 1);
  assert.equal(art.bronnen[0].url, null);
  assert.match(art.bronnen[0].urlGeweigerd, /leeg pad/);
});

// ---- De validatieregels, per regime ----------------------------------------

test("de herkomsttoets geldt voor elk regime, ook eigen en verenigingen", () => {
  for (const bron of laadBronnen().filter((b) => b.actief && !b.linkAggregaat)) {
    const vreemd = bronUrlOordeel("https://voorbeeld-vreemd.example/artikel", bron);
    assert.equal(vreemd.ok, false, `${bron.naam} liet een vreemde host door`);
    assert.match(vreemd.reden, /hoort niet bij bron/);
  }
});

test("een lege of ontbrekende bron-URL wordt geweigerd met reden", () => {
  assert.match(bronUrlOordeel("", INFOFRANKRIJK).reden, /geen bron-URL/);
  assert.match(bronUrlOordeel(null, INFOFRANKRIJK).reden, /geen bron-URL/);
  assert.match(bronUrlOordeel("/relatief/pad", INFOFRANKRIJK).reden, /geen absolute URL/);
  assert.match(
    bronUrlOordeel("javascript:alert(1)", INFOFRANKRIJK).reden,
    /geen absolute URL|niet http/
  );
});

test("een subdomein van de bron mag wel, een ander domein niet", () => {
  assert.equal(bronUrlOordeel("https://www.infofrankrijk.com/artikel/", INFOFRANKRIJK).ok, true);
  assert.equal(bronUrlOordeel("https://blog.infofrankrijk.com/x", INFOFRANKRIJK).ok, true);
  assert.equal(bronUrlOordeel("https://infofrankrijk.com.kwaad.example/x", INFOFRANKRIJK).ok, false);
});

test("asset-hosts worden categorisch geweerd, ook binnen een legitieme bron", () => {
  for (const host of [
    "fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net",
    "www.googletagmanager.com", "static.lemonde.fr", "analytics.example.org",
    "cdn.infofrankrijk.com",
  ]) {
    assert.equal(isAssetHost(host), true, `${host} hoort een asset-host te zijn`);
  }
  for (const host of [
    "infofrankrijk.com", "www.lemonde.fr", "nos.nl", "ofb.gouv.fr",
    "www.service-public.fr",
  ]) {
    assert.equal(isAssetHost(host), false, `${host} is geen asset-host`);
  }
});

test("het registreerbare domein respecteert gouv.fr en github.io", () => {
  assert.equal(registreerbaarDomein("feeds.nos.nl"), "nos.nl");
  assert.equal(registreerbaarDomein("www.douane.gouv.fr"), "douane.gouv.fr");
  assert.equal(registreerbaarDomein("antonnoe.github.io"), "antonnoe.github.io");
  // Twee ministeries zijn NIET hetzelfde registreerbare domein.
  assert.notEqual(
    registreerbaarDomein("www.douane.gouv.fr"),
    registreerbaarDomein("www.economie.gouv.fr")
  );
});

test("keurBronnen meldt een besmet opgeslagen record zonder het weg te gooien", () => {
  const doc = {
    bronnen: [
      { naam: "Infofrankrijk", url: "https://fonts.googleapis.com" },
      { naam: "Infofrankrijk", url: "https://infofrankrijk.com/goed-artikel/" },
    ],
  };
  const weigeringen = keurBronnen(doc);
  assert.equal(weigeringen.length, 1);
  assert.equal(weigeringen[0].url, "https://fonts.googleapis.com");
  assert.equal(doc.bronnen.length, 2, "keurBronnen mag niets verwijderen");
});

test("de aggregaatbron laat vreemde hosts toe maar nooit assets of lege paden", () => {
  // De verenigingenfeed bundelt de websites van de verenigingen zelf; "host
  // hoort bij de feed-host" kan daar niet gelden (zie _linkAggregaat in
  // bronnen.json). Alle andere toetsen blijven wél gelden.
  const agg = laadBronnen().find((b) => b.linkAggregaat);
  assert.ok(agg, "er hoort een aggregaatbron te zijn");
  assert.equal(bronUrlOordeel("https://vereniging.example/nieuws/zomerfeest", agg).ok, true);
  assert.equal(bronUrlOordeel("https://fonts.googleapis.com/css2?family=X", agg).ok, false);
  assert.equal(bronUrlOordeel("https://vereniging.example", agg).ok, false);
  assert.equal(bronUrlOordeel("https://goedinfrankrijk.com/x", agg).ok, false);
});
