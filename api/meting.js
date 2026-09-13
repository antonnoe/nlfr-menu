// /api/meting — de teller van het menugebruik, en de levering aan de Cockpit.
// ---------------------------------------------------------------------------
// POST telt (publiek, vanuit het menu-iframe). GET levert dagtotalen (achter een
// token, voor de Cockpit). Twee richtingen in één route, net als /api/banner,
// alleen precies andersom: daar mag iedereen lezen en schrijft de beheerder;
// hier telt iedereen mee en leest alleen de Cockpit.
//
// WAAROM DE POST NOOIT EEN FOUT TERUGGEEFT. Aan de andere kant zit een bezoeker
// die een link aanklikt. Gaat het tellen mis — KV plat, rare body, verkeerde
// herkomst — dan is er voor hém niets te herstellen, en een foutmelding in de
// console van een iframe op elke pagina van de site is alleen maar schadelijk.
// De teller antwoordt dus altijd 204 en houdt zijn mond. Of het instrument zelf
// gezond is, blijkt uit de GET: die meldt of KV er is en wanneer er voor het
// laatst iets binnenkwam. Dat is het versheidssignaal voor de Cockpit.
//
// GEEN EIGEN ALARM, GEEN EIGEN DASHBOARD. Dit is een meetbron; de Cockpit is de
// enige plek waar gekeken en gealarmeerd wordt.

import crypto from "node:crypto";

import { kvBeschikbaar, pipeline } from "../lib/store.js";
import {
  KEY_METING,
  METING_TTL_S,
  METING_PROEF_TTL_S,
  METING_DAGEN_STANDAARD,
  METING_DAGEN_MAX,
} from "../lib/config.js";
import {
  veldenUitBody,
  herkomstDeugt,
  dagStempel,
  laatsteDagen,
  dagUitHash,
  doorklik,
  VELD_MAX,
  BODY_MAX,
} from "../lib/meting.js";

// Preview- en ontwikkeldeploys schrijven in een eigen sleutel met een korte
// levensduur. VERCEL_ENV wordt door het platform gezet, niet door ons: een
// omgevingsvlag die je zelf moet onthouden te zetten, staat ooit verkeerd.
function isProef() {
  const omgeving = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  return omgeving !== "production";
}

async function leesBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    if (req.body.length > BODY_MAX) return null;
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  // sendBeacon stuurt een Blob met type text/plain (dat is een CORS-veilig
  // type; met application/json zou de browser een preflight willen die
  // sendBeacon niet kan sturen). Vercel parseert die body dus niet voor ons.
  //
  // DE GROOTTE WORDT TWEE KEER GECONTROLEERD, en dat is geen dubbelop: een
  // opgegeven Content-Length scheelt het inlezen helemaal, maar hij is niet
  // verplicht en niet te vertrouwen. Daarom telt het lezen zelf ook mee en
  // stopt het zodra de grens voorbij is, vóór Buffer.concat en JSON.parse.
  const gemeld = Number(req.headers && req.headers["content-length"]);
  if (Number.isFinite(gemeld) && gemeld > BODY_MAX) return null;
  const stukken = [];
  let totaal = 0;
  for await (const stuk of req) {
    totaal += stuk.length;
    if (totaal > BODY_MAX) return null;
    stukken.push(stuk);
  }
  const tekst = Buffer.concat(stukken).toString("utf8");
  if (!tekst) return null;
  try {
    return JSON.parse(tekst);
  } catch {
    return null;
  }
}

function tokenGeldig(req) {
  const verwachtRuw = process.env.METING_TOKEN;
  const verwacht = (verwachtRuw == null ? "" : String(verwachtRuw)).trim();
  const geleverdRuw = req && req.headers ? req.headers["x-meting-token"] : undefined;
  const geleverd = (geleverdRuw == null ? "" : String(geleverdRuw)).trim();
  // In BYTES vergelijken, niet in tekens: timingSafeEqual werkt op buffers en
  // gooit een fout bij verschillende lengtes. Een token met een accent erin is
  // in tekens even lang maar in bytes langer, en dan zou een fout token een 500
  // opleveren in plaats van een nette 401.
  const a = Buffer.from(verwacht, "utf8");
  const b = Buffer.from(geleverd, "utf8");
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---- Tellen -----------------------------------------------------------------

async function tel(req) {
  if (!herkomstDeugt(req.headers)) return;
  if (!kvBeschikbaar()) return;

  let body;
  try {
    body = await leesBody(req);
  } catch {
    return;
  }
  const velden = veldenUitBody(body);
  if (!velden.size) return;

  const proef = isProef();
  const sleutel = KEY_METING(dagStempel(new Date()), proef);
  const ttl = proef ? METING_PROEF_TTL_S : METING_TTL_S;

  // HEXISTS gaat VOOR de tellingen de deur uit, in dezelfde pipeline en dus in
  // deze volgorde: zo staat zwart op wit welke velden er al waren. Dat kan niet
  // uit de uitkomst van HINCRBY worden afgeleid — komt dezelfde nieuwe ingang
  // twee keer in één verzoek voor, dan telt hij in één keer met 2 op en geeft
  // HINCRBY dus 2 terug, precies als een veld dat er al stond. Iemand die elke
  // verzonnen ingang twee keer stuurt, zou de dagsleutel daarmee ongelimiteerd
  // kunnen laten groeien langs de grens hieronder.
  const namen = [...velden.keys()];
  const opdrachten = namen.map((veld) => ["HEXISTS", sleutel, veld]);
  for (const veld of namen) {
    opdrachten.push(["HINCRBY", sleutel, veld, String(velden.get(veld))]);
  }
  // EXPIRE elke keer meesturen in plaats van alleen bij de eerste telling van de
  // dag: dat kost niets extra's in dezelfde pipeline en het scheelt een tweede
  // round-trip om te weten of de sleutel al bestond.
  opdrachten.push(["EXPIRE", sleutel, String(ttl)]);
  opdrachten.push(["HLEN", sleutel]);

  let uitslag;
  try {
    uitslag = await pipeline(opdrachten);
  } catch (e) {
    console.warn("[meting] tellen mislukt: " + (e && e.message));
    return;
  }

  // Overloopgrens. De teller staat open voor iedereen; zonder grens kan iemand
  // de dagsleutel volschrijven met verzonnen ingangen. Velden die er vóór dit
  // verzoek nog niet waren (HEXISTS gaf 0) gaan er weer uit zodra de sleutel
  // over de grens raakt; wat er al stond, blijft staan.
  const lengte = Number(uitslag[uitslag.length - 1] && uitslag[uitslag.length - 1].result);
  if (Number.isFinite(lengte) && lengte > VELD_MAX) {
    const nieuw = namen.filter((_, i) => Number(uitslag[i] && uitslag[i].result) === 0);
    if (nieuw.length) {
      try {
        await pipeline([["HDEL", sleutel, ...nieuw]]);
        console.warn(`[meting] veldgrens ${VELD_MAX} bereikt; ${nieuw.length} nieuwe ingang(en) geweigerd`);
      } catch {
        /* een mislukte opruiming is geen reden om de bezoeker iets te melden */
      }
    }
  }
}

// ---- Leveren ----------------------------------------------------------------

async function lever(req, res) {
  if (!process.env.METING_TOKEN) {
    return res.status(503).json({
      ok: false,
      fout: "METING_TOKEN is niet ingesteld in deze runtime; de levering staat daarom dicht.",
    });
  }
  if (!tokenGeldig(req)) {
    return res.status(401).json({ ok: false, fout: "Ongeldig of ontbrekend token." });
  }

  const gevraagd = Number((req.query && req.query.dagen) || METING_DAGEN_STANDAARD);
  const aantal = Math.max(1, Math.min(Number.isFinite(gevraagd) ? gevraagd : METING_DAGEN_STANDAARD, METING_DAGEN_MAX));
  const proef = isProef();
  const dagen = laatsteDagen(aantal, new Date());

  if (!kvBeschikbaar()) {
    return res.status(200).json({
      bron: "nlfr-menu",
      meting: "menugebruik",
      omgeving: proef ? "proef" : "productie",
      kv: false,
      waarschuwing: "KV is niet geconfigureerd; er wordt niets geteld en niets bewaard.",
      bijgewerkt: new Date().toISOString(),
      // Ook hier, want de Cockpit hoort niet twee antwoordvormen te kennen: een
      // ontbrekend veld dwingt hem tot een uitzondering precies in het geval
      // waarin hij juist een helder signaal nodig heeft.
      laatsteDagMetData: null,
      dagen: [],
    });
  }

  let uitslag;
  try {
    uitslag = await pipeline(dagen.map((d) => ["HGETALL", KEY_METING(d, proef)]));
  } catch (e) {
    return res.status(502).json({ ok: false, fout: "KV lezen mislukt: " + (e && e.message) });
  }

  // Een pipeline kan HTTP 200 geven met een fout in één opdracht. Ongemerkt
  // doorlezen maakt daar nullen van, en dan meldt deze route 200 met kv:true
  // terwijl er in werkelijkheid niets gelezen is: een vals "niet geklikt" is
  // precies het signaal dat de bewaking niet mag krijgen.
  const kapot = uitslag.find((r) => r && r.error);
  if (kapot || uitslag.length !== dagen.length) {
    return res.status(502).json({
      ok: false,
      fout: "KV lezen mislukt: " + (kapot ? String(kapot.error) : "onvolledig antwoord"),
    });
  }

  const rijen = dagen.map((dag, i) => {
    const rij = dagUitHash(dag, uitslag[i] && uitslag[i].result);
    rij.doorklik = doorklik(rij);
    return rij;
  });

  // Het versheidssignaal waar het kader om vraagt: de laatste dag waarop er
  // werkelijk iets binnenkwam. Blijft die achter, dan is het instrument stuk —
  // en dat is iets anders dan een dag waarop niemand op het menu klikte.
  //
  // ELKE soort telt hier mee, ook een lade-opening of een veld uit een oudere
  // menuversie. Kijk je alleen naar weergaven en kliks, dan geldt een dag met
  // uitsluitend lade-openingen als leeg en slaat de bewaking alarm terwijl het
  // instrument gewoon werkt.
  const heeftData = (r) =>
    r.weergaven > 0 ||
    Object.keys(r.kliks).length > 0 ||
    Object.keys(r.laden).length > 0 ||
    Object.keys(r.overig).length > 0;
  const laatsteMetData = rijen.find(heeftData);

  return res.status(200).json({
    bron: "nlfr-menu",
    meting: "menugebruik",
    omgeving: proef ? "proef" : "productie",
    kv: true,
    bijgewerkt: new Date().toISOString(),
    laatsteDagMetData: laatsteMetData ? laatsteMetData.dag : null,
    dagen: rijen,
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method === "POST") {
    try {
      await tel(req);
    } catch (e) {
      console.warn("[meting] onverwachte fout bij tellen: " + (e && e.message));
    }
    return res.status(204).end();
  }

  if (req.method === "GET") return lever(req, res);

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ ok: false, fout: "Methode niet toegestaan." });
}
