// Regiekamer (/regie, 21-11-2026, mock-up goedgekeurd door Anton): nieuws en PEIL
// als één lopende band. Deze module bevat alleen pure regels, zodat de route en
// de tests dezelfde logica gebruiken.
//
// PEIL-besluiten: Anton kiest per punt uit de PEIL-bewaking "Verwacht (a)",
// "Vastgesteld (b)" of "Niets". De keuze wordt hier alleen BEWAARD. Er wordt
// niets naar PEIL geschreven: Peil wijzigt nooit zelf een registerwaarde, en het
// schrijven naar de mutatielijst komt pas in ronde 4 (na twee droge weken en
// akkoord van Anton). Fase c bestaat hier bewust niet: die houdt altijd een
// eigen tik in PEIL zelf.
import { KV_PREFIX } from "./config.js";

export const KEY_PEIL_BESLUITEN = `${KV_PREFIX}regie:peil-besluiten:v1`;
export const PEIL_BEWAKING_URL = "https://communitiesabroad.com/manifest/peil-bewaking.json";
export const PEIL_KEUZES = ["a", "b", "niets"];
const MUTATIE_RE = /^m\.\d{4}\.\d{4}$/;

// Controleert een POST van de pagina. Geeft { ok, mutatie, keuze } of { ok:false, fout }.
export function leesPeilBesluit(body) {
  const mutatie = String((body && body.mutatie) || "");
  const keuze = String((body && body.keuze) || "");
  if (!MUTATIE_RE.test(mutatie)) return { ok: false, fout: "Onbekend PEIL-punt." };
  if (keuze !== "herstel" && !PEIL_KEUZES.includes(keuze)) return { ok: false, fout: "Onbekende keuze." };
  return { ok: true, mutatie, keuze };
}

// Past een besluit toe op de bewaarde lijst (een object per mutatie). "herstel"
// haalt de keuze weg. Hooguit 500 punten, de oudste vallen eraf.
export function pasBesluitToe(lijst, { mutatie, keuze }, nu = new Date()) {
  const uit = { ...(lijst && typeof lijst === "object" ? lijst : {}) };
  if (keuze === "herstel") delete uit[mutatie];
  else uit[mutatie] = { keuze, op: nu.toISOString() };
  const sleutels = Object.keys(uit).sort((x, y) => String(uit[y].op).localeCompare(String(uit[x].op)));
  for (const k of sleutels.slice(500)) delete uit[k];
  return uit;
}

// Alleen de velden die de pagina gebruikt, zodat een vreemde export niets
// onverwachts doorgeeft.
export function schoonExport(d) {
  if (!d || typeof d !== "object" || !d.meta) return null;
  const tekst = (s, n) => (s == null ? null : String(s).slice(0, n));
  const url = (u) => (/^https:\/\//.test(String(u || "")) ? String(u) : null);
  const lijst = (x) => (Array.isArray(x) ? x.slice(0, 100) : []);
  return {
    meta: { run: tekst(d.meta.run, 40), droog: d.meta.droog !== false, samenvatting: d.meta.samenvatting && typeof d.meta.samenvatting === "object" ? d.meta.samenvatting : {} },
    besluiten: lijst(d.besluiten).filter((b) => MUTATIE_RE.test(String(b.mutatie || ""))).map((b) => ({
      mutatie: b.mutatie, naam: tekst(b.naam, 160), bron_url: url(b.bron_url), reden: tekst(b.reden, 300),
      oordelen: lijst(b.oordelen).slice(0, 2).map((o) => ({ door: tekst(o.door, 20), model: tekst(o.model, 40), fase: tekst(o.fase, 4), nieuwe_waarde: tekst(o.nieuwe_waarde, 120), ingangsdatum: tekst(o.ingangsdatum, 20), citaat: tekst(o.citaat, 300), citaat_klopt: !!o.citaat_klopt, toelichting: tekst(o.toelichting, 400) })),
    })),
    niet_opgehaald: lijst(d.niet_opgehaald).map((x) => ({ mutatie: tekst(x.mutatie, 20), naam: tekst(x.naam, 160), bron_url: url(x.bron_url), reden: tekst(x.reden, 160) })),
  };
}
