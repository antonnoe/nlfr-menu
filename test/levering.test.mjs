// De splitsing in twee leveringen: wat gaat waarheen, en gaat er niets verloren?
// ---------------------------------------------------------------------------
// De belofte van de splitsing is dat de PAGINA niet verandert, alleen het
// moment waarop de bytes over de lijn gaan. Deze test legt dat vast op de enige
// plek waar het te controleren is: de twee leveringen samen moeten het
// volledige antwoord weer opleveren, en de compacte levering moet precies die
// twee dingen bevatten die de dichte staat toont.

import test from "node:test";
import assert from "node:assert/strict";

import { splitsAntwoord, artikelSleutel, isArchiefTegel } from "../lib/levering.js";

function volAntwoord() {
  return {
    bijgewerkt: "2026-08-28T18:00:00.000Z",
    gebakkenOp: "2026-08-28T18:00:00.000Z",
    agenda: [{ datum: "2026-09-01", titel: "Borrel" }],
    bronStatus: [{ naam: "Le Monde", ok: true, aantal: 4 }],
    tegels: [
      {
        id: "overheid-douane",
        soort: "overheid",
        thema: "douane",
        label: "Douane",
        artikelen: [
          {
            id: "a1",
            soort: "overheid",
            titel: "Nieuwe drempel",
            summary: "Eerste zin.",
            tekst: "Eerste zin.\n\nTweede alinea met meer tekst.",
            url: "https://www.douane.gouv.fr/a1",
            bronnen: [
              { naam: "Douane", titel: "Seuil", url: "https://www.douane.gouv.fr/a1", datum: "2026-08-27" },
            ],
          },
        ],
      },
      {
        id: "pers-landelijk",
        soort: "pers",
        label: "Landelijk",
        artikelen: [
          {
            id: "p1",
            soort: "pers",
            titel: "Synthese",
            summary: "Kort.",
            tekst: "Lange synthesetekst.",
            datum: "2026-08-28T09:00:00.000Z",
            bronnen: [
              { naam: "Le Monde", titel: "Un", url: "https://www.lemonde.fr/un", datum: "2026-08-28" },
              { naam: "Le Figaro", titel: "Deux", url: null, urlGeweigerd: "vreemde host" },
            ],
          },
          { id: "p2", soort: "pers", titel: "Zonder bronnen", summary: "S.", tekst: "T.", bronnen: [] },
        ],
      },
      {
        id: "archief",
        soort: "archief",
        label: "Archief",
        artikelen: [
          {
            id: "p1", // zelfde id als in pers-landelijk: de oude versie
            soort: "pers",
            titel: "Synthese",
            summary: "Kort.",
            tekst: "OUDE synthesetekst.",
            bronnen: [{ naam: "Le Monde", titel: "Un", url: "https://www.lemonde.fr/un", datum: "2026-08-20" }],
          },
          { id: "o1", soort: "pers", titel: "Ouder bericht", summary: "O.", tekst: "Oud.", bronnen: [] },
        ],
      },
    ],
  };
}

test("geen enkel compact artikel draagt tekst of een bronnen-array mee", () => {
  const { compact, archief } = splitsAntwoord(volAntwoord());
  // De archieftegel heeft in de compacte levering helemaal geen artikelenlijst
  // meer; zijn artikelen staan in de derde levering en moeten daar even compact
  // zijn.
  const alle = [
    ...compact.tegels.flatMap((t) => t.artikelen || []),
    ...archief.artikelen,
  ];
  assert.equal(alle.length, 5, "drie buiten het archief plus twee erin");
  for (const a of alle) {
    assert.equal("tekst" in a, false, `${a.id} draagt nog tekst mee`);
    assert.equal("bronnen" in a, false, `${a.id} draagt nog een bronnen-array mee`);
    assert.equal(typeof a.bronAantal, "number");
    assert.ok("bronMeta" in a);
  }
});

test("de compacte levering houdt alles wat de dichte staat toont", () => {
  const { compact } = splitsAntwoord(volAntwoord());
  const a = compact.tegels[0].artikelen[0];
  assert.equal(a.id, "a1");
  assert.equal(a.titel, "Nieuwe drempel");
  assert.equal(a.summary, "Eerste zin.");
  assert.equal(a.soort, "overheid");
  assert.equal(a.url, "https://www.douane.gouv.fr/a1");
  // De onderregel: naam + datum van de EERSTE bron.
  assert.deepEqual(a.bronMeta, { naam: "Douane", datum: "2026-08-27" });
  // Het getal op de knop "Bronnen (n)".
  assert.equal(a.bronAantal, 1);

  // Tegel- en antwoordvelden blijven ongemoeid.
  assert.equal(compact.tegels[0].label, "Douane");
  assert.deepEqual(compact.agenda, volAntwoord().agenda);
  assert.deepEqual(compact.bronStatus, volAntwoord().bronStatus);
  assert.equal(compact.bijgewerkt, "2026-08-28T18:00:00.000Z");
});

test("bronMeta neemt de eerste bron, bronAantal telt ze allemaal", () => {
  const { compact } = splitsAntwoord(volAntwoord());
  const p1 = compact.tegels[1].artikelen[0];
  assert.deepEqual(p1.bronMeta, { naam: "Le Monde", datum: "2026-08-28" });
  assert.equal(p1.bronAantal, 2, "ook de bron met een geweigerde URL telt mee");
});

test("een artikel zonder bronnen krijgt bronMeta null en bronAantal 0", () => {
  const { compact } = splitsAntwoord(volAntwoord());
  const p2 = compact.tegels[1].artikelen[1];
  assert.equal(p2.bronMeta, null);
  assert.equal(p2.bronAantal, 0);
});

test("de tekst-levering bevat elk niet-archiefartikel, op sleutel tegelId/artikelId", () => {
  const { tekst } = splitsAntwoord(volAntwoord());
  assert.deepEqual(Object.keys(tekst.artikelen).sort(), [
    "overheid-douane/a1",
    "pers-landelijk/p1",
    "pers-landelijk/p2",
  ]);
  const a1 = tekst.artikelen[artikelSleutel("overheid-douane", "a1")];
  assert.equal(a1.tekst, "Eerste zin.\n\nTweede alinea met meer tekst.");
  assert.deepEqual(a1.bronnen, volAntwoord().tegels[0].artikelen[0].bronnen);
  // De geweigerde URL en de reden blijven staan — daar toetst de sonde op.
  const p1 = tekst.artikelen["pers-landelijk/p1"];
  assert.equal(p1.bronnen[1].url, null);
  assert.equal(p1.bronnen[1].urlGeweigerd, "vreemde host");
});

test("de drie leveringen samen zijn weer het volledige antwoord", () => {
  const vol = volAntwoord();
  const { compact, tekst, archief } = splitsAntwoord(vol);
  const teksten = { ...tekst.artikelen, ...archief.teksten };
  const vul = (tegelId, a) => {
    const { bronMeta, bronAantal, ...rest } = a;
    const extra = teksten[artikelSleutel(tegelId, a.id)];
    return { ...rest, tekst: extra.tekst, bronnen: extra.bronnen };
  };
  const hersteld = {
    ...compact,
    tegels: compact.tegels.map((t) => {
      const { artikelAantal, artikelenApart, ...rest } = t;
      const lijst = artikelenApart ? archief.artikelen : t.artikelen;
      return { ...rest, artikelen: lijst.map((a) => vul(t.id, a)) };
    }),
  };
  assert.deepEqual(hersteld, vol, "niets verloren, niets veranderd");
});

test("de archieftegel gaat zonder artikelenlijst mee, mét een kloppende telling", () => {
  const { compact, archief } = splitsAntwoord(volAntwoord());
  const tegel = compact.tegels.find((t) => t.id === "archief");
  assert.equal("artikelen" in tegel, false, "de 86 records gaan niet mee");
  assert.equal(tegel.artikelAantal, 2, "maar de kop weet hoeveel het er zijn");
  assert.equal(tegel.artikelenApart, true, "en de pagina weet dat ze apart komen");
  assert.equal(tegel.label, "Archief", "kop en accent blijven");
  assert.equal(tegel.soort, "archief");
  assert.equal(archief.artikelen.length, tegel.artikelAantal, "levering en telling lopen gelijk");
  assert.equal(archief.tegelId, "archief");
});

test("de tekst-levering bevat GEEN archiefartikelen meer", () => {
  const { tekst, archief } = splitsAntwoord(volAntwoord());
  assert.deepEqual(Object.keys(tekst.artikelen).sort(), [
    "overheid-douane/a1",
    "pers-landelijk/p1",
    "pers-landelijk/p2",
  ]);
  assert.deepEqual(Object.keys(archief.teksten).sort(), ["archief/o1", "archief/p1"]);
});

test("dezelfde synthese in de live-tegel en in het archief blijft uit elkaar", () => {
  // Op het kale artikel-id zouden deze twee elkaar overschrijven; op
  // tegelId/artikelId niet.
  const { tekst, archief } = splitsAntwoord(volAntwoord());
  assert.equal(tekst.artikelen["pers-landelijk/p1"].tekst, "Lange synthesetekst.");
  assert.equal(archief.teksten["archief/p1"].tekst, "OUDE synthesetekst.");
});

test("elke tegel met een artikelenlijst draagt een kloppend artikelAantal", () => {
  const { compact } = splitsAntwoord(volAntwoord());
  for (const t of compact.tegels) {
    if (t.artikelenApart) continue;
    assert.equal(t.artikelAantal, t.artikelen.length, `tegel ${t.id}`);
  }
});

test("alle drie de leveringen dragen hetzelfde bakmoment", () => {
  const { compact, tekst, archief } = splitsAntwoord(volAntwoord());
  assert.equal(tekst.gebakkenOp, compact.gebakkenOp);
  assert.equal(archief.gebakkenOp, compact.gebakkenOp);
  assert.equal(tekst.bijgewerkt, compact.bijgewerkt);
  assert.equal(archief.bijgewerkt, compact.bijgewerkt);
});

test("de archieftegel wordt op id én op soort herkend", () => {
  // Zo schakelt een hernoeming van één van de twee de splitsing niet stil uit.
  assert.equal(isArchiefTegel({ id: "archief", soort: "pers" }), true);
  assert.equal(isArchiefTegel({ id: "oud-nieuws", soort: "archief" }), true);
  assert.equal(isArchiefTegel({ id: "pers-landelijk", soort: "pers" }), false);
  assert.equal(isArchiefTegel(null), false);
});

test("splitsen laat het oorspronkelijke antwoord ongemoeid", () => {
  const vol = volAntwoord();
  splitsAntwoord(vol);
  assert.deepEqual(vol, volAntwoord());
});

test("een tegel zonder artikelen overleeft de splitsing", () => {
  const { compact, tekst, archief } = splitsAntwoord({
    bijgewerkt: "x",
    tegels: [{ id: "links", soort: "links", label: "Links" }],
  });
  assert.deepEqual(compact.tegels[0], { id: "links", soort: "links", label: "Links" });
  assert.deepEqual(tekst.artikelen, {});
  // Geen archieftegel -> een lege archieflevering, geen ontbrekende.
  assert.deepEqual(archief.artikelen, []);
  assert.deepEqual(archief.teksten, {});
  assert.equal(archief.tegelId, null);
});

