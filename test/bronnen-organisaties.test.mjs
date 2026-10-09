// NIHB en Stichting GOED staan als organisatiebron in de verenigingentegel.
//
// Die tegel toont kop, een korte aanhef en een link naar de eigen site van de
// organisatie, zonder samenvatting door het AI-model. Deze toets bewaakt dat de
// twee bronnen er blijven staan, in dat regime, met hun feed en de notitie dat
// de licentie niet is vastgesteld (zie bronnen.json).

import { test } from "node:test";
import assert from "node:assert/strict";
import { laadBronnen, parseerFeed, normaliseerBron } from "../lib/feeds.js";
import { assembleerTegels } from "../lib/tegels.js";

const lijst = () => {
  const b = laadBronnen();
  return Array.isArray(b) ? b : b.bronnen;
};
const NU = Date.parse("2026-10-09T12:00:00Z");
const XML = (host, titel) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title>${titel}</title><link>https://${host}/nieuws/een-bericht/</link><pubDate>Sat, 26 Sep 2026 09:00:00 +0000</pubDate>
<description><![CDATA[<p>Eerste zin van het bericht. Tweede zin die niet in de aanhef hoort.</p>]]></description></item></channel></rss>`;

for (const [naam, host, feed] of [
  ["NIHB", "www.nihb.nl", "https://www.nihb.nl/feed/"],
  ["Stichting GOED", "www.stichtinggoed.nl", "https://www.stichtinggoed.nl/feed/"],
]) {
  test(`${naam} staat als organisatiebron in de verenigingentegel`, () => {
    const bron = lijst().find((b) => b.naam.startsWith(naam));
    assert.ok(bron, "bron ontbreekt");
    assert.equal(bron.feed, feed);
    assert.equal(bron.regime, "verenigingen");
    assert.equal(bron.thema, "verenigingen");
    assert.equal(bron.licentie, "niet vastgesteld", "de licentiestatus hoort eerlijk te staan");
    const { items } = normaliseerBron(parseerFeed(XML(host, "Een bericht")), bron, NU);
    assert.equal(items.length, 1);
    const tegel = assembleerTegels({ items, nu: NU }).find((t) => t.id === "verenigingen");
    assert.ok(tegel, "het bericht hoort in de verenigingentegel te komen");
    const art = tegel.artikelen[0];
    assert.equal(art.url, `https://${host}/nieuws/een-bericht/`, "de link wijst naar de eigen site van de organisatie");
    assert.ok(!art.summary.includes("Tweede zin"), "alleen een korte aanhef, geen samenvatting");
    assert.equal(art.bronnen[0].naam, bron.naam, "de bron wordt genoemd");
  });
}

// --- de zeef geldt voor het hele regime (review PR #55) ------------------------
const ITEM = (host, titel, tekst, pad = "/nieuws/een-bericht/") => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title>${titel}</title><link>https://${host}${pad}</link><pubDate>Sat, 26 Sep 2026 09:00:00 +0000</pubDate>
<description><![CDATA[<p>${tekst}</p>]]></description></item></channel></rss>`;

test("een bericht van NIHB dat naar Facebook of een concurrent verwijst, valt weg en wordt gemeld", () => {
  const bron = lijst().find((b) => b.naam.startsWith("NIHB"));
  const fb = normaliseerBron(parseerFeed(ITEM("www.nihb.nl", "Volg ons", "Meer nieuws vindt u op facebook.com/nihb.")), bron, NU);
  assert.equal(fb.items.length, 0, "een Facebook-verwijzing hoort er niet door te komen");
  assert.equal(fb.geweigerd.length, 1, "de weigering hoort in de bronstatus te staan");
  const conc = normaliseerBron(parseerFeed(ITEM("www.nihb.nl", "Tip", "Lees ook goedinfrankrijk.fr voor meer.")), bron, NU);
  assert.equal(conc.items.length, 0, "een concurrerend platform hoort er niet door te komen");
});

test("een kop over een tarief of de btw wordt bij een organisatie niet als zelfpromotie geweigerd", () => {
  const bron = lijst().find((b) => b.naam.startsWith("Stichting GOED"));
  const r = normaliseerBron(parseerFeed(ITEM("www.stichtinggoed.nl", "Nieuw btw-tarief voor woningen in Frankrijk", "Wat dit betekent voor eigenaren.")), bron, NU);
  assert.equal(r.items.length, 1, "de zelfpromotiezeef is afgestemd op amateuristische verenigingssites");
});
