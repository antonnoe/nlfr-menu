// GET /api/actueel-archief — de derde levering bij /api/actueel.
// ---------------------------------------------------------------------------
// De archieftegel staat standaard DICHT en bevat 86 van de 152 artikelen — goed
// voor 174.180 van de 241.393 bytes van de tekst-levering. Een lezer die het
// archief niet aanraakt hoeft daar niet voor te betalen, dus staat het hier
// apart. De pagina haalt deze levering pas op wanneer de lezer de archieftegel
// OPENT; expres niet op de achtergrond, want dat is precies het verbruik dat we
// weghalen.
//
// Vorm — de compacte artikelen én hun tekst en bronnen, in één verzoek:
//   { bijgewerkt, gebakkenOp, tegelId,
//     artikelen: [ { id, titel, summary, soort, bronMeta, bronAantal, ... } ],
//     teksten:   { "<tegelId>/<artikelId>": { tekst, bronnen } } }
//
// `bijgewerkt` is hetzelfde bakmoment als in de andere twee leveringen, zodat te
// zien is of ze uit dezelfde cronronde komen (de sonde toetst dat, I10).
//
// Cache en terugval zijn identiek aan /api/actueel (zie lib/lever.js): de cron
// bakt deze levering voor, en bij een ontbrekende snapshot stelt de route het
// volledige antwoord alsnog zelf samen en schrijft alle drie de leveringen weg.
//
// NIET TE VERWARREN met /archief: die pagina toont het duurzame
// regelgevingsregister en draait op /api/register. Die staat hier los van.

import { lever } from "../lib/lever.js";

export default async function handler(req, res) {
  return lever(req, res, "archief");
}
