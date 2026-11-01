// /api/banner — het record achter de Café Jeudi-banner in het hoofdmenu.
//
//   GET   publiek, no-store. Levert het KV-record "banner" plus de effectieve
//         stand: `aan` (effectief, zie lib/banner.js effectieveStand), `datum`
//         (de donderdag waarvoor het geldt, of null), `volgende` (eerstvolgende
//         bijeenkomst) en `bijgewerkt`. Is KV leeg of niet
//         geconfigureerd, dan banner.json uit de repo als startwaarde. Zo toont
//         een verse deployment meteen de goede banner, zonder eerst te moeten
//         opslaan.
//   POST  alleen met "Authorization: Bearer <BANNER_TOKEN>". Valideert het hele
//         record (lib/banner.js) en schrijft het naar KV.
//
// BANNER_TOKEN is een eigen env-var in Vercel, los van de Supabase-login op
// /review: wie de banner beheert hoeft niet ook bij de redactietool te kunnen.
// Deze route kan later dezelfde loginlaag krijgen (zie docs/login.md); dat is
// bewust buiten die wijziging gehouden.
//
// Bewust GEEN token in de querystring: een
// URL komt in serverlogs en in de geschiedenis van de browser terecht. De
// beheerpagina bewaart hem in localStorage en stuurt hem als header mee.

import crypto from "node:crypto";
import { setJSON, kvBeschikbaar } from "../lib/store.js";
import { valideer, effectieveStand, eerstvolgende } from "../lib/banner.js";
import { leesBanner, KV_SLEUTEL_BANNER as KV_SLEUTEL } from "../lib/banner-opslag.js";

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
    const { record: uit, bron } = await leesBanner();
    // `aan` is hier de EFFECTIEVE stand (zie effectieveStand in lib/banner.js):
    // zonder "ja" voor een donderdag die nog niet voorbij is, is het false.
    // `aanIngesteld` is de ruwe stand in het record, voor de beheerpagina.
    const stand = effectieveStand(uit);
    return res.status(200).json({
      ...uit,
      aanIngesteld: uit.aan,
      aan: stand.aan,
      datum: stand.datum,
      volgende: eerstvolgende(uit),
      bron,
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
