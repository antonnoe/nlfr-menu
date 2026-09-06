// I5 laat de verenigingentegel met rust.
// ---------------------------------------------------------------------------
// AANLEIDING, GEMETEN. Van 3 tot en met 6 september 2026 was de sonde elke dag
// rood, en elke dag op dezelfde bevinding: "Zondag 1 november – Kerkdienst
// (Kerk+YouTube)" ≈ "Zondag 18 oktober – Kerkdienst (Kerk+YouTube)". Beide uit
// de verenigingenagenda, beide terecht op de pagina.
//
// Dat is geen bevinding maar een eigenschap van de bron. Een agenda bestaat uit
// TERUGKERENDE activiteiten: dezelfde kerkdienst, dezelfde koffieochtend,
// dezelfde taalles, met alleen een andere datum. Die lijken per definitie op
// elkaar. I5 bestaat om te voorkomen dat de REDACTIE hetzelfde nieuws twee keer
// publiceert, en die vraag speelt niet bij een feed die buiten de
// publicatiepoort om rechtstreeks op de pagina komt.
//
// WAAROM DIT ERTOE DOET. Een sonde die permanent rood staat, bewaakt niets: de
// volgende echte bevinding verdwijnt in vier regels ruis die er elke dag al
// stonden. Dat gold meteen voor I14 en I15, die er juist zijn omdat de
// persketen veertig uur onzichtbaar stil kon liggen.
//
// De sonde draait hier als echt proces tegen een lokale server.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const NU = Date.now();
const iso = (ms = 0) => new Date(NU - ms).toISOString();
const UUR = 3600e3;

// De twee kerkdiensten van de echte bevinding, woordelijk.
const KERKDIENSTEN = [
  "Zondag 1 november – Kerkdienst (Kerk+YouTube)",
  "Zondag 18 oktober – Kerkdienst (Kerk+YouTube)",
];
const KERKTEKST =
  "De kerkdienst begint om tien uur en is ook te volgen via YouTube. Iedereen is welkom in de kerk.";

// Twee perssyntheses over hetzelfde verhaal: dit MOET I5 wél melden, anders
// meet deze wijziging de invariant kapot in plaats van hem schoon te maken.
const DUBBELE_PERS = [
  "Franse regering kondigt bezuiniging van veertig miljard aan",
  "Kabinet in Parijs presenteert bezuinigingsplan van veertig miljard",
];
const PERSTEKST =
  "De Franse regering wil veertig miljard euro bezuinigen op de rijksbegroting van volgend jaar. " +
  "Het plan raakt de zorg, de uitkeringen en de ambtenarensalarissen, en gaat in het najaar naar het parlement.";

// De bron zoals de tweede levering hem draagt. Compleet, want een half
// ingevuld artikel laat I4 en I11 afgaan en dan meet deze toets die twee in
// plaats van I5.
function bron(naam, host, pad) {
  return { naam, titel: "Bronartikel", url: `https://${host}${pad}`, datum: iso(2 * UUR) };
}

function artikel(id, titel, soort) {
  const bronnen =
    soort === "pers"
      ? [bron("Le Monde — À la une", "www.lemonde.fr", `/politique/article/${id}.html`),
         bron("Le Figaro — Actualités", "www.lefigaro.fr", `/politique/${id}`)]
      : [bron("NL-verenigingen in Frankrijk", "antonnoe.github.io", `/verenigingen-kalender/${id}`)];
  return {
    id,
    soort,
    titel,
    summary: "Korte onderregel.",
    url: bronnen[0].url,
    datum: iso(2 * UUR),
    bronMeta: { naam: bronnen[0].naam, datum: bronnen[0].datum },
    bronAantal: bronnen.length,
    _bronnen: bronnen,
  };
}

// Bouwt de drie leveringen uit een lijst tegels, met per artikel de tekst waar
// I5 op rekent (kop + tekst, niet de kale titel).
function leveringen(tegels) {
  const teksten = {};
  const compacteTegels = tegels.map((t) => {
    for (const a of t.artikelen) {
      teksten[`${t.id}/${a.id}`] = { tekst: a._tekst, bronnen: a._bronnen };
    }
    return {
      soort: t.soort,
      id: t.id,
      label: t.label,
      artikelen: t.artikelen.map(({ _tekst, _bronnen, ...rest }) => rest),
      artikelAantal: t.artikelen.length,
    };
  });
  const stempel = { bijgewerkt: iso(0), gebakkenOp: iso(0) };
  return {
    compact: {
      ...stempel,
      tegels: compacteTegels,
      agenda: [],
      bronStatus: [],
      // Zonder dit blok meldt I15 een blinde bewaking en gaat deze toets rood om
      // een reden die er niets mee te maken heeft.
      bewaking: {
        ronde: iso(5 * 60e3),
        laatsteConceptOp: iso(2 * UUR),
        persItemsLaatsteRonde: 61,
        keten: {},
        eersteNul: null,
        duiding: null,
        tegels: {},
      },
    },
    tekst: { ...stempel, artikelen: teksten },
    archief: { ...stempel, tegelId: null, artikelen: [], teksten: {} },
  };
}

async function draaiSonde(tegels) {
  const stukken = leveringen(tegels);
  const server = http.createServer((req, res) => {
    const pad = req.url.split("?")[0];
    const body =
      pad === "/api/actueel" ? stukken.compact
      : pad === "/api/actueel-tekst" ? stukken.tekst
      : pad === "/api/actueel-archief" ? stukken.archief
      : pad === "/actueel.json" ? { kaarten: [{ titel: "x", url: "https://www.nederlanders.fr/" }] }
      : {};
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await new Promise((klaar) => {
      const kind = spawn(process.execPath, ["scripts/sonde.mjs"], {
        env: {
          ...process.env,
          SONDE_URL: `http://127.0.0.1:${server.address().port}`,
          SONDE_WEBHOOK_URL: "",
          NO_PROXY: "127.0.0.1,localhost",
          no_proxy: "127.0.0.1,localhost",
        },
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

const verenigingenTegel = {
  soort: "verenigingen",
  id: "verenigingen",
  label: "Verenigingen",
  artikelen: KERKDIENSTEN.map((titel, i) => ({
    ...artikel(`v${i}`, titel, "verenigingen"),
    _tekst: KERKTEKST,
  })),
};

const persTegel = {
  soort: "pers",
  id: "pers-landelijk",
  label: "Landelijk nieuws",
  artikelen: DUBBELE_PERS.map((titel, i) => ({
    ...artikel(`p${i}`, titel, "pers"),
    _tekst: PERSTEKST,
  })),
};

test("twee terugkerende kerkdiensten maken de sonde niet meer rood", async () => {
  const { code, uit } = await draaiSonde([verenigingenTegel]);
  // Volledig groen, niet alleen "geen I5". Zo legt deze toets vast dat de
  // agenda met haar terugkerende activiteiten een NORMALE stand van de pagina
  // is, en niet iets wat elke dag een bevinding oplevert.
  assert.equal(code, 0, uit);
  assert.match(uit, /VERDICT: groen/);
  assert.doesNotMatch(uit, /Kerkdienst/);
});

test("twee perssyntheses over hetzelfde verhaal worden nog steeds gemeld", async () => {
  const { code, uit } = await draaiSonde([persTegel]);
  assert.equal(code, 1);
  assert.match(uit, /I5 geen-dubbele-titels/);
  assert.match(uit, /bezuinig/i);
});

test("de tegel valt aan BEIDE kanten van het paar weg, niet alleen als eerste", async () => {
  // Een verenigingsitem naast een persartikel over hetzelfde onderwerp: ook dat
  // paar hoort niet gemeld te worden, anders is de tegel er maar half uit.
  const overlappend = {
    soort: "verenigingen",
    id: "verenigingen",
    label: "Verenigingen",
    artikelen: [{ ...artikel("v9", DUBBELE_PERS[1], "verenigingen"), _tekst: PERSTEKST }],
  };
  const alleenEen = {
    soort: "pers",
    id: "pers-landelijk",
    label: "Landelijk nieuws",
    artikelen: [{ ...artikel("p9", DUBBELE_PERS[0], "pers"), _tekst: PERSTEKST }],
  };
  const { uit } = await draaiSonde([alleenEen, overlappend]);
  assert.doesNotMatch(uit, /I5 geen-dubbele-titels/, uit);
});
