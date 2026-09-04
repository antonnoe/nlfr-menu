// Zelftests voor de nieuwe overheidsbron OFB (Office français de la
// biodiversité) en de bijbehorende rubriek "Natuur & milieu".
//
// De rubriek komt uit één constante (OVERHEID_THEMAS): die stuurt tegelijk de
// tegel op /actueel, de instroomselectie in de cron én de rubriekvolgorde van
// het register. Deze tests leggen die drie kanten vast, plus het regime-gedrag.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseerFeed, laadBronnen, faitsDiversDoorlaat, buitenlandDoorlaat } from "../lib/feeds.js";
import { assembleerTegels } from "../lib/tegels.js";
import { maakRegisterRecord, publiekeRubrieken } from "../lib/register.js";
import { isPersConcept } from "../lib/poort.js";
import { OVERHEID_THEMAS, OVERHEID_THEMA_LABEL, OVERHEID_MAX_LIVE_PER_TEGEL } from "../lib/config.js";

const NU = Date.parse("2026-08-05T12:00:00Z");
const DAG = 24 * 60 * 60 * 1000;

// ---- 1) De bron staat er goed in -------------------------------------------

test("OFB staat in bronnen.json met het juiste regime, thema en taal", () => {
  const ofb = laadBronnen().find((b) => /OFB/.test(b.naam));
  assert.ok(ofb, "OFB hoort in de bronnenlijst te staan");
  assert.equal(ofb.naam, "OFB — Office français de la biodiversité");
  assert.equal(ofb.feed, "https://ofb.gouv.fr/rss.xml");
  assert.equal(ofb.regime, "overheid");
  assert.equal(ofb.taal, "fr");
  assert.equal(ofb.thema, "natuur-milieu");
  assert.equal(ofb.actief, true);
  assert.equal(ofb.verificatie, "geverifieerd");
  assert.equal(ofb.verificatieDatum, "2026-08-05");
});

test("natuur-milieu is een volwaardige rubriek met label", () => {
  assert.ok(OVERHEID_THEMAS.includes("natuur-milieu"));
  assert.equal(OVERHEID_THEMA_LABEL["natuur-milieu"], "Natuur & milieu");
});

// ---- 2) Een OFB-feeditem parseert ------------------------------------------

const OFB_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>OFB — Actualités</title>
    <item>
      <title>Nouvelles règles pour la pêche en eau douce à partir de janvier</title>
      <link>https://ofb.gouv.fr/actualites/nouvelles-regles-peche-eau-douce</link>
      <description>L'Office français de la biodiversité précise les règles applicables aux pêcheurs.</description>
      <pubDate>Tue, 04 Aug 2026 09:00:00 +0200</pubDate>
    </item>
    <item>
      <title>Sécheresse : restrictions d'eau dans quinze départements</title>
      <link>https://ofb.gouv.fr/actualites/secheresse-restrictions</link>
      <description>Les préfectures étendent les restrictions d'usage de l'eau.</description>
      <pubDate>Mon, 03 Aug 2026 08:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

test("een OFB RSS 2.0-item parseert met titel, link, datum en samenvatting", () => {
  const items = parseerFeed(OFB_RSS);
  assert.equal(items.length, 2);
  const eerste = items[0];
  assert.equal(eerste.titel, "Nouvelles règles pour la pêche en eau douce à partir de janvier");
  assert.equal(eerste.url, "https://ofb.gouv.fr/actualites/nouvelles-regles-peche-eau-douce");
  assert.ok(eerste.samenvatting && eerste.samenvatting.length > 10, "overheid levert wél een samenvatting");
  assert.equal(new Date(eerste.datum).toISOString().slice(0, 10), "2026-08-04");
});

// ---- 3) De bestaande zeven gedragen zich zoals bij de andere overheidsfeeds -
// Belangrijk: de faits-divers- en buitenlandzeef gelden ALLEEN voor regime
// 'pers'. In feeds.js staat de buitenlandzeef achter `bron.regime === "pers"`
// en in api/cron.js staat de faits-divers-zeef achter `i.regime === "pers"`.
// OFB volgt dus exact hetzelfde pad als Service-Public en Bercy: geen van beide
// zeven wordt toegepast. Deze tests leggen dat vast, zodat een latere wijziging
// aan de zeven niet stilletjes één overheidsbron anders behandelt.

test("de zeven raken OFB-items niet, net zomin als bij andere overheidsbronnen", () => {
  const overheidBronnen = laadBronnen().filter((b) => b.regime === "overheid" && b.actief);
  for (const b of overheidBronnen) {
    assert.notEqual(b.regime, "pers", `${b.naam} zou anders door de perszeven gaan`);
  }
  assert.ok(overheidBronnen.some((b) => /OFB/.test(b.naam)), "OFB hoort in die groep");
});

test("de zeeffuncties zelf oordelen over een OFB-kop hetzelfde als over elke andere kop", () => {
  // Puur ter documentatie van het gedrag: de functies zijn regimeloos, het is de
  // aanroeper die ze alleen op pers loslaat.
  const kop = "Sécheresse : restrictions d'eau dans quinze départements";
  assert.equal(faitsDiversDoorlaat(kop), true, "secheresse staat in de insluitlijst");
  assert.equal(buitenlandDoorlaat(kop), true, "geen buitenlandmarker");
});

// ---- 4) Overheidsregime: direct live, buiten de publicatie-gate -------------

const ofbDoc = (over = {}) => ({
  id: "ofb1",
  thema: "natuur-milieu",
  bron: "OFB — Office français de la biodiversité",
  url: "https://ofb.gouv.fr/actualites/nouvelles-regles-peche-eau-douce",
  datum: new Date(NU - 2 * DAG).toISOString(),
  titelBron: "Nouvelles règles pour la pêche en eau douce",
  kop: "Nieuwe regels voor zoetwatervissen",
  samenvatting: "Vanaf januari gelden nieuwe regels voor het vissen in binnenwateren.",
  gepubliceerdOp: new Date(NU - 2 * DAG).toISOString(),
  ...over,
});

test("een vers OFB-bericht krijgt zijn eigen tegel Natuur & milieu", () => {
  const tegels = assembleerTegels({ publicaties: [], overheidDocs: [ofbDoc()], items: [], nu: NU });
  const tegel = tegels.find((t) => t.thema === "natuur-milieu");
  assert.ok(tegel, "de tegel hoort er te zijn");
  assert.equal(tegel.soort, "overheid");
  assert.equal(tegel.label, "Natuur & milieu");
  assert.equal(tegel.accent, "brand", "zelfde vormgeving als de andere overheidstegels");
  assert.equal(tegel.badge, "Overheid");
  assert.equal(tegel.artikelen.length, 1);
});

test("de tegel volgt dezelfde volumecap als de andere overheidstegels", () => {
  // Elk bericht een eigen onderwerp: de overheid-dedup voegt bijna gelijke
  // titels samen (en doet dat op deze bron net zo goed als op de andere), dus
  // met varianten van één titel zou deze test zichzelf leegtrekken.
  const onderwerpen = [
    ["Zoetwatervisserij krijgt nieuwe regels", "Vanaf januari gelden andere voorwaarden voor vissen in binnenwateren."],
    ["Wolvenpopulatie opnieuw geteld", "De jaarlijkse telling laat een lichte groei zien in de Alpen."],
    ["Restricties op wateronttrekking uitgebreid", "Vijftien departementen scherpen de gebruiksbeperkingen aan."],
    ["Beschermde status voor twee moerasgebieden", "De gebieden krijgen een strenger beheerregime."],
    ["Nieuw meetnet voor luchtkwaliteit", "Er komen extra meetpunten rond industriezones."],
    ["Subsidie voor herstel van heggenlandschap", "Gemeenten kunnen een bijdrage aanvragen voor aanplant."],
    ["Jachtseizoen op waterwild ingekort", "Het seizoen sluit dit jaar twee weken eerder."],
    ["Rapport over bodemverontreiniging verschenen", "Het rapport bundelt metingen van de afgelopen vijf jaar."],
    ["Handhaving op stroperij opgevoerd", "Er komen meer controles langs de rivieren."],
    ["Kaart met kwetsbare natuurzones vernieuwd", "De kaart toont waar bebouwing beperkt is."],
    ["Vergunningplicht voor drainagewerken", "Grondeigenaren moeten voortaan een melding doen."],
  ];
  const docs = onderwerpen.map(([kop, samenvatting], i) =>
    ofbDoc({
      id: `ofb${i}`,
      url: `https://ofb.gouv.fr/actualites/item-${i}`,
      kop,
      samenvatting,
      datum: new Date(NU - (i + 1) * 60 * 60 * 1000).toISOString(),
    })
  );
  assert.ok(docs.length > OVERHEID_MAX_LIVE_PER_TEGEL, "er moeten er meer zijn dan de cap");
  const tegels = assembleerTegels({ publicaties: [], overheidDocs: docs, items: [], nu: NU });
  const tegel = tegels.find((t) => t.thema === "natuur-milieu");
  assert.equal(tegel.artikelen.length, OVERHEID_MAX_LIVE_PER_TEGEL);
});

test("een OFB-concept zou buiten de publicatie-gate vallen (overheidsregime)", () => {
  const alsConcept = {
    id: "x",
    tekst: "Nederlandse tekst.",
    bronnen: [{ naam: "OFB — Office français de la biodiversité", titel: "Kop", url: "https://ofb.gouv.fr/a" }],
  };
  assert.equal(isPersConcept(alsConcept), false, "geen persconcept, dus geen tweekrantenregel");
});

// ---- 5) Registeropname in de rubriek natuur-milieu --------------------------

test("na de live periode landt een OFB-bericht in de rubriek natuur-milieu", () => {
  const record = maakRegisterRecord(ofbDoc(), NU);
  assert.equal(record.rubriek, "natuur-milieu", "de rubriek mag niet terugvallen op wetgeving");
  assert.equal(record.titel, "Nieuwe regels voor zoetwatervissen");
  assert.equal(record.bronNaam, "OFB — Office français de la biodiversité");
  assert.equal(record.status, "actueel");
});

test("de rubriekmap natuur-milieu verschijnt in de publieke weergave", () => {
  const rubrieken = publiekeRubrieken([maakRegisterRecord(ofbDoc(), NU)]);
  const map = rubrieken.find((r) => r.rubriek === "natuur-milieu");
  assert.ok(map, "de rubriekmap hoort in /archief te staan");
  assert.equal(map.items.length, 1);
  assert.equal(map.items[0].bron, "OFB", "de rubrieksuffix van de bronnaam valt weg in het triplet");
  assert.ok(!("tekst" in map.items[0]), "publiek blijft het bij het triplet");
});

// ---- 6) De archieftegel-tekst ----------------------------------------------

test("de archief-tegel verwijst naar het Regelgevingsarchief", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
  assert.ok(
    html.includes("Verlopen nieuwsberichten, blijven hier maximaal 14 dagen staan."),
    "de nieuwe uitlegtekst hoort erin te staan"
  );
  assert.ok(
    html.includes(`<a href="/archief" target="_self">Regelgevingsarchief</a>`),
    "Regelgevingsarchief hoort een link naar /archief te zijn, in hetzelfde iframe (_self, nooit _top)"
  );
  assert.ok(!html.includes("Dit zijn de ‘oude’ artikelen"), "de oude tekst hoort weg te zijn");
});
