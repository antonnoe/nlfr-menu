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
import { buitenlandDoorlaatNL } from "../lib/feeds.js";
import { beoordeelPublicatie, structureelGeldig } from "../lib/poort.js";
import {
  CONCEPT_TTL_S,
  PUBLICATIE_TTL_S,
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

// ---- Ontdubbelen van concepten ---------------------------------------------
// Veel concepten gaan over hetzelfde verhaal (opeenvolgende cron-rondes). We
// groeperen bijna-gelijke concepten (op kop + tekst) en houden de BESTE over:
// meeste bronnen -> recentst -> meest compleet.
function tokens(s) {
  return new Set(
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
  );
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const w of a) if (b.has(w)) i += 1;
  return i / (a.size + b.size - i);
}
function beterDan(a, b) {
  const ba = a.aantalBronnen || 0;
  const bb = b.aantalBronnen || 0;
  if (ba !== bb) return ba > bb;
  const ta = Date.parse(a.aangemaaktOp) || 0;
  const tb = Date.parse(b.aangemaaktOp) || 0;
  if (ta !== tb) return ta > tb;
  return String(a.tekst || "").length >= String(b.tekst || "").length;
}
function ontdubbel(concepten) {
  const groepen = [];
  for (const c of concepten) {
    const t = tokens(`${c.kop || ""} ${c.tekst || ""}`);
    let g = null;
    for (const x of groepen) {
      if (jaccard(t, x.rep) >= 0.55) {
        g = x;
        break;
      }
    }
    if (!g) groepen.push({ rep: t, beste: c, leden: [c] });
    else {
      g.leden.push(c);
      if (beterDan(c, g.beste)) g.beste = c;
    }
  }
  const besten = groepen.map((g) => g.beste);
  const duplicaten = [];
  for (const g of groepen) for (const c of g.leden) if (c !== g.beste) duplicaten.push(c);
  return { besten, duplicaten };
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
    const [ruweConcepten, publicaties, overheid] = await Promise.all([
      listJSON(SCAN_CONCEPT),
      listJSON(SCAN_PUBLICATIE),
      listJSON(SCAN_OVERHEID),
    ]);
    // Buitenland-opschoning: concepten die niet over Frankrijk gaan (bv. Israël/
    // Hamas) horen hier niet. Ze zijn vaak vóór de tweede filterlaag gemaakt; we
    // verwijderen ze meteen uit de opslag (zelfherstellend) en tonen ze niet.
    const concepten = [];
    let buitenlandVerwijderd = 0;
    for (const c of ruweConcepten) {
      if (buitenlandDoorlaatNL(`${c.kop || ""} ${c.tekst || ""}`)) {
        concepten.push(c);
      } else if (c && c.id) {
        await del(KEY_CONCEPT(c.id));
        buitenlandVerwijderd += 1;
      }
    }
    // Ontdubbelen: alleen de beste per verhaal tonen (van ~300 naar 30-60).
    const { besten, duplicaten } = ontdubbel(concepten);
    // Elk concept krijgt de actuele poort-uitslag mee (aantal onafhankelijke
    // outlets + namen, en of het zou worden geweigerd). Ook oude concepten uit KV
    // worden zo NU beoordeeld, niet volgens de regels van toen.
    for (const c of besten) {
      const s = structureelGeldig(c);
      c.poort = {
        persconcept: !s.overgeslagen,
        onafhankelijkeOutlets: s.onafhankelijk == null ? null : s.onafhankelijk,
        outletNamen: s.outlets || [],
        publiceerbaar: s.ok !== false,
        code: s.ok === false ? s.code : null,
      };
    }
    besten.sort(
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
    return res.status(200).json({
      ok: true,
      concepten: besten,
      totaalConcepten: concepten.length,
      duplicatenAantal: duplicaten.length,
      buitenlandVerwijderd,
      publicaties,
      overheid,
    });
  }

  if (req.method === "POST") {
    const body = await leesBody(req);
    const actie = body.actie;
    const id = body.id;

    // Bulk-acties zonder id: opruimen van de conceptenberg.
    if (actie === "wis-alles") {
      const alle = await listJSON(SCAN_CONCEPT);
      for (const c of alle) if (c && c.id) await del(KEY_CONCEPT(c.id));
      return res.status(200).json({ ok: true, verwijderd: alle.length });
    }
    if (actie === "ontdubbel") {
      const alle = await listJSON(SCAN_CONCEPT);
      const { duplicaten } = ontdubbel(alle);
      for (const c of duplicaten) if (c && c.id) await del(KEY_CONCEPT(c.id));
      return res
        .status(200)
        .json({ ok: true, verwijderd: duplicaten.length, over: alle.length - duplicaten.length });
    }

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
      // POORTWACHTER: de huisregels opnieuw toetsen op het moment van
      // publiceren, op de tekst zoals die live zou gaan. Vangt ook concepten die
      // vóór een regelwijziging in KV zijn beland. Overheid/verenigingen vallen
      // hierbuiten (zie lib/poort.js).
      const oordeel = beoordeelPublicatie(concept, tekst);
      if (!oordeel.ok) {
        console.warn(`[review] publicatie geweigerd (${oordeel.code}) voor concept ${id}`);
        return res.status(409).json({
          ok: false,
          geweigerd: true,
          code: oordeel.code,
          fout: oordeel.fout,
          details: oordeel.details,
        });
      }
      const publicatie = {
        ...concept,
        tekst,
        gepubliceerd: true,
        gepubliceerdOp: new Date().toISOString(),
      };
      await setJSON(KEY_PUBLICATIE(id), publicatie, PUBLICATIE_TTL_S); // verloopt na 7 dagen
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

    if (actie === "archiveer") {
      // Handmatig naar de Archief-tegel schuiven (i.p.v. wachten op de
      // automatische 48 u). De originele publicatietijd blijft staan, zodat de
      // "blijft nog X dagen" en de 14-daagse TTL ongewijzigd doorlopen.
      const pub = await getJSON(KEY_PUBLICATIE(id));
      if (!pub) {
        return res.status(404).json({ ok: false, fout: "Publicatie niet gevonden." });
      }
      pub.gearchiveerd = true;
      pub.gearchiveerdOp = new Date().toISOString();
      const gepubT = Date.parse(pub.gepubliceerdOp) || Date.now();
      const rest = Math.max(60, Math.round(PUBLICATIE_TTL_S - (Date.now() - gepubT) / 1000));
      await setJSON(KEY_PUBLICATIE(id), pub, rest); // TTL blijft op het 14-daagse eindpunt
      return res.status(200).json({ ok: true, publicatie: pub });
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
