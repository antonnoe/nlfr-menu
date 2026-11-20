// /api/selectie — backend van het go/no-go-scherm /selectie.
// ---------------------------------------------------------------------------
// Toegang zoals /api/review: een Supabase-sessie van een adres in
// ALLOWED_LOGIN_EMAILS, gecontroleerd HIER in de route (de middleware bewaakt
// alleen de pagina).
//
// GET  -> { kandidaten (vers, per verhaal één, score hoog -> laag; zie
//          kandidatenVoorScherm), verborgen, recent (laatste beslissingen), ronde }
// POST -> { actie: "go" | "nogo", id, categorie? }
//         go/nogo: kandidaat wordt een blijvende beslissing (geen TTL). Een
//         gekozen categorie overschrijft het voorstel van het model.
//         { actie: "herstel", id }: een beslissing ongedaan maken; het bericht
//         wordt weer kandidaat.
//         { actie: "reden", id, reden }: reden bij een Nee (Niet relevant, Dubbel,
//         Te oud, Buitenland) achteraf zetten; go/nogo/redactie nemen `reden` ook mee.
//         { actie: "blokkeer" | "deblokkeer", bron }: een nieuwsbron onder
//         embargo zetten of weer vrijgeven.
//         { actie: "redactie", herkomst: "concept"|"publicatie"|"overheid", id,
//           zijbalk: true|false, categorie? }: keuze op de redactiepagina
//         /redactie voor een synthese of overheidsbericht uit /review. true =
//         naar de zijbalk (go), false = niet (no-go, bericht is afgehandeld).
//         Zie redactieBesluit in kern.js.

import { getJSON, setJSON, del, listJSON, kvBeschikbaar } from "../lib/store.js";
import { toegangVanVerzoek } from "../lib/auth-node.js";
import {
  CATEGORIEEN,
  CATEGORIE_LABEL,
  KEY_SEL_KANDIDAAT,
  KEY_SEL_BESLUIT,
  KEY_SEL_RONDE,
  KEY_SEL_HISTORIE,
  SCAN_SEL_KANDIDAAT,
  SCAN_SEL_BESLUIT,
  SEL_KANDIDAAT_TTL_S,
  KEY_SEL_BLOKKADE,
  kandidatenVoorScherm,
  zonderGeblokkeerd,
  bronSleutel,
  zoekGekoppeldAlle,
  redactieBesluit,
  standaardRubriek,
  leesKanalen,
  kanalenVan,
  leesReden,
  SEL_LEES_UREN,
} from "../lib/selectie/kern.js";
import { slaRedactieBesluitOp } from "../lib/selectie/redactie-opslag.js";
import { KEY_CONCEPT, KEY_PUBLICATIE, KEY_OVERHEID, SCORE_DREMPEL } from "../lib/config.js";

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
    const [kandidaten, besluiten, ronde, blokkade] = await Promise.all([
      // Alleen wat recent is geschreven: ouder valt buiten elk venster en
      // hoeft de pagina niet te vertragen (zie lib/store.js, index per soort).
      listJSON(SCAN_SEL_KANDIDAAT, { sindsUren: SEL_LEES_UREN }),
      listJSON(SCAN_SEL_BESLUIT),
      getJSON(KEY_SEL_RONDE),
      getJSON(KEY_SEL_BLOKKADE),
    ]);
    const tonen = kandidatenVoorScherm(zonderGeblokkeerd(kandidaten.filter((k) => !k.opgenomen), blokkade), besluiten);
    const recent = besluiten.sort((a, b) => String(b.besluitOp || "").localeCompare(String(a.besluitOp || ""))).slice(0, 40);
    const go = besluiten.filter((b) => b.besluit === "go").length;
    return res.status(200).json({
      ok: true,
      drempel: SCORE_DREMPEL,
      categorieen: CATEGORIEEN.map((k) => ({ key: k, label: CATEGORIE_LABEL[k] })),
      kandidaten: tonen,
      verborgen: kandidaten.length - tonen.length,
      recent,
      // Keuzes van de laatste 36 uur, zonder de grens van 40 van "recent": de
      // redactiepagina haalt er zelf "vandaag" uit (op de klok van de lezer).
      vandaag: besluiten.filter((b) => Date.parse(b.besluitOp || "") > Date.now() - 36 * 3600 * 1000),
      telling: { besluiten: besluiten.length, go, nogo: besluiten.length - go },
      ronde,
      geblokkeerd: (blokkade && blokkade.bronnen) || [],
      // Voor /redactie: welke berichten uit /review al een keuze hebben, en de
      // kandidaten waarop ze steunen (die horen niet nog eens op het scherm).
      redactie: besluiten
        .filter((b) => b.redactie && b.redactie.reviewId && Date.parse(b.besluitOp || "") > Date.now() - 7 * 86400 * 1000)
        .map((b) => ({ id: b.id, reviewId: b.redactie.reviewId, herkomst: b.redactie.herkomst, besluit: b.besluit, kanalen: kanalenVan(b), categorie: b.categorie, titel: b.titel, besluitOp: b.besluitOp })),
    });
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, fout: "Alleen GET en POST." });
  const body = leesBody(req);
  const { id, categorie, bron, herkomst, zijbalk } = body;
  const elders = body.elders === true; // ook op de nieuwspagina, in de nieuwsbrief of Infopoche
  // kanalen: ["zijbalk", "infofrankrijk"] of een deel daarvan. Leeg = nergens,
  // dus een go zonder kanaal is een no-go. Ontbreekt het veld: alleen zijbalk.
  const kanalen = leesKanalen(body.kanalen);
  let actie = body.actie;
  if (actie === "go" && kanalen && !kanalen.length) actie = "nogo";

  if (actie === "blokkeer" || actie === "deblokkeer") {
    const naam = String(bron || "").trim().slice(0, 100);
    if (!bronSleutel(naam)) return res.status(400).json({ ok: false, fout: "Geen bron opgegeven." });
    const doc = (await getJSON(KEY_SEL_BLOKKADE)) || { bronnen: [] };
    const rest = (doc.bronnen || []).filter((b) => bronSleutel(b.naam) !== bronSleutel(naam));
    const bronnen = actie === "blokkeer" ? [...rest, { naam, op: new Date().toISOString(), door: deur.adres || null }] : rest;
    await setJSON(KEY_SEL_BLOKKADE, { bronnen }); // geen TTL
    return res.status(200).json({ ok: true, bronnen });
  }

  if (!id || typeof id !== "string" || !/^[a-z0-9]{1,20}$/.test(id)) {
    return res.status(400).json({ ok: false, fout: "Ongeldig id." });
  }

  if (actie === "redactie") {
    const uit = await slaRedactieBesluitOp({ herkomst, id, categorie, zijbalk, kanalen, elders, opPagina: body.opPagina, reden: body.reden, weg: body.weg === true, act: body.act, live: body.live === true, kop: body.kop, tekst: body.tekst, door: deur.adres || null });
    if (!uit.ok) return res.status(uit.status).json({ ok: false, fout: uit.fout });
    return res.status(200).json({ ok: true, besluit: uit.besluit });
  }

  if (actie === "go" || actie === "nogo") {
    const k = await getJSON(KEY_SEL_KANDIDAAT(id));
    if (!k) return res.status(404).json({ ok: false, fout: "Kandidaat niet (meer) gevonden." });
    const voorstel = k.ai && CATEGORIEEN.includes(k.ai.categorie) ? k.ai.categorie : null;
    // Nooit verplicht: zonder keuze en voorstel een standaardrubriek.
    const gekozen = CATEGORIEEN.includes(categorie) ? categorie : voorstel || standaardRubriek(k.soort);
    const besluit = {
      ...k,
      besluit: actie,
      kanalen: actie === "go" ? kanalen || ["zijbalk"] : [],
      categorie: gekozen,
      categorieDoorRedactie: Boolean(categorie && categorie !== voorstel),
      ...(leesReden(body.reden) ? { reden: leesReden(body.reden) } : {}),
      besluitOp: new Date().toISOString(),
      door: deur.adres || null,
    };
    await setJSON(KEY_SEL_BESLUIT(id), besluit); // lesmateriaal: geen vervaltermijn
    await del(KEY_SEL_KANDIDAAT(id));
    return res.status(200).json({ ok: true, besluit: { id, besluit: actie, categorie: gekozen, kanalen: besluit.kanalen } });
  }

  if (actie === "reden") {
    // Reden bij een Nee achteraf (of wijzigen): bij het besluit bewaard als leerstof.
    const b = await getJSON(KEY_SEL_BESLUIT(id));
    if (!b) return res.status(404).json({ ok: false, fout: "Beslissing niet gevonden." });
    const r = leesReden(body.reden);
    if (r) b.reden = r; else delete b.reden;
    await setJSON(KEY_SEL_BESLUIT(id), b);
    return res.status(200).json({ ok: true });
  }

  if (actie === "herstel") {
    const b = await getJSON(KEY_SEL_BESLUIT(id));
    if (!b) return res.status(404).json({ ok: false, fout: "Beslissing niet gevonden." });
    const { besluit, besluitOp, door, categorieDoorRedactie, kanalen: _k, reden: _r, ...kandidaat } = b;
    // Het teruggedraaide besluit blijft bewaard (geen TTL): ook een correctie is
    // lesmateriaal, en wie later wil weten wat er gebeurde kan het nalezen.
    const nu = new Date().toISOString();
    await setJSON(KEY_SEL_HISTORIE(id, nu.replace(/[^0-9]/g, "")), { ...b, teruggedraaidOp: nu, teruggedraaidDoor: deur.adres || null });
    // Een besluit vanaf de redactiepagina is geen kandidaat geweest: terug naar
    // de kandidaat waarop het steunde, of alleen weg uit de zijbalk.
    if (b.redactie) {
      if (b.redactie.kandidaat) await setJSON(KEY_SEL_KANDIDAAT(id), b.redactie.kandidaat, SEL_KANDIDAAT_TTL_S);
      for (const kid of b.redactie.ook || []) {
        const k = /^[a-z0-9]{1,20}$/.test(String(kid)) ? await getJSON(KEY_SEL_KANDIDAAT(kid)) : null;
        if (k && k.opgenomen === id) {
          const { opgenomen, ...vrij } = k;
          await setJSON(KEY_SEL_KANDIDAAT(kid), vrij, SEL_KANDIDAAT_TTL_S);
        }
      }
      await del(KEY_SEL_BESLUIT(id));
      return res.status(200).json({ ok: true });
    }
    await setJSON(KEY_SEL_KANDIDAAT(id), kandidaat, SEL_KANDIDAAT_TTL_S);
    await del(KEY_SEL_BESLUIT(id));
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, fout: "Onbekende actie." });
}
