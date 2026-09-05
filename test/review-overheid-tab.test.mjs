// Het tweede tabblad van de reviewtool: Overheid (.gouv).
// ---------------------------------------------------------------------------
// WAT HIER WORDT VASTGELEGD, EN WAAROM.
//
// De overheidsberichten gaan zonder review live: de poort raakt ze niet aan.
// Het tweede tabblad is dus GEEN tweede wachtrij maar nawerk op wat al op de
// pagina staat. Precies daarom staan hier drie dingen vast die je met het oog
// niet ziet en die stil kunnen wegglippen bij een volgende wijziging:
//
//   1. HET EERSTE TABBLAD IS DE STANDAARD. De dagelijkse taak is de
//      conceptenwachtrij; wie de tool opent hoort daar te staan, niet in het
//      nawerk.
//   2. GEEN PUBLICATIEACTIE OP HET TWEEDE TABBLAD. Geen publiceren, geen
//      weigeren, geen archiveren, geen "Van de site halen". Eén verdwaalde
//      `data-act` op een kaart zou hier meteen een knop opleveren die een
//      bericht van de site haalt — daarom toetst deze test op de afwezigheid
//      van het attribuut zelf, niet op de labels.
//   3. WEGHALEN KAN, OP ALLEBEI DE TABBLADEN. Een verwijzing zetten is één
//      klik; hem weer weg krijgen hoort dat ook te zijn. Het blok komt uit één
//      functie (ifBlokHtml), en deze test houdt dat zo.
//
// De renderfuncties worden UIT review.html gehaald en daar uitgevoerd, net als
// in test/client-artikel.test.mjs en test/verwijzing.test.mjs: een test op een
// kopie van de renderlogica blijft groen terwijl de tool stuk is.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assembleerTegels } from "../lib/tegels.js";
import { splitsAntwoord, artikelSleutel } from "../lib/levering.js";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");

// ---- De twee tabbladen in de markup ----------------------------------------

test("de tool heeft twee tabbladen, en Redactie actueel is de standaard", () => {
  assert.match(review, /<div class="tabs" role="tablist"/, "er is een tabbladbalk");
  const redactie = review.match(/<button[^>]*id="tabRedactie"[^>]*>([^<]*)<\/button>/);
  const overheid = review.match(/<button[^>]*id="tabOverheid"[^>]*>([^<]*)<\/button>/);
  assert.ok(redactie, "het eerste tabblad ontbreekt");
  assert.ok(overheid, "het tweede tabblad ontbreekt");
  assert.equal(redactie[1], "Redactie actueel");
  assert.equal(overheid[1], "Overheid (.gouv)");
  assert.match(redactie[0], /aria-selected="true"/, "het eerste tabblad staat open bij het laden");
  assert.match(overheid[0], /aria-selected="false"/, "het tweede niet");
  // En de tool begint ook in de code op dat tabblad, niet alleen in de markup.
  assert.match(review, /tab: "redactie"/, "state.tab begint op redactie");
  // Het eerste tabblad staat vóór het tweede.
  assert.ok(review.indexOf('id="tabRedactie"') < review.indexOf('id="tabOverheid"'));
});

test("alleen het open tabblad is een tabstop", () => {
  // Roving tabindex: met Tab kom je de balk in en er weer uit, tussen de
  // tabbladen loop je met de pijltjes. Zonder dit staat er een extra tabstop
  // vóór elke inhoud, op elk scherm.
  assert.match(review.match(/<button[^>]*id="tabRedactie"[^>]*>/)[0], /tabindex="0"/);
  assert.match(review.match(/<button[^>]*id="tabOverheid"[^>]*>/)[0], /tabindex="-1"/);
});

test("het overheidstabblad leest de nieuwspagina zelf, niet de reviewopslag", () => {
  // /api/actueel toont wat er NU live staat (binnen het venster, binnen de cap
  // per tegel). /api/review kent ook records die daar allang buiten vallen.
  assert.match(review, /fetch\("\/api\/actueel"/, "laadGouv haalt /api/actueel op");
});

// ---- De renderfuncties, uit de pagina gehaald ------------------------------

const ifBegin = review.indexOf("function ifDatum(iso){");
const ifEind = review.indexOf("// ---- Geweigerde bron-URL's");
const gouvBegin = review.indexOf("// ---- Tabblad 2: Overheid (.gouv)");
const gouvEind = review.indexOf("// ---- einde tabblad 2");
assert.ok(ifBegin > 0 && ifEind > ifBegin, "IF-renderfuncties niet gevonden in review.html");
assert.ok(gouvBegin > 0 && gouvEind > gouvBegin, "het overheidstabblad niet gevonden in review.html");
const bron = review.slice(ifBegin, ifEind) + "\n" + review.slice(gouvBegin, gouvEind);

function maakRenderer(state) {
  const esc = (x) =>
    String(x == null ? "" : x)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const datum = (d) => String(d || "").slice(0, 10);
  // eslint-disable-next-line no-new-func
  return new Function(
    "esc", "datum", "state",
    `${bron}; return { gouvTegels: gouvTegels, gouvArtikelHtml: gouvArtikelHtml, gouvHtml: gouvHtml, ifBlokHtml: ifBlokHtml };`
  )(esc, datum, state);
}

const leegState = { verwijzingen: {}, ifPaneel: null, gouv: { status: "leeg", tegels: [] } };

const gouvArt = (id, titel, bron, iso, over = {}) => ({
  id,
  soort: "overheid",
  titel,
  summary: `${titel} — in het kort.`,
  url: `https://www.economie.gouv.fr/${id}`,
  bronMeta: { naam: bron, datum: iso },
  bronAantal: 1,
  ...over,
});

// Een levering met twee overheidstegels, een perstegel en een verenigingstegel.
const LEVERING = {
  gebakkenOp: "2026-09-05T08:15:59.189Z",
  tegels: [
    {
      soort: "pers",
      id: "pers-landelijk",
      label: "Landelijk",
      artikelen: [gouvArt("p1", "Perssynthese", "Le Monde", "2026-09-05T07:00:00Z", { soort: "pers" })],
    },
    {
      soort: "overheid",
      id: "overheid-douane",
      label: "Douane",
      artikelen: [
        gouvArt("o-oud", "Oudere douanewijziging", "Douane", "2026-09-01T09:00:00Z"),
        gouvArt("o-nieuw", "Nieuwe douanewijziging", "Douane", "2026-09-03T09:00:00Z"),
      ],
    },
    {
      soort: "overheid",
      id: "overheid-geld-belasting",
      label: "Geld & belasting",
      artikelen: [gouvArt("o-bercy", "Bercy verschuift de aangiftetermijn", "Bercy", "2026-09-04T09:00:00Z")],
    },
    { soort: "verenigingen", id: "verenigingen", label: "Verenigingen", artikelen: [gouvArt("v1", "Kerkdienst", "LOTgenoten", "2026-09-05T06:00:00Z")] },
  ],
};

test("alleen de overheidstegels komen op dit tabblad, nieuwste bovenaan", () => {
  const { gouvTegels } = maakRenderer(leegState);
  const tegels = gouvTegels(LEVERING);
  assert.deepEqual(tegels.map((t) => t.id), ["overheid-geld-belasting", "overheid-douane"],
    "pers en verenigingen horen hier niet, en de tegel met het nieuwste bericht staat bovenaan");
  assert.deepEqual(tegels[1].artikelen.map((a) => a.id), ["o-nieuw", "o-oud"],
    "binnen een tegel ook nieuwste eerst");
  assert.equal(tegels[0].label, "Geld & belasting", "de tegelkop komt uit de levering");
});

test("een lege of vormloze levering levert een lege lijst, geen fout", () => {
  const { gouvTegels } = maakRenderer(leegState);
  assert.deepEqual(gouvTegels(null), []);
  assert.deepEqual(gouvTegels({}), []);
  assert.deepEqual(gouvTegels({ tegels: [{ soort: "overheid", id: "leeg", artikelen: [] }] }), [],
    "een overheidstegel zonder artikelen komt er niet in");
});

test("de kaart toont kop, bron en datum, en verder alleen het Infofrankrijk-blok", () => {
  const { gouvArtikelHtml } = maakRenderer(leegState);
  const uit = gouvArtikelHtml(gouvArt("o1", "Bercy verschuift de aangiftetermijn", "Bercy", "2026-09-04T09:00:00Z"));

  assert.ok(uit.includes("Bercy verschuift de aangiftetermijn"), "de kop");
  assert.ok(uit.includes("<b>Bercy</b>"), "de bron");
  assert.ok(uit.includes("2026-09-04"), "de datum");
  assert.ok(uit.includes('data-id="o1"'), "de kaart draagt het id waarop de IF-acties werken");
  assert.ok(uit.includes('class="ifblok"'), "het Infofrankrijk-blok staat eronder");
  assert.ok(uit.includes('data-if-open="o1"'), "met de knop die het zoekveld opent");
});

test("op het overheidstabblad staat geen enkele publicatieactie", () => {
  const { gouvHtml } = maakRenderer({
    ...leegState,
    gouv: { status: "klaar", tegels: maakRenderer(leegState).gouvTegels(LEVERING), gebakkenOp: LEVERING.gebakkenOp },
  });
  const uit = gouvHtml();

  // De harde toets: het attribuut waarmee elke publicatieknop in deze tool
  // werkt (zie de handler op button[data-act] in review.html) komt hier niet
  // voor. Daarmee kan er ook geen knop bij sluipen die wél iets publiceert.
  assert.ok(!uit.includes("data-act"), "geen enkele knop met een publicatieactie");
  for (const label of ["Publiceer", "Weg", "Toevoegen aan archief", "Van de site halen", "Bewaar tekst"]) {
    assert.ok(!uit.includes(">" + label + "<"), `de knop "${label}" hoort hier niet te staan`);
  }
  // Wel dit: de artikelen, gegroepeerd per tegel, met hun tegelkop.
  assert.ok(uit.includes("Overheid — staat live op /actueel (3)"), "de telling over alle overheidstegels");
  assert.ok(uit.includes("<h3>Douane <span class=\"telling\">2 artikelen</span></h3>"));
  assert.ok(uit.includes("<h3>Geld &amp; belasting <span class=\"telling\">1 artikel</span></h3>"));
  assert.ok(uit.indexOf("Bercy verschuift") < uit.indexOf("Nieuwe douanewijziging"),
    "de tegel met het nieuwste bericht staat bovenaan");
});

test("zonder overheidsartikelen staat er een lege staat, geen kale pagina", () => {
  const { gouvHtml } = maakRenderer({ ...leegState, gouv: { status: "klaar", tegels: [], gebakkenOp: null } });
  assert.ok(gouvHtml().includes("Geen overheidsartikelen live."));
});

test("een mislukte ophaalactie zegt dat, en biedt opnieuw proberen", () => {
  const { gouvHtml } = maakRenderer({ ...leegState, gouv: { status: "fout", tegels: [], fout: "HTTP 502" } });
  const uit = gouvHtml();
  assert.ok(uit.includes("HTTP 502"));
  assert.ok(uit.includes('id="gouvOpnieuw"'));
  assert.match(review, /gouvOpnieuw.*addEventListener/s, "en die knop is ook echt gekoppeld");
});

// ---- Weghalen: op allebei de tabbladen -------------------------------------

test("bij elke bestaande verwijzing staat een knop om hem weg te halen", () => {
  const state = {
    ...leegState,
    verwijzingen: {
      "o-bercy": [
        { ifId: 7, titel: "De SCI", url: "https://infofrankrijk.com/de-sci/" },
        { ifId: 8, titel: "Belastingaangifte", url: "https://infofrankrijk.com/belastingaangifte/" },
      ],
    },
  };
  const { gouvArtikelHtml, ifBlokHtml } = maakRenderer(state);

  // Tabblad 2, op de overheidskaart.
  const opTabblad2 = gouvArtikelHtml(gouvArt("o-bercy", "Bercy", "Bercy", "2026-09-04T09:00:00Z"));
  assert.ok(opTabblad2.includes('data-if-af="7"'), "weghaalknop bij de eerste verwijzing");
  assert.ok(opTabblad2.includes('data-if-af="8"'), "en bij de tweede");
  assert.ok(opTabblad2.includes(">Weghalen<"), "met een leesbaar label, geen naamloos kruisje");
  assert.ok(opTabblad2.includes('aria-label="Verwijzing weghalen: De SCI"'), "en een label dat zegt wélke");

  // Tabblad 1 gebruikt dezelfde functie, dus dezelfde knop. Dat is precies wat
  // hier vastligt: één blok, twee tabbladen.
  const opTabblad1 = ifBlokHtml("o-bercy");
  assert.ok(opTabblad1.includes('data-if-af="7"') && opTabblad1.includes(">Weghalen<"));
  assert.ok(opTabblad2.includes(opTabblad1), "het blok op tabblad 2 is letterlijk hetzelfde blok");
});

test("de weghaalknop roept de actie aan die api/review.js ook echt kent", async () => {
  // data-if-af -> actie "verwijs-weg". Een typefout hier zou pas op productie
  // opvallen, en dan als een knop die niets doet.
  assert.match(review, /data-if-af="[^"]*".*\n?.*actie: "verwijs-weg"/s);
  const route = readFileSync(new URL("../api/review.js", import.meta.url), "utf8");
  assert.match(route, /actie === "verwijs-weg"/, "de route kent die actie");
});

// ---- De keten erachter: van klik tot sondetelling --------------------------
// Het tabblad is alleen zinvol als een verwijzing onder een OVERHEIDSbericht
// dezelfde weg aflegt als onder een persartikel: lib/tegels.js hangt hem aan
// het artikel, lib/levering.js zet hem in de tekst-levering, en de sonde telt
// hem mee. Die keten wordt hier in één keer nagelopen, met de echte
// merge-functie uit scripts/sonde.mjs.

const sonde = readFileSync(new URL("../scripts/sonde.mjs", import.meta.url), "utf8");
const sBegin = sonde.indexOf("function alleArtikelen(data, teksten, archief) {");
const sEind = sonde.indexOf("async function main() {");
assert.ok(sBegin > 0 && sEind > sBegin, "alleArtikelen() niet gevonden in scripts/sonde.mjs");
// eslint-disable-next-line no-new-func
const alleArtikelen = new Function(
  "artikelSleutel",
  `${sonde.slice(sBegin, sEind)}; return alleArtikelen;`
)(artikelSleutel);

test("een verwijzing onder een overheidsbericht telt mee in de sonde-regel", () => {
  const NU = Date.parse("2026-09-05T12:00:00Z");
  const VERS = new Date(NU - 2 * 24 * 60 * 60 * 1000).toISOString();
  const IF = { ifId: 101, titel: "Belastingaangifte in Frankrijk", url: "https://infofrankrijk.com/belastingaangifte/" };

  const tegels = assembleerTegels({
    overheidDocs: [
      {
        id: "o1",
        thema: "geld-belasting",
        bron: "Bercy — Ministère de l'Économie",
        url: "https://www.economie.gouv.fr/actualites/nieuw",
        datum: VERS,
        titelBron: "Nouveau",
        kop: "Bercy kondigt nieuwe aangiftetermijn aan",
        samenvatting: "De termijn voor de aangifte verschuift.",
        gepubliceerdOp: VERS,
      },
    ],
    verwijzingen: [{ id: "o1", items: [IF] }],
    nu: NU,
  });

  const { compact, tekst, archief } = splitsAntwoord({
    bijgewerkt: new Date(NU).toISOString(),
    gebakkenOp: new Date(NU).toISOString(),
    tegels,
    agenda: [],
    bronStatus: [],
  });

  // Zoals de sonde het doet: de drie leveringen samenvoegen en tellen.
  const artikelen = alleArtikelen(compact, tekst, archief);
  const aantal = artikelen.reduce(
    (n, r) => n + (Array.isArray(r.art.verwijzingen) ? r.art.verwijzingen.length : 0),
    0
  );
  const metVerwijzing = artikelen.filter((r) => (r.art.verwijzingen || []).length);
  assert.equal(aantal, 1, "de sonde telt hem mee");
  assert.equal(metVerwijzing.length, 1);
  assert.equal(metVerwijzing[0].art.id, "o1", "en wel onder het overheidsbericht");
  assert.deepEqual(metVerwijzing[0].art.verwijzingen, [{ titel: IF.titel, url: IF.url }]);
  // En hij staat NIET in de compacte levering: dit blok hoort onder de bronnen,
  // dus achter het openklappen. Zie lib/levering.js.
  assert.equal(compact.tegels[0].artikelen[0].verwijzingen, undefined);
});

// ---- De tool echt starten, met een nagebootste DOM -------------------------
// De tests hierboven halen losse functies uit de pagina. Wat ze NIET zien is de
// bedrading eromheen: de tabbladknoppen, het ophalen bij de eerste klik, het
// omzetten van aria-selected. Eén verschrijving daar (een verkeerde
// elementnaam, een functie die pas later gedefinieerd wordt) levert een
// ReferenceError op die geen enkele losse functietest merkt — de pagina blijft
// dan op "Laden…" staan. Daarom wordt het hele script hier één keer echt
// uitgevoerd, tegen een minimale DOM en een nagebootste fetch.

function maakDom() {
  const registry = new Map();
  const maakEl = (naam) => {
    const el = {
      naam,
      innerHTML: "",
      textContent: "",
      disabled: false,
      attrs: new Map(),
      listeners: {},
      getAttribute: (k) => (el.attrs.has(k) ? el.attrs.get(k) : null),
      setAttribute: (k, v) => el.attrs.set(k, String(v)),
      hasAttribute: (k) => el.attrs.has(k),
      removeAttribute: (k) => el.attrs.delete(k),
      addEventListener: (soort, fn) => { (el.listeners[soort] = el.listeners[soort] || []).push(fn); },
      querySelectorAll: () => [],
      querySelector: () => null,
      closest: () => null,
      focus: () => { el.heeftFocus = true; },
      heeftFocus: false,
      klik: () => (el.listeners.click || []).forEach((fn) => fn()),
      toets: (key) => (el.listeners.keydown || []).forEach((fn) => fn({ key, preventDefault: () => {} })),
    };
    return el;
  };
  const haal = (id) => {
    if (!registry.has(id)) registry.set(id, maakEl(id));
    return registry.get(id);
  };
  const tabs = [haal("tabRedactie"), haal("tabOverheid")];
  tabs[0].setAttribute("data-tab", "redactie");
  tabs[0].setAttribute("aria-selected", "true");
  tabs[1].setAttribute("data-tab", "overheid");
  tabs[1].setAttribute("aria-selected", "false");
  const document = {
    getElementById: haal,
    querySelectorAll: (sel) => (sel === ".tab[data-tab]" ? tabs : []),
  };
  return { document, haal, tabs };
}

const REVIEW_PAYLOAD = {
  ok: true,
  concepten: [],
  publicaties: [],
  overheid: [],
  verwijzingen: { "o-bercy": [{ ifId: 7, titel: "De SCI", url: "https://infofrankrijk.com/de-sci/" }] },
  nakijken: [],
  bijnaVerlopen: [],
  bronUrlWeigeringen: [],
};

async function startTool({ actueel = LEVERING } = {}) {
  const { document, haal, tabs } = maakDom();
  const gezien = [];
  const fetchStub = (url) => {
    gezien.push(String(url));
    const body = String(url).startsWith("/api/actueel") ? actueel : REVIEW_PAYLOAD;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  const script = review.slice(review.lastIndexOf("<script>") + "<script>".length, review.lastIndexOf("</script>"));
  // eslint-disable-next-line no-new-func
  new Function("document", "location", "fetch", "window", script)(
    document,
    { search: "?token=geheim" },
    fetchStub,
    { confirm: () => false }
  );
  // De eerste GET afwikkelen (fetch -> json -> render).
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  return { haal, tabs, gezien, inhoud: () => haal("inhoud").innerHTML };
}

test("de tool start op het eerste tabblad en haalt alleen /api/review op", async () => {
  const tool = await startTool();
  assert.ok(tool.inhoud().includes("Concepten"), "de conceptenwachtrij staat er");
  assert.ok(!tool.inhoud().includes("staat live op /actueel"), "en het overheidstabblad nog niet");
  assert.ok(tool.gezien.every((u) => u.startsWith("/api/review")), `onverwachte verzoeken: ${tool.gezien}`);
});

test("klikken op Overheid (.gouv) haalt de nieuwspagina op en toont de tegels", async () => {
  const tool = await startTool();
  tool.tabs[1].klik();
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  assert.ok(tool.gezien.some((u) => u.startsWith("/api/actueel")), "nu pas wordt /api/actueel opgehaald");
  const html = tool.inhoud();
  assert.ok(html.includes("Overheid — staat live op /actueel (3)"));
  assert.ok(html.includes("Nieuwe douanewijziging"), "de artikelen staan er");
  assert.ok(html.includes(">Weghalen<"), "en de bestaande verwijzing kan weg");
  assert.ok(!html.includes("data-act"), "zonder ook maar één publicatieactie");
  assert.equal(tool.tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tool.tabs[0].getAttribute("aria-selected"), "false");
  assert.equal(tool.haal("inhoud").getAttribute("aria-labelledby"), "tabOverheid");

  // Terug naar het eerste tabblad: de conceptenwachtrij, ongewijzigd.
  tool.tabs[0].klik();
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  assert.ok(tool.inhoud().includes("Concepten"));
  assert.equal(tool.tabs[0].getAttribute("aria-selected"), "true");
  // En /api/actueel wordt niet opnieuw opgehaald bij een tweede bezoek.
  const voor = tool.gezien.filter((u) => u.startsWith("/api/actueel")).length;
  tool.tabs[1].klik();
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  assert.equal(tool.gezien.filter((u) => u.startsWith("/api/actueel")).length, voor);
});

test("de pijltjestoetsen verplaatsen tabblad, tabstop en focus", async () => {
  // Hetzelfde patroon als de tabbalk op /actueel (zie de keydown-handler daar).
  // Een tabbalk die alleen met de muis werkt is geen tabbalk.
  const tool = await startTool();
  const [redactie, overheid] = tool.tabs;

  redactie.toets("ArrowRight");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  assert.equal(overheid.getAttribute("aria-selected"), "true");
  assert.equal(overheid.getAttribute("tabindex"), "0", "de tabstop verhuist mee");
  assert.equal(redactie.getAttribute("tabindex"), "-1");
  assert.ok(overheid.heeftFocus, "en de focus ook, anders praat de schermlezer over het verkeerde tabblad");
  assert.ok(tool.inhoud().includes("staat live op /actueel"), "de inhoud volgt");

  overheid.toets("ArrowLeft");
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  assert.equal(redactie.getAttribute("aria-selected"), "true");
  assert.equal(redactie.getAttribute("tabindex"), "0");
  assert.ok(tool.inhoud().includes("Concepten"));

  // Aan de rand blijft hij staan: geen wrap-around, en geen fout.
  redactie.toets("ArrowLeft");
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  assert.equal(redactie.getAttribute("aria-selected"), "true");

  // Andere toetsen blijven van de tabbalk af.
  redactie.toets("Enter");
  redactie.toets("ArrowDown");
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  assert.equal(redactie.getAttribute("aria-selected"), "true");
});
