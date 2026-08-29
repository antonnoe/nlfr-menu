// Lokale namaak van productie voor de schermen op /uitleg.
// ---------------------------------------------------------------------------
// WAAROM DIT BESTAAT. De uitlegpagina toont ECHTE schermafdrukken van de
// reviewtool en de nieuwspagina. Die kun je niet van productie plukken: daar
// staat werkelijk nieuws in, met namen en bronnen die morgen anders zijn. Dit
// bestand serveert dezelfde HTML met VERZONNEN maar realistische inhoud, zodat
// de schermen reproduceerbaar zijn en niets tonen wat er niet hoort.
//
// Draaien:  node scripts/demo-uitleg.mjs        (poort 8790, of DEMO_POORT)
// Daarna:   node scripts/schermen.mjs           (maakt de afbeeldingen)
//
// Raakt productie niet aan: er is geen KV, geen cron en geen netwerk.
import http from "node:http";
import { readFileSync } from "node:fs";
import { splitsAntwoord } from "../lib/levering.js";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const nu = Date.now();
const iso = (ms) => new Date(nu - ms).toISOString();
const DAG = 86400000;

const IF = [
  { ifId: 4102, titel: "Kinderbijslag in Frankrijk: waar u recht op hebt", url: "https://infofrankrijk.com/kinderbijslag/", modified: iso(297 * DAG), categorieen: [18, 12] },
  { ifId: 4187, titel: "De SCI (Société Civile Immobilière)", url: "https://infofrankrijk.com/de-sci/", modified: iso(295 * DAG), categorieen: [18] },
  { ifId: 4210, titel: "U en de Franse fiscus: 40 voorbeeldbrieven", url: "https://infofrankrijk.com/voorbeeldbrieven-fiscus/", modified: iso(273 * DAG), categorieen: [18] },
  { ifId: 4488, titel: "Franse bankrekening openen? Dit zijn de regels en uw rechten", url: "https://infofrankrijk.com/bankrekening-openen/", modified: iso(262 * DAG), categorieen: [12, 362] },
  { ifId: 5031, titel: "Plus-value op onroerend goed (immobilières)", url: "https://infofrankrijk.com/plus-value/", modified: iso(261 * DAG), categorieen: [18] },
  { ifId: 5290, titel: "Aangifte doen in Frankrijk: stap voor stap", url: "https://infofrankrijk.com/aangifte-stap-voor-stap/", modified: iso(120 * DAG), categorieen: [18] },
  { ifId: 5561, titel: "Belastingschijven en tarieven", url: "https://infofrankrijk.com/belastingschijven/", modified: iso(96 * DAG), categorieen: [18] },
  { ifId: 5904, titel: "Prélèvement à la source uitgelegd", url: "https://infofrankrijk.com/prelevement-a-la-source/", modified: iso(64 * DAG), categorieen: [18, 12] },
  { ifId: 6120, titel: "Erfbelasting tussen Nederland en Frankrijk", url: "https://infofrankrijk.com/erfbelasting/", modified: iso(41 * DAG), categorieen: [18, 73] },
  { ifId: 6455, titel: "Taxe d'habitation: wie betaalt er nog?", url: "https://infofrankrijk.com/taxe-dhabitation/", modified: iso(22 * DAG), categorieen: [18, 26] },
  { ifId: 6788, titel: "Uw Franse aanslag lezen en controleren", url: "https://infofrankrijk.com/aanslag-lezen/", modified: iso(9 * DAG), categorieen: [18] },
  { ifId: 6912, titel: "Bankzaken regelen op afstand", url: "https://infofrankrijk.com/bankzaken-op-afstand/", modified: iso(5 * DAG), categorieen: [362] },
];

const CONCEPT = {
  id: "c1",
  kop: "Franse regering schuift aangiftetermijn twee weken op",
  tekst:
    "De termijn voor de Franse inkomstenaangifte schuift dit jaar twee weken op. Volgens meerdere Franse media hangt het uitstel samen met een storing in het aangifteportaal die eind vorige week begon.\n\nVoor wie in Frankrijk woont en digitaal aangifte doet, geldt de nieuwe datum automatisch; een verzoek indienen is niet nodig. De belastingdienst laat weten dat boetes voor te late indiening in deze periode niet worden opgelegd.",
  bronnen: [
    { naam: "Le Monde — À la une", titel: "Impôts: le calendrier décalé", url: "https://www.lemonde.fr/impots-calendrier", datum: iso(0.3 * DAG) },
    { naam: "Sud Ouest", titel: "Déclaration: deux semaines de plus", url: "https://www.sudouest.fr/declaration-deux-semaines", datum: iso(0.4 * DAG) },
    { naam: "Franceinfo", titel: "Panne du portail des impôts", url: "https://www.franceinfo.fr/panne-portail-impots", datum: iso(0.5 * DAG) },
  ],
  aantalBronnen: 3,
  aangemaaktOp: iso(0.2 * DAG),
  model: "claude-opus-5",
  poort: { persconcept: true, onafhankelijkeOutlets: 3, outletNamen: ["Le Monde", "Sud Ouest", "Franceinfo"], publiceerbaar: true, code: null, outletnamenInTekst: [] },
  gelijkenis: {},
  primaireBron: null,
};

const PUBLICATIE = {
  id: "p1",
  kop: "Energieprijzen dalen komende winter",
  tekst: "Huishoudens betalen komende winter minder voor gas. De gereguleerde tarieven gaan volgens meerdere Franse media met enkele procenten omlaag.",
  gepubliceerdOp: iso(0.8 * DAG),
  bronnen: [
    { naam: "Le Monde — À la une", titel: "Gaz: les tarifs baissent", url: "https://www.lemonde.fr/gaz-tarifs", datum: iso(DAG) },
    { naam: "Franceinfo", titel: "Baisse des tarifs réglementés", url: "https://www.franceinfo.fr/tarifs-reglementes", datum: iso(DAG) },
  ],
};

const OVERHEID = [
  {
    id: "o1",
    thema: "geld-belasting",
    bron: "Bercy — Ministère de l'Économie",
    url: "https://www.economie.gouv.fr/actualites/declaration-2026",
    kop: "Aangiftetermijn inkomstenbelasting verschoven",
    samenvatting:
      "De uiterste datum voor de digitale inkomstenaangifte verschuift met twee weken. Wie op papier aangifte doet, houdt de oorspronkelijke datum. Er hoeft geen uitstel te worden aangevraagd; de nieuwe termijn geldt voor iedereen die digitaal indient.",
    gepubliceerdOp: iso(0.5 * DAG),
    datum: iso(0.5 * DAG),
  },
  {
    id: "o2",
    thema: "douane",
    bron: "Douane — douane.gouv.fr",
    url: "https://www.douane.gouv.fr/actualites/seuils-colis",
    kop: "Nieuwe drempels voor pakketten van buiten de EU",
    samenvatting: "Voor pakketten van buiten de Europese Unie gelden vanaf volgende maand andere drempelbedragen voor invoerrechten.",
    gepubliceerdOp: iso(1.5 * DAG),
    datum: iso(1.5 * DAG),
  },
];

// De reviewstaat: wat er al gekozen is.
const state = {
  verwijzingen: { p1: [{ ifId: 6912, titel: "Bankzaken regelen op afstand", url: "https://infofrankrijk.com/bankzaken-op-afstand/" }] },
  nakijken: [
    {
      ifId: 4187,
      titel: "De SCI (Société Civile Immobilière)",
      url: "https://infofrankrijk.com/de-sci/",
      modified: iso(295 * DAG),
      aanleidingen: [{ id: "o1", kop: "Aangiftetermijn inkomstenbelasting verschoven", bron: "Bercy — Ministère de l'Économie" }],
    },
  ],
};

const MAANDEN = 12;
const grens = () => { const d = new Date(nu); d.setUTCMonth(d.getUTCMonth() - MAANDEN); return d.getTime(); };
const CAT_NAMEN = { 18: "Belastingen", 12: "Geldzaken", 362: "Bankieren", 26: "Overheden", 73: "Juridisch" };

function kandidaten(zoek) {
  const binnen = IF.filter((a) => Date.parse(a.modified) >= grens());
  const lijst = zoek
    ? binnen.filter((a) => a.titel.toLowerCase().includes(zoek.toLowerCase()))
    : binnen.filter((a) => a.categorieen.some((c) => [18, 12, 362].includes(c)));
  return lijst.sort((a, b) => Date.parse(a.modified) - Date.parse(b.modified));
}

// ---- de lezerspagina ----
const volAntwoord = {
  bijgewerkt: iso(0.01 * DAG),
  gebakkenOp: iso(0.01 * DAG),
  agenda: [],
  bronStatus: [],
  tegels: [
    {
      soort: "pers", id: "pers-landelijk", thema: "landelijk",
      label: "Landelijk & internationaal", accent: "groen", badge: "Redactie", hot: true,
      artikelen: [
        {
          id: "p1", soort: "pers", datum: iso(0.8 * DAG),
          url: "https://www.lemonde.fr/gaz-tarifs",
          titel: "Energieprijzen dalen komende winter",
          summary: "Huishoudens betalen komende winter minder voor gas.",
          tekst: "Huishoudens betalen komende winter minder voor gas. De gereguleerde tarieven gaan volgens meerdere Franse media met enkele procenten omlaag.\n\nDe verlaging geldt voor wie een contract heeft tegen het gereguleerde tarief; bij een vast contract verandert er niets tot de afloopdatum.",
          bronnen: PUBLICATIE.bronnen,
          label: "Redactie NLFR \u2014 automatisch samengesteld, bronnen onderaan",
          verwijzingen: [{ titel: "Bankzaken regelen op afstand", url: "https://infofrankrijk.com/bankzaken-op-afstand/" }],
        },
      ],
    },
    {
      soort: "overheid", id: "overheid-geld-belasting", thema: "geld-belasting",
      label: "Geld & belasting", accent: "brand", badge: "Overheid", hot: false,
      artikelen: [
        {
          id: "o1", soort: "overheid", url: OVERHEID[0].url,
          titel: OVERHEID[0].kop, summary: "De uiterste datum voor de digitale inkomstenaangifte verschuift met twee weken.",
          tekst: OVERHEID[0].samenvatting,
          bronnen: [{ naam: "Bercy — Ministère de l'Économie", titel: "Déclaration 2026", url: OVERHEID[0].url, datum: iso(0.5 * DAG) }],
          verwijzingen: [
            { titel: "Aangifte doen in Frankrijk: stap voor stap", url: "https://infofrankrijk.com/aangifte-stap-voor-stap/" },
            { titel: "Uw Franse aanslag lezen en controleren", url: "https://infofrankrijk.com/aanslag-lezen/" },
          ],
        },
      ],
    },
  ],
};
const { compact, tekst, archief } = splitsAntwoord(volAntwoord);

const json = (res, obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const pad = u.pathname;
  if (pad === "/review" || pad === "/review.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(readFileSync(`${REPO}/review.html`));
  }
  if (pad === "/uitleg" || pad === "/uitleg.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(readFileSync(`${REPO}/uitleg.html`));
  }
  if (pad.startsWith("/schermen/")) {
    res.setHeader("Content-Type", "image/webp");
    try { return res.end(readFileSync(`${REPO}${pad}`)); } catch { res.statusCode = 404; return res.end(""); }
  }
  if (pad === "/actueel" || pad === "/actueel.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(readFileSync(`${REPO}/actueel.html`));
  }
  if (pad === "/api/review") {
    if (req.method === "POST") return json(res, { ok: true });
    if (u.searchParams.get("deel") === "if") {
      const zoek = u.searchParams.get("zoek") || "";
      const lijst = kandidaten(zoek);
      const gekozenIds = new Set((state.verwijzingen[u.searchParams.get("artikel")] || []).map((x) => x.ifId));
      return json(res, {
        ok: true,
        index: { opgehaaldOp: iso(0.1 * DAG), aantal: 351 },
        bericht: { id: u.searchParams.get("artikel"), soort: "overheid", thema: "geld-belasting", kop: OVERHEID[0].kop },
        categorieen: [18, 12, 362].map((id) => ({ id, naam: CAT_NAMEN[id] })),
        maanden: MAANDEN, standaardAantal: 10, totaal: lijst.length,
        kandidaten: lijst.map((a) => ({ ...a, gekozen: gekozenIds.has(a.ifId) })),
      });
    }
    return json(res, {
      ok: true,
      concepten: [CONCEPT], totaalConcepten: 1, duplicatenAantal: 0, buitenlandVerwijderd: 0,
      publicaties: [PUBLICATIE], overheid: OVERHEID, bronUrlWeigeringen: [],
      verwijzingen: state.verwijzingen, nakijken: state.nakijken,
      bijnaVerlopen: [{ ifId: 4102, titel: "Kinderbijslag in Frankrijk: waar u recht op hebt", url: "https://infofrankrijk.com/kinderbijslag/", modified: iso(297 * DAG) }],
      ifIndex: { opgehaaldOp: iso(0.1 * DAG), aantal: 351 },
    });
  }
  if (pad === "/api/actueel") return json(res, compact);
  if (pad === "/api/actueel-tekst") return json(res, tekst);
  if (pad === "/api/actueel-archief") return json(res, archief);
  if (pad === "/api/schoolvakanties") return json(res, { ok: true, zin: "De eerstvolgende schoolvakantie (Vacances de la Toussaint) begint in Zone A vanaf 17 oktober." });
  if (pad === "/actueel.json") { res.setHeader("Content-Type", "application/json"); return res.end(readFileSync(`${REPO}/actueel.json`)); }
  res.statusCode = 404; res.end("");
}).listen(Number(process.env.DEMO_POORT || 8790), () => console.log("demo op " + (process.env.DEMO_POORT || 8790)));
