// /api/banner — het record achter de Café Jeudi-banner in het hoofdmenu.
//
//   GET   publiek, no-store. Levert het KV-record "banner"; is KV leeg of niet
//         geconfigureerd, dan banner.json uit de repo als startwaarde. Zo toont
//         een verse deployment meteen de goede banner, zonder eerst te moeten
//         opslaan.
//   POST  alleen met "Authorization: Bearer <BANNER_TOKEN>". Valideert het hele
//         record (lib/banner.js) en schrijft het naar KV.
//
// BANNER_TOKEN is een nieuwe env-var in Vercel, los van REVIEW_TOKEN: wie de
// banner beheert hoeft niet ook bij de redactietool te kunnen.
//
// Bewust GEEN token in de querystring (zoals de reviewtool die nog kent): een
// URL komt in serverlogs en in de geschiedenis van de browser terecht. De
// beheerpagina bewaart hem in localStorage en stuurt hem als header mee.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getJSON, setJSON, kvBeschikbaar } from "../lib/store.js";
import { valideer, normaliseer, STANDAARD } from "../lib/banner.js";

const KV_SLEUTEL = "banner";

// De startwaarde uit de repo. Eén keer lezen en onthouden: het bestand
// verandert niet tijdens de looptijd van een functie-instantie.
let startwaardeCache = null;
function startwaarde() {
  if (startwaardeCache) return startwaardeCache;
  try {
    const bestand = path.join(process.cwd(), "banner.json");
    startwaardeCache = normaliseer(JSON.parse(fs.readFileSync(bestand, "utf8")));
  } catch {
    // Ook zonder het bestand een werkend antwoord: het schema staat in lib/.
    startwaardeCache = normaliseer(STANDAARD);
  }
  return startwaardeCache;
}

function leesToken(req) {
  const kop = req && req.headers ? req.headers.authorization || req.headers.Authorization : "";
  const m = /^Bearer\s+(.+)$/i.exec(String(kop || "").trim());
  return m ? m[1].trim() : "";
}

function tokenGeldig(req) {
  const verwachtRuw = process.env.BANNER_TOKEN;
  const verwacht = (verwachtRuw == null ? "" : String(verwachtRuw)).trim();
  const geleverd = leesToken(req);

  // Alleen lengtes loggen, nooit waarden — genoeg om "env-var vergeten" van
  // "verkeerd overgetypt" te onderscheiden.
  if (!verwacht || !geleverd || verwacht.length !== geleverd.length) {
    console.warn(
      "[banner] tokencheck faalt: env BANNER_TOKEN " +
        (verwachtRuw == null ? "ONTBREEKT in deze runtime" : "aanwezig") +
        "; verwachte lengte " + verwacht.length + ", ontvangen lengte " + geleverd.length
    );
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(geleverd), Buffer.from(verwacht));
}

async function leesBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const brokken = [];
  for await (const brok of req) brokken.push(brok);
  const tekst = Buffer.concat(brokken).toString("utf8").trim();
  if (!tekst) return {};
  return JSON.parse(tekst);
}

export default async function handler(req, res) {
  // De banner wordt vanuit het iframe op nederlanders.fr opgehaald, dus
  // cross-origin. Lezen mag iedereen; schrijven hangt aan het token.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    let record = null;
    try {
      record = await getJSON(KV_SLEUTEL);
    } catch {
      record = null;
    }
    const uit = record ? normaliseer(record) : startwaarde();
    return res.status(200).json({
      ...uit,
      bron: record ? "kv" : "banner.json",
      bijgewerkt: new Date().toISOString(),
    });
  }

  if (req.method === "POST") {
    if (!tokenGeldig(req)) {
      return res.status(401).json({ ok: false, fout: "Ongeldig of ontbrekend token." });
    }

    let body;
    try {
      body = await leesBody(req);
    } catch {
      return res.status(400).json({ ok: false, fout: "Onleesbare JSON in de body." });
    }

    const uitslag = valideer(body);
    if (!uitslag.ok) {
      return res.status(400).json({ ok: false, fout: uitslag.fout });
    }

    if (!kvBeschikbaar()) {
      return res.status(503).json({
        ok: false,
        fout: "KV is niet geconfigureerd (KV_REST_API_URL / KV_REST_API_TOKEN ontbreken); er is niets opgeslagen.",
      });
    }

    try {
      await setJSON(KV_SLEUTEL, uitslag.record);
    } catch (e) {
      return res.status(500).json({ ok: false, fout: "Opslaan mislukt: " + (e && e.message) });
    }

    return res.status(200).json({ ok: true, record: uitslag.record });
  }

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ ok: false, fout: "Methode niet toegestaan." });
}
