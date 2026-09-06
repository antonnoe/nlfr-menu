// Meldingen over de browseropslag van de reviewtool: opschonen en beoordelen.
// ---------------------------------------------------------------------------
// WAAROM DIT NAAR DE SERVER GAAT. De diagnose stond alleen op het scherm van de
// telefoon, en juist daar was hij onleesbaar: op Android verscheen en verdween
// hij binnen een fractie van een seconde, te snel om te lezen en te snel voor
// een schermafdruk. Een diagnose die je alleen kunt zien als alles al goed gaat,
// is geen diagnose.
//
// Elke melding gaat daarom mee met het token dat de redacteur tóch al intikt —
// dat is precies het probleem dat we onderzoeken, dus dat gebeurt elk bezoek.
// Geen ongeauthenticeerde schrijfroute: die zou een vreemde in staat stellen de
// ring vol te duwen en Antons metingen eruit te drukken.
//
// Pure module: meldingen in, opgeschoonde meldingen en een oordeel uit. Geen
// fetch, geen KV, geen Date.now() — het moment komt van de aanroeper.

import { OPSLAGMELDING_MAX } from "./config.js";

// Geen enkel veld uit de browser wordt ongezien overgenomen. Wat hier niet in
// staat, komt er niet in; wat te lang is, wordt afgekapt. Een diagnoseregel
// hoort de opslag niet te kunnen laten vollopen.
const MAX_TEKST = 300;
const WAAR = ["local", "session", "geheugen"];

function tekst(v, max = MAX_TEKST) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, max) : null;
}
function bool(v) {
  return v === true ? true : v === false ? false : null;
}
function getal(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 9999) : null;
}

// Eén binnengekomen melding naar de vorm waarin hij bewaard wordt. `op` komt
// van de SERVER en niet uit de browser: een klok die verkeerd staat (of met
// opzet verkeerd wordt gezet) mag de volgorde van de ring niet bepalen.
export function normaliseerMelding(ruw, opIso) {
  const r = ruw && typeof ruw === "object" ? ruw : {};
  return {
    op: opIso,
    waar: WAAR.includes(r.waar) ? r.waar : "onbekend",
    localReden: tekst(r.localReden),
    sessionReden: tekst(r.sessionReden),
    ingebed: bool(r.ingebed),
    // Het baken van het VORIGE bezoek. Dit is het veld waar alles om draait:
    // het onderscheidt "de browser weigert te schrijven" van "de browser heeft
    // het geschrevene later opgeruimd".
    vorigBaken: tekst(r.vorigBaken, 40),
    bakenGeschreven: bool(r.bakenGeschreven),
    tokenGeschreven: bool(r.tokenGeschreven),
    // Hoe vaak de diagnose opnieuw is getekend, en hoe vaak hij daarbij zou
    // zijn verborgen. Dat tweede getal is de meting van het knipperen.
    getekend: getal(r.getekend),
    zouVerbergen: getal(r.zouVerbergen),
    ua: tekst(r.ua, 400),
  };
}

// Herkent de browser aan zijn eigen opgave. Alleen gebruikt om een oordeel te
// duiden, nooit om gedrag op te hangen: een UA is een zelfverklaring en kan
// liegen. Voor het oordeel hieronder telt het GEMETEN gedrag, de naam is de
// aanwijzing waar de instelling te vinden is.
export function browserNaam(ua) {
  const s = String(ua || "");
  if (/SamsungBrowser\//.test(s)) return "Samsung Internet";
  if (/FBAN|FBAV|FB_IAB/.test(s)) return "Facebook-app";
  if (/Instagram/.test(s)) return "Instagram-app";
  if (/EdgA?\//.test(s)) return "Edge";
  if (/Firefox\//.test(s)) return "Firefox";
  if (/CriOS|Chrome\//.test(s)) return "Chrome";
  if (/Safari\//.test(s)) return "Safari";
  return null;
}

// ---- Het oordeel -----------------------------------------------------------
// DRIE UITKOMSTEN, en ze wijzen elk een andere oplossing aan:
//
//   schrijven-mislukt     De browser weigert weg te schrijven. Een cookie van de
//                         server helpt hier NIET; er is geen plek om iets te
//                         bewaren zolang die stand duurt.
//   gewist-tussen-bezoeken De browser schreef wél weg en las het terug, maar bij
//                         het volgende bezoek was alles weg — token én baken.
//                         Dat is geen mislukte schrijfactie maar een opruiming
//                         achteraf: precies wat "sitegegevens wissen bij
//                         afsluiten" doet (Samsung Internet heeft die
//                         instelling, en hij staat daar niet standaard aan).
//   onbekend              Nog te weinig bezoeken om die twee te scheiden. Eén
//                         melding kan het verschil niet maken, en dan zegt dit
//                         dat ook in plaats van te kiezen.
//
// Het oordeel steunt op het GEMETEN gedrag over twee bezoeken, niet op de
// browsernaam. Die naam komt er alleen bij te staan om te kunnen zeggen waar de
// instelling zit.
export function beoordeelMeldingen(meldingen) {
  const lijst = (meldingen || []).filter(Boolean);
  if (!lijst.length) return { code: "geen-meldingen", tekst: "Er is nog geen melding binnengekomen." };

  const nieuwste = lijst[0];
  const naam = browserNaam(nieuwste.ua);
  const waar = naam ? ` (${naam})` : "";

  if (nieuwste.waar !== "local") {
    return {
      code: "schrijven-mislukt",
      browser: naam,
      tekst:
        `De browser${waar} bewaart niets blijvend: opslag=${nieuwste.waar}` +
        (nieuwste.localReden ? `, localStorage gaf "${nieuwste.localReden}"` : "") +
        ". Een cookie van de server lost dit niet op — er is geen plek om iets te bewaren.",
    };
  }

  // localStorage werkt en het token IS weggeschreven (teruggelezen), maar er
  // was geen spoor van het vorige bezoek. Dat is een opruiming achteraf.
  const geschreven = lijst.filter((m) => m.tokenGeschreven === true);
  const zonderSpoor = lijst.filter((m) => m.waar === "local" && !m.vorigBaken);
  if (geschreven.length >= 1 && zonderSpoor.length >= 2) {
    return {
      code: "gewist-tussen-bezoeken",
      browser: naam,
      tekst:
        `De browser${waar} schrijft het token weg en leest het terug, maar bij een volgend bezoek is ` +
        `álles weg — token én baken — terwijl de opslag dan gewoon werkt. Dat is geen mislukte ` +
        `schrijfactie maar een opruiming achteraf: de instelling die sitegegevens wist bij het ` +
        `afsluiten van de browser` +
        (naam === "Samsung Internet"
          ? ". In Samsung Internet: Instellingen → Persoonlijke browsegegevens → Persoonlijke gegevens verwijderen bij afsluiten."
          : ".") +
        ` Gemeten over ${zonderSpoor.length} bezoeken zonder spoor van het vorige.`,
    };
  }

  return {
    code: "onbekend",
    browser: naam,
    tekst:
      `Nog te weinig bezoeken om "schrijven mislukt" van "achteraf opgeruimd" te scheiden. ` +
      `${lijst.length} melding${lijst.length === 1 ? "" : "en"}, ${zonderSpoor.length} zonder spoor van een vorig bezoek. ` +
      `Open /review nog een keer op hetzelfde toestel.`,
  };
}

// Nieuwe melding vooraan, ring afgekapt. Nieuwste eerst, want dat is de
// volgorde waarin je ze leest.
export function voegToe(ring, melding, max = OPSLAGMELDING_MAX) {
  return [melding, ...(Array.isArray(ring) ? ring : []).filter(Boolean)].slice(0, max);
}
