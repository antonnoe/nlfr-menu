// Nederlandstalige overheidsbronnen gaan buiten het AI-model om.
//
// De keten voor overheidsberichten bestaat om een FRANSE tekst in het
// Nederlands samen te vatten. Bij rijksoverheid.nl valt er niets te vertalen:
// kop en samenvatting staan al in het Nederlands in de feed. Een model
// erlangs sturen zou betalen om Nederlands in Nederlands om te zetten, en het
// zou het enige punt in die keten zijn waar iets verzonnen KAN worden.
//
// Woordelijk overnemen mag alleen bij een licentie die dat toestaat. Die eis
// staat hieronder als harde toets: geen licentie in bronnen.json, dan hoort de
// bron niet in deze route thuis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { overheidUitFeed } from "../lib/synthese.js";
import {
  OVERHEID_THEMAS, OVERHEID_THEMA_LABEL, IF_CATEGORIE_PER_THEMA,
  MAX_OVERHEID_PER_RONDE, MAX_OVERHEID_NL_PER_RONDE,
} from "../lib/config.js";

const bronnen = JSON.parse(readFileSync(new URL("../bronnen.json", import.meta.url), "utf8")).bronnen;

test("de feedtekst wordt woordelijk overgenomen, zonder model", () => {
  const r = overheidUitFeed({
    titel: "Nieuwe regels voor rijbewijzen in het buitenland",
    samenvatting: "Vanaf 1 januari verandert de omwisselprocedure.",
  });
  assert.equal(r.kop, "Nieuwe regels voor rijbewijzen in het buitenland");
  assert.equal(r.samenvatting, "Vanaf 1 januari verandert de omwisselprocedure.");
  assert.equal(r.model, null, "er hoort geen model aan te pas te komen");
});

test("HTML en entiteiten uit de feed worden opgeruimd", () => {
  const r = overheidUitFeed({
    titel: "Kabinet &amp; Kamer eens over  regeling",
    samenvatting: "<p>Er komt een <strong>overgangstermijn</strong>.</p>\n<p>Details volgen.</p>",
  });
  assert.equal(r.kop, "Kabinet & Kamer eens over regeling");
  assert.equal(r.samenvatting, "Er komt een overgangstermijn. Details volgen.");
});

test("zonder samenvatting blijft de kop over — er wordt niets bij verzonnen", () => {
  const r = overheidUitFeed({ titel: "Korte mededeling" });
  assert.equal(r.samenvatting, "Korte mededeling");
  assert.equal(r.model, null);
});

// DE VANGRAIL. Woordelijk overnemen zonder licentie is een auteursrechtelijk
// probleem, geen smaakkwestie. Deze toets is de reden dat het veld bestaat.
test("elke Nederlandstalige overheidsbron heeft een licentie vastgelegd", () => {
  const zonder = bronnen
    .filter((b) => b.taal === "nl" && b.regime === "overheid")
    .filter((b) => !b.licentie);
  assert.deepEqual(zonder.map((b) => b.naam), [],
    "een NL-overheidsbron wordt woordelijk overgenomen; dat mag alleen met een vastgelegde licentie");
});

test("de cron kiest op taal, niet op bronnaam", () => {
  const cron = readFileSync(new URL("../api/cron.js", import.meta.url), "utf8");
  assert.ok(cron.includes('item.taal === "nl"'), "de keuze hoort op de taal van de bron te vallen");
  assert.ok(cron.includes("overheidUitFeed"), "de modelvrije route hoort aangeroepen te worden");
});

test("feeds.js geeft de taal van de bron door aan het item", () => {
  const feeds = readFileSync(new URL("../lib/feeds.js", import.meta.url), "utf8");
  assert.ok(/taal:\s*bron\.taal/.test(feeds),
    "zonder doorgegeven taal kan de cron de keuze niet maken");
});

// De twee tellers mogen elkaar niet opeten: een drukke Rijksoverheid-dag mag
// niet de plekken opsouperen die voor de Franse vertaalslag bedoeld zijn.
test("de modelvrije route heeft een eigen rondelimiet", () => {
  assert.ok(MAX_OVERHEID_NL_PER_RONDE > 0);
  assert.notEqual(MAX_OVERHEID_NL_PER_RONDE, MAX_OVERHEID_PER_RONDE);
  const cron = readFileSync(new URL("../api/cron.js", import.meta.url), "utf8");
  assert.ok(cron.includes("MAX_OVERHEID_NL_PER_RONDE"));
  assert.ok(cron.includes("nieuwOverheidNL"));
});

test("het thema nl-overheid is overal ingehangen", () => {
  assert.ok(OVERHEID_THEMAS.includes("nl-overheid"));
  assert.equal(OVERHEID_THEMA_LABEL["nl-overheid"], "Nederlandse overheid");
  assert.ok(Array.isArray(IF_CATEGORIE_PER_THEMA["nl-overheid"]));
  const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
  assert.ok(html.includes('"nl-overheid":"ic-'), "geen pictogram voor nl-overheid");
});

test("de Rijksoverheid-bron staat erin, met feed, taal en licentie", () => {
  const b = bronnen.find((x) => x.thema === "nl-overheid" && x.actief);
  assert.ok(b, "geen actieve bron met thema nl-overheid");
  assert.equal(b.taal, "nl");
  assert.equal(b.regime, "overheid");
  assert.ok(b.licentie);
  // De query is verplicht en moet beide velden bevatten; met alleen "filters"
  // antwoordt de server met een 400.
  assert.ok(b.feed.includes("/api/rss?query="));
  const query = decodeURIComponent(new URL(b.feed).searchParams.get("query") || "");
  const ontleed = JSON.parse(query);
  assert.ok(Array.isArray(ontleed.filters), "query mist het veld filters");
  assert.equal(typeof ontleed.resultSearchTerm, "string", "query mist resultSearchTerm");
});
