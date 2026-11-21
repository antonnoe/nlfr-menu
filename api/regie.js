// /api/regie — gegevens voor de Regiekamer (/regie) die niet al in /api/actueel,
// /api/review of /api/selectie staan: de samenvatting van de PEIL-bewaking en
// de keuzes van Anton per PEIL-punt.
//
// Toegang zoals /api/selectie: een Supabase-sessie van een toegestaan adres,
// gecontroleerd HIER in de route.
//
// GET  -> { ok, peil: <samenvatting> | null, peilFout?, besluiten: { <mutatie>: { keuze, op } } }
// POST -> { mutatie: "m.2026.0037", keuze: "a" | "b" | "niets" | "herstel" }
//         Bewaart alleen de keuze (zie lib/regie.js). Er wordt niets naar PEIL geschreven.
import { getJSON, setJSON, kvBeschikbaar } from "../lib/store.js";
import { toegangVanVerzoek } from "../lib/auth-node.js";
import { KEY_PEIL_BESLUITEN, PEIL_BEWAKING_URL, leesPeilBesluit, pasBesluitToe, schoonExport } from "../lib/regie.js";

function leesBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

async function haalPeil() {
  try {
    const r = await fetch(PEIL_BEWAKING_URL, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (!r.ok) return { peil: null, peilFout: r.status === 404 ? "Nog geen samenvatting van de PEIL-bewaking." : "PEIL-bewaking niet bereikbaar (HTTP " + r.status + ")." };
    const peil = schoonExport(await r.json());
    return peil ? { peil } : { peil: null, peilFout: "Samenvatting van de PEIL-bewaking onleesbaar." };
  } catch {
    return { peil: null, peilFout: "PEIL-bewaking niet bereikbaar." };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const deur = await toegangVanVerzoek(req, res);
  if (!deur.ok) {
    return res.status(deur.status === 503 ? 503 : 401).json({ ok: false, fout: deur.status === 503 ? "Inloggen is op deze omgeving niet ingesteld." : "Niet ingelogd of geen toegang." });
  }
  if (!kvBeschikbaar()) return res.status(503).json({ ok: false, fout: "KV niet geconfigureerd." });

  if (req.method === "GET") {
    const [p, besluiten] = await Promise.all([haalPeil(), getJSON(KEY_PEIL_BESLUITEN)]);
    return res.status(200).json({ ok: true, ...p, besluiten: besluiten || {} });
  }
  if (req.method === "POST") {
    const b = leesPeilBesluit(leesBody(req));
    if (!b.ok) return res.status(400).json(b);
    const nieuw = pasBesluitToe(await getJSON(KEY_PEIL_BESLUITEN), b);
    await setJSON(KEY_PEIL_BESLUITEN, nieuw);
    return res.status(200).json({ ok: true, besluiten: nieuw });
  }
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, fout: "Alleen GET en POST." });
}
