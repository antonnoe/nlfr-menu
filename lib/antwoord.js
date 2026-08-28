// Samenstellen van het antwoord van /api/actueel — één plek, twee gebruikers.
// ---------------------------------------------------------------------------
// WAAROM DEZE MODULE BESTAAT. /api/actueel stelde het antwoord bij ELKE
// cache-miss ter plekke samen: 16 live feeds ophalen plus de verenigingen-
// agenda. De traagste externe site bepaalde de responstijd (gemeten: 12 s).
// Nu BAKT de cron (elke 15 min) dit object voor en zet het in KV onder
// KEY_ACTUEEL_SNAPSHOT; /api/actueel leest die sleutel en antwoordt ermee.
//
// Ontbreekt de snapshot of is hij ouder dan SNAPSHOT_MAX_LEEFTIJD_S, dan stelt
// de route hem alsnog zelf samen — met exact deze functie. Dat de twee paden
// dezelfde code draaien is de garantie dat het terugvalpad functioneel
// identiek is aan het voorgebakken pad, inclusief bronStatus en de graceful
// degradation zonder KV.

import { haalAlleItems, haalAgenda } from "./feeds.js";
import { listJSON } from "./store.js";
import { assembleerTegels } from "./tegels.js";
import {
  SCAN_PUBLICATIE,
  SCAN_OVERHEID,
  SCAN_VERWIJZING,
  SNAPSHOT_MAX_LEEFTIJD_S,
} from "./config.js";

// Bouwt het volledige antwoordobject: bijgewerkt, tegels, agenda, bronStatus.
//   nu     — het bakmoment (ms). Dit is wat in `bijgewerkt` terechtkomt.
//   vooraf — optioneel al opgehaalde feeditems ({ items, bronStatus }). De cron
//            heeft die aan het begin van zijn ronde al binnen; die tweede keer
//            ophalen zou de cron nodeloos ~12 s kosten binnen zijn maxDuration.
export async function bouwAntwoord({ nu = Date.now(), vooraf = null } = {}) {
  let items = [];
  let bronStatus = [];
  let agenda = [];
  try {
    const feedsBelofte =
      vooraf && Array.isArray(vooraf.items)
        ? Promise.resolve({ items: vooraf.items, bronStatus: vooraf.bronStatus || [] })
        : haalAlleItems(nu);
    [{ items, bronStatus }, { items: agenda }] = await Promise.all([
      feedsBelofte,
      haalAgenda(nu),
    ]);
  } catch {
    items = [];
    bronStatus = [];
    agenda = [];
  }

  // Opgeslagen NL-content ophalen (graceful: zonder KV blijft de rest werken).
  let publicaties = [];
  let overheidDocs = [];
  // De door de redactie gekozen Infofrankrijk-verwijzingen. Zijn ze er niet,
  // dan mist de pagina alleen het blok "Meer hierover op Infofrankrijk" — de
  // rest blijft ongewijzigd werken.
  let verwijzingen = [];
  try {
    [publicaties, overheidDocs, verwijzingen] = await Promise.all([
      listJSON(SCAN_PUBLICATIE),
      listJSON(SCAN_OVERHEID),
      listJSON(SCAN_VERWIJZING),
    ]);
  } catch {
    publicaties = [];
    overheidDocs = [];
    verwijzingen = [];
  }

  const tegels = assembleerTegels({ publicaties, overheidDocs, items, verwijzingen, nu });
  const gebakkenOp = new Date(nu).toISOString();

  return {
    // `bijgewerkt` is voortaan het BAKMOMENT, niet de requesttijd: de pagina
    // toont daarmee hoe oud de getoonde inhoud werkelijk is.
    bijgewerkt: gebakkenOp,
    gebakkenOp, // expliciet, en waar de leeftijdstoets hieronder op kijkt
    tegels,
    agenda: agenda || [], // activiteiten komende 14 dagen (verenigingen-repo)
    bronStatus,
  };
}

// Is een uit KV gelezen snapshot bruikbaar? Vorm én leeftijd. Een onleesbaar of
// vormloos document is per definitie onbruikbaar; dan bakt de route zelf.
export function snapshotBruikbaar(
  snapshot,
  nu = Date.now(),
  maxLeeftijdS = SNAPSHOT_MAX_LEEFTIJD_S
) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (!Array.isArray(snapshot.tegels)) return false;
  const t = Date.parse(snapshot.gebakkenOp || snapshot.bijgewerkt || "");
  if (!t) return false;
  return nu - t <= maxLeeftijdS * 1000;
}
