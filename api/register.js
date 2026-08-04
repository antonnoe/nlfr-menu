// GET /api/register — publieke, rubrieksgewijze inhoudsopgave van het
// regelgevingsarchief.
// ---------------------------------------------------------------------------
// DE MUUR ZIT HIER, NIET IN DE PAGINA. Deze route geeft per record uitsluitend
// het triplet terug — datumtag, bron, titel — samengesteld door publiekeRij().
// De tekst, de bron-URL en de ketenvelden verlaten de server niet. Wie de
// respons rechtstreeks opvraagt, krijgt dus precies hetzelfde als wie de pagina
// bekijkt: titels. Records met status 'vervangen' zitten er niet in; ze blijven
// wel in de opslag staan (het register gooit nooit iets weg).

import { listJSON } from "../lib/store.js";
import { publiekeRubrieken } from "../lib/register.js";
import {
  SCAN_REGISTER,
  FEED_MAX_AGE_S,
  FEED_SWR_S,
  OVERHEID_THEMA_LABEL,
  REGISTER_MUURTEKST,
  REGISTER_ABONNEE_URL,
} from "../lib/config.js";

export default async function handler(req, res) {
  let records = [];
  try {
    records = await listJSON(SCAN_REGISTER);
  } catch {
    records = [];
  }

  const rubrieken = publiekeRubrieken(records).map((r) => ({
    rubriek: r.rubriek,
    label: OVERHEID_THEMA_LABEL[r.rubriek] || r.rubriek,
    aantal: r.items.length,
    items: r.items,
  }));

  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${FEED_MAX_AGE_S}, stale-while-revalidate=${FEED_SWR_S}`
  );
  return res.status(200).json({
    bijgewerkt: new Date().toISOString(),
    totaal: rubrieken.reduce((n, r) => n + r.aantal, 0),
    muur: { tekst: REGISTER_MUURTEKST, url: REGISTER_ABONNEE_URL },
    rubrieken,
  });
}
