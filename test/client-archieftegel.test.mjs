// De archieftegel in de pagina: kop, laadstaat en gevulde inhoud.
// ---------------------------------------------------------------------------
// WAAROM DEZE TEST BESTAAT. De archieftegel bevat 86 van de 152 artikelen en
// staat standaard dicht; zijn artikelen komen daarom uit een EIGEN levering die
// pas bij het openen wordt opgehaald. Drie dingen moeten kloppen:
//   1. de kop toont het juiste aantal ("86 artikelen") terwijl die 86 records
//      er nog niet zijn — anders liegt de tegel tegen de lezer;
//   2. tijdens het ophalen staat er een laadstaat, geen lege bak;
//   3. mislukt het ophalen, dan zegt de tegel dat, met een weg terug.
// De functies worden UIT actueel.html gehaald en daar uitgevoerd, niet
// overgeschreven: een test op een kopie zou groen blijven terwijl de pagina
// stuk is.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");

// Het blok met bronHTML .. tegelHTML (tegelHTML zelf inbegrepen).
const begin = html.indexOf("function bronHTML(b){");
const eind = html.indexOf("function leegHTML(){");
assert.ok(begin > 0 && eind > begin, "renderfuncties niet gevonden in actueel.html");
const bron = html.slice(begin, eind);

// De vrije variabelen van dat blok, met de simpelst mogelijke invulling.
function maakRenderer({ teksten = null, tekstStatus = "klaar", archiefArtikelen = null, archiefStatus = "niet-nodig", open = {} } = {}) {
  const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const ico = (n) => `<svg data-ic="${n}"></svg>`;
  const datum = (d) => String(d || "").slice(0, 10);
  const themaIco = () => "ic-thema";
  const meerv = (n) => `${n} ${n === 1 ? "artikel" : "artikelen"}`;
  const CATS = [{ key: "archief", label: "Archief", ic: "ic-archief" }];
  // eslint-disable-next-line no-new-func
  return new Function(
    "esc", "ico", "datum", "artOpen", "teksten", "tekstStatus",
    "archiefArtikelen", "archiefStatus", "open", "themaIco", "meerv", "CATS",
    `${bron}; return tegelHTML;`
  )(esc, ico, datum, {}, teksten, tekstStatus, archiefArtikelen, archiefStatus, open, themaIco, meerv, CATS);
}

const ARCHIEFTEGEL = {
  id: "archief",
  soort: "archief",
  thema: "archief",
  label: "Archief",
  // Wat de compacte levering meestuurt: de telling, en het signaal dat de
  // artikelen apart komen. GEEN artikelenlijst.
  artikelAantal: 86,
  artikelenApart: true,
};

const ARCHIEFARTIKELEN = [
  { id: "a1", soort: "pers", titel: "Ouder bericht", summary: "Samenvatting.", bronMeta: { naam: "Le Monde", datum: "2026-08-20" }, bronAantal: 2 },
  { id: "a2", soort: "pers", titel: "Nog ouder", summary: "Ook een samenvatting.", bronMeta: null, bronAantal: 0 },
];

test("de kop toont het juiste aantal zonder dat de 86 records er zijn", () => {
  const tegelHTML = maakRenderer({ archiefArtikelen: null, archiefStatus: "niet-nodig" });
  const uit = tegelHTML("archief", ARCHIEFTEGEL);
  assert.ok(uit.includes("86 artikelen"), "de kop telt uit artikelAantal");
  assert.ok(uit.includes("<h3>Archief</h3>"), "kop en label blijven");
  assert.ok(uit.includes("archief-intro"), "de introtekst van de archieftegel blijft");
});

test("tijdens het ophalen staat er een laadstaat, geen lege bak", () => {
  const tegelHTML = maakRenderer({ archiefArtikelen: null, archiefStatus: "laden" });
  const uit = tegelHTML("archief", ARCHIEFTEGEL);
  assert.ok(uit.includes("Archief wordt geladen"), "de lezer ziet wat er gebeurt");
  assert.ok(uit.includes("86 artikelen"), "en de kop blijft kloppen");
  assert.ok(!uit.includes("data-art="), "er staat nog geen artikel");
});

test("mislukt het ophalen, dan zegt de tegel dat, met een weg terug", () => {
  const tegelHTML = maakRenderer({ archiefArtikelen: null, archiefStatus: "mislukt" });
  const uit = tegelHTML("archief", ARCHIEFTEGEL);
  assert.ok(uit.includes("kon niet worden geladen"));
  assert.ok(uit.includes("dicht en weer open"), "en hoe je het opnieuw probeert");
  assert.ok(uit.includes("86 artikelen"));
});

test("na het ophalen staan de artikelen er, met hun tekst en bronnen", () => {
  const tegelHTML = maakRenderer({
    archiefArtikelen: ARCHIEFARTIKELEN,
    archiefStatus: "klaar",
    teksten: {
      "archief/a1": {
        tekst: "Eerste alinea.\n\nTweede alinea.",
        bronnen: [
          { naam: "Le Monde", titel: "Un", url: "https://www.lemonde.fr/un", datum: "2026-08-20" },
          { naam: "Le Figaro", titel: "Deux", url: "https://www.lefigaro.fr/deux", datum: "2026-08-20" },
        ],
      },
      "archief/a2": { tekst: "Losse tekst.", bronnen: [] },
    },
  });
  const uit = tegelHTML("archief", ARCHIEFTEGEL);

  assert.ok(uit.includes("<p>Eerste alinea.</p>"));
  assert.ok(uit.includes("<p>Tweede alinea.</p>"));
  assert.ok(uit.includes('class="bronknop" data-bron="archief/a1"'), "werkende bronnenknop");
  assert.ok(uit.includes("Bronnen (2)"));
  assert.ok(uit.includes('href="https://www.lemonde.fr/un"'), "de bronlink werkt");
  assert.ok(uit.includes("Geen externe bron"), "en het artikel zonder bronnen houdt zijn regel");
  assert.ok(!uit.includes("Archief wordt geladen"), "geen laadstaat meer");
  assert.ok(uit.includes("86 artikelen"), "de kop blijft uit artikelAantal komen");
});

test("een gewone tegel is onveranderd: artikelen meteen mee, telling uit de lijst", () => {
  const tegelHTML = maakRenderer({
    teksten: { "overheid-douane/x1": { tekst: "Tekst.", bronnen: [] } },
  });
  const uit = tegelHTML("archief", {
    id: "overheid-douane",
    soort: "overheid",
    label: "Douane",
    artikelAantal: 1,
    artikelen: [{ id: "x1", soort: "overheid", titel: "T", summary: "S.", bronMeta: null, bronAantal: 0 }],
  });
  assert.ok(uit.includes("1 artikel<"), "enkelvoud in de kop");
  assert.ok(uit.includes("<p>Tekst.</p>"), "de artikelen staan er meteen");
  assert.ok(!uit.includes("Archief wordt geladen"));
});

test("een oudere compacte levering zonder artikelAantal telt gewoon de lijst", () => {
  // Vlak na een deploy kan een browser nog een antwoord van vóór deze wijziging
  // hebben liggen (max-age=120). De kop mag dan niet leeg of nul worden.
  const tegelHTML = maakRenderer({ teksten: {} });
  const uit = tegelHTML("archief", {
    id: "pers-landelijk",
    soort: "pers",
    label: "Landelijk",
    artikelen: [
      { id: "p1", soort: "pers", titel: "A", summary: "a", bronAantal: 0 },
      { id: "p2", soort: "pers", titel: "B", summary: "b", bronAantal: 0 },
    ],
  });
  assert.ok(uit.includes("2 artikelen"));
});
