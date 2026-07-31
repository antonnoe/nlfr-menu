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
  KEY_OVERHEID,
  SCAN_CONCEPT,
  SCAN_PUBLICATIE,
  SCAN_OVERHEID,
} from "../lib/config.js";

// Leest het token robuust, ongeacht runtime-eigenaardigheden:
//   1) req.query.token als de runtime die vult (Vercel Node vult dit normaal);
//   2) anders zelf uit req.url parsen (werkt altijd, ook als req.query leeg is);
//   3) als alternatief de header x-review-token.
// Whitespace wordt getrimd (een geplakte env-waarde heeft vaak een \n aan het eind).
function leesToken(req) {
  let t = req && req.query ? req.query.token : undefined;
  if (Array.isArray(t)) t = t[0];
  if (!t && req && req.url) {
    try {
      t = new URL(req.url, "http://localhost").searchParams.get("token");
    } catch {
      t = null;
    }
  }
  if (!t && req && req.headers) t = req.headers["x-review-token"];
  return (t == null ? "" : String(t)).trim();
}

function tokenGeldig(req) {
  const verwachtRuw = process.env.REVIEW_TOKEN;
  const verwacht = (verwachtRuw == null ? "" : String(verwachtRuw)).trim();
  const geleverd = leesToken(req);

  // Veilige diagnose: alleen lengtes en of de env-var bestaat — nooit waarden.
  if (!verwacht || !geleverd || verwacht.length !== geleverd.length) {
    console.warn(
      `[review] tokencheck faalt: env REVIEW_TOKEN ${
        verwachtRuw == null ? "ONTBREEKT in deze runtime" : "aanwezig"
      }; verwachte lengte ${verwacht.length}, ontvangen lengte ${geleverd.length}`
    );
    return false;
  }

  const gelijk = crypto.timingSafeEqual(
    Buffer.from(geleverd),
    Buffer.from(verwacht)
  );
  if (!gelijk) {
    console.warn(
      `[review] tokencheck faalt: lengtes gelijk (${verwacht.length}) maar waarden verschillen`
    );
  }
  return gelijk;
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
    const [concepten, publicaties, overheid] = await Promise.all([
      listJSON(SCAN_CONCEPT),
      listJSON(SCAN_PUBLICATIE),
      listJSON(SCAN_OVERHEID),
    ]);
    concepten.sort(
      (a, b) => (Date.parse(b.aangemaaktOp) || 0) - (Date.parse(a.aangemaaktOp) || 0)
    );
    publicaties.sort(
      (a, b) =>
        (Date.parse(b.gepubliceerdOp) || 0) - (Date.parse(a.gepubliceerdOp) || 0)
    );
    overheid.sort(
      (a, b) =>
        (Date.parse(b.gepubliceerdOp) || 0) - (Date.parse(a.gepubliceerdOp) || 0)
    );
    // overheid staat automatisch live; hier alleen als kill-switch (verwijderen).
    return res.status(200).json({ ok: true, concepten, publicaties, overheid });
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

    if (actie === "verwijder-overheid") {
      // Kill-switch voor een automatisch gepubliceerd overheidsbericht.
      await del(KEY_OVERHEID(id));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, fout: `Onbekende actie: ${actie}` });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, fout: "Methode niet toegestaan." });
}
