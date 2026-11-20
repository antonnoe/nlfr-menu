// Het redactiebesluit vastleggen (gedeeld door /api/selectie actie "redactie" en
// /api/review actie "publiceer" met een `selectie`-veld, zodat één verzoek
// volstaat, ook als de pagina meteen daarna wordt gesloten).
import { getJSON, setJSON, del, listJSON } from "../store.js";
import { KEY_CONCEPT, KEY_PUBLICATIE, KEY_OVERHEID, KEY_AFGEWEZEN, CONCEPT_TTL_S, OVERHEID_TTL_S, PUBLICATIE_TTL_S, KEY_ACTUEEL_SNAPSHOT, KEY_ACTUEEL_TEKST_SNAPSHOT, KEY_ACTUEEL_ARCHIEF_SNAPSHOT } from "../config.js";
import { normActueelKanalen } from "../tegels.js";
import {
  KEY_SEL_KANDIDAAT,
  KEY_SEL_BESLUIT,
  SCAN_SEL_KANDIDAAT,
  SEL_KANDIDAAT_TTL_S,
  SEL_LEES_UREN,
  zoekGekoppeldAlle,
  redactieBesluit,
} from "./kern.js";

// -> { ok: true, besluit } | { ok: false, status, fout }
async function vervalSnapshots() {
  for (const k of [KEY_ACTUEEL_SNAPSHOT, KEY_ACTUEEL_TEKST_SNAPSHOT, KEY_ACTUEEL_ARCHIEF_SNAPSHOT]) {
    try { await del(k); } catch { /* de eerstvolgende cronronde bakt opnieuw */ }
  }
}

export async function slaRedactieBesluitOp({ herkomst, id, categorie, zijbalk, kanalen, elders, opPagina, reden, voorstel, weg, kop, tekst, act, live, door }) {
  const sleutel = { concept: KEY_CONCEPT, publicatie: KEY_PUBLICATIE, overheid: KEY_OVERHEID }[herkomst];
  if (!sleutel) return { ok: false, status: 400, fout: "Onbekende herkomst." };
  let doc = await getJSON(sleutel(id));
  // Een synthese die intussen is gepubliceerd (een eerdere poging lukte voor de helft)
  // is nu een publicatie: ga daarmee verder in plaats van te falen.
  if (!doc && herkomst === "concept") {
    doc = await getJSON(KEY_PUBLICATIE(id));
    if (doc) herkomst = "publicatie";
  }
  if (!doc) return { ok: false, status: 404, fout: "Bericht niet (meer) gevonden." };
  if (herkomst === "concept" && (kop || tekst) && !weg) {
    if (typeof kop === "string" && kop.trim()) doc.kop = kop.trim().slice(0, 300);
    if (typeof tekst === "string" && tekst.trim()) doc.tekst = tekst.trim();
    doc.bewerktOp = new Date().toISOString();
    await setJSON(KEY_CONCEPT(id), doc, CONCEPT_TTL_S);
  }
  const kandidaten = await listJSON(SCAN_SEL_KANDIDAAT, { sindsUren: SEL_LEES_UREN });
  const [gekoppeld = null, ...ook] = zoekGekoppeldAlle(doc, kandidaten);
  const uit = redactieBesluit({ herkomst, doc, gekoppeld, categorie, zijbalk: zijbalk !== false, kanalen, elders, reden, voorstelLijst: voorstel, weg: weg === true, opPagina: opPagina === false ? false : opPagina === true ? true : null, door: door || null });
  if (uit.fout) return { ok: false, status: 400, fout: uit.fout };
  uit.besluit.redactie.ook = ook.map((k) => k.id);
  await setJSON(KEY_SEL_BESLUIT(uit.besluit.id), uit.besluit); // lesmateriaal: geen vervaltermijn
  if (gekoppeld) await del(KEY_SEL_KANDIDAAT(gekoppeld.id));
  for (const k of ook) await setJSON(KEY_SEL_KANDIDAAT(k.id), { ...k, opgenomen: uit.besluit.id }, SEL_KANDIDAAT_TTL_S);
  // Een weggegooide synthese gaat in hetzelfde verzoek weg (één verzoek volstaat).
  if (weg === true && herkomst === "concept") {
    await del(KEY_CONCEPT(id));
    await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString() }, CONCEPT_TTL_S);
  }
  // Overheid en publicatie: ook de rest in hetzelfde verzoek (één verzoek volstaat).
  if (herkomst === "publicatie" || herkomst === "overheid") {
    if (weg === true) {
      if (herkomst === "publicatie") await del(KEY_PUBLICATIE(id));
      else {
        await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString(), reden: "redactie-weg", doc }, OVERHEID_TTL_S);
        await del(KEY_OVERHEID(id));
      }
      await vervalSnapshots();
    } else {
      const nk = normActueelKanalen(act);
      if (nk || live === true) {
        if (nk) doc.kanalen = { ...(normActueelKanalen(doc.kanalen) || {}), ...nk };
        if (live === true && herkomst === "overheid") doc.poort = { status: "ok", score: (doc.poort && doc.poort.score) ?? null, door: "redactie", keuze: true, op: new Date().toISOString() };
        const t = Date.parse(doc.gepubliceerdOp || doc.datum || "") || Date.now();
        const ttl = herkomst === "overheid" ? OVERHEID_TTL_S : PUBLICATIE_TTL_S;
        await setJSON(sleutel(id), doc, Math.max(60, Math.round(ttl - (Date.now() - t) / 1000)));
        await vervalSnapshots();
      }
    }
  }
  return { ok: true, besluit: { id: uit.besluit.id, besluit: uit.besluit.besluit, categorie: uit.besluit.categorie, kanalen: uit.besluit.kanalen } };
}
