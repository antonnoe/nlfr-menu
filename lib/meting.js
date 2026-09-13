// Meting van het menugebruik: dagtotalen, verder niets.
// ---------------------------------------------------------------------------
// WAAROM DIT BESTAAT. Het menu draait in een iframe op elke pagina van
// nederlanders.fr en mat tot nu toe niets. Toen het bezoek terugliep was de
// vraag "komt dat door het nieuwe menu?" daardoor niet te beantwoorden: er was
// geen enkel cijfer over wat mensen in dat menu aanklikken. Dit is het
// meetinstrument dat die vraag voortaan wél beantwoordt.
//
// WAT ER NIET GEMETEN WORDT, en dat is een ontwerpkeuze, geen omissie:
//   - geen cookie, geen sessie-id, geen bezoeker-id, geen IP in de opslag;
//   - geen pagina waarop het menu stond (dat zou een leesprofiel per bezoeker
//     benaderen zodra je het met tijdstippen combineert);
//   - geen tijdstippen binnen de dag.
// Wat overblijft is een teller per ingang per dag. Dat zijn geen
// persoonsgegevens, en het is genoeg om de vraag te beantwoorden.
//
// DRIE SOORTEN, en de eerste is de belangrijkste:
//   weergave — het menu is getoond. Zonder deze noemer zegt een klikaantal
//              niets: een daling van de kliks is dan niet te onderscheiden van
//              gewoon minder bezoek.
//   lade     — een lade of het paneel is opengeklapt. Dit scheidt "niemand
//              opent het menu" van "ze openen het wel en kiezen niets" — precies
//              de vraag bij de wegwijzer.
//   klik     — een ingang is aangeklikt.

export const SOORTEN = ["weergave", "lade", "klik"];

// Een id is kort en uit een nauwe tekenverzameling. Niet uit netheid: dit veld
// komt van buiten (iedereen kan het endpoint aanroepen) en wordt een sleutel in
// een hash die blijft staan. Een ruime tekenverzameling laat iemand er rommel in
// schrijven die daarna niet meer weggaat.
export const ID_MAX = 80;
export const ID_PATROON = /^[a-z0-9][a-z0-9/_.~:-]*$/;

// Per verzoek. Eén paginabezoek levert er hooguit een handvol; meer dan dit is
// geen bezoeker maar iemand die het endpoint volloopt.
export const GEBEURTENIS_MAX = 20;

// Per dag. Het menu heeft enkele tientallen ingangen; deze grens laat ruime
// groei toe en houdt tegelijk de dagsleutel begrensd als iemand toch verzint.
export const VELD_MAX = 400;

// De dag loopt op Franse tijd: de lezers zitten in Frankrijk en de redactie ook.
export const TIJDZONE = "Europe/Paris";

// ---- Dagstempel -------------------------------------------------------------

export function dagStempel(nu, tijdzone) {
  const d = nu instanceof Date ? nu : new Date(nu == null ? Date.now() : nu);
  if (Number.isNaN(d.getTime())) return "";
  const delen = new Intl.DateTimeFormat("nl-NL", {
    timeZone: tijdzone || TIJDZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const p = {};
  for (const deel of delen) p[deel.type] = deel.value;
  if (!p.year || !p.month || !p.day) return "";
  return `${p.year}-${p.month}-${p.day}`;
}

// De laatste `aantal` dagen, nieuwste eerst. Het terugtellen gebeurt in UTC en
// het stempelen in Parijse tijd. Dat is bewust die volgorde: een UTC-dag is
// altijd precies 24 uur, dus de reeks kan niet scheef lopen, terwijl de NAAM van
// de dag de dag is die de lezer beleefde. De dubbelcheck hieronder is een
// vangnet, geen correctie: hij hoort nooit aan te slaan.
export function laatsteDagen(aantal, nu, tijdzone) {
  const n = Math.max(1, Math.min(Number(aantal) || 1, 400));
  const basis = nu instanceof Date ? nu : new Date(nu == null ? Date.now() : nu);
  const uit = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(basis.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    const stempel = dagStempel(d, tijdzone);
    if (stempel && !uit.includes(stempel)) uit.push(stempel);
  }
  return uit;
}

// ---- Id's en velden ---------------------------------------------------------

export function normaliseerId(ruw) {
  let s = String(ruw == null ? "" : ruw).trim().toLowerCase();
  s = s.replace(/\s+/g, "-");
  s = s.replace(/[^a-z0-9/_.~:-]/g, "");
  s = s.replace(/\/{2,}/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  s = s.slice(0, ID_MAX);
  // Na het afkappen kan er een scheidingsteken op het eind staan; dat maakt
  // twee verschillende ingangen anders tot hetzelfde veld met een rare naam.
  s = s.replace(/[/_.~:-]+$/, "");
  return ID_PATROON.test(s) ? s : "";
}

// De naam waaronder dit in de dagsleutel terechtkomt. Geeft "" bij alles wat
// niet deugt; de aanroeper slaat dat over in plaats van te raden.
export function veldVan(gebeurtenis) {
  const g = gebeurtenis && typeof gebeurtenis === "object" ? gebeurtenis : {};
  const soort = String(g.soort == null ? "" : g.soort).trim().toLowerCase();
  if (!SOORTEN.includes(soort)) return "";
  if (soort === "weergave") return "weergave";
  const id = normaliseerId(g.id);
  if (!id) return "";
  return `${soort}:${id}`;
}

// Van een binnengekomen body naar tellingen per veld. Alles wat niet deugt valt
// er stil uit: een bezoeker met een oude menuversie of een rare link hoort geen
// foutmelding te krijgen, want er valt voor hem niets te herstellen.
export function veldenUitBody(body) {
  const lijst = body && Array.isArray(body.gebeurtenissen) ? body.gebeurtenissen : [];
  const uit = new Map();
  for (const g of lijst.slice(0, GEBEURTENIS_MAX)) {
    const veld = veldVan(g);
    if (!veld) continue;
    uit.set(veld, (uit.get(veld) || 0) + 1);
  }
  return uit;
}

// ---- Herkomst ---------------------------------------------------------------
// GEEN beveiligingsgrens, en het staat hier zodat niemand dat later denkt: een
// Origin-header is na te maken. Het houdt toevallige ruis buiten (een crawler,
// een losse curl) van data die verder niemand iets oplevert om te vervalsen.

export const HERKOMST_TOEGESTAAN = [/(^|\.)nederlanders\.fr$/i, /(^|\.)vercel\.app$/i];

export function herkomstDeugt(headers) {
  const h = headers || {};
  const ruw = h.origin || h.referer || h.referrer || "";
  if (!ruw) return false;
  let host;
  try {
    host = new URL(String(ruw)).hostname;
  } catch {
    return false;
  }
  return HERKOMST_TOEGESTAAN.some((p) => p.test(host));
}

// ---- Vorm van het antwoord --------------------------------------------------

// Upstash geeft HGETALL terug als platte lijst [veld, waarde, veld, waarde].
export function hashNaarObject(ruw) {
  const uit = {};
  if (Array.isArray(ruw)) {
    for (let i = 0; i + 1 < ruw.length; i += 2) uit[String(ruw[i])] = ruw[i + 1];
    return uit;
  }
  if (ruw && typeof ruw === "object") {
    for (const [k, v] of Object.entries(ruw)) uit[String(k)] = v;
  }
  return uit;
}

// Eén dag, uitgesplitst naar de drie soorten. Velden die niet meer bij een
// bekende soort horen (een oude naam uit een vorige menuversie) komen onder
// "overig" terecht in plaats van verloren te gaan: een getal dat je niet meer
// kunt plaatsen is nog altijd beter dan een getal dat stil verdwijnt.
export function dagUitHash(dag, ruw) {
  const hash = hashNaarObject(ruw);
  const uit = { dag, weergaven: 0, laden: {}, kliks: {}, overig: {} };
  for (const [veld, waarde] of Object.entries(hash)) {
    const n = Number(waarde);
    if (!Number.isFinite(n)) continue;
    if (veld === "weergave") uit.weergaven = n;
    else if (veld.startsWith("lade:")) uit.laden[veld.slice(5)] = n;
    else if (veld.startsWith("klik:")) uit.kliks[veld.slice(5)] = n;
    else uit.overig[veld] = n;
  }
  return uit;
}

// Het doorklikpercentage per dag: kliks gedeeld door weergaven. Dit is het
// getal waar het om begonnen was; een kaal klikaantal beweegt met het bezoek
// mee en zegt op zichzelf niets. Zonder weergaven is het null, niet 0: "niet te
// zeggen" is iets anders dan "nul procent".
export function doorklik(dag) {
  const weergaven = Number(dag && dag.weergaven) || 0;
  if (weergaven <= 0) return null;
  const kliks = Object.values((dag && dag.kliks) || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  return Math.round((kliks / weergaven) * 10000) / 100;
}
