// De redactieregels van Nederlanders.fr: ÉÉN bestand (20-11-2026).
// ---------------------------------------------------------------------------
// Prompt (lib/selectie/kern.js), /redactie (via /api/selectie), de poort
// (lib/overheidpoort.js, lib/poort.js), de zeven en de tests lezen dit bestand.
// Het bevat alleen regels die al besloten zijn of al in de code stonden; per
// regel staat de herkomst. Geen imports, zodat elke module het kan laden.
// De leesbare versie staat in docs/redactieregels.md; test/redactieregels.test.mjs
// houdt beide gelijk. Een nieuwe regel hoort hier en in dat document, niet elders.

// ---- Waarden -----------------------------------------------------------------
// Drempel: onder deze modelscore is een bericht "niet relevant" (plek weg) en
// komt een overheidsbericht niet live. Eén plek; config.js geeft hem door.
export const SCORE_DREMPEL = 40;
// Minstens zoveel onafhankelijke kranten voor een synthese (nieuwspagina).
export const MIN_KRANTEN = 2;
// Selectiestroom: per bron per ronde hooguit zoveel (de nieuwste). Instelbaar.
export const SELECTIE_MAX_PER_BRON = 15;
export const SELECTIE_MAX_PER_BRON_UITZONDERING = { "Google News NL": 40, "Google News BE": 40 };
// Leersignaal: hooguit zoveel voorbeelden per soort (go, no-go) en zoveel tekens per regel.
export const VOORBEELDEN_MAX_PER_SOORT = 25;
export const VOORBEELD_MAX_TEKENS = 260;
// Meten: de regel op /redactie verschijnt pas bij minstens zoveel besluiten, en telt de laatste zoveel dagen.
export const METEN_MIN_BESLUITEN = 5;
export const METEN_DAGEN = 7;

// ---- De vijf plekken -----------------------------------------------------------
// losMag: mag een los krantenbericht (één krant) hier komen? Besluit opdrachtgever.
// volgtNieuwspagina: nieuwsbrief en Infopoche lezen /api/actueel, dus alleen met de nieuwspagina erbij.
export const PLEKKEN_VIJF = [
  { id: "nieuwspagina", kort: "nieuwspagina", naam: "Nieuwspagina", uitleg: "Frankrijknieuws op Nederlanders.fr", losMag: false, volgtNieuwspagina: false },
  { id: "nieuwsbrief", kort: "nieuwsbrief", naam: "Nieuwsbrief", uitleg: "De dagelijkse brief van morgen", losMag: false, volgtNieuwspagina: true },
  { id: "infopoche", kort: "Infopoche", naam: "Infopoche", uitleg: "De app", losMag: false, volgtNieuwspagina: true },
  { id: "zijbalk", kort: "zijbalk", naam: "Zijbalk", uitleg: "Het nieuwsblok naast het forum", losMag: true, volgtNieuwspagina: false },
  { id: "infofrankrijk", kort: "Infofrankrijk", naam: "Infofrankrijk", uitleg: "Het nieuwsblok op Infofrankrijk", losMag: true, volgtNieuwspagina: false },
];
export const PLEK_IDS = PLEKKEN_VIJF.map((p) => p.id);
export const LOS_PLEKKEN = PLEKKEN_VIJF.filter((p) => p.losMag).map((p) => p.id);
export const LOS_TEKST = "Eén krant: volgens de huisregel niet op nieuwspagina, nieuwsbrief en Infopoche.";

// ---- Rubrieken ------------------------------------------------------------------
export const RUBRIEKEN = ["algemeen", "ondernemers", "reizen", "meteo", "regelgeving"];
export const RUBRIEK_LABEL = {
  algemeen: "Algemeen nieuws",
  ondernemers: "Ondernemersnieuws",
  reizen: "Reisnieuws",
  meteo: "Meteo",
  regelgeving: "Wet- en regelgeving",
};

// ---- Kennisdomeinen voor Café Claude ----------------------------------------------
export const CAFE_DOMEINEN = ["geld", "bureaucratie", "zorg", "wonen"];

// ---- Redenen bij Nee op /redactie -------------------------------------------------
export const REDENEN = ["Niet relevant", "Dubbel", "Te oud", "Buitenland"];

// ---- Frankrijk-woordenlijsten ------------------------------------------------------
// Twee lijsten bestonden naast elkaar en geven bewust niet dezelfde uitkomst
// (deelwoord of woordbegin); ze staan hier samen. Samenvoegen verandert het
// gedrag en is een besluit voor de opdrachtgever (zie docs/redactieregels.md).
// "frans" staat bij de woordbegin-lijst bewust NIET: dat is ook een voornaam.
export const FRANKRIJK_DEEL = [
  "frankrijk", "frans", "franse", "fransen", "france", "french",
  "parijs", "parijse", "paris", "marseille", "lyon", "bordeaux", "toulouse",
  "nice", "montpellier", "cannes", "corsica", "corse", "bretagne", "normandie",
  "provence", "gironde", "landes", "var", "aude", "herault", "riviera",
  "cote d'azur", "cote d azur", "azurenkust", "dordogne", "ardeche",
  "macron", "bardella", "le pen", "lepen", "matignon", "elysee", "elysée",
  "assemblee nationale", "assemblée", "franse regering", "franse president",
  "francais", "francaise", "francaises", "francophone", "hexagone",
];
export const FRANKRIJK_BEGIN = [
  "frankrijk", "franse", "fransen", "fransman", "parijs", "parisienne",
  "macron", "lecornu", "corsica", "bretagne", "normandie", "elzas", "provence",
  "dordogne", "marseille", "lyon", "toulouse", "bordeaux", "lille", "straatsburg",
  "montpellier", "nantes", "ardeche", "pyreneeen", "cote d'azur", "occitanie",
  "auvergne", "bourgogne", "loire", "calais", "duinkerke", "tgv", "elysee",
];

// ---- Persbronnen van de selectiestroom ----------------------------------------------
// Eerder in lib/selectie/bronnen.js. filter true = alleen items die over Frankrijk gaan.
export const SELECTIE_PERS_BRONNEN = [
  { naam: "NOS", land: "NL", feed: "https://feeds.nos.nl/nosnieuwsbuitenland", filter: true },
  { naam: "VRT NWS", land: "BE", feed: "https://www.vrt.be/vrtnws/nl.rss.articles.xml", filter: true },
  { naam: "Google News NL", land: "NL", feed: "https://news.google.com/rss/search?q=Frankrijk&hl=nl&gl=NL&ceid=NL:nl", filter: false, googleNews: true },
  { naam: "Google News BE", land: "BE", feed: "https://news.google.com/rss/search?q=Frankrijk&hl=nl&gl=BE&ceid=BE:nl", filter: false, googleNews: true },
  { naam: "NU.nl", land: "NL", feed: "https://www.nu.nl/rss/Algemeen", filter: true },
  { naam: "Le Monde", land: "FR", feed: "https://www.lemonde.fr/rss/une.xml", filter: false },
  { naam: "Le Figaro", land: "FR", feed: "https://www.lefigaro.fr/rss/figaro_actualites.xml", filter: false },
  { naam: "Franceinfo", land: "FR", feed: "https://www.francetvinfo.fr/titres.rss", filter: false },
  { naam: "Sud Ouest", land: "FR", feed: "https://www.sudouest.fr/rss.xml", filter: false },
  { naam: "Midi Libre", land: "FR", feed: "https://www.midilibre.fr/rss.xml", filter: false },
];

// ---- R17: Nederlands binnenlands nieuws (besluit opdrachtgever 20-11-2026) ----------
// Nederlands binnenlands nieuws en bestuur (benoemingen, vacatures, Kamerbrieven,
// defensie-inzet, binnenlandse regelingen) is alleen relevant als het Nederlanders
// in Frankrijk of het buitenland raakt. Dit zijn de kenmerken van "raakt het
// buitenland" (accent-ongevoelig, op woordbegin); de poort laat een bericht van
// de Rijksoverheid-feed alleen live zonder redactiekeuze als er één in staat.
export const NL_BUITENLAND_RAAKT = [
  "nederlanders in het buitenland", "nederlander in het buitenland", "nederlanders in frankrijk", "nederlander in frankrijk",
  "emigr", "remigr", "expat", "frankrijk", "grensregeling", "grensarbeid", "woonland", "verdragsland",
  "kiezers in het buitenland", "briefstem",
  "vanuit het buitenland", "verdragsgerechtig",
];
// "in het buitenland" en "buiten Nederland" tellen alleen met een vorm van wonen in dezelfde tekst,
// of (kaal) samen met een onderwerp uit NL_ALLEEN_MET_CONTEXT. "Het schip is in het buitenland ingezet" telt dus niet.
export const NL_BUITENLAND_PLAATS = ["in het buitenland", "buiten nederland"];
export const NL_WONEN = ["wonen", "woont", "woonachtig", "wonend"];
// Streng (20-11-2026): een losse buitenlandse plaats of land (Rode Zee, Oekraine, "Buitenlandse
// Zaken" als ministerie) telt niet. Deze onderwerpen tellen alleen samen met een
// buitenlandcontext: voor wie in het buitenland woont.
export const NL_ALLEEN_MET_CONTEXT = ["aow", "pensioen", "zorgverzekering", "paspoort", "rijbewijs", "verdrag", "belasting", "kinderbijslag", "erfbelasting", "uitkering", "stem", "kiezer", "digid", "studiefinanciering"];
const CONTEXT = [
  "in het buitenland", "buiten nederland", "woonachtig in", "wonen in het buitenland", "woont in het buitenland", "wonen in frankrijk",
  "emigr", "remigr", "frankrijk", "verdragsland", "woonland", "over de grens", "expat",
];
// Ambassade en consulaat tellen alleen samen met Parijs of Frankrijk (de ministerienaam "Buitenlandse Zaken" telt nooit).
export const NL_POST_FRANKRIJK = ["ambassade", "consula"];
const POST_CONTEXT = ["parijs", "frankrijk"];
export const R17_REDEN = "Nederlands binnenlands nieuws, raakt Nederlanders in het buitenland niet";
export function raaktBuitenland(tekst) {
  const n = String(tekst || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const heeft = (w) => new RegExp(`(^|[^a-z])${w}`).test(n);
  return NL_BUITENLAND_RAAKT.some(heeft) || (NL_BUITENLAND_PLAATS.some(heeft) && NL_WONEN.some(heeft)) || (NL_POST_FRANKRIJK.some(heeft) && POST_CONTEXT.some(heeft)) || (NL_ALLEEN_MET_CONTEXT.some(heeft) && CONTEXT.some(heeft));
}

// ---- De regels met herkomst ---------------------------------------------------------
// id, regel in gewone woorden, herkomst, status: "besloten" (opdrachtgever) of "code" (stond al zo in de code).
export const REGELS = [
  { id: "R01", regel: "Een los krantenbericht (één krant) komt nooit op de nieuwspagina, in de nieuwsbrief of in Infopoche; alleen zijbalk en Infofrankrijk.", herkomst: "Huisregel minstens twee kranten (lib/poort.js, README, docs/selectie.md); besluit opdrachtgever", status: "besloten" },
  { id: "R02", regel: "Nieuwsbrief en Infopoche volgen de nieuwspagina: ze lezen /api/actueel en kunnen alleen met de nieuwspagina erbij.", herkomst: "docs/selectie.md, Vijf plekken per bericht (20-11-2026)", status: "besloten" },
  { id: "R03", regel: "In de nieuwsbrief staan geen links naar perssites of krantennamen buiten het bronnenblok; persberichten zijn eigen redactionele syntheses.", herkomst: "nlfr-nieuwsbrief CLAUDE.md en REGIE.md (besluiten van de opdrachtgever); wordt daar bewaakt, niet in nlfr-menu", status: "besloten" },
  { id: "R04", regel: "Een synthese heeft minstens twee onafhankelijke kranten nodig (MIN_KRANTEN).", herkomst: "lib/config.js SYNTHESE_MIN_BRONNEN, lib/poort.js (auteursrecht)", status: "code" },
  { id: "R05", regel: "Een overheidsbericht is alleen live met een modelscore van minstens de drempel (SCORE_DREMPEL, 40) of na plaatsing door de redactie; zonder score of eronder wacht het op /redactie. Zonder poortveld is een bericht niet live.", herkomst: "Herstelronde onzichtbare fouten (20-11-2026), besluit opdrachtgever; lib/overheidpoort.js", status: "besloten" },
  { id: "R06", regel: "Een bericht dat de redactie met Weg afwees blijft weg (afgewezen-merkteken).", herkomst: "Herstelronde onzichtbare fouten (20-11-2026)", status: "besloten" },
  { id: "R07", regel: "Café Claude alleen bij een kennisdomein: geld, bureaucratie, zorg of wonen; past er geen, dan geen regel.", herkomst: "docs/selectie.md, Eén redactiepagina (20-11-2026); lib/selectie/kern.js", status: "besloten" },
  { id: "R08", regel: "De vijf plekken zijn nieuwspagina, nieuwsbrief, Infopoche, zijbalk en Infofrankrijk.", herkomst: "docs/selectie.md, Vijf plekken per bericht (20-11-2026)", status: "besloten" },
  { id: "R09", regel: "De rubrieken zijn algemeen nieuws, ondernemersnieuws, reisnieuws, meteo en wet- en regelgeving; de rubriek is nooit verplicht (standaard algemeen, overheid regelgeving, meteo).", herkomst: "REGIE.md besluit B2 (7-11-2026); herstelronde onzichtbare fouten", status: "besloten" },
  { id: "R10", regel: "Caribisch Nederland komt nooit live (harde uitsluiting); een Nederlands overheidsbericht moet ook door de relevantiezeef.", herkomst: "lib/feeds.js nlOverheidUitgesloten en nlOverheidRelevant (PR 78)", status: "code" },
  { id: "R11", regel: "De zeven: faits divers, buitenland zonder Frankrijk-link en sport zonder Franse ploeg komen niet door; dit geldt voor de persstroom en nu ook voor de selectiestroom vóór het model.", herkomst: "lib/feeds.js (faitsDiversDoorlaat, buitenlandDoorlaat, sportDoorlaat), lib/persmeting.js; selectie: deze ronde", status: "code" },
  { id: "R12", regel: "NOS, VRT en NU.nl komen alleen door als het bericht over Frankrijk gaat (Frankrijk-woordenlijst).", herkomst: "lib/selectie/bronnen.js, kern.js gaatOverFrankrijk", status: "code" },
  { id: "R13", regel: "Per bron hooguit SELECTIE_MAX_PER_BRON nieuwste berichten per ronde naar het model, met uitzonderingen per bron.", herkomst: "Opdracht 20-11-2026 (Midi Libre levert 100 per ronde); de getallen zijn een voorstel", status: "code" },
  { id: "R14", regel: "Een bericht dat alleen op nieuwspagina, nieuwsbrief of Infopoche komt is een go met lege zijbalkkanalen, geen no-go; alleen Weg is een no-go.", herkomst: "Herstelronde onzichtbare fouten (20-11-2026)", status: "besloten" },
  { id: "R15", regel: "Geen ledennamen en geen auteursnamen in de nieuwsbrief.", herkomst: "nlfr-nieuwsbrief CLAUDE.md (besluit opdrachtgever); bewaakt in die repo", status: "besloten" },
  { id: "R17", regel: "Nederlands binnenlands nieuws en bestuur (benoemingen, vacatures, Kamerbrieven, defensie-inzet, binnenlandse regelingen) is alleen relevant als het Nederlanders in Frankrijk of het buitenland raakt (AOW en pensioen, belasting buitenland, zorgverzekering verdragslanden, paspoort, rijbewijs en consulaire zaken, kiezers in het buitenland). De prompt laat zulke berichten onder de drempel scoren en de poort laat een Rijksoverheid-bericht zonder zo'n kenmerk niet live zonder keuze van de redactie.", herkomst: "Besluit opdrachtgever 20-11-2026 (Caribisch Nederland en irrelevante Rijksoverheid-berichten)", status: "besloten" },
  { id: "R16", regel: "Een artikel staat nooit op twee opeenvolgende dagen in de nieuwsbrief.", herkomst: "nlfr-nieuwsbrief CLAUDE.md; bewaakt in die repo", status: "besloten" },
];
