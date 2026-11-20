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

// -> { status: "ok" | "wacht" | "afgewezen", score, door }
export function poortUitslag(doc, { kandidaten = [], besluiten = [], drempel = SCORE_DREMPEL } = {}) {
  const lijst = besluiten || [];
  const besluit = lijst.find((b) => b && b.redactie && b.redactie.reviewId === doc.id) || null;
  // Een go-besluit van het oude selectiescherm (zonder `redactie`) op een
  // kandidaat met dezelfde bronlink telt ook: de redactie koos het bewust.
  const direct = !besluit ? zoekGekoppeldAlle(doc, lijst.filter((b) => b && b.besluit === "go" && !b.redactie))[0] || null : null;
  const score = bestScore(doc, kandidaten, besluit || direct);
  // Alleen een EXPLICIETE Weg telt als afgewezen (redactie.weg). Een nogo zonder
  // dat kenmerk is "niet in de zijbalk" (bijvoorbeeld "OK, plaatsen" met alleen
  // de nieuwspagina, zoals oude besluiten het opsloegen) en wijst niets af;
  // Weg zet daarnaast het afgewezen-merkteken (KEY_AFGEWEZEN).
  if (besluit && besluit.besluit === "nogo" && besluit.redactie.weg === true) return { status: "afgewezen", score, door: "redactie" };
  // Een bericht van vóór de poort (geen poortveld) met een nog bestaand redactiebesluit
  // (nogo zonder Weg, of go) is door de redactie geplaatst: blijft live.
  if (besluit && !doc.poort) return { status: "ok", score, door: "redactie" };
  // De keuze van de redactie gaat altijd voor de score.
  if (besluit && besluit.besluit === "go" && besluit.redactie.nieuwspagina === false) return { status: "wacht", score, door: null };
  if (besluit && besluit.besluit === "go" && besluit.redactie.nieuwspagina === true) return { status: "ok", score, door: "redactie" };
  if (direct && !(doc.poort && doc.poort.status === "ok")) return { status: "ok", score, door: "redactie" };
  if (doc.poort && doc.poort.status === "ok") return { status: "ok", score: doc.poort.score ?? score, door: doc.poort.door || "model" };
  // Vóór de poort bestond de nieuwspagina automatisch; een go van de redactie
  // op zo'n bericht was een bewuste keuze en blijft staan.
  if (besluit && besluit.besluit === "go" && !doc.poort) return { status: "ok", score, door: "redactie" };
  if (score != null && score >= drempel) return { status: "ok", score, door: "model" };
  return { status: "wacht", score, door: null };
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
    if (huidig === u.status) continue;
    // Lees het bericht vlak voor het terugschrijven opnieuw: een kanaalkeuze of
    // plaatsing die intussen is gedaan (door de redactie) mag niet worden
    // overschreven met de stand van het begin van deze ronde.
    const vers = io.lees ? await io.lees(d) : d;
    if (!vers) continue; // intussen verwijderd
    if (vers.poort && vers.poort.door === "redactie" && vers.poort.status === "ok") continue;
    if (vers.poort && vers.poort.status === u.status) continue;
    if (huidig == null && u.status === "wacht") tel.eraf += 1; // was live, komt niet door
    if (huidig === "ok" && u.status === "wacht") tel.eraf += 1;
    vers.poort = { status: u.status, score: u.score, door: u.door, op: new Date(nu).toISOString() };
    await io.schrijf(vers, restTtlS(vers, nu));
    tel.gewijzigd += 1;
  }
  return tel;
}
