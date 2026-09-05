// De kwaliteitszeef op de verenigingenfeed, gemeten tegen de ECHTE feed.
// ---------------------------------------------------------------------------
// WAAROM DEZE TEST BESTAAT. De verenigingenkalender bundelt de sites van
// Nederlandse verenigingen in Frankrijk: WordPress-installaties van
// uiteenlopende ouderdom. Wat daar uit komt is niet stuk, maar wel rommelig —
// aankondigingen die maanden na de activiteit blijven staan, samenvattingen die
// midden in een woord ophouden, en berichten die een concurrerend platform
// navertellen. Uitgangspunt: liever een item niet tonen dan half tonen.
//
// DE INVOER IS DE ECHTE FEED, ongewijzigd overgenomen in
// test/fixtures/verenigingen-nieuws.json (27 items, 4 september 2026). Een zeef
// die alleen tegen verzonnen items wordt getoetst, meet de fantasie van degene
// die hem schreef. Twee fouten in deze zeef zijn met precies deze 27 items
// gevonden en zouden met verzonnen invoer zijn blijven staan:
//   1. "NATIONALITEITOp donderdag" werd niet gerepareerd, omdat het herstel twee
//      kleine letters na de hoofdletter eiste en "Op" er maar één heeft;
//   2. een keurige zin werd geweigerd als "eindigt op een losse hoofdletter",
//      terwijl die hoofdletter er stond doordat ONZE EIGEN inkorting midden in
//      "Atelier Néerlandais" landde.
//
// DE TEGENKANT IS NET ZO BELANGRIJK. Een zeef die zichzelf overschat gooit het
// verenigingsnieuws leeg, en dat merkt niemand — er staat dan gewoon minder.
// Daarom staat hier ook vast wat er NIET weg mag: items zonder herkenbare datum,
// en een handleiding met een byline uit 2017.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseerJsonVerenigingen, normaliseerBron, laadBronnen } from "../lib/feeds.js";
import { assembleerTegels, eersteZin } from "../lib/tegels.js";
import {
  activiteitDatum,
  verstreken,
  herstelSpaties,
  afgekapt,
  teaser,
  uitgesloten,
  kortAf,
} from "../lib/verenigingen.js";
import { CONCURRENTEN, SOCIALE_NETWERKEN, zoekUitsluiting } from "../lib/uitsluitlijst.js";

const feed = JSON.parse(
  readFileSync(new URL("./fixtures/verenigingen-nieuws.json", import.meta.url), "utf8")
);
// De dag waarop deze uitkomsten zijn gemeten. Vast, want "vandaag" zou deze
// test elke dag een andere zijn.
const NU = Date.parse("2026-09-05T12:00:00Z");
const bron = laadBronnen().find((b) => b.type === "json-verenigingen");
const alsItem = (it) => ({ titel: it.titel, samenvatting: it.excerpt || "", url: it.link, datum: it.datum });
const zoek = (fragment) => feed.items.find((i) => i.titel.includes(fragment));

// ---- 1. Verstreken activiteiten --------------------------------------------

test("de feed levert 17 items met een herkenbare datum en 10 zonder", () => {
  // Het getal zelf is minder belangrijk dan de verhouding: herkent de zeef
  // ineens bijna alles, of bijna niets, dan is er iets veranderd aan de
  // datumherkenning en hoort iemand daarnaar te kijken.
  let met = 0;
  let zonder = 0;
  for (const it of feed.items) {
    if (activiteitDatum(alsItem(it), Date.parse(it.datum)) === null) zonder += 1;
    else met += 1;
  }
  assert.equal(met + zonder, 27, "de fixture hoort 27 items te hebben");
  assert.equal(met, 17);
  assert.equal(zonder, 10);
});

test("de laatste datum uit een reeks telt, niet de eerste", () => {
  // Een expositie van 1 tot en met 31 oktober is op 2 oktober niet verstreken.
  const it = alsItem(zoek("Parcours Bijoux"));
  assert.equal(
    new Date(activiteitDatum(it, Date.parse(it.datum))).toISOString().slice(0, 10),
    "2026-10-31"
  );
  assert.equal(verstreken(it, Date.parse("2026-10-02T12:00:00Z"), Date.parse(it.datum)), false);
  assert.equal(verstreken(it, Date.parse("2026-11-02T12:00:00Z"), Date.parse(it.datum)), true);
});

test("een activiteit is op de dag zelf nog actueel, pas de dag erna verstreken", () => {
  const it = alsItem(zoek("Zondag 1 november"));
  const anker = Date.parse(it.datum);
  assert.equal(verstreken(it, Date.parse("2026-11-01T23:00:00Z"), anker), false, "op de dag zelf");
  assert.equal(verstreken(it, Date.parse("2026-11-02T09:00:00Z"), anker), true, "de dag erna");
});

test("een verslag ACHTERAF krijgt het jaar van de publicatie, niet het jaar erop", () => {
  // "Op 19 juli organiseerde …", gepubliceerd op 26 juli. Alleen vooruit kijken
  // zou hier juli 2027 opleveren en het item een jaar lang laten staan.
  const it = alsItem(zoek("Rondleiding Cité des Présents"));
  assert.equal(
    new Date(activiteitDatum(it, Date.parse(it.datum))).toISOString().slice(0, 10),
    "2026-07-19"
  );
  assert.equal(verstreken(it, NU, Date.parse(it.datum)), true);
});

test("een Franse maandnaam telt net zo goed", () => {
  const it = alsItem(zoek("Exposition 17-19 juillet"));
  assert.equal(
    new Date(activiteitDatum(it, Date.parse(it.datum))).toISOString().slice(0, 10),
    "2026-07-19"
  );
});

test("een byline uit 2017 is geen activiteitsdatum", () => {
  // "door Rob van der Meulen | jun 26, 2017" — afgekorte maand, en de maand
  // staat vóór de dag. Zou de zeef dit als datum lezen, dan verdween een
  // bruikbare handleiding over bouwvergunningen van de pagina.
  const it = alsItem(zoek("Melding, bouwvergunning"));
  assert.equal(activiteitDatum(it, Date.parse(it.datum)), null);
  assert.equal(verstreken(it, NU, Date.parse(it.datum)), false, "en hij blijft dus gewoon staan");
});

test("geen herkenbare datum betekent tonen, niet verbergen", () => {
  for (const fragment of ["De vos doden", "Et Voilà", "Zonnepanelen", "Bosbranden in de regio"]) {
    const it = alsItem(zoek(fragment));
    assert.equal(activiteitDatum(it, Date.parse(it.datum)), null, fragment);
    assert.equal(verstreken(it, NU, Date.parse(it.datum)), false, fragment);
  }
});

// ---- 2. Afgekapte en aaneengeplakte samenvattingen -------------------------

test('"NATIONALITEITOp donderdag" wordt uit elkaar gehaald', () => {
  const ruw = zoek("Dubbele nationaliteit").excerpt;
  assert.ok(ruw.includes("NATIONALITEITOp"), "de fixture bevat het gemeten geval nog");
  assert.ok(herstelSpaties(ruw).includes("NATIONALITEIT Op donderdag"));
});

test("herstel blijft van gewone woorden af", () => {
  for (const woord of ["YouTube", "McDonald's", "IJsselstein", "iPhone", "NVLR", "Kerk+YouTube"]) {
    assert.equal(herstelSpaties(woord), woord, woord);
  }
  assert.equal(herstelSpaties("veranderd.Voor bestaande"), "veranderd. Voor bestaande");
});

test("een teaser die op een afkorting eindigt, gaat eruit", () => {
  // "Voorganger: ds. Ruth van der Waall-Schaeffer Ouderling…" — de eerste zin is
  // letterlijk "Voorganger: ds." en dat zegt de lezer niets.
  const t = teaser(zoek("Zondag 1 november").excerpt, eersteZin);
  assert.equal(t.tekst, "", "alleen de titel dus");
  assert.match(t.reden, /afkorting "ds\."/);
  assert.match(teaser(zoek("Zondag 4 oktober").excerpt, eersteZin).reden, /afkorting "nnb\."/);
});

test("een teaser zonder leesbare zin gaat er ook uit", () => {
  // Excerpt begint met "1. Van druif naar most": de eerste zin is "1.".
  const t = teaser(zoek("Van druif tot fles").excerpt, eersteZin);
  assert.equal(t.tekst, "");
  assert.equal(t.reden, "bevat geen leesbare zin");
});

test("de drie vormen uit de afspraak, los getoetst", () => {
  assert.match(afgekapt("Voorganger: ds."), /afkorting/);
  assert.equal(afgekapt("Het programma bestaat uit:"), "eindigt op een dubbele punt");
  assert.equal(afgekapt("Een lezing door mevrouw J."), "eindigt op een losse hoofdletter");
  assert.equal(afgekapt("Et Voilà nummer 02 is uit!"), null, "een hele zin blijft staan");
});

test("onze eigen inkorting maakt van een goede zin geen afgekapte", () => {
  // GEMETEN FOUT. De zin liep door tot "… in Atelier Néerlandais in Parijs.",
  // maar werd op teken 150 afgeknipt tot "… in Atelier N…" en daarna geweigerd
  // als "losse hoofdletter". De zin was niets mis mee; de schaar was van ons.
  const t = teaser(zoek("FOTODOK").excerpt, eersteZin);
  assert.notEqual(t.tekst, "", `onterecht geweigerd: ${t.reden}`);
  assert.ok(!/\s[A-Z]…$/.test(t.tekst), `eindigt alsnog op een losse hoofdletter: ${t.tekst}`);
  assert.ok(t.tekst.startsWith("Van 6 t/m 15 november presenteert FOTODOK"));
});

test("inkorten gebeurt op een woordgrens", () => {
  const lang = "Van 6 tot en met 15 november presenteert FOTODOK de groepstentoonstelling A Wider Gaze in Atelier Néerlandais in Parijs, vlak voor Paris Photo";
  const kort = kortAf(lang, 60);
  assert.ok(kort.length <= 61, kort);
  assert.ok(kort.endsWith("…"));
  assert.ok(!/\S…$/.test(kort.replace(/\s\S+…$/, "x…")) || /\s/.test(kort), kort);
  assert.ok(lang.startsWith(kort.slice(0, -1)), "de tekst is niet veranderd, alleen ingekort");
});

// ---- 3. Uitsluitlijst -------------------------------------------------------

test("de lijst begint met de twee afgesproken platforms", () => {
  assert.ok(CONCURRENTEN.includes("goedinfrankrijk.fr"));
  assert.ok(CONCURRENTEN.includes("frankrijkactueel.nl"));
  assert.ok(SOCIALE_NETWERKEN.some((t) => t.includes("facebook")));
});

test("een bericht dat een concurrerend platform noemt, valt volledig weg", () => {
  // Gemeten geval: een LOTgenoten-bericht dat begint met "Door: goedinfrankrijk.fr".
  const it = alsItem(zoek("Opnieuw tropische temperaturen"));
  assert.match(uitgesloten(it), /goedinfrankrijk\.fr/);
});

test("de naam wegknippen is niet genoeg — het hele bericht gaat eruit", () => {
  const { items, geweigerd } = normaliseerBron(
    parseerJsonVerenigingen(feed), bron, NU
  );
  assert.ok(!items.some((i) => i.titel.includes("Opnieuw tropische temperaturen")),
    "het bericht hoort niet in de items te staan");
  assert.ok(geweigerd.some((g) => /goedinfrankrijk\.fr/.test(g.reden)),
    "en het hoort met reden in de weigeringen te staan");
});

test("Facebook telt ook, in de tekst én in de link", () => {
  assert.match(uitgesloten({ titel: "Kom naar onze avond", samenvatting: "Meld je aan via Facebook.", url: "https://vereniging.fr/avond" }), /sociaal netwerk/);
  assert.match(uitgesloten({ titel: "Kom naar onze avond", samenvatting: "Meld je aan.", url: "https://www.facebook.com/events/123" }), /sociaal netwerk/);
  assert.equal(uitgesloten({ titel: "Kom naar onze avond", samenvatting: "Meld je aan.", url: "https://vereniging.fr/avond" }), null);
});

test("de lijst is hoofdletter- en accentongevoelig", () => {
  assert.ok(zoekUitsluiting("zie GoedInFrankrijk.FR voor meer"));
  assert.ok(zoekUitsluiting("via FACEBOOK.com"));
});

test("een naam die er niet in staat, weert niets", () => {
  assert.equal(zoekUitsluiting("nederlanders.fr en infofrankrijk.com"), null);
});

// ---- De hele keten, met de echte feed --------------------------------------

test("de zeef weigert niets stil: elke weigering draagt een reden", () => {
  const { geweigerd } = normaliseerBron(parseerJsonVerenigingen(feed), bron, NU);
  assert.ok(geweigerd.length > 0, "er hoort in deze feed iets geweigerd te worden");
  for (const g of geweigerd) {
    assert.ok(g.reden && g.reden.length > 5, `weigering zonder bruikbare reden: ${JSON.stringify(g)}`);
    assert.ok(g.titel, "en zonder titel is een weigering niet na te trekken");
  }
  // De drie die op 5 september 2026 binnen het feedvenster afvallen.
  const redenen = geweigerd.map((g) => g.reden).sort();
  assert.deepEqual(redenen, [
    "activiteit is verstreken",
    "activiteit is verstreken",
    "concurrerend platform genoemd: goedinfrankrijk.fr",
  ]);
});

test("de tegel houdt alleen over wat de lezer iets zegt", () => {
  const { items } = normaliseerBron(parseerJsonVerenigingen(feed), bron, NU);
  const tegel = assembleerTegels({ items, nu: NU }).find((t) => t.id === "verenigingen");
  assert.ok(tegel, "de verenigingentegel bestaat");

  // Niets verstreken, niets uitgesloten.
  for (const a of tegel.artikelen) {
    assert.ok(!/Dubbele nationaliteit|Caunes-Minervois|tropische temperaturen/.test(a.titel), a.titel);
  }
  // Een lege teaser betekent "alleen de titel" — en dan mag de titel er niet
  // ook nog eens als onderregel onder staan.
  for (const a of tegel.artikelen) {
    assert.notEqual(a.summary, a.titel, `titel dubbel op het scherm: ${a.titel}`);
  }
  // Vier van de twaalf tonen alleen hun titel; de rest heeft een hele zin.
  const zonder = tegel.artikelen.filter((a) => !a.summary);
  assert.equal(zonder.length, 4);
  for (const a of tegel.artikelen) {
    if (a.summary) assert.equal(afgekapt(a.summary), null, `halve zin doorgelaten: ${a.summary}`);
  }
});
