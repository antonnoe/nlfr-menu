// Meting van de PERSKETEN: van feeditem tot weggeschreven concept.
// ---------------------------------------------------------------------------
// WAAROM DEZE MODULE BESTAAT. De persketen kon stilvallen zonder dat er ook
// maar één regel over verscheen. Het draailog van een cronronde bestond
// uitsluitend uit de `[feeds]`-regels van lib/feeds.js; alles ná de inname —
// clusteren, de tweebronnendrempel, de synthese-aanroep, het wegschrijven —
// deed zijn werk zwijgend. Een ronde die nul concepten oplevert zag er in het
// log dus exact hetzelfde uit als een ronde die er twee maakte, en een keten
// die veertig uur lang niets meer produceerde bleef veertig uur onzichtbaar.
//
// EEN STAP DIE NIETS LOGT, KAN NIET BEWAAKT WORDEN. Vandaar dat hier per stap
// een teller staat die ALTIJD wordt afgedrukt, juist ook als hij nul is: het
// verschil tussen "er kwam niets binnen", "er clusterde niets", "niets haalde
// de drempel" en "alles was al eerder afgewezen" is het hele verschil tussen
// een rustige nieuwsdag en een storing.
//
// Pure module: items en tellingen in, tellingen en regels uit. Geen fetch, geen
// KV, geen Date.now() — het moment komt van de aanroeper, zodat elke uitkomst
// reproduceerbaar is en in een toets kan worden vastgelegd.
//
// De weging van de invoer (zeven, clusteren, drempel) staat hier en niet in
// api/cron.js, zodat de diagnosestand en de echte ronde GEGARANDEERD dezelfde
// keten meten. Een diagnose die een andere trechter telt dan de ronde zelf is
// erger dan geen diagnose: hij wijst de verkeerde stap aan.

import { faitsDiversDoorlaat, sportDoorlaat, buitenlandDoorlaatNL } from "./feeds.js";
import { clusterItems, zelfdeVerhaal } from "./cluster.js";
import { HOT_VENSTER_UREN, SYNTHESE_MIN_BRONNEN } from "./config.js";

// Haalt een cluster de auteursrechtelijk harde drempel? VERSCHILLENDE kranten
// (aantalBronnen) én evenveel ONAFHANKELIJKE berichten (onafhankelijkeBronnen).
// Zie de toelichting in api/cron.js.
export function geschiktVoorSynthese(c) {
  return (
    c.aantalBronnen >= SYNTHESE_MIN_BRONNEN &&
    c.onafhankelijkeBronnen >= SYNTHESE_MIN_BRONNEN
  );
}

// Waarom slaat de cron dit cluster over — of doet hij dat niet? Één functie
// voor de echte ronde én voor de diagnosestand. Ze uit elkaar laten lopen zou
// betekenen dat de diagnose een andere reden noemt dan de reden waarom de ronde
// het cluster daadwerkelijk laat liggen; dan is de diagnose erger dan niets.
//
// De volgorde is die van api/cron.js en is niet vrijblijvend: eerst de drie
// sleutels (het goedkoopste antwoord), dan de vingerafdruk-dedup, dan de
// buitenlandpoort op de gezamenlijke koppen. `teller` wijst het veld in
// meting.overgeslagen aan, zodat de tellingen niet op twee plekken worden
// opgehoogd.
export function blokkadeVoor({ cluster, concept, publicatie, afgewezen, kernen = [] }) {
  if (concept) {
    return { teller: "concept", reden: "al-concept", uitleg: "er ligt al een concept met deze sleutel", sinds: concept.aangemaaktOp || null };
  }
  if (publicatie) {
    return { teller: "publicatie", reden: "al-gepubliceerd", uitleg: "al gepubliceerd onder dezelfde sleutel", sinds: publicatie.gepubliceerdOp || null };
  }
  if (afgewezen) {
    return {
      teller: "afgewezen",
      reden: "eerder-afgewezen",
      uitleg: `eerder afgewezen (${afgewezen.reden || "reden onbekend"})`,
      sinds: afgewezen.op || null,
    };
  }
  if (kernen.some((k) => zelfdeVerhaal(cluster.kernTokens, k))) {
    return { teller: "duplicaat", reden: "duplicaat", uitleg: "zelfde verhaal als een bestaand concept", sinds: null };
  }
  const koppenBlob = (cluster.items || []).map((i) => i.titel || "").join(" · ");
  if (!buitenlandDoorlaatNL(koppenBlob)) {
    return { teller: "buitenland", reden: "buitenland", uitleg: "buitenland zonder Frankrijk-link", sinds: null };
  }
  return null; // niets in de weg: dit cluster gaat de synthese in
}

// De trechter van feeditem tot kandidaat-cluster, met de tellingen per stap.
// `meting` wordt ter plekke bijgewerkt; de clusters komen terug zodat de
// aanroeper ermee verder kan.
export function weegPersInvoer(items, nu, meting) {
  const alle = items || [];
  meting.itemsTotaal = alle.length;

  const persRuw = alle.filter((i) => i && i.regime === "pers");
  meting.persRuw = persRuw.length;

  const persItems = [];
  for (const i of persRuw) {
    if (!faitsDiversDoorlaat(i.titel)) {
      meting.gezeefd.faitsDivers += 1;
      continue;
    }
    if (!sportDoorlaat(i.titel)) {
      meting.gezeefd.sport += 1;
      continue;
    }
    persItems.push(i);
  }
  meting.naZeef = persItems.length;

  // Hetzelfde venster als clusterItems() hanteert. Apart geteld omdat "wel
  // binnengekomen, maar te oud om te clusteren" een heel andere storing is dan
  // "niets binnengekomen".
  const grens = nu - HOT_VENSTER_UREN * 60 * 60 * 1000;
  meting.binnenVenster = persItems.filter((i) => {
    const t = Date.parse(i.datum);
    return !Number.isNaN(t) && t >= grens;
  }).length;

  const clusters = clusterItems(persItems, nu);
  meting.clusters = clusters.length;

  const geschikt = clusters.filter(geschiktVoorSynthese).sort((a, b) => b.score - a.score);
  meting.bovenDrempel = geschikt.length;

  return { persItems, clusters, geschikt };
}

// De keten in volgorde. Elke stap noemt het veld in de meting, een leesbare
// naam en de stap ervóór. Deze lijst is de enige plek waar de volgorde staat:
// het log, het journaal en de nul-analyse lezen er alle drie uit.
export const KETEN = [
  { veld: "itemsTotaal", naam: "feeditems binnen" },
  { veld: "persRuw", naam: "items met regime pers" },
  { veld: "naZeef", naam: "na de faits-divers- en sportzeef" },
  { veld: "binnenVenster", naam: "binnen het clustervenster" },
  { veld: "clusters", naam: "clusters gevormd" },
  { veld: "bovenDrempel", naam: "clusters boven de tweebronnendrempel" },
  { veld: "kandidaten", naam: "kandidaten na de rondelimiet" },
  { veld: "beoordeeld", naam: "kandidaten die aan de synthese toekwamen" },
  { veld: "syntheseAangeroepen", naam: "synthese-aanroepen" },
  { veld: "geschreven", naam: "concepten weggeschreven" },
];

// Een lege meting. Alle tellers staan expliciet op nul, zodat een veld dat
// nooit wordt opgehoogd zichtbaar nul is in plaats van afwezig.
export function nieuweMeting(nu = Date.now()) {
  return {
    op: new Date(nu).toISOString(),
    itemsTotaal: 0,
    persRuw: 0,
    naZeef: 0,
    binnenVenster: 0,
    clusters: 0,
    bovenDrempel: 0,
    kandidaten: 0,
    beoordeeld: 0,
    syntheseAangeroepen: 0,
    geschreven: 0,
    // Waarom er items of kandidaten afvielen. Niet elk verlies is een storing,
    // maar een verlies zonder reden is niet te beoordelen.
    gezeefd: { faitsDivers: 0, sport: 0 },
    overgeslagen: { concept: 0, publicatie: 0, afgewezen: 0, duplicaat: 0, buitenland: 0 },
    geweigerd: { geenVerhaal: 0, buitenland: 0, teSmal: 0, mislukt: 0 },
    // Randvoorwaarden die de keten kunnen dichtzetten zonder dat er iets mis is
    // met het nieuws zelf.
    openstaandeConcepten: 0,
    ruimte: 0,
    limiet: 0,
    // Wat de ronde uit de KV-voorraad haalde. Ook dit gebeurde tot nu toe
    // zwijgend, terwijl een opschoning die te streng staat de wachtrij elke
    // ronde leeg kan trekken — met precies hetzelfde beeld op /review als een
    // keten die niets aanmaakt.
    opgeruimd: 0,
    opgeruimdeRedenen: {},
    gesnoeid: 0,
  };
}

// De EERSTE stap in de keten die nul oplevert, met het aantal ervóór. Dit is de
// vraag die bij een storing als eerste beantwoord moet worden: waar breekt hij,
// en met hoeveel ervoor. Levert null zolang de keten helemaal doorloopt.
export function eersteNul(meting) {
  const m = meting || {};
  for (let i = 0; i < KETEN.length; i += 1) {
    const stap = KETEN[i];
    if ((m[stap.veld] || 0) > 0) continue;
    const vorige = i > 0 ? KETEN[i - 1] : null;
    return {
      veld: stap.veld,
      stap: stap.naam,
      ervoor: vorige ? vorige.naam : null,
      aantalErvoor: vorige ? m[vorige.veld] || 0 : null,
    };
  }
  return null;
}

// Waarom viel de keten stil? Alleen als er iets te zeggen valt: bij een
// geblokkeerde stap wijzen de bijtellingen aan wat het was. Bewust GEEN
// gissing als de cijfers niets aanwijzen — dan staat er dat het niet uit de
// tellingen blijkt, en niet een verzonnen oorzaak.
export function duiding(meting) {
  const m = meting || {};
  const nul = eersteNul(m);
  if (!nul) return null;
  const over = m.overgeslagen || {};
  const gez = m.gezeefd || {};
  const gew = m.geweigerd || {};
  if (nul.veld === "beoordeeld" && (over.concept || over.publicatie || over.afgewezen || over.duplicaat || over.buitenland)) {
    const delen = [];
    if (over.afgewezen) delen.push(`${over.afgewezen}× eerder afgewezen (sleutel staat nog in KV)`);
    if (over.publicatie) delen.push(`${over.publicatie}× al gepubliceerd onder dezelfde sleutel`);
    if (over.concept) delen.push(`${over.concept}× er ligt al een concept met deze sleutel`);
    if (over.duplicaat) delen.push(`${over.duplicaat}× zelfde verhaal als een bestaand concept`);
    if (over.buitenland) delen.push(`${over.buitenland}× buitenland zonder Frankrijk-link`);
    return `alle kandidaten overgeslagen vóór de synthese: ${delen.join(", ")}`;
  }
  if (nul.veld === "kandidaten" && m.bovenDrempel > 0) {
    return `${m.bovenDrempel} cluster(s) boven de drempel, maar de rondelimiet stond op ${m.limiet} (openstaand ${m.openstaandeConcepten}, ruimte ${m.ruimte})`;
  }
  if (nul.veld === "naZeef" && (gez.faitsDivers || gez.sport)) {
    return `de zeven namen alles weg: ${gez.faitsDivers}× faits divers, ${gez.sport}× sport`;
  }
  if (m.opgeruimd > 0 && m.openstaandeConcepten === 0 && m.geschreven === 0) {
    return `de opschoning haalde ${m.opgeruimd} concept(en) uit de voorraad en er kwam er geen bij; ` +
      `de wachtrij staat daardoor op nul`;
  }
  if (nul.veld === "geschreven" && (gew.geenVerhaal || gew.buitenland || gew.teSmal || gew.mislukt)) {
    const delen = [];
    if (gew.geenVerhaal) delen.push(`${gew.geenVerhaal}× GEEN (geen onderwerp met twee kranten)`);
    if (gew.teSmal) delen.push(`${gew.teSmal}× te smal na de bronopgave van het model`);
    if (gew.buitenland) delen.push(`${gew.buitenland}× buitenland in de NL-tekst`);
    if (gew.mislukt) delen.push(`${gew.mislukt}× mislukt`);
    return `de synthese draaide maar leverde geen concept: ${delen.join(", ")}`;
  }
  return null;
}

// De regels die de cron per ronde afdrukt. ALTIJD alle stappen, ook de nullen:
// dat is het enige wat een stille stap onderscheidt van een gezonde stap.
export function logRegels(meting, voorvoegsel = "[pers]") {
  const m = meting || {};
  const uit = KETEN.map((s) => `${voorvoegsel} ${s.naam}: ${m[s.veld] || 0}`);
  const gez = m.gezeefd || {};
  uit.push(`${voorvoegsel} weggezeefd: faits-divers=${gez.faitsDivers || 0}, sport=${gez.sport || 0}`);
  const over = m.overgeslagen || {};
  uit.push(
    `${voorvoegsel} overgeslagen: concept=${over.concept || 0}, publicatie=${over.publicatie || 0}, ` +
      `afgewezen=${over.afgewezen || 0}, duplicaat=${over.duplicaat || 0}, buitenland=${over.buitenland || 0}`
  );
  const gew = m.geweigerd || {};
  uit.push(
    `${voorvoegsel} na de synthese geweigerd: geen-verhaal=${gew.geenVerhaal || 0}, ` +
      `te-smal=${gew.teSmal || 0}, buitenland=${gew.buitenland || 0}, mislukt=${gew.mislukt || 0}`
  );
  uit.push(
    `${voorvoegsel} ruimte: openstaande concepten=${m.openstaandeConcepten || 0}, ` +
      `ruimte=${m.ruimte || 0}, limiet deze ronde=${m.limiet || 0}`
  );
  const redenen = Object.entries(m.opgeruimdeRedenen || {})
    .map(([code, n]) => `${code}=${n}`)
    .join(", ");
  uit.push(
    `${voorvoegsel} uit de voorraad: opgeruimd=${m.opgeruimd || 0}` +
      (redenen ? ` (${redenen})` : "") +
      `, gesnoeid=${m.gesnoeid || 0}`
  );
  const nul = eersteNul(m);
  if (!nul) {
    uit.push(`${voorvoegsel} keten volledig doorlopen: ${m.geschreven || 0} concept(en) weggeschreven`);
  } else if (nul.ervoor) {
    uit.push(
      `${voorvoegsel} STAP OP NUL: "${nul.stap}" — ervoor stond "${nul.ervoor}" op ${nul.aantalErvoor}`
    );
  } else {
    uit.push(`${voorvoegsel} STAP OP NUL: "${nul.stap}" — er kwam niets binnen`);
  }
  const waarom = duiding(m);
  if (waarom) uit.push(`${voorvoegsel} oorzaak volgens de tellingen: ${waarom}`);
  return uit;
}
