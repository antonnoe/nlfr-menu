// /api/review — backend van de reviewtool. Toegang via geheim token in de
// querystring (?token=...), vergeleken met de env-var REVIEW_TOKEN. Geen login.
// ---------------------------------------------------------------------------
// GET  -> lijst met concepten + publicaties (token vereist).
// POST -> { actie, id, tekst? } met actie:
//           "publiceer"   concept -> publicatie (evt. met bewerkte tekst)
//           "weg"         concept verwijderen + 48u-afwijzing (cron regenereert niet)
//           "bewerk"      concepttekst bijwerken (TTL vernieuwt)
//           "depubliceer" publicatie verwijderen (verdwijnt van de feed)
// Concepten verlopen automatisch na 48 uur (TTL in KV). Standaard = niet
// gepubliceerd.

import crypto from "node:crypto";
import { getJSON, setJSON, del, listJSON, kvBeschikbaar } from "../lib/store.js";
import {
  CONCEPT_TTL_S,
  KEY_CONCEPT,
  KEY_PUBLICATIE,
  KEY_AFGEWEZEN,
  SCAN_CONCEPT,
  SCAN_PUBLICATIE,
} from "../lib/config.js";

function tokenGeldig(req) {
  const verwacht = process.env.REVIEW_TOKEN;
  if (!verwacht) return false;
  const q = req.query && req.query.token;
  const uitQuery = Array.isArray(q) ? q[0] : q;
  const geleverd =
    uitQuery || (req.headers["x-review-token"] || "").toString();
  if (!geleverd) return false;
  const a = Buffer.from(String(geleverd));
  const b = Buffer.from(String(verwacht));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function leesBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const brokken = [];
  for await (const brok of req) brokken.push(brok);
  const ruw = Buffer.concat(brokken).toString("utf8");
  if (!ruw) return {};
  try {
    return JSON.parse(ruw);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");

  if (!tokenGeldig(req)) {
    return res.status(401).json({ ok: false, fout: "Ongeldig of ontbrekend token." });
  }
  if (!kvBeschikbaar()) {
    return res
      .status(503)
      .json({ ok: false, fout: "KV niet geconfigureerd (opslag ontbreekt)." });
  }

  if (req.method === "GET") {
    const [concepten, publicaties] = await Promise.all([
      listJSON(SCAN_CONCEPT),
      listJSON(SCAN_PUBLICATIE),
    ]);
    concepten.sort(
      (a, b) => (Date.parse(b.aangemaaktOp) || 0) - (Date.parse(a.aangemaaktOp) || 0)
    );
    publicaties.sort(
      (a, b) =>
        (Date.parse(b.gepubliceerdOp) || 0) - (Date.parse(a.gepubliceerdOp) || 0)
    );
    return res.status(200).json({ ok: true, concepten, publicaties });
  }

  if (req.method === "POST") {
    const body = await leesBody(req);
    const actie = body.actie;
    const id = body.id;
    if (!actie || !id) {
      return res.status(400).json({ ok: false, fout: "actie en id vereist." });
    }

    if (actie === "publiceer") {
      const concept = await getJSON(KEY_CONCEPT(id));
      if (!concept) {
        return res.status(404).json({ ok: false, fout: "Concept niet gevonden." });
      }
      const tekst =
        typeof body.tekst === "string" && body.tekst.trim()
          ? body.tekst.trim()
          : concept.tekst;
      const publicatie = {
        ...concept,
        tekst,
        gepubliceerd: true,
        gepubliceerdOp: new Date().toISOString(),
      };
      await setJSON(KEY_PUBLICATIE(id), publicatie); // geen TTL: blijft tot handmatig weg
      await del(KEY_CONCEPT(id));
      return res.status(200).json({ ok: true, publicatie });
    }

    if (actie === "bewerk") {
      const concept = await getJSON(KEY_CONCEPT(id));
      if (!concept) {
        return res.status(404).json({ ok: false, fout: "Concept niet gevonden." });
      }
      if (typeof body.tekst !== "string" || !body.tekst.trim()) {
        return res.status(400).json({ ok: false, fout: "tekst vereist." });
      }
      concept.tekst = body.tekst.trim();
      concept.bewerktOp = new Date().toISOString();
      await setJSON(KEY_CONCEPT(id), concept, CONCEPT_TTL_S); // TTL vernieuwt
      return res.status(200).json({ ok: true, concept });
    }

    if (actie === "weg") {
      await del(KEY_CONCEPT(id));
      // Afwijzing onthouden zodat de cron dit verhaal niet meteen opnieuw maakt.
      await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString() }, CONCEPT_TTL_S);
      return res.status(200).json({ ok: true });
    }

    if (actie === "depubliceer") {
      await del(KEY_PUBLICATIE(id));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, fout: `Onbekende actie: ${actie}` });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, fout: "Methode niet toegestaan." });
}
