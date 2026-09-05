// Kwaliteitszeef voor de verenigingenfeed.
// ---------------------------------------------------------------------------
// DE BRON IS WAT HIJ IS. De verenigingenkalender bundelt de sites van
// Nederlandse verenigingen in Frankrijk: WordPress-installaties van uiteenlopende
// ouderdom, met samenvattingen die soms midden in een woord ophouden en
// aankondigingen die maanden na de activiteit blijven staan. Daar valt niets aan
// te repareren aan de bronkant, dus gebeurt het hier.
//
// UITGANGSPUNT: LIEVER NIET TONEN DAN HALF TONEN. Bij twijfel over de INHOUD
// (een halve zin, een verlopen activiteit) laten we weg. Bij twijfel over ONZE
// EIGEN HERKENNING is het precies andersom: herkennen we geen betrouwbare datum,
// dan tonen we het item gewoon. Een zeef die zichzelf overschat, gooit het
// verenigingsnieuws leeg en dat merkt niemand.
//
// Pure module: tekst in, oordeel uit. Geen fetch, geen KV, geen Date.now() —
// het ankermoment en "nu" komen altijd van de aanroeper, zodat elke uitkomst
// reproduceerbaar is.

import { zoekUitsluiting } from "./uitsluitlijst.js";

export function normaliseerTekst(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ---- 1. De activiteitsdatum -------------------------------------------------
// Nederlandse én Franse maandnamen, VOLUIT. Afkortingen ("jun", "okt") staan er
// bewust niet in: in deze feed komen die vooral voor in bylines als
// "door Rob van der Meulen | jun 26, 2017", en dat is geen activiteitsdatum maar
// de publicatiedatum van een handleiding uit 2017. Zo'n item hoort gewoon
// zichtbaar te blijven.
const MAANDEN = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
  janvier: 1, fevrier: 2, mars: 3, avril: 4, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
// "mai" en "avril" zijn kort maar ondubbelzinnig; "mars" botst niet met iets in
// deze feed. Alleen "mei"/"mai" krijgen een woordgrens, anders matcht "mei" in
// "meiden".
MAANDEN.mai = 5;

const MAANDPATROON = Object.keys(MAANDEN).join("|");
// "6 november", "15 november 2026", "1 – 31 oktober" (de dag vóór de maand).
// Alleen deze volgorde: dag, dan maand. Dat is hoe een aankondiging in het
// Nederlands en het Frans geschreven wordt.
const DATUM_RE = new RegExp(`\\b(\\d{1,2})\\s*(?:e|de|ste)?\\s+(${MAANDPATROON})\\b(?:\\s+(\\d{4}))?`, "gi");
// De begindag van een reeks: "6 – 15 november", "21-25 oktober", "17-19 juillet".
// De einddag vangt DATUM_RE al; deze vult de begindag aan, zodat een reeks die
// nog loopt niet op zijn einddatum alleen wordt beoordeeld.
const REEKS_RE = new RegExp(`\\b(\\d{1,2})\\s*(?:t\\/m|tot en met|tot|[-–—])\\s*(\\d{1,2})\\s+(${MAANDPATROON})\\b(?:\\s+(\\d{4}))?`, "gi");

// Welk jaar hoort bij een dag+maand zonder jaartal? Het jaar waarin die datum
// het DICHTST bij de publicatiedatum ligt — vóór of ná, wat het dichtst is.
// Alleen vooruit kijken breekt op een verslag ("Op 19 juli organiseerde…", een
// week ná de activiteit gepubliceerd); alleen achteruit breekt op elke
// aankondiging. Dichtstbij klopt voor allebei.
function jaarBijAnker(dag, maand, ankerMs) {
  const anker = new Date(ankerMs);
  let beste = null;
  for (const jaar of [anker.getUTCFullYear() - 1, anker.getUTCFullYear(), anker.getUTCFullYear() + 1]) {
    const kandidaat = Date.UTC(jaar, maand - 1, dag);
    if (beste === null || Math.abs(kandidaat - ankerMs) < Math.abs(beste - ankerMs)) beste = kandidaat;
  }
  return beste;
}

// Alle herkende datums in een tekst, als tijdstempels (UTC-middernacht).
export function datumsIn(tekst, ankerMs) {
  const n = normaliseerTekst(tekst);
  const uit = [];
  for (const re of [DATUM_RE, REEKS_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(n)) !== null) {
      // DATUM_RE: [_, dag, maand, jaar?]   REEKS_RE: [_, dag1, dag2, maand, jaar?]
      const reeks = re === REEKS_RE;
      const dag = Number(reeks ? m[1] : m[1]);
      const maandNaam = reeks ? m[3] : m[2];
      const jaar = reeks ? m[4] : m[3];
      const maand = MAANDEN[maandNaam];
      if (!maand || dag < 1 || dag > 31) continue;
      uit.push(jaar ? Date.UTC(Number(jaar), maand - 1, dag) : jaarBijAnker(dag, maand, ankerMs));
      if (reeks) {
        const dag2 = Number(m[2]);
        if (dag2 >= 1 && dag2 <= 31) {
          uit.push(jaar ? Date.UTC(Number(jaar), maand - 1, dag2) : jaarBijAnker(dag2, maand, ankerMs));
        }
      }
    }
  }
  return uit;
}

// De datum waarop een item ophoudt actueel te zijn: de LAATSTE genoemde datum.
// Een expositie van 1 tot 31 oktober is op 2 oktober niet verstreken, en een
// aankondiging met een reeks data loopt tot de laatste. Geen enkele herkenbare
// datum -> null, en dat is expliciet géén reden om iets weg te laten.
export function activiteitDatum(item, ankerMs) {
  const anker = Number.isFinite(ankerMs) ? ankerMs : Date.parse(item && item.datum) || Date.now();
  const datums = datumsIn(`${(item && item.titel) || ""} ${(item && item.samenvatting) || ""}`, anker);
  if (!datums.length) return null;
  return Math.max(...datums);
}

// Is de activiteit voorbij? De hele DAG telt mee: een activiteit op 5 september
// is op 5 september nog actueel en pas op 6 september verstreken.
export function verstreken(item, nu, ankerMs) {
  const eind = activiteitDatum(item, ankerMs);
  if (eind === null) return false; // niet herkend = gewoon tonen
  return eind + 24 * 60 * 60 * 1000 <= nu;
}

// ---- 2. Afgekapte en aaneengeplakte samenvattingen -------------------------

// "NATIONALITEITOp donderdag" -> "NATIONALITEIT Op donderdag". Alleen deze ene
// vorm: een reeks van DRIE of meer hoofdletters, gevolgd door een hoofdletter
// met kleine letters erachter. Dat is hoe een WordPress-kop aan de eerste zin
// vastplakt. De eis van drie hoofdletters ervóór is wat "YouTube", "McDonald"
// en "IJsselstein" heel laat; één kleine letter erna is genoeg, want anders
// blijft precies het gemeten geval ("…TEITOp") staan.
const GLUE_KOP = /([A-ZÀ-ÞŸ]{3,})([A-ZÀ-ÞŸ][a-zà-ÿœ]+)/g;
// "veranderd.Voor" -> "veranderd. Voor": leesteken direct tegen een hoofdletter.
const GLUE_LEESTEKEN = /([.!?,;:])([A-ZÀ-ÞŸ])/g;

export function herstelSpaties(tekst) {
  return String(tekst || "")
    .replace(GLUE_KOP, "$1 $2")
    .replace(GLUE_LEESTEKEN, "$1 $2");
}

// Blijft er ná herstel nog aaneengeplakte tekst over? Dan is het niet gelukt en
// gaat de zin eruit. Dit vangt de vormen die GLUE_KOP niet aandurft, zoals een
// kleine letter die tegen een hoofdletter plakt middenin een zin.
export function bevatRestGlue(tekst) {
  const s = String(tekst || "");
  // Vier of meer hoofdletters gevolgd door een kleine letter, zonder spatie
  // ertussen: dat is geen normaal woord en geen normale afkorting.
  return /[A-ZÀ-ÞŸ]{4,}[a-zà-ÿœ]/.test(s);
}

// Waarom is deze teaser onbruikbaar? Geeft de reden terug, of null.
// Drie vormen, alle drie een halve zin die de lezer niets vertelt:
//   "Voorganger: ds."   afkorting        (de zin gaat verder na het punt)
//   "Er is geen speld:" dubbele punt     (de opsomming erna ontbreekt)
//   "van J."            losse hoofdletter (een initiaal, geen zin)
export function afgekapt(zin) {
  const s = String(zin || "").trim();
  if (!s) return null; // leeg is geen afgekapte zin; dat vangt de aanroeper zelf
  // Zowel "…" als "..." is een beletselteken en zegt niets over de zin eronder.
  const kaal = s.replace(/(?:…|\.{3,}|\s)+$/, "");
  if (/:$/.test(kaal)) return "eindigt op een dubbele punt";
  const laatste = kaal.split(/\s+/).pop() || "";
  if (/^[A-ZÀ-ÞŸ]\.?$/.test(laatste)) return "eindigt op een losse hoofdletter";
  // Afkorting: een kort woord met een punt erachter, waarbij het punt dus geen
  // zinseinde was. "ds.", "nnb.", "bijv.", "e.d." — en niet "Waall-Schaeffer."
  if (/\.$/.test(kaal) && /^[a-zà-ÿ]{1,4}\.$/.test(laatste)) return `eindigt op de afkorting "${laatste}"`;
  if (/\.$/.test(kaal) && /^([a-zà-ÿ]\.){2,}$/.test(laatste)) return `eindigt op de afkorting "${laatste}"`;
  // Vangnet, als laatste zodat de preciezere redenen hierboven voorgaan: een
  // teaser die alleen uit een lijstnummer of een leesteken bestaat vertelt de
  // lezer niets. Gemeten geval: een excerpt dat begint met "1. Van druif naar
  // most" levert als eerste zin letterlijk "1." op.
  if (!/[a-zà-ÿ]{3,}/i.test(kaal)) return "bevat geen leesbare zin";
  return null;
}

// Inkorten op een WOORDGRENS, en nooit eindigen op een losse hoofdletter.
// GEMETEN FOUT: het oude pad kapte de zin op teken 150 af en landde midden in
// "Atelier Néerlandais" -> "… in Atelier N…". Dat lijkt op een afgekapte bron,
// maar het was onze eigen schaar. Een teaser die op een losse hoofdletter
// eindigt is precies wat punt 2 verbiedt, dus die letter gaat er hier af.
export function kortAf(zin, max = 150) {
  const s = String(zin || "").trim();
  if (s.length <= max) return s;
  const knip = s.slice(0, max);
  const spatie = knip.lastIndexOf(" ");
  let uit = (spatie > 40 ? knip.slice(0, spatie) : knip).replace(/[\s,;:–—-]+$/, "");
  // Laatste woord een losse hoofdletter of een initiaal? Dan die ook weg.
  uit = uit.replace(/\s+[A-ZÀ-ÞŸ]\.?$/, "");
  return `${uit}…`;
}

// De teaser die onder de titel komt te staan. Leeg betekent: alleen de titel
// tonen. `eersteZin` komt van de aanroeper (lib/tegels.js), zodat deze module
// niets van de presentatielaag hoeft te importeren.
//
// VOLGORDE IS ALLES. Eerst spaties herstellen, dan de VOLLEDIGE eerste zin
// pakken en die beoordelen, en pas daarna inkorten. Beoordelen ná het inkorten
// zou onze eigen schaar aanzien voor een kapotte bron.
export function teaser(samenvatting, eersteZin, max = 150) {
  const hersteld = herstelSpaties(samenvatting);
  if (!hersteld.trim()) return { tekst: "", reden: null };
  if (bevatRestGlue(hersteld)) return { tekst: "", reden: "aaneengeplakte tekst, herstel niet gelukt" };
  const volleZin = eersteZin(hersteld, Number.MAX_SAFE_INTEGER);
  const kapot = afgekapt(volleZin);
  if (kapot) return { tekst: "", reden: kapot };
  return { tekst: kortAf(volleZin, max), reden: null };
}

// ---- 3. Uitsluitlijst -------------------------------------------------------
// Kop, samenvatting én link worden getoetst: een platform kan in de tekst
// genoemd worden of alleen in de link zitten.
export function uitgesloten(item) {
  const treffer = zoekUitsluiting(
    `${(item && item.titel) || ""} ${(item && item.samenvatting) || ""} ${(item && item.url) || ""}`
  );
  if (!treffer) return null;
  return `${treffer.soort} genoemd: ${treffer.term}`;
}
