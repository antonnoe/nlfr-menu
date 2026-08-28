// GET /api/actueel-tekst — de tweede levering bij /api/actueel.
// ---------------------------------------------------------------------------
// Levert per artikel BUITEN HET ARCHIEF wat de lezer pas ziet als hij
// OPENKLAPT: de volledige NL-tekst en de volledige bronnen-array (met titel,
// naam, datum en de al gevalideerde bron-URL, of `url: null` met
// `urlGeweigerd` als de server hem heeft geweigerd — zie lib/bronurl.js).
// De archiefartikelen staan in /api/actueel-archief.
//
// Vorm:
//   { bijgewerkt, gebakkenOp, artikelen: { "<tegelId>/<artikelId>": { tekst, bronnen } } }
//
// ÉÉN verzoek voor alle artikelen, geen route per artikel: 152 losse verzoeken
// zouden op een trage verbinding veel duurder zijn dan de ene levering die ze
// vervangt, en de CDN zou ze geen van alle warm hebben.
//
// De sleutel is `tegelId/artikelId` en niet het kale artikel-id, omdat
// hetzelfde artikel-id in twee tegels kan voorkomen (een perssynthese die van
// de live-tegel naar het archief verhuist). `bijgewerkt` is hetzelfde bakmoment
// als in de compacte levering, zodat te zien is of de twee uit dezelfde ronde
// komen.
//
// Cache en terugval zijn identiek aan /api/actueel (zie lib/lever.js): de cron
// bakt deze levering voor, en bij een ontbrekende snapshot stelt de route het
// volledige antwoord alsnog zelf samen en schrijft beide leveringen weg.

import { lever } from "../lib/lever.js";

export default async function handler(req, res) {
  return lever(req, res, "tekst");
}
