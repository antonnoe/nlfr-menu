// Zelftests voor de twee invarianten die op 5 september 2026 aan de sonde zijn
// toegevoegd: I14 (ongefilterde bronnenlijst) en I15 (hetzelfde bericht twee
// keer live).
//
// Beide gaten komen uit de STORINGEN VAN 3 AUGUSTUS 2026, en de code die ze
// destijds heeft gerepareerd zit er nog:
//   23e276d — bouwBronnen() viel terug op de volledige clusterlijst als de
//             GEBRUIKT-opgave van het model niet te matchen was. De vlag
//             `bronnenTerugval` werd toen ingevoerd, maar bleef op het concept
//             hangen: hij haalde de publicatie noch het API-antwoord.
//   fdfd877 — Service-Public zet dezelfde actualité op de particuliers- én de
//             professionnels-feed. Op de oude URL-sleutel werden dat twee
//             records met elk een eigen AI-samenvatting, en stond hetzelfde
//             bericht twee keer op /actueel.
//
// De tweede helft van dit bestand draait de ECHTE sonde als kindproces tegen
// een lokale server. De pagina die die server serveert is niet met de hand
// geschreven maar door de productiecode zelf gebouwd (assembleerTegels +
// splitsAntwoord), zodat de drie leveringen net zo in elkaar zitten als op
// productie en de overige invarianten niet op een vormfout afgaan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { assembleerTegels, bronIdentiteit, dubbeleBerichten, urlPad } from "../lib/tegels.js";
import { splitsAntwoord } from "../lib/levering.js";
import { bouwBronnen } from "../lib/synthese.js";
import { overheidSleutel } from "../lib/overheid.js";

const WORTEL = new URL("..", import.meta.url);
const SONDE = fileURLToPath(new URL("scripts/sonde.mjs", WORTEL));
const ACTUEEL_JSON = readFileSync(new URL("actueel.json", WORTEL), "utf8");

// ---------------------------------------------------------------------------
// 1) I15 op het materiaal van 3 augustus 2026
// ---------------------------------------------------------------------------
// De twee URL's hieronder zijn niet bedacht: ze staan sinds fdfd877 woordelijk
// in de kop van lib/overheid.js als de twee feeds waarop actualité A18905
// verscheen. Let op host én pad: die verschillen allebei.
const TWEELING_PARTICULIEREN =
  "https://www.service-public.fr/particuliers/actualites/A18905?xtor=RSS-111";
const TWEELING_PROFESSIONALS =
  "https://entreprendre.service-public.fr/actualites/A18905?xtor=RSS-112";

// Zoals ze na de storing op de pagina stonden: twee artikelen, elk met één
// bron, met twee los gegenereerde NL-samenvattingen van hetzelfde bericht.
const artikelParticulieren = {
  id: "sp-part-a18905",
  soort: "overheid",
  titel: "Brandstofsteun voor de bouwsector verlengd",
  tekst: "De tegemoetkoming in de brandstofkosten voor bouwbedrijven loopt door tot het einde van het jaar.",
  bronnen: [
    {
      naam: "Service-Public — particuliers",
      titel: "Aide au carburant pour les entreprises du bâtiment",
      url: TWEELING_PARTICULIEREN,
      datum: "2026-08-01T06:00:00Z",
    },
  ],
};
const artikelProfessionals = {
  id: "sp-pro-a18905",
  soort: "overheid",
  titel: "Bouwbedrijven houden recht op brandstoftegemoetkoming",
  tekst: "Ondernemers in de bouw kunnen ook de komende maanden een vergoeding voor brandstof aanvragen.",
  bronnen: [
    {
      naam: "Service-Public — professionnels",
      titel: "Aide carburant : prolongation pour le secteur du bâtiment",
      url: TWEELING_PROFESSIONALS,
      datum: "2026-08-01T06:00:00Z",
    },
  ],
};

test("de storing van 3 augustus: dezelfde actualité op twee feeds wordt herkend", () => {
  const paren = dubbeleBerichten([artikelParticulieren, artikelProfessionals]);
  assert.equal(paren.length, 1, "de twee tweelingen horen als één paar te worden gemeld");
  assert.equal(paren[0].reden, "actualité-nummer");
  assert.equal(paren[0].bewijs, "A18905");
});

test("juist déze storing is op host+pad onzichtbaar — het nummer is wat hem vangt", () => {
  // Dit is de reden dat de invariant twee vormen heeft. Beide URL's wijzen naar
  // hetzelfde bericht, maar host én pad verschillen: een dedup op host+pad
  // alleen (urlPad) had er twee losse berichten in gezien.
  assert.notEqual(urlPad(TWEELING_PARTICULIEREN), urlPad(TWEELING_PROFESSIONALS));
  assert.equal(overheidSleutel(TWEELING_PARTICULIEREN), "A18905");
  assert.equal(overheidSleutel(TWEELING_PROFESSIONALS), "A18905");
  assert.deepEqual([...bronIdentiteit(artikelParticulieren).nummers], ["A18905"]);
});

test("de tracking-parametertweeling wordt op host+pad gevangen", () => {
  // De andere helft van fdfd877: dezelfde pagina met een andere ?xtor-waarde,
  // die anders als nieuw bericht binnenkwam en de levenscyclus terugzette.
  const a = {
    ...artikelParticulieren,
    id: "a19013-111",
    bronnen: [
      {
        naam: "Service-Public — particuliers",
        url: "https://www.service-public.fr/particuliers/actualites/A19013?xtor=RSS-111",
      },
    ],
  };
  const b = {
    ...artikelProfessionals,
    id: "a19013-112",
    bronnen: [
      {
        naam: "Service-Public — particuliers",
        url: "https://www.service-public.fr/particuliers/actualites/A19013?xtor=RSS-112",
      },
    ],
  };
  const paren = dubbeleBerichten([a, b]);
  assert.equal(paren.length, 1);
  // Het nummer wint van het pad in de melding; allebei zouden het gezien hebben.
  assert.equal(paren[0].bewijs, "A19013");
  assert.equal(urlPad(a.bronnen[0].url), urlPad(b.bronnen[0].url));
});

test("twee verschillende actualités blijven twee berichten", () => {
  const b = {
    ...artikelProfessionals,
    bronnen: [
      {
        naam: "Service-Public — professionnels",
        url: "https://entreprendre.service-public.fr/actualites/A18906?xtor=RSS-112",
      },
    ],
  };
  assert.deepEqual(dubbeleBerichten([artikelParticulieren, b]), []);
});

test("twee syntheses mogen één krantenlink delen, twee gedeelde links niet", () => {
  // De drempel is niet nieuw: ontdubbelPers() in lib/tegels.js hanteert al
  // ">= 2 dezelfde bronlinks" als duplicaatsignaal. Eén gedeelde link is
  // legitiem — een live-blog kan over twee verhalen tegelijk berichten.
  const lemonde =
    "https://www.lemonde.fr/politique/article/2026/08/24/presidentielle-2027-la-bataille-des-gauches-irreconciliables-est-lancee_6754812_823448.html";
  const figaro =
    "https://www.lefigaro.fr/politique/presidentielle-melenchon-en-position-de-se-qualifier-pour-le-second-tour-selon-un-sondage-20260824";
  const sudouest =
    "https://www.sudouest.fr/politique/presidentielle-2027-yannick-jadot-annonce-son-ralliement-a-raphael-glucksmann-30350689.php";

  const een = { id: "p1", bronnen: [{ url: lemonde }, { url: figaro }] };
  const twee = { id: "p2", bronnen: [{ url: lemonde }, { url: sudouest }] };
  assert.deepEqual(dubbeleBerichten([een, twee]), [], "één gedeelde link is geen duplicaat");

  const drie = { id: "p3", bronnen: [{ url: lemonde }, { url: figaro }, { url: sudouest }] };
  const paren = dubbeleBerichten([een, drie]);
  assert.equal(paren.length, 1);
  assert.equal(paren[0].reden, "2 bron-URL's");
});

// ---------------------------------------------------------------------------
// 2) I14: de vlag bronnenTerugval loopt door tot in het API-antwoord
// ---------------------------------------------------------------------------

// Een echt cluster: vier artikelen uit de productiedata van 4 september 2026.
const CLUSTER = {
  items: [
    {
      bron: "Le Monde — À la une",
      titel: "Orages : seize départements de la moitié sud du pays en vigilance orange",
      url: "https://www.lemonde.fr/planete/article/2026/08/24/orages-seize-departements-de-la-moitie-sud-du-pays-en-vigilance-orange-lundi-apres-midi_6754437_3245.html",
      datum: "2026-08-24T09:00:00Z",
    },
    {
      bron: "Midi Libre",
      titel: "Alerte aux orages : qu'est-ce que le thalweg",
      url: "https://www.midilibre.fr/2026/08/24/alerte-aux-orages-quest-ce-que-thalweg-le-phenomene-meteo-a-lorigine-des-intemperies-annoncees-ce-lundi-13519860.php",
      datum: "2026-08-24T08:30:00Z",
    },
    {
      bron: "Sud Ouest",
      titel: "Volkswagen : le PDG juge la situation plus que critique",
      url: "https://www.sudouest.fr/economie/auto-moto/automobile-le-pdg-de-volkswagen-oliver-blume-juge-la-situation-du-groupe-plus-que-critique-30344918.php",
      datum: "2026-08-23T17:00:00Z",
    },
  ],
};

test("een onmatchbare GEBRUIKT-opgave levert de ongefilterde clusterlijst op", () => {
  // Precies de storing van 23e276d: het model noemt links die niet in het
  // cluster zitten, dus valt bouwBronnen() terug op ALLE items — inclusief het
  // Volkswagen-artikel, dat niets met de onweerswaarschuwing te maken heeft.
  const terugval = bouwBronnen(CLUSTER, { urls: ["https://www.example.org/iets-anders"], nummers: null });
  assert.equal(terugval.gefilterd, false, "niets gematcht, dus terugval");
  assert.equal(terugval.bronnen.length, 3, "de volledige clusterlijst, bijvangst en al");

  // En ter contrast: een opgave die wél matcht, filtert de bijvangst weg.
  const gefilterd = bouwBronnen(CLUSTER, { urls: [CLUSTER.items[0].url, CLUSTER.items[1].url], nummers: null });
  assert.equal(gefilterd.gefilterd, true);
  assert.equal(gefilterd.bronnen.length, 2);
});

// De publicatie zoals api/review.js hem wegschrijft: `{ ...concept }` met de
// publicatievelden erop. De vlag hoort die spread te overleven.
function publicatieMetTerugval(nu) {
  const { bronnen, gefilterd } = bouwBronnen(CLUSTER, { urls: ["https://www.example.org/iets-anders"], nummers: null });
  return {
    id: "terugval-1",
    sleutel: "terugval-1",
    kop: "Zestien departementen op oranje voor onweer",
    tekst:
      "In zestien departementen in het zuiden van Frankrijk geldt maandagmiddag een oranje waarschuwing voor onweer, zo melden meerdere Franse media. De waarschuwing loopt tot in de avond.",
    bronnen,
    bronnenTerugval: !gefilterd,
    gepubliceerd: true,
    gepubliceerdOp: new Date(nu - 60 * 60 * 1000).toISOString(),
  };
}

test("bronnenTerugval haalt het artikel en de compacte levering", () => {
  const nu = Date.parse("2026-09-05T12:00:00Z");
  const pub = publicatieMetTerugval(nu);
  assert.equal(pub.bronnenTerugval, true, "de publicatie draagt de vlag");

  const tegels = assembleerTegels({ publicaties: [pub], nu });
  const artikelen = tegels.flatMap((t) => t.artikelen || []);
  const artikel = artikelen.find((a) => a.id === "terugval-1");
  assert.ok(artikel, "de publicatie staat op de pagina");
  assert.equal(artikel.bronnenTerugval, true, "het artikel draagt de vlag");

  const { compact } = splitsAntwoord({ bijgewerkt: "", gebakkenOp: "", tegels });
  const compactArtikel = compact.tegels
    .flatMap((t) => t.artikelen || [])
    .find((a) => a.id === "terugval-1");
  assert.equal(compactArtikel.bronnenTerugval, true, "de compacte levering draagt de vlag");
});

test("zonder terugval staat de vlag niet in de levering", () => {
  const nu = Date.parse("2026-09-05T12:00:00Z");
  const pub = { ...publicatieMetTerugval(nu), bronnenTerugval: false };
  const tegels = assembleerTegels({ publicaties: [pub], nu });
  const artikel = tegels.flatMap((t) => t.artikelen || []).find((a) => a.id === "terugval-1");
  assert.equal("bronnenTerugval" in artikel, false, "een false zou elke levering laten groeien zonder iets te zeggen");
});

// ---------------------------------------------------------------------------
// 3) De echte sonde, tegen een lokale server
// ---------------------------------------------------------------------------

// Een pagina bouwen zoals productie hem bouwt, en de drie leveringen serveren.
async function serveerPagina({ publicaties = [], overheidDocs = [], nu }) {
  const tegels = assembleerTegels({ publicaties, overheidDocs, items: [], verwijzingen: [], nu });
  const stempel = new Date(nu).toISOString();
  const { compact, tekst, archief } = splitsAntwoord({
    bijgewerkt: stempel,
    gebakkenOp: stempel,
    tegels,
    agenda: [],
    bronStatus: [],
  });
  const routes = {
    "/api/actueel": JSON.stringify(compact),
    "/api/actueel-tekst": JSON.stringify(tekst),
    "/api/actueel-archief": JSON.stringify(archief),
    "/actueel.json": ACTUEEL_JSON,
  };
  const server = createServer((req, res) => {
    const body = routes[req.url.split("?")[0]];
    if (!body) {
      res.writeHead(404).end("nee");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(body);
  });
  await new Promise((klaar) => server.listen(0, "127.0.0.1", klaar));
  return { server, basis: `http://127.0.0.1:${server.address().port}` };
}

function draaiSonde(basis) {
  return new Promise((klaar) => {
    const kind = spawn(process.execPath, [SONDE], {
      // Geen webhook: die stap hoort dan stilzwijgend te worden overgeslagen.
      env: { ...process.env, SONDE_URL: basis, SONDE_WEBHOOK_URL: "", SONDE_TOON_LINKS: "0" },
    });
    let uit = "";
    kind.stdout.on("data", (d) => (uit += d));
    kind.stderr.on("data", (d) => (uit += d));
    kind.on("close", (code) => klaar({ code, uit }));
  });
}

// Twee overheidsrecords zoals de cron ze wegschrijft. De hosts staan op
// service-public.gouv.fr — daarheen is Service-Public verhuisd, en alleen die
// komen door de herkomsttoets van lib/bronurl.js. Zou de URL geweigerd worden,
// dan haalt hij het artikel niet eens en valt er niets te vergelijken.
function tweelingRecords(nu) {
  const datum = new Date(nu - 2 * 24 * 60 * 60 * 1000).toISOString();
  return [
    {
      id: "sp-part-a18905",
      sleutel: "A18905",
      thema: "praktisch",
      bron: "Service-Public — particuliers",
      url: "https://www.service-public.gouv.fr/particuliers/actualites/A18905?xtor=RSS-111",
      titelBron: "Aide au carburant pour les entreprises du bâtiment",
      kop: "Brandstofsteun voor de bouwsector verlengd",
      samenvatting:
        "De tegemoetkoming in de brandstofkosten voor bouwbedrijven loopt door tot het einde van het jaar. Aanvragen kan via het ondernemersloket.",
      datum,
      gepubliceerdOp: datum,
    },
    {
      id: "sp-pro-a18905",
      sleutel: "A18905",
      thema: "ondernemen",
      bron: "Service-Public — professionnels",
      url: "https://entreprendre.service-public.gouv.fr/actualites/A18905?xtor=RSS-112",
      titelBron: "Aide carburant : prolongation pour le secteur du bâtiment",
      kop: "Bouwbedrijven houden recht op brandstoftegemoetkoming",
      samenvatting:
        "Ondernemers in de bouw kunnen ook de komende maanden een vergoeding aanvragen. De regeling gold eerder tot september.",
      datum,
      gepubliceerdOp: datum,
    },
  ];
}

test("sonde: een schone pagina blijft groen", async () => {
  const nu = Date.now();
  const { server, basis } = await serveerPagina({ overheidDocs: [tweelingRecords(nu)[0]], nu });
  try {
    const { code, uit } = await draaiSonde(basis);
    assert.equal(code, 0, uit);
    assert.match(uit, /VERDICT: groen/);
    assert.doesNotMatch(uit, /Webhook/, "zonder secret hoort de POST stilzwijgend over te slaan");
  } finally {
    server.close();
  }
});

test("sonde: de storing van 3 augustus had de run rood gemaakt (I15)", async () => {
  const nu = Date.now();
  const { server, basis } = await serveerPagina({ overheidDocs: tweelingRecords(nu), nu });
  try {
    const { code, uit } = await draaiSonde(basis);
    assert.equal(code, 1, uit);
    assert.match(uit, /I15 dubbel-bericht/);
    assert.match(uit, /actualité-nummer: A18905/);
    // En het bewijs dat I5 dit niet zag: twee los geschreven samenvattingen zijn
    // twee verschillende teksten, dus de tekstinvariant blijft stil.
    assert.doesNotMatch(uit, /I5 geen-dubbele-titels/);
  } finally {
    server.close();
  }
});

test("sonde: een live artikel met een ongefilterde bronnenlijst maakt de run rood (I14)", async () => {
  const nu = Date.now();
  const { server, basis } = await serveerPagina({ publicaties: [publicatieMetTerugval(nu)], nu });
  try {
    const { code, uit } = await draaiSonde(basis);
    assert.equal(code, 1, uit);
    assert.match(uit, /I14 bronnenlijst-terugval/);
    assert.match(uit, /ongefilterde clusterlijst/);
  } finally {
    server.close();
  }
});

test("sonde: dezelfde publicatie zonder terugval blijft groen", async () => {
  const nu = Date.now();
  const pub = { ...publicatieMetTerugval(nu), bronnenTerugval: false };
  const { server, basis } = await serveerPagina({ publicaties: [pub], nu });
  try {
    const { code, uit } = await draaiSonde(basis);
    assert.equal(code, 0, uit);
  } finally {
    server.close();
  }
});
