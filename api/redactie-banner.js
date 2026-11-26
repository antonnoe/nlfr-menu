// /api/redactie-banner — Café Jeudi-banner aanpassen vanuit /redactie, met de
// sessie van de redactie in plaats van BANNER_TOKEN (zoals /banner-beheer deed).
// Zelfde validatie en zelfde opslag als api/banner.js (POST); aanTot komt altijd
// uit het bestaande record, nooit uit de body (die hoort bij Ja/Nee).
import { setJSON, kvBeschikbaar } from "../lib/store.js";
import { valideer } from "../lib/banner.js";
import { leesBannerStrikt, KV_SLEUTEL_BANNER } from "../lib/banner-opslag.js";
import { toegangVanVerzoek } from "../lib/auth-node.js";

function leesBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const deur = await toegangVanVerzoek(req, res);
  if (!deur.ok) return res.status(deur.status === 503 ? 503 : 401).json({ ok: false, fout: "Niet ingelogd of geen toegang." });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, fout: "Alleen POST." }); }
  const uitslag = valideer(leesBody(req));
  if (!uitslag.ok) return res.status(400).json({ ok: false, fout: uitslag.fout });
  if (!kvBeschikbaar()) return res.status(503).json({ ok: false, fout: "KV is niet geconfigureerd; er is niets opgeslagen." });
  let bestaand;
  try { bestaand = (await leesBannerStrikt()).record; }
  catch { return res.status(503).json({ ok: false, fout: "Het bestaande record kon niet worden gelezen; er is niets opgeslagen." }); }
  const samen = valideer({ ...uitslag.record, aanTot: bestaand.aanTot });
  const record = samen.ok ? samen.record : { ...uitslag.record, aanTot: null };
  try { await setJSON(KV_SLEUTEL_BANNER, record); }
  catch (e) { return res.status(500).json({ ok: false, fout: "Opslaan mislukt." }); }
  return res.status(200).json({ ok: true, record });
}
