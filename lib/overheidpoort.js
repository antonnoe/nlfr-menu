// De poort voor overheidsberichten (20-11-2026, besluit opdrachtgever).
// ---------------------------------------------------------------------------
// Overheidsberichten (Rijksoverheid, Douane, vie-publique enz.) gingen zonder
// enige toets live, ook naar de nieuwsbrief en Infopoche. Nu geldt:
//   - een bericht is alleen LIVE (nieuwspagina, /api/actueel) als het door de
//     poort is: de modelscore uit de selectie is minstens SCORE_DREMPEL, of de
//     redactie heeft het zelf geplaatst;
//   - zonder score of eronder staat het in de voorraad met poort.status
//     "wacht": niet live, wel als kandidaat op /redactie;
//   - een bericht dat de redactie expliciet wegdeed (Weg: redactie.weg) wordt
//     verwijderd en krijgt een afgewezen-merkteken (KEY_AFGEWEZEN) zodat de cron
//     het niet opnieuw live zet.
// Een doc zonder veld `poort` is van vóór de poort en was live: de eerstvolgende
// cronronde toetst hem alsnog (en haalt hem eraf als hij niet doorkomt).
// Alles hier is puur en zonder opslag; de cron doet het schrijven.

import { SCORE_DREMPEL, OVERHEID_TTL_S } from "./config.js";
import { zoekGekoppeldAlle } from "./selectie/kern.js";
import { raaktBuitenland } from "./redactieregels.js";

// Staat dit overheidsdoc live? ALLEEN met poort.status "ok" (fail closed).
// Vroeger gold een ontbrekend poortveld als live ("nog niet getoetst"); daardoor
// bleef elk doc zonder poortveld op de nieuwspagina, in de nieuwsbrief en in
// Infopoche staan zolang de cron het niet toetste (een cronronde die afbreekt, of
// de eerste ronde na een deploy die op de 60 s van de functie stukloopt). Een
// doc zonder veld wacht nu op de eerstvolgende toets van de cron.
export function overheidIsLive(doc) {
  if (!doc) return false;
  return Boolean(doc.poort && doc.poort.status === "ok");
}

function bestScore(doc, kandidaten, besluit) {
  let best = null;
  for (const k of zoekGekoppeldAlle(doc, kandidaten)) {
    if (k.ai && typeof k.ai.score === "number" && (best == null || k.ai.score > best)) best = k.ai.score;
  }
  if (besluit && besluit.ai && typeof besluit.ai.score === "number" && (best == null || besluit.ai.score > best)) best = besluit.ai.score;
  return best;
}

// Variant B (20-11-2026): voor een overheidsbericht telt ALLEEN een expliciete plaatsing
// in /redactie (live:true, opgeslagen als poort.keuze:true) als keuze van de redactie.
// Een go-besluit (ook met nieuwspagina:true, dat de redactiepagina ook voor al-live
// regels opslaat) of een go van het oude selectiescherm maakt een bericht niet live.


// -> { status: "ok" | "wacht" | "afgewezen", score, door }
export function poortUitslag(doc, { kandidaten = [], besluiten = [], drempel = SCORE_DREMPEL } = {}) {
  const lijst = besluiten || [];
  const besluit = lijst.find((b) => b && b.redactie && b.redactie.reviewId === doc.id) || null;
  const score = bestScore(doc, kandidaten, besluit);
  const nlOverheid = doc.thema === "nl-overheid";
  // Alleen een EXPLICIETE Weg telt als afgewezen (redactie.weg); Weg zet ook het
  // afgewezen-merkteken (KEY_AFGEWEZEN).
  if (besluit && besluit.besluit === "nogo" && besluit.redactie.weg === true) return { status: "afgewezen", score, door: "redactie" };
  // De redactie koos expliciet "niet op de nieuwspagina".
  if (besluit && besluit.besluit === "go" && besluit.redactie.nieuwspagina === false) return { status: "wacht", score, door: null };
  const poort = doc.poort || null;
  // De enige keuze die telt: poort.keuze (live:true in /redactie).
  if (poort && poort.status === "ok" && poort.door === "redactie" && poort.keuze === true) return { status: "ok", score: poort.score ?? score, door: "redactie", keuze: true };
  // "ok door redactie" zonder keuze is een stempel van een oudere ronde: opnieuw toetsen als modelbericht.
  const eerderOk = poort && poort.status === "ok";
  const vorigeScore = poort && poort.score != null ? poort.score : score;
  if (nlOverheid && !raaktBuitenland(doc.kop || "", doc.samenvatting || "")) {
    // R17: Nederlands binnenlands bestuur komt niet door op de modelscore alleen.
    if (eerderOk || (score != null && score >= drempel) || (poort && poort.reden === "r17")) return { status: "wacht", score: vorigeScore, door: null, reden: "r17" };
    return { status: "wacht", score, door: null };
  }
  // Keuze A (21-11-2026): de aanvoer loopt weer vanzelf. Franse overheidsberichten,
  // en Nederlandse overheid die NL'ers in het buitenland raakt, gaan zonder klik
  // live. /redactie houdt Weg en "niet op de nieuwspagina" (hierboven).
  return { status: "ok", score, door: "automatisch" };
}

export function restTtlS(doc, nu = Date.now(), ttl = OVERHEID_TTL_S) {
  const t = Date.parse(doc.gepubliceerdOp || doc.datum || "") || nu;
  return Math.max(60, Math.round(ttl - (nu - t) / 1000));
}

// Past de poort toe op de hele voorraad. io = { schrijf(doc, ttlS), verwijder(doc),
// afgewezen(doc) }. Wijzigt alleen wat verandert. Geeft tellingen terug.
export async function verwerkPoort(docs, ctx, io, nu = Date.now()) {
  const tel = { ok: 0, wacht: 0, afgewezen: 0, gewijzigd: 0, eraf: 0, weg: [] };
  for (const d of docs) {
    if (!d || !d.id) continue;
    const u = poortUitslag(d, ctx);
    if (u.status === "afgewezen") {
      await io.afgewezen(d);
      await io.verwijder(d);
      tel.afgewezen += 1;
      tel.weg.push(d.id);
      continue;
    }
    tel[u.status] += 1;
    const huidig = d.poort && d.poort.status;
    if (huidig === u.status && ((d.poort && d.poort.reden) || null) === (u.reden || null)) continue;
    // Lees het bericht vlak voor het terugschrijven opnieuw: een kanaalkeuze of
    // plaatsing die intussen is gedaan (door de redactie) mag niet worden
    // overschreven met de stand van het begin van deze ronde.
    const vers = io.lees ? await io.lees(d) : d;
    if (!vers) continue; // intussen verwijderd
    if (vers.poort && vers.poort.door === "redactie" && vers.poort.status === "ok" && vers.poort.keuze === true) continue;
    if (vers.poort && vers.poort.status === u.status && (vers.poort.reden || null) === (u.reden || null)) continue;
    if (huidig == null && u.status === "wacht") tel.eraf += 1; // was live, komt niet door
    if (huidig === "ok" && u.status === "wacht") tel.eraf += 1;
    vers.poort = { status: u.status, score: u.score, door: u.door, ...(u.reden ? { reden: u.reden } : {}), op: new Date(nu).toISOString() };
    await io.schrijf(vers, restTtlS(vers, nu));
    tel.gewijzigd += 1;
  }
  return tel;
}
