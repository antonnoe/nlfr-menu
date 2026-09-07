// Een geweigerde API-sleutel moet zichzelf melden (07-09-2026).
// ---------------------------------------------------------------------------
// WAT ER GEBEURDE. Op 6 september viel de perssynthese uit. In het draailog
// stond alleen een telling: "mislukt=5". Dat las als vijf clusters die
// inhoudelijk stukliepen, terwijl het vijf keer dezelfde geweigerde
// ANTHROPIC_API_KEY was — HTTP 401 bij elke aanroep. De diagnose ging daardoor
// de verkeerde kant op (het tokenplafond), en de echte oorzaak kwam pas boven
// water toen de logging van #34/#36 er eenmaal was.
//
// WAT HIER MISGAAT ALS NIEMAND OPLET.
// 1. De foutmelding valt terug op alleen een telling. Dan is een sleutelfout
//    weer niet te onderscheiden van een cluster dat inhoudelijk stukliep.
// 2. De HTTP-status verdwijnt uit de melding. Juist die maakt het verschil
//    tussen "de sleutel deugt niet" (401) en "de dienst had het druk" (429).
// 3. Een 401 wordt per cluster afgehandeld. Dan doet de ronde vier zinloze
//    verzoeken erachteraan en vullen vier identieke regels het log.
// 4. Een 429 of 5xx wordt óók fataal. Dan breekt de ronde af op iets dat bij
//    de volgende aanroep gewoon kan slagen.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  aanroepStoring,
  storingRegel,
  nieuweMeting,
  duiding,
  logRegels,
} from "../lib/persmeting.js";

const CRON = fs.readFileSync(new URL("../api/cron.js", import.meta.url), "utf8");
const SONDE = fs.readFileSync(new URL("../scripts/sonde.mjs", import.meta.url), "utf8");
const CONFIG = fs.readFileSync(new URL("../lib/config.js", import.meta.url), "utf8");

// Zoals de SDK hem gooit: een Error met een .status.
function apiFout(status, bericht = "boem") {
  return Object.assign(new Error(bericht), { status });
}

// --- 1. de reden, niet alleen de telling -----------------------------------

test("een 401 wordt herkend als de API-sleutel, met zijn status", () => {
  const s = aanroepStoring(apiFout(401));
  assert.equal(s.soort, "sleutel");
  assert.equal(s.status, 401);
  assert.equal(s.fataal, true);
  assert.match(s.reden, /API-sleutel/, "de melding hoort te zeggen dat het de sleutel is");
  assert.match(s.reden, /HTTP 401/, "met de status erbij");
  assert.match(s.reden, /ANTHROPIC_API_KEY/, "en de naam van de omgevingsvariabele");
});

test("een 403 telt net zo goed als een sleutelprobleem", () => {
  const s = aanroepStoring(apiFout(403));
  assert.equal(s.soort, "sleutel");
  assert.equal(s.status, 403);
  assert.equal(s.fataal, true);
});

test("een status uit de tekst wordt alsnog gevonden", () => {
  // Sommige omhullingen geven de status niet als veld door. De tekstterugval
  // kan een status alleen TOEVOEGEN, nooit een gevonden status overschrijven.
  const s = aanroepStoring(new Error('401 {"type":"error","error":{"type":"authentication_error"}}'));
  assert.equal(s.soort, "sleutel");
  assert.equal(s.status, 401);
  const veld = aanroepStoring(Object.assign(new Error("401 in de tekst"), { status: 529 }));
  assert.equal(veld.status, 529, "het veld wint van de tekst");
  assert.equal(veld.soort, "aanroep");
});

test("de logregel noemt de reden en de status, niet alleen dat het misging", () => {
  const regel = storingRegel(aanroepStoring(apiFout(401)), "1mow509");
  assert.match(regel, /^\[pers\] synthese afgebroken voor cluster 1mow509: /);
  assert.match(regel, /API-sleutel/);
  assert.match(regel, /HTTP 401/);
  // Precies één keer: "HTTP 401 de API-sleutel wordt geweigerd (HTTP 401)" is
  // wat er uitkomt als de status er twee keer aan wordt geplakt.
  assert.equal(regel.split("HTTP 401").length - 1, 1);
});

test("een andere fout houdt zijn status en zijn eigen tekst", () => {
  const regel = storingRegel(aanroepStoring(apiFout(529, "Overloaded")), "ssme50");
  assert.match(regel, /synthese mislukt voor cluster ssme50: HTTP 529 — Overloaded/);
  const zonder = storingRegel(aanroepStoring(new Error("geen tekstblok")), "vv3s6d");
  assert.match(zonder, /synthese mislukt voor cluster vv3s6d: geen tekstblok/);
  assert.ok(!zonder.includes("HTTP"), "geen verzonnen status als die er niet is");
});

// --- 2. een sleutelfout is geen clusterprobleem ----------------------------

test("alleen een sleutelfout breekt de ronde af", () => {
  assert.equal(aanroepStoring(apiFout(401)).fataal, true);
  assert.equal(aanroepStoring(apiFout(403)).fataal, true);
  // Deze kunnen bij de volgende aanroep gewoon slagen; daar hoort de ronde niet
  // op te stoppen.
  for (const status of [429, 500, 503, 529]) {
    assert.equal(aanroepStoring(apiFout(status)).fataal, false, status + " hoort niet fataal te zijn");
    assert.equal(aanroepStoring(apiFout(status)).status, status, "maar zijn status hoort wel bekend");
  }
  assert.equal(aanroepStoring(new Error("geen tekstblok")).fataal, false);
});

test("de cron stopt de lus bij een fatale storing en zegt hoeveel er overblijft", () => {
  const lus = CRON.slice(CRON.indexOf("const storing = aanroepStoring(e);"), CRON.indexOf("drukMeting(meting)"));
  assert.match(lus, /console\.error\(storingRegel\(storing, id\)\)/, "de reden gaat naar het log");
  assert.match(lus, /if \(storing\.fataal\) \{/, "en alleen dan stopt de ronde");
  assert.match(lus, /meting\.storing = \{/, "de storing wordt vastgelegd");
  assert.match(lus, /niet meer aangeroepen/, "met hoeveel kandidaten er niet meer zijn geprobeerd");
  assert.match(lus, /\n\s*break;/, "de lus breekt af");
  // De oude regel, die alleen de kale message afdrukte, hoort weg te zijn.
  assert.ok(!CRON.includes("console.error(`[pers] synthese mislukt voor cluster ${id}: ${reden}`)"),
    "de kale foutregel zonder status hoort vervangen te zijn");
});

// --- 3. de meting en de bewaking dragen hem mee ----------------------------

test("een verse meting heeft nog geen storing", () => {
  assert.equal(nieuweMeting(0).storing, null);
});

test("een sleutelstoring overstemt elke andere duiding", () => {
  const m = nieuweMeting(0);
  m.storing = { soort: "sleutel", status: 401, reden: "de API-sleutel wordt geweigerd (HTTP 401)" };
  const d = duiding(m);
  assert.match(d, /afgebroken/);
  assert.match(d, /API-sleutel/);
  // Zonder storing wint de gewone duiding weer.
  assert.notEqual(duiding(nieuweMeting(0)), d);
});

test("de storing staat in het draailog van de ronde", () => {
  const m = nieuweMeting(0);
  m.storing = { soort: "sleutel", status: 401, reden: "de API-sleutel wordt geweigerd (HTTP 401)" };
  const regels = logRegels(m).join("\n");
  assert.match(regels, /STORING: sleutel \(HTTP 401\)/);
  assert.ok(!logRegels(nieuweMeting(0)).join("\n").includes("STORING"),
    "zonder storing hoort die regel er niet te staan");
});

test("de bewaking krijgt de storing mee, en wist hem vanzelf", () => {
  const blok = CRON.slice(CRON.indexOf("const bewakingNu = {"), CRON.indexOf("let snapshot;"));
  assert.match(blok, /storing: meting\.storing \|\| null/,
    "het bewakingsblok draagt de storing van DEZE ronde");
  // bewakingNu wordt elke ronde opnieuw opgebouwd uit een verse meting, dus een
  // opgeloste storing verdwijnt zonder dat iemand iets hoeft op te ruimen.
  assert.match(CRON, /const meting = nieuweMeting\(/, "elke ronde begint met een verse meting");
});

// --- 4. de sonde meldt het als eigen bevinding -----------------------------

test("I17 meldt de storing zelf, zonder op I15 te wachten", () => {
  const blok = SONDE.slice(SONDE.indexOf("// I17."), SONDE.indexOf("// I15."));
  assert.match(blok, /if \(bewaking\.storing\)/, "hij leest het veld uit de bewaking");
  assert.match(blok, /meld\(\s*"I17 modelaanroep"/, "en meldt het als eigen invariant");
  assert.match(blok, /HTTP \$\{st\.status\}/, "met de HTTP-status erbij");
  assert.match(blok, /st\.reden/, "en met de reden");
  // I17 staat vóór de stiltetoets van I15, zodat de oorzaak boven het gevolg
  // komt te staan in het verslag. Niet vergelijken met de naam "I15 persketen":
  // die staat óók in de tak die een ontbrekend bewakingsblok meldt, hoger in het
  // bestand, en dan slaagt de toets om de verkeerde reden.
  assert.ok(SONDE.indexOf('"I17 modelaanroep"') < SONDE.indexOf("geen concept aangemaakt"),
    "de oorzaak hoort boven het gevolg te staan");
});

// --- 5. het commentaar dat de verkeerde conclusie voorkomt -----------------

test("lib/config.js noemt de echte oorzaak van september, met datum", () => {
  const kop = CONFIG.slice(0, CONFIG.indexOf("maxTokens:"));
  assert.match(kop, /6 september 2026/i, "de datum van de storing");
  assert.match(kop, /ANTHROPIC_API_KEY/, "en de werkelijke oorzaak");
  assert.match(kop, /401/, "met de status die erbij hoorde");
  assert.match(kop, /I17/, "en de wegwijzer naar wat het nu wél zou melden");
  // De oude tekst stelde het tokenplafond als oorzaak. Dat mag er staan als
  // mogelijkheid, maar niet als verklaring van deze storing.
  assert.match(kop, /verklaring was FOUT|niet wat er in september gebeurde/,
    "de onjuiste verklaring hoort als onjuist gemarkeerd te zijn");
});
