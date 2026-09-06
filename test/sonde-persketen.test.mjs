// De twee invarianten die de storing van 6 september wél hadden gemeld.
// ---------------------------------------------------------------------------
// WAT ER MISGING. Alle perstegels ontbraken op /actueel, de reviewtool stond op
// nul concepten en er was sinds 4 september 16:12 geen concept meer aangemaakt.
// De sonde was groen. Dat kon, omdat elke invariant tot dan toe naar de VORM
// keek van wat er stond — klopt de bronlink, klopt de datum, dekken de drie
// leveringen elkaar — en omdat I1 pas afgaat als de héle pagina leeg is. Zeven
// gevulde overheidstegels hielden dat getal ruim boven nul.
//
// I14 en I15 kijken naar wat er NIET staat:
//   I14 — een tegel die deze week nog gevuld was, staat nu op nul (of ontbreekt).
//   I15 — meer dan een etmaal geen concept, terwijl er persartikelen binnenkomen.
//
// De sonde draait hier als echt proces tegen een lokale server. Geen nagedane
// logica: dit is het script dat in GitHub Actions draait.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

import { CONCEPT_STILTE_MAX_UREN, TEGEL_VULLING_VENSTER_DAGEN } from "../lib/config.js";

const NU = Date.now();
const gelegen = (ms) => new Date(NU - ms).toISOString();
const UUR = 3600e3;
const DAG = 24 * UUR;

// Een levering met één gevulde perstegel. De velden zijn die van
// lib/levering.js; alleen wat de twee nieuwe invarianten raakt doet ertoe.
function levering({ persArtikelen, bewaking }) {
  const artikelen = [];
  for (let i = 0; i < persArtikelen; i += 1) {
    artikelen.push({
      id: `a${i}`,
      soort: "pers",
      titel: `Franse regering kondigt maatregel ${i} aan`,
      summary: "Een korte samenvatting.",
      url: "https://www.lemonde.fr/politique/article/2026/09/06/iets.html",
      datum: gelegen(2 * UUR),
      bronMeta: { naam: "Le Monde", datum: gelegen(2 * UUR) },
      bronAantal: 2,
    });
  }
  const tegels = [];
  if (persArtikelen > 0) {
    tegels.push({
      soort: "pers",
      id: "pers-landelijk",
      thema: "landelijk",
      label: "Landelijk nieuws",
      artikelen,
      artikelAantal: artikelen.length,
    });
  }
  return {
    compact: { bijgewerkt: gelegen(0), gebakkenOp: gelegen(0), tegels, agenda: [], bronStatus: [], bewaking },
    tekst: {
      bijgewerkt: gelegen(0),
      gebakkenOp: gelegen(0),
      artikelen: Object.fromEntries(
        artikelen.map((a) => [`pers-landelijk/${a.id}`, { tekst: "Tekst van het bericht.", bronnen: [] }])
      ),
    },
    archief: { bijgewerkt: gelegen(0), gebakkenOp: gelegen(0), tegelId: null, artikelen: [], teksten: {} },
  };
}

async function draaiSonde(vorm) {
  const stukken = levering(vorm);
  const server = http.createServer((req, res) => {
    const pad = req.url.split("?")[0];
    const body =
      pad === "/api/actueel" ? stukken.compact
      : pad === "/api/actueel-tekst" ? stukken.tekst
      : pad === "/api/actueel-archief" ? stukken.archief
      : pad === "/actueel.json" ? { kaarten: [{ titel: "x", url: "https://www.nederlanders.fr/" }] }
      : null;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body || {}));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await new Promise((klaar) => {
      const kind = spawn(process.execPath, ["scripts/sonde.mjs"], {
        env: { ...process.env, SONDE_URL: url, SONDE_WEBHOOK_URL: "", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
      });
      let uit = "";
      kind.stdout.on("data", (c) => (uit += c));
      kind.stderr.on("data", (c) => (uit += c));
      kind.on("close", (code) => klaar({ code, uit }));
    });
  } finally {
    server.close();
  }
}

test("I15 wordt rood na een etmaal zonder concept terwijl er pers binnenkomt", async () => {
  const { code, uit } = await draaiSonde({
    persArtikelen: 3,
    bewaking: {
      ronde: gelegen(5 * 60e3),
      laatsteConceptOp: gelegen((CONCEPT_STILTE_MAX_UREN + 16) * UUR),
      persItemsLaatsteRonde: 61,
      keten: {},
      eersteNul: { veld: "beoordeeld", stap: "kandidaten die aan de synthese toekwamen", ervoor: "kandidaten na de rondelimiet", aantalErvoor: 5 },
      duiding: "alle kandidaten overgeslagen vóór de synthese: 5× eerder afgewezen",
      tegels: { "pers-landelijk": { laatstGevuld: gelegen(UUR) } },
    },
  });
  assert.equal(code, 1);
  assert.match(uit, /I15 persketen/);
  assert.match(uit, /geen concept aangemaakt/);
  assert.match(uit, /61 persartikel/, "het aantal binnengekomen persartikelen hoort in de melding");
  assert.match(uit, /eerder afgewezen/, "de duiding uit het journaal hoort mee te komen");
});

test("I15 blijft groen op een rustige nacht: geen concept, maar ook geen pers", async () => {
  const { uit } = await draaiSonde({
    persArtikelen: 3,
    bewaking: {
      ronde: gelegen(5 * 60e3),
      laatsteConceptOp: gelegen((CONCEPT_STILTE_MAX_UREN + 16) * UUR),
      persItemsLaatsteRonde: 0,
      keten: {},
      eersteNul: null,
      duiding: null,
      tegels: { "pers-landelijk": { laatstGevuld: gelegen(UUR) } },
    },
  });
  assert.doesNotMatch(uit, /I15 persketen/, "zonder instroom is nul concepten geen storing");
});

test("I14 wordt rood als een tegel die deze week gevuld was ontbreekt", async () => {
  const { code, uit } = await draaiSonde({
    persArtikelen: 0, // precies de storing: de perstegel wordt niet meer gebouwd
    bewaking: {
      ronde: gelegen(5 * 60e3),
      laatsteConceptOp: gelegen(2 * UUR),
      persItemsLaatsteRonde: 61,
      keten: {},
      eersteNul: null,
      duiding: null,
      tegels: { "pers-landelijk": { laatstGevuld: gelegen(40 * UUR) } },
    },
  });
  assert.equal(code, 1);
  assert.match(uit, /I14 lege tegel/);
  assert.match(uit, /pers-landelijk ontbreekt in de levering/);
  assert.match(uit, /40 uur geleden nog gevuld/);
});

test("I14 zwijgt over een tegel die al langer dan het venster leeg is", async () => {
  const { uit } = await draaiSonde({
    persArtikelen: 0,
    bewaking: {
      ronde: gelegen(5 * 60e3),
      laatsteConceptOp: gelegen(2 * UUR),
      persItemsLaatsteRonde: 61,
      keten: {},
      eersteNul: null,
      duiding: null,
      tegels: { "pers-bosbranden": { laatstGevuld: gelegen((TEGEL_VULLING_VENSTER_DAGEN + 3) * DAG) } },
    },
  });
  assert.doesNotMatch(uit, /I14 lege tegel/, "een tegel buiten het seizoen mag niet elke week rood worden");
});

test("een ontbrekend bewakingsblok is zelf een bevinding", async () => {
  const { code, uit } = await draaiSonde({ persArtikelen: 3, bewaking: null });
  assert.equal(code, 1);
  assert.match(uit, /geen bewakingsblok/);
});
