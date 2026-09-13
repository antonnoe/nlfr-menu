// De meetkant in index.html: welke naam een ingang krijgt, en wat er NIET wordt
// meegestuurd.
// ---------------------------------------------------------------------------
// DE PRIVACYGRENS STAAT IN CODE, DUS HOORT HIJ IN EEN TOETS. Deze meting telt
// per dag per ingang en verder niets: geen cookie, geen sessie, geen
// bezoeker-id, en niet de pagina waarop het menu stond. Dat is geen detail maar
// de reden dat er geen toestemming gevraagd hoeft te worden en dat er geen
// persoonsgegevens in de opslag staan. Eén regel die er een id bij zet, en dat
// verandert — zonder dat iemand het aan de cijfers ziet.
//
// De functie wordt UIT index.html gehaald en daar uitgevoerd: een test op een
// overgeschreven kopie blijft groen terwijl het menu iets anders doet.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function pak(van, tot) {
  const a = HTML.indexOf(van), b = HTML.indexOf(tot);
  assert.ok(a >= 0 && b > a, "blok niet gevonden in index.html: " + van);
  return HTML.slice(a, b);
}

const MEETBLOK = pak("  var MEET_URL =", "  // ---- Opstarten");

const meetDoel = new Function(
  "location",
  pak("  function meetDoel(href){", "  function meetZone(a){") + "\nreturn meetDoel;"
)({ href: "https://nlfr-menu.vercel.app/index.html" });

// ---- De naam van een bestemming --------------------------------------------

test("een link naar de eigen site wordt herkenbaar aan zijn pad", () => {
  assert.equal(meetDoel("https://www.nederlanders.fr/page/onroerend-goed"), "nlfr/page/onroerend-goed");
  assert.equal(meetDoel("https://nederlanders.fr/page/lezen"), "nlfr/page/lezen", "met of zonder www is dezelfde pagina");
});

test("het anker telt mee, anders belanden alle homepage-ingangen op één hoop", () => {
  // "Recente activiteiten" wijst naar de homepage MET anker; zonder het anker
  // is die klik niet te onderscheiden van een klik op het logo.
  assert.equal(meetDoel("https://www.nederlanders.fr/#xg_network_activity"), "nlfr~xg_network_activity");
  assert.notEqual(
    meetDoel("https://www.nederlanders.fr/#xg_network_activity"),
    meetDoel("https://www.nederlanders.fr/")
  );
});

test("bij een externe bestemming is de host het antwoord, kort gehouden", () => {
  assert.equal(
    meetDoel("https://nlfr-nieuwsbrief.vercel.app/api/nieuwsbrief"),
    "nlfr-nieuwsbrief.vercel.app/api/nieuwsbrief"
  );
  const aanmelden = meetDoel(
    "https://communities-abroad-c.email-provider.eu/memberforms/subscribe/standalone/form/?a=0f1aywezl2&l=ysinmqgflb"
  );
  assert.equal(aanmelden, "communities-abroad-c.email-provider.eu/memberforms/subscribe");
  assert.ok(aanmelden.length < 70, "een id moet binnen de grens van de server passen: " + aanmelden.length);
});

test("wat geen http-link is, wordt niet geteld", () => {
  assert.equal(meetDoel("javascript:void(0)"), "");
  assert.equal(meetDoel("mailto:iemand@voorbeeld.nl"), "");
  assert.equal(meetDoel(""), "", "een lege href verwijst naar de pagina zelf");
  assert.equal(meetDoel("#"), "", "en een kale # nergens heen");
});

// ---- De privacygrens --------------------------------------------------------

test("de meting draagt geen identiteit met zich mee", () => {
  for (const verboden of ["cookie", "localStorage", "sessionStorage", "Math.random", "crypto.randomUUID"]) {
    assert.ok(!MEETBLOK.includes(verboden),
      `het meetblok gebruikt ${verboden} — dat maakt er een herkenbare bezoeker van`);
  }
});

test("de meting stuurt niet mee op welke pagina het menu stond", () => {
  // document.referrer is de pagina waarop dit iframe staat. Met tijdstippen
  // erbij benadert dat een leesprofiel per bezoeker; daar is deze teller niet
  // voor en daar hoort hij niet voor gebruikt te kunnen worden.
  assert.ok(!MEETBLOK.includes("referrer"), "het meetblok leest de verwijzende pagina uit");
  assert.ok(!/gebeurtenissen:\s*meetRij\s*,/.test(MEETBLOK), "er gaat meer mee dan de gebeurtenissen zelf");
  assert.match(MEETBLOK, /JSON\.stringify\(\{ gebeurtenissen: meetRij \}\)/,
    "de lading hoort uit niets anders te bestaan dan de gebeurtenissen");
});

// ---- De aansluiting ---------------------------------------------------------

test("een klik gaat er meteen uit, want daarna navigeert de pagina weg", () => {
  assert.match(MEETBLOK, /meet\("klik", meetZone\(a\) \+ "\/" \+ doel\);\s*\n\s*meetSpoel\(\);/,
    "zonder directe verzending is de klik weg zodra de pagina wisselt");
  assert.match(MEETBLOK, /navigator\.sendBeacon/, "en sendBeacon is het enige dat dat overleeft");
});

test("de rest gaat mee als de pagina verdwijnt", () => {
  assert.match(MEETBLOK, /addEventListener\("pagehide", meetSpoel\)/);
  assert.match(MEETBLOK, /visibilityState === "hidden"/, "op mobiel vuurt pagehide lang niet altijd");
});

test("de weergave wordt geteld, want zonder noemer zegt een klikaantal niets", () => {
  assert.match(HTML, /\/\/ ---- Opstarten[\s\S]{0,200}?meet\("weergave"\)/,
    "de weergave hoort bij het opstarten geteld te worden");
});

test("een lade telt alleen bij openen, niet bij sluiten", () => {
  // openLade() wordt ook aangeroepen om te sluiten; die tak keert eerder terug.
  // Staat de telling vóór die afslag, dan telt elke sluitklik als een opening
  // en verdubbelt het getal ongeveer.
  const openLade = pak("  function openLade(naam, knop){", "  function ladeHTML(");
  const afslag = openLade.indexOf("sluitLade(); report(); return;");
  const telling = openLade.indexOf('meet("lade", naam)');
  assert.ok(afslag >= 0 && telling > afslag, "de telling hoort NA de sluit-afslag te staan");
  assert.match(pak("  function zetPaneel(open){", "  // ---- Lade"), /if \(open\) meet\("lade", "paneel"\)/);
});

test("meten mag het menu niet kunnen breken", () => {
  // Dit iframe staat op elke pagina van de site. Een fout in de teller mag daar
  // nooit doorheen slaan.
  assert.match(MEETBLOK, /function meetSpoel\(\)\{[\s\S]*?try \{/, "de verzending staat in een try");
  assert.match(MEETBLOK, /catch \(e\) \{ \/\* meten mag het menu niet in de weg zitten \*\/ \}/);
});
