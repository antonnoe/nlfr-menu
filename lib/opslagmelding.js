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
    // De vorm van het token bij het OPSLAAN en bij het VERSTUREN: lengte plus
    // een korte, niet-omkeerbare vingerafdruk. Nooit het token zelf — deze ring
    // is te lezen met het beheertoken, en een verkeerd token kan van alles zijn.
    // Verschillen de twee, dan is het token tussen twee bezoeken door veranderd.
    vormBijOpslaan: tekst(r.vormBijOpslaan, 40),
    vormVerstuurd: tekst(r.vormVerstuurd, 40),
    tokenGewijzigd: bool(r.tokenGewijzigd),
    uitUrl: bool(r.uitUrl),
    // Hoe vaak de diagnose opnieuw is getekend, en hoe vaak hij daarbij zou
    // zijn verborgen. Dat tweede getal is de meting van het knipperen.
    getekend: getal(r.getekend),
    zouVerbergen: getal(r.zouVerbergen),
    ua: tekst(r.ua, 400),
  };
}

// Herkent browser én toestel aan de eigen opgave van de browser. Alleen
// gebruikt om een oordeel te duiden, nooit om gedrag op te hangen: een
// user-agent is een zelfverklaring en kan liegen. Voor het oordeel telt het
// GEMETEN gedrag; de naam is de aanwijzing waar de instelling te vinden is.
//
// HET TOESTEL HOORT ERBIJ. Zonder platform heten een telefoon en een desktop
// allebei "Chrome", en dan staan er twee identieke regels boven twee heel
// verschillende metingen — precies de vraag die je met deze lijst beantwoordt.
export function browserNaam(ua) {
  const s = String(ua || "");
  if (!s.trim()) return null;

  const platform = /Android/.test(s)
    ? "Android"
    : /iPhone|iPad|iPod/.test(s)
    ? "iOS"
    : /Windows/.test(s)
    ? "Windows"
    : /Macintosh|Mac OS X/.test(s)
    ? "Mac"
    : /Linux/.test(s)
    ? "Linux"
    : null;

  // Volgorde telt: een ingebouwde app-browser draagt óók "Chrome" of "Safari"
  // in zijn user-agent, en dat is niet wat je wilt lezen.
  const browser = /SamsungBrowser\//.test(s)
    ? "Samsung Internet"
    : /FBAN|FBAV|FB_IAB/.test(s)
    ? "Facebook-app"
    : /Instagram/.test(s)
    ? "Instagram-app"
    : /EdgA?\//.test(s)
    ? "Edge"
    : /Firefox\//.test(s)
    ? "Firefox"
    : /CriOS|Chrome\//.test(s)
    ? "Chrome"
    : /Safari\//.test(s)
    ? "Safari"
    : null;

  if (!browser) return platform;
  return platform ? `${browser} op ${platform}` : browser;
}

// ---- Het oordeel -----------------------------------------------------------
// PER TOESTEL, en dat is niet vrijblijvend. De ring bevat de meldingen van élke
// browser die /review opent: de telefoon die onderzocht wordt én de desktop
// waarop het resultaat wordt gelezen. Eén oordeel over die hoop trekt de
// verkeerde conclusie op twee manieren tegelijk. Het keek naar de NIEUWSTE
// melding, en dat is bijna altijd de desktop waarop je zit te lezen — dus ging
// het oordeel over het verkeerde apparaat. En het telde "geen spoor van een
// vorig bezoek" over alle toestellen samen, terwijl elke browser die hier voor
// het eerst komt er per definitie één oplevert; twee verse desktops zouden
// samen een telefoon aanwijzen die niets mankeert.
//
// VIER UITKOMSTEN, en ze wijzen elk iets anders aan:
//
//   opslag-werkt          De browser schrijft weg én vindt het bij een volgend
//                         bezoek terug. Er is hier niets te repareren. Deze
//                         uitkomst ontbrak, en dat was de ergste: een toestel
//                         waar alles goed ging viel door naar "onbekend", en
//                         dan stond er "open /review nog een keer" tegen iemand
//                         die het al zes keer had gedaan.
//   schrijven-mislukt     De browser weigert weg te schrijven. Een cookie van de
//                         server helpt hier NIET; er is geen plek om iets te
//                         bewaren zolang die stand duurt.
//   gewist-tussen-bezoeken De browser schreef wél weg en las het terug, maar bij
//                         het volgende bezoek was alles weg — token én baken.
//                         Dat is geen mislukte schrijfactie maar een opruiming
//                         achteraf: precies wat "sitegegevens wissen bij
//                         afsluiten" doet (Samsung Internet heeft die
//                         instelling, en hij staat daar niet standaard aan).
//   eerste-bezoek         Deze browser is hier één keer geweest. Er valt nog
//                         niets te vergelijken, en dat zegt het dan ook.
//
// Het oordeel steunt op het GEMETEN gedrag, niet op de browsernaam. Die naam
// komt er alleen bij te staan om te kunnen zeggen waar de instelling zit.
function oordeelVoorToestel(lijst) {
  const nieuwste = lijst[0];
  const naam = browserNaam(nieuwste.ua);

  // EEN GEWIJZIGD TOKEN GAAT VOOR. Het is geen opslagprobleem: er wordt keurig
  // bewaard en teruggelezen, alleen staat er iets anders op die plek dan wat
  // erin ging. Dat onder "opslag werkt" laten vallen zou de storing wegpoetsen.
  const gewijzigd = lijst.filter((m) => m.tokenGewijzigd === true);
  if (gewijzigd.length) {
    const g = gewijzigd[0];
    return {
      code: "token-veranderd",
      tekst:
        `Het bewaarde beheertoken is veranderd sinds het werd opgeslagen. Weggeschreven: ` +
        `${g.vormBijOpslaan || "onbekend"}, teruggelezen: ${g.vormVerstuurd || "onbekend"}` +
        (g.uitUrl ? ". Dit token kwam uit de adresbalk en overschreef het bewaarde token" : "") +
        `. Dat is geen verlopen token maar een andere waarde op die plek: een oude snelkoppeling met ` +
        `?token=…, autovullen bij het opslaan, of iets anders dat over deze sleutel heen schrijft.`,
    };
  }

  if (nieuwste.waar !== "local") {
    return {
      code: "schrijven-mislukt",
      tekst:
        `Bewaart niets blijvend: opslag=${nieuwste.waar}` +
        (nieuwste.localReden ? `, localStorage gaf "${nieuwste.localReden}"` : "") +
        ". Een cookie van de server lost dit niet op, er is geen plek om iets te bewaren.",
    };
  }

  // Twee of meer bezoeken van DIT toestel, en geen enkele vond het spoor van de
  // vorige terug, terwijl er wel steeds is weggeschreven. Dan is er tussendoor
  // opgeruimd.
  const zonderSpoor = lijst.filter((m) => !m.vorigBaken).length;
  if (lijst.length >= 2 && zonderSpoor === lijst.length && lijst.some((m) => m.tokenGeschreven === true)) {
    return {
      code: "gewist-tussen-bezoeken",
      tekst:
        `Schrijft het token weg en leest het terug, maar bij elk volgend bezoek is álles weg, ` +
        `token én baken, terwijl de opslag dan gewoon werkt. Dat is geen mislukte schrijfactie maar een ` +
        `opruiming achteraf: de instelling die sitegegevens wist bij het afsluiten van de browser` +
        (/^Samsung Internet/.test(naam || "")
          ? ". In Samsung Internet: Instellingen → Persoonlijke browsegegevens → Persoonlijke gegevens verwijderen bij afsluiten."
          : ".") +
        ` Gemeten over ${lijst.length} bezoeken.`,
    };
  }

  // Het spoor van het vorige bezoek is teruggevonden. Dan werkt het, en dat is
  // een antwoord en geen tussenstand.
  if (nieuwste.vorigBaken) {
    return {
      code: "opslag-werkt",
      tekst:
        `Bewaart het token en vindt het bij een volgend bezoek terug. Laatste bezoek daarvóór: ` +
        `${nieuwste.vorigBaken}. Hier is niets te repareren. Let op: dit zegt niets over een browser die ` +
        `tussendoor helemaal wordt AFGESLOTEN. Om dat te toetsen moet de browser echt dicht en daarna weer open.`,
    };
  }

  return {
    code: "eerste-bezoek",
    tekst:
      `Eén bezoek van dit toestel, dus nog niets om mee te vergelijken. Open /review nog een keer ` +
      `op ditzelfde toestel.`,
  };
}

// Eén oordeel per toestel, in de volgorde waarin ze voor het laatst van zich
// lieten horen. Toestellen worden gescheiden op hun user-agent: grover kan niet
// (er is geen identiteit) en fijner hoeft niet.
export function beoordeelMeldingen(meldingen) {
  const lijst = (meldingen || []).filter(Boolean);
  const groepen = new Map();
  for (const m of lijst) {
    const sleutel = m.ua || "onbekend toestel";
    if (!groepen.has(sleutel)) groepen.set(sleutel, []);
    groepen.get(sleutel).push(m);
  }
  return [...groepen.entries()].map(([ua, eigen]) => ({
    ua,
    browser: browserNaam(ua),
    aantal: eigen.length,
    laatste: eigen[0].op,
    ...oordeelVoorToestel(eigen),
  }));
}

// Nieuwe melding vooraan, ring afgekapt. Nieuwste eerst, want dat is de
// volgorde waarin je ze leest.
export function voegToe(ring, melding, max = OPSLAGMELDING_MAX) {
  return [melding, ...(Array.isArray(ring) ? ring : []).filter(Boolean)].slice(0, max);
}
