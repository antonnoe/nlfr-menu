// /api/selectie — backend van het go/no-go-scherm /selectie.
// ---------------------------------------------------------------------------
// Toegang zoals /api/review: een Supabase-sessie van een adres in
// ALLOWED_LOGIN_EMAILS, gecontroleerd HIER in de route (de middleware bewaakt
// alleen de pagina).
//
// GET  -> { kandidaten (score hoog -> laag), recent (laatste beslissingen), ronde }
// POST -> { actie: "go" | "nogo", id, categorie? }
//         go/nogo: kandidaat wordt een blijvende beslissing (geen TTL). Een
//         gekozen categorie overschrijft het voorstel van het model.
//         { actie: "herstel", id }: een beslissing ongedaan maken; het bericht
//         wordt weer kandidaat.

import { getJSON, setJSON, del, listJSON, kvBeschikbaar } from "../lib/store.js";
import { toegangVanVerzoek } from "../lib/auth-node.js";
import {
  CATEGORIEEN,
  CATEGORIE_LABEL,
  KEY_SEL_KANDIDAAT,
  KEY_SEL_BESLUIT,
  KEY_SEL_RONDE,
  SCAN_SEL_KANDIDAAT,
  SCAN_SEL_BESLUIT,
  SEL_KANDIDAAT_TTL_S,
} from "../lib/selectie/kern.js";

function leesBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const deur = await toegangVanVerzoek(req, res);
  if (!deur.ok) {
    return res.status(deur.status === 503 ? 503 : 401).json({
      ok: false,
      fout: deur.status === 503 ? "Inloggen is op deze omgeving niet ingesteld." : "Niet ingelogd of geen toegang.",
    });
  }
  if (!kvBeschikbaar()) return res.status(503).json({ ok: false, fout: "KV niet geconfigureerd." });

  if (req.method === "GET") {
    const [kandidaten, besluiten, ronde] = await Promise.all([
      listJSON(SCAN_SEL_KANDIDAAT),
      listJSON(SCAN_SEL_BESLUIT),
      getJSON(KEY_SEL_RONDE),
    ]);
    kandidaten.sort((a, b) => ((b.ai && b.ai.score) ?? -1) - ((a.ai && a.ai.score) ?? -1) || String(b.datum || "").localeCompare(String(a.datum || "")));
    const recent = besluiten.sort((a, b) => String(b.besluitOp || "").localeCompare(String(a.besluitOp || ""))).slice(0, 40);
    const go = besluiten.filter((b) => b.besluit === "go").length;
    return res.status(200).json({
      ok: true,
      categorieen: CATEGORIEEN.map((k) => ({ key: k, label: CATEGORIE_LABEL[k] })),
      kandidaten,
      recent,
      telling: { besluiten: besluiten.length, go, nogo: besluiten.length - go },
      ronde,
    });
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, fout: "Alleen GET en POST." });
  const { actie, id, categorie } = leesBody(req);
  if (!id || typeof id !== "string" || !/^[a-z0-9]{1,20}$/.test(id)) {
    return res.status(400).json({ ok: false, fout: "Ongeldig id." });
  }

  if (actie === "go" || actie === "nogo") {
    const k = await getJSON(KEY_SEL_KANDIDAAT(id));
    if (!k) return res.status(404).json({ ok: false, fout: "Kandidaat niet (meer) gevonden." });
    const voorstel = k.ai && CATEGORIEEN.includes(k.ai.categorie) ? k.ai.categorie : null;
    const gekozen = CATEGORIEEN.includes(categorie) ? categorie : voorstel;
    if (actie === "go" && !gekozen) {
      return res.status(400).json({ ok: false, fout: "Kies eerst een categorie." });
    }
    const besluit = {
      ...k,
      besluit: actie,
      categorie: gekozen,
      categorieDoorRedactie: Boolean(categorie && categorie !== voorstel),
      besluitOp: new Date().toISOString(),
      door: deur.adres || null,
    };
    await setJSON(KEY_SEL_BESLUIT(id), besluit); // GEEN TTL: dit is het lesmateriaal
    await del(KEY_SEL_KANDIDAAT(id));
    return res.status(200).json({ ok: true, besluit: { id, besluit: actie, categorie: gekozen } });
  }

  if (actie === "herstel") {
    const b = await getJSON(KEY_SEL_BESLUIT(id));
    if (!b) return res.status(404).json({ ok: false, fout: "Beslissing niet gevonden." });
    const { besluit, besluitOp, door, categorieDoorRedactie, ...kandidaat } = b;
    await setJSON(KEY_SEL_KANDIDAAT(id), kandidaat, SEL_KANDIDAAT_TTL_S);
    await del(KEY_SEL_BESLUIT(id));
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, fout: "Onbekende actie." });
}
