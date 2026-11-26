// /api/redactie-nv — de brug tussen /redactie en Nieuwsvoorziening.
// GET  -> berichten van de laatste dagen (?dagen=2) uit nieuws.infofrankrijk.com/api/redactie
// POST -> { id, actie: weg|terug|kanaal|plaats|herschrijf|bewerk, ... } of { id, actie: "peil", keuze }
// Achter de bestaande inlog (zoals /api/regie). De sleutel voor de motor staat in
// NV_REDACTIE_SECRET en verlaat deze server nooit: niet in antwoorden, niet in logs.
import { toegangVanVerzoek } from "../lib/auth-node.js";
import { roepMotor, leesOpdracht } from "../lib/redactie-nv.js";

function leesBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const deur = await toegangVanVerzoek(req, res);
  if (!deur.ok) {
    return res.status(deur.status === 503 ? 503 : 401).json({ ok: false, fout: deur.status === 503 ? "Inloggen is op deze omgeving niet ingesteld." : "Niet ingelogd of geen toegang." });
  }
  if (req.method === "GET") {
    const dagen = Number((req.query && req.query.dagen) || 2);
    const q = "dagen=" + (Number.isFinite(dagen) && dagen >= 1 ? Math.min(30, Math.floor(dagen)) : 2);
    const uit = await roepMotor({ methode: "GET", query: q });
    return res.status(uit.status).json(uit.body);
  }
  if (req.method === "POST") {
    const l = leesOpdracht(leesBody(req));
    if (!l.ok) return res.status(400).json(l);
    const uit = await roepMotor({ methode: "POST", body: l.opdracht });
    return res.status(uit.status).json(uit.body);
  }
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, fout: "Alleen GET en POST." });
}
