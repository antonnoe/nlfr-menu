// /api/review — backend van de reviewtool. Toegang via een geheim token in de
// header X-Review-Token, vergeleken met de env-var REVIEW_TOKEN. Geen login.
//
// UITSLUITEND DE HEADER, NIET DE QUERYSTRING. Een token in een URL belandt in de
// browsergeschiedenis en in de serverlogs van elke aanvraag, en lift mee als
// Referer naar elke externe link die op die pagina wordt aangeklikt — en /review
// staat vol met links naar bronnen en naar Infofrankrijk. Een header doet dat
// alle drie niet.
//
// De route heeft ?token= een tijd lang óók gelezen: eerst als enige weg, later
// als terugval toen een geldig token werd geweigerd. Die oorzaak bleek elders te
// liggen (een wachtwoordveld waar de wachtwoordmanager in schreef) en de
// headerroute is inmiddels op productie bewezen, dus de terugval is eruit.
// review.html haalt een token dat nog in zijn eigen URL staat wel op, bewaart
// het en wist het uit de adresbalk — een oude bookmark blijft dus werken, maar
// het token reist daarna alleen nog als header.
// ---------------------------------------------------------------------------
// GET  -> lijst met concepten + publicaties (token vereist).
// POST -> { actie, id, tekst? } met actie:
//           "publiceer"   concept -> publicatie (evt. met bewerkte tekst)
//           "weg"         concept verwijderen + afwijzing voor CONCEPT_TTL_S (cron regenereert niet)
//           "bewerk"      concepttekst bijwerken (TTL vernieuwt)
//           "depubliceer" publicatie verwijderen (verdwijnt van de feed)
//           "verwijs"     Infofrankrijk-verwijzing onder een bericht zetten
//           "verwijs-weg" die verwijzing weer weghalen
//           "nakijken"    IF-artikel op de auditlijst zetten (lezer ziet niets)
//           "nakijken-klaar" van de auditlijst af
// GET ?deel=if&artikel=<id>[&zoek=…] -> Infofrankrijk-kandidaten bij één bericht.
// Concepten verlopen automatisch na CONCEPT_TTL_S (nu 36 uur, TTL in KV). Standaard = niet
// gepubliceerd.

import crypto from "node:crypto";
import { getJSON, setJSON, del, listJSON, kvBeschikbaar } from "../lib/store.js";
import { buitenlandDoorlaatNL } from "../lib/feeds.js";
import {
  beoordeelPublicatie,
  structureelGeldig,
  isPersConcept,
  zachteSignalen,
} from "../lib/poort.js";
import { vindGelijkenis, gelijkenis, vindPrimaireBron } from "../lib/gelijkenis.js";
import { maakRegisterRecord, pasVervangingToe, pasAanvullingToe } from "../lib/register.js";
import { keurBronnen, bronUrlOordeel, bronVoorNaam } from "../lib/bronurl.js";
import { persTegelVanPublicatie } from "../lib/tegels.js";
import {
  kandidaten as ifKandidaten,
  bijnaVerlopen as ifBijnaVerlopen,
  categorieIdsVoorThema,
  artikelUitIndex,
} from "../lib/ifindex.js";
import {
  CONCEPT_TTL_S,
  PUBLICATIE_TTL_S,
  KEY_CONCEPT,
  KEY_PUBLICATIE,
  KEY_AFGEWEZEN,
  KEY_OVERHEID,
  KEY_REGISTER,
  OVERHEID_TTL_S,
  SCAN_CONCEPT,
  SCAN_PUBLICATIE,
  SCAN_OVERHEID,
  SCAN_REGISTER,
  KEY_IF_INDEX,
  KEY_ACTUEEL_SNAPSHOT,
  KEY_ACTUEEL_TEKST_SNAPSHOT,
  KEY_ACTUEEL_ARCHIEF_SNAPSHOT,
  KEY_VERWIJZING,
  SCAN_VERWIJZING,
  VERWIJZING_TTL_S,
  KEY_NAKIJKEN,
  SCAN_NAKIJKEN,
  IF_VERWIJZING_MAX,
  IF_KANDIDATEN_STANDAARD,
  IF_MAX_LEEFTIJD_MAANDEN,
} from "../lib/config.js";

// Leest het token robuust, ongeacht runtime-eigenaardigheden:
//   1) req.query.token als de runtime die vult (Vercel Node vult dit normaal);
//   2) anders zelf uit req.url parsen (werkt altijd, ook als req.query leeg is);
//   3) als alternatief de header x-review-token.
// Whitespace wordt getrimd (een geplakte env-waarde heeft vaak een \n aan het eind).
function leesToken(req) {
  const t = req && req.headers ? req.headers["x-review-token"] : undefined;
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


// ---- Infofrankrijk: verwijzen en nakijken ----------------------------------
// TWEE UITGANGEN, ÉÉN VRAAG: welke Infofrankrijk-artikelen horen bij dit
// bericht? De ene uitgang is publiek (een verwijzing onder het bericht op
// /actueel), de andere is de takenlijst van de redactie ("nakijken" — een
// nieuwe aankondiging van Bercy kan betekenen dat fiscale artikelen op IF
// bijgewerkt moeten worden). De kandidatenlijst is voor allebei dezelfde.
//
// HANDMATIG, ZONDER UITZONDERING. Alleen deze route schrijft verwijzingen, en
// alleen op een expliciete actie. De cron doet het niet, en er is geen
// automatische keuze uit de lijst: klikt de redactie niets aan, dan komt er
// geen verwijzing.

function leesQuery(req, naam) {
  let v = req && req.query ? req.query[naam] : undefined;
  if (Array.isArray(v)) v = v[0];
  if (v == null && req && req.url) {
    try {
      v = new URL(req.url, "http://localhost").searchParams.get(naam);
    } catch {
      v = null;
    }
  }
  return (v == null ? "" : String(v)).trim();
}

// Bij welk bericht hoort dit id, en welk thema heeft dat bericht? Het thema
// bepaalt via de koppeltabel welke IF-categorieën meedoen. Bewust SERVERSIDE:
// de reviewtool stuurt alleen een id, nooit een thema — anders zou de
// categoriekeuze vanuit de browser te sturen zijn.
async function zoekBericht(id) {
  const overheid = await getJSON(KEY_OVERHEID(id));
  if (overheid) {
    return {
      soort: "overheid",
      id,
      thema: overheid.thema || null,
      kop: overheid.kop || overheid.titelBron || "",
      bron: overheid.bron || null,
      datum: overheid.datum || overheid.gepubliceerdOp || null,
    };
  }
  const publicatie = await getJSON(KEY_PUBLICATIE(id));
  if (publicatie) {
    return {
      soort: "publicatie",
      id,
      // Een perssynthese heeft geen opgeslagen thema: de tegelindeling wordt bij
      // weergave berekend. Dezelfde functie gebruiken we hier, zodat de
      // kandidaten horen bij de tegel waarin de lezer het artikel ziet staan.
      thema: persTegelVanPublicatie(publicatie),
      kop: publicatie.kop || "",
      bron: null,
      datum: publicatie.gepubliceerdOp || null,
    };
  }
  return null;
}

async function leesIfIndex() {
  const index = await getJSON(KEY_IF_INDEX);
  if (!index || !Array.isArray(index.artikelen)) return null;
  return index;
}

// Een verwijzing wordt alleen opgeslagen als de URL de bron-URL-toets van
// Infofrankrijk doorstaat (lib/bronurl.js). Dezelfde toets als voor bronlinks:
// dat is de laag die ooit is gebouwd omdat Infofrankrijk-items naar
// fonts.googleapis.com bleken te wijzen, en een verwijzing hoort daar niet
// buiten te vallen.
function keurIfUrl(url) {
  return bronUrlOordeel(url, bronVoorNaam("Infofrankrijk") || {});
}

// ---- De voorgebakken momentopname ongeldig maken ---------------------------
// GEMETEN PROBLEEM, geen theorie. Een verwijzing legde de hele keten correct af
// — KV, /api/review, lib/tegels.js, lib/levering.js, actueel.html — en werd toch
// niet zichtbaar, omdat /api/actueel de VOORGEBAKKEN momentopname uitserveert.
// Die is van vóór de klik en wordt pas losgelaten als hij ouder is dan
// SNAPSHOT_MAX_LEEFTIJD_S (een uur), of als de cron een nieuwe bakt. Loopt de
// cron niet, dan blijft dezelfde momentopname tot SNAPSHOT_TTL_S (zes uur)
// staan. Een verwijzing die pas uren later verschijnt, is in de praktijk geen
// verwijzing.
//
// DEZELFDE REGEL GELDT VOOR ELKE ACTIE DIE VERANDERT WAT /actueel TOONT, en het
// zwaarst voor "Van de site halen". Wie iets weghaalt omdat het fout of
// schadelijk is, haalt het nu weg — niet over een uur. Dat is geen ongemak maar
// een redactioneel risico, en het is de reden dat depubliceer en
// verwijder-overheid hier net zo goed langskomen als verwijs.
//
// WELKE ACTIES WEL EN WELKE NIET. Wel: publiceer, depubliceer, archiveer,
// verwijder-overheid, verwijs en verwijs-weg — die veranderen alle zes wat er op
// /actueel staat. Niet: weg, bewerk, wis-alles en ontdubbel (die raken alleen
// CONCEPTEN, en een concept staat per definitie niet op de pagina), niet
// nakijken en nakijken-klaar (een takenlijst die de lezer nooit ziet), en niet
// keten — die schrijft registerrecords voor /archief, en die route leest KV
// rechtstreeks zonder momentopname.
//
// Weggooien in plaats van bijwerken: de eerstvolgende aanvraag van /api/actueel
// bakt hem dan opnieuw met exact dezelfde code als de cron (lib/lever.js), en er
// is dus geen tweede plek die de regels van hangVerwijzingen na moet doen.
//
// ALLE DRIE, altijd samen. De verwijzing zit alleen in de tekst-levering, maar
// de drie leveringen horen hetzelfde bakmoment te dragen; de sonde toetst dat
// (I10). Eén sleutel weggooien zou die drie uit elkaar laten lopen.
//
// Stil bij een fout: de verwijzing zelf is dan al opgeslagen en verschijnt bij
// de eerstvolgende cronronde alsnog. Een 500 zou de redacteur laten denken dat
// zijn klik niet is aangekomen.
async function vervalSnapshots() {
  for (const sleutel of [
    KEY_ACTUEEL_SNAPSHOT,
    KEY_ACTUEEL_TEKST_SNAPSHOT,
    KEY_ACTUEEL_ARCHIEF_SNAPSHOT,
  ]) {
    try {
      await del(sleutel);
    } catch (e) {
      console.warn(`[review] momentopname ${sleutel} niet kunnen wissen: ${e && e.message}`);
    }
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
    const nuMs = Date.now();

    // ---- Kandidatenlijst bij één bericht (aparte, kleine GET) --------------
    // Apart gehouden van de hoofd-GET: die haalt alle concepten, publicaties,
    // overheidsberichten en registerrecords op, en dat hoef je niet opnieuw te
    // doen omdat de redacteur een zoekterm intypt.
    if (leesQuery(req, "deel") === "if") {
      const artikelId = leesQuery(req, "artikel");
      const zoek = leesQuery(req, "zoek");
      const index = await leesIfIndex();
      if (!index) {
        return res.status(200).json({
          ok: true,
          index: null,
          kandidaten: [],
          fout: "De Infofrankrijk-index is er nog niet. Hij wordt bij de eerstvolgende cronronde opgehaald.",
        });
      }
      const bericht = artikelId ? await zoekBericht(artikelId) : null;
      if (artikelId && !bericht) {
        return res.status(404).json({ ok: false, fout: "Bericht niet gevonden." });
      }
      const thema = bericht ? bericht.thema : null;
      const lijst = ifKandidaten({ index, thema, zoek, nu: nuMs });
      const catIds = categorieIdsVoorThema(thema);
      const bestaand = artikelId ? await getJSON(KEY_VERWIJZING(artikelId)) : null;
      const gekozen = new Set(((bestaand && bestaand.items) || []).map((x) => Number(x.ifId)));
      return res.status(200).json({
        ok: true,
        index: { opgehaaldOp: index.opgehaaldOp, aantal: index.artikelen.length },
        bericht: bericht ? { id: bericht.id, soort: bericht.soort, thema, kop: bericht.kop } : null,
        // Welke categorieën het filter heeft gebruikt, met hun naam — anders is
        // een lege of rare lijst niet te verklaren zonder in de code te kijken.
        categorieen: catIds.map((cid) => ({
          id: cid,
          naam: (index.categorieen && index.categorieen[String(cid)]) || `#${cid}`,
        })),
        maanden: IF_MAX_LEEFTIJD_MAANDEN,
        standaardAantal: IF_KANDIDATEN_STANDAARD,
        totaal: lijst.length,
        kandidaten: lijst.map((a) => ({ ...a, gekozen: gekozen.has(Number(a.ifId)) })),
      });
    }

    const [ruweConcepten, publicaties, overheid, registerRecords, verwijzingRecords, nakijkenRecords] =
      await Promise.all([
        listJSON(SCAN_CONCEPT),
        listJSON(SCAN_PUBLICATIE),
        listJSON(SCAN_OVERHEID),
        listJSON(SCAN_REGISTER),
        listJSON(SCAN_VERWIJZING),
        listJSON(SCAN_NAKIJKEN),
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
        // Zachte signalen: wel tonen, niet blokkeren.
        outletnamenInTekst: zachteSignalen(c).outletnamen,
      };
      // Lijkt dit concept op een ander openstaand concept of op iets dat al live
      // staat? De server rekent, de UI toont alleen.
      c.gelijkenis = vindGelijkenis(c, besten, publicaties);
      // Dwarsverband: staat er over dit onderwerp al een overheidsbericht? Dan
      // is dat de primaire bron. Signalering, geen blokkade — de redacteur
      // kiest tussen "Weg" en publiceren.
      c.primaireBron = c.poort.persconcept
        ? vindPrimaireBron(c, overheid, registerRecords, nuMs)
        : null;
    }
    // VOLGORDE VAN DE WACHTRIJ: breedste bronbasis eerst, daarbinnen het
    // nieuwste bovenaan. De huisregel blijft twee onafhankelijke outlets — dat
    // is de auteursrechtelijke ondergrens en die verandert hier niet — maar een
    // verhaal dat door drie of meer kranten wordt gemeld is een steviger
    // synthese, en dat hoort de redacteur het eerst te zien. Wie halverwege de
    // wachtrij stopt, heeft dan de beste stukken al gehad in plaats van de
    // toevallig nieuwste.
    const breedte = (c) => (c.poort && typeof c.poort.onafhankelijkeOutlets === "number"
      ? c.poort.onafhankelijkeOutlets
      : 0);
    besten.sort(
      (a, b) =>
        breedte(b) - breedte(a) ||
        (Date.parse(b.aangemaaktOp) || 0) - (Date.parse(a.aangemaaktOp) || 0)
    );
    publicaties.sort(
      (a, b) =>
        (Date.parse(b.gepubliceerdOp) || 0) - (Date.parse(a.gepubliceerdOp) || 0)
    );
    overheid.sort(
      (a, b) =>
        (Date.parse(b.gepubliceerdOp) || 0) - (Date.parse(a.gepubliceerdOp) || 0)
    );
    // Bron-URL-weigeringen over ALLES wat is opgeslagen: concepten, publicaties,
    // overheidsberichten en registerrecords. Aanleiding was de storing waarbij
    // Infofrankrijk-items naar fonts.googleapis.com linkten; die was nergens
    // zichtbaar. Nu staat hier per record waarom een link is onderdrukt, in
    // gewone taal. Er wordt niets verwijderd — alleen gemeld.
    const bronUrlWeigeringen = [];
    for (const [soort, lijst] of [
      ["concept", besten],
      ["publicatie", publicaties],
      ["overheid", overheid],
      ["register", registerRecords],
    ]) {
      for (const doc of lijst || []) {
        for (const w of keurBronnen(doc)) {
          bronUrlWeigeringen.push({
            soort,
            id: doc.id || null,
            titel: doc.kop || doc.titel || doc.titelBron || "",
            datum: doc.gepubliceerdOp || doc.datum || doc.datumBron || null,
            bron: w.naam,
            url: w.url,
            reden: w.reden,
          });
        }
      }
    }

    // Verwijzingen als kaart id -> items, zodat de kaart van een bericht meteen
    // toont wat eronder staat zonder een tweede verzoek.
    const verwijzingen = {};
    for (const r of verwijzingRecords) {
      if (r && r.id && Array.isArray(r.items)) verwijzingen[r.id] = r.items;
    }
    // De auditlijst: oudste `modified` bovenaan — dat is de volgorde waarin je
    // ze wilt nakijken.
    const nakijken = (nakijkenRecords || [])
      .filter(Boolean)
      .sort((a, b) => (Date.parse(a.modified) || 0) - (Date.parse(b.modified) || 0));
    // De index en wat er bijna uit de verwijzingen valt. De 12-maandengrens is
    // stil: zonder deze lijst merk je pas dat een artikel niet meer verwijsbaar
    // is als je het mist.
    const ifIndex = await leesIfIndex();
    const bijnaVerlopen = ifIndex ? ifBijnaVerlopen({ index: ifIndex, nu: nuMs }) : [];

    // overheid staat automatisch live; hier alleen als kill-switch (verwijderen).
    return res.status(200).json({
      ok: true,
      verwijzingen,
      nakijken,
      bijnaVerlopen,
      ifIndex: ifIndex
        ? { opgehaaldOp: ifIndex.opgehaaldOp, aantal: ifIndex.artikelen.length }
        : null,
      concepten: besten,
      totaalConcepten: concepten.length,
      duplicatenAantal: duplicaten.length,
      buitenlandVerwijderd,
      publicaties,
      overheid,
      bronUrlWeigeringen,
    });
  }

  if (req.method === "POST") {
    const body = await leesBody(req);
    const actie = body.actie;
    const id = body.id;

    // Bulk-acties zonder id: opruimen van de conceptenberg.
    if (actie === "wis-alles") {
      // Uitsluitend PERSCONCEPTEN in de wachtrij. Deze route scant alleen
      // actueel:concept:* — gepubliceerde persartikelen (actueel:publicatie:*)
      // en overheidsrecords (actueel:overheid:*, inclusief hun levenscyclus)
      // liggen buiten dat patroon en worden dus sowieso niet geraakt. De
      // expliciete isPersConcept-toets houdt daarbovenop concepten van
      // overheids-, Infofrankrijk- en verenigingsbronnen buiten schot, mocht er
      // ooit zo'n concept in de wachtrij belanden.
      const alle = await listJSON(SCAN_CONCEPT);
      let verwijderd = 0;
      let overgeslagen = 0;
      for (const c of alle) {
        if (!c || !c.id) continue;
        if (!isPersConcept(c)) {
          overgeslagen += 1;
          continue;
        }
        await del(KEY_CONCEPT(c.id));
        verwijderd += 1;
      }
      return res.status(200).json({ ok: true, verwijderd, overgeslagen });
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
      // VANGNET tegen per ongeluk dubbel publiceren. Geen harde blokkade: bij
      // doorlopend nieuws is een vervolgverhaal legitiem. De redacteur krijgt de
      // reden te zien en kan dezelfde actie herhalen met bevestigd:true.
      if (body.bevestigd !== true && isPersConcept(concept)) {
        const live = await listJSON(SCAN_PUBLICATIE);
        let lijkendste = null;
        for (const p of live) {
          if (!p || p.id === id) continue;
          const g = gelijkenis({ ...concept, tekst }, p);
          if (!g.sterk) continue;
          if (!lijkendste || g.gedeeldeUrls > lijkendste.g.gedeeldeUrls || g.jaccard > lijkendste.g.jaccard) {
            lijkendste = { p, g };
          }
        }
        if (lijkendste) {
          const sinds = lijkendste.p.gepubliceerdOp
            ? new Date(lijkendste.p.gepubliceerdOp).toLocaleString("nl-NL", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "onbekend";
          return res.status(409).json({
            ok: false,
            geweigerd: true,
            bevestigingNodig: true,
            code: "lijkt-op-live",
            fout:
              `Er staat al een vergelijkbaar verhaal live sinds ${sinds}: “${lijkendste.p.kop || "zonder kop"}” ` +
              `(${lijkendste.g.reden === "bron-urls"
                ? `${lijkendste.g.gedeeldeUrls} dezelfde bronlinks`
                : `${Math.round(lijkendste.g.jaccard * 100)}% woordoverlap`}). ` +
              `Is dit een vervolg op doorlopend nieuws, dan is publiceren prima — bevestig dat dan.`,
            details: {
              id: lijkendste.p.id,
              kop: lijkendste.p.kop || "",
              gepubliceerdOp: lijkendste.p.gepubliceerdOp || null,
              ...lijkendste.g,
            },
          });
        }
      }
      const publicatie = {
        ...concept,
        tekst,
        gepubliceerd: true,
        gepubliceerdOp: new Date().toISOString(),
      };
      await setJSON(KEY_PUBLICATIE(id), publicatie, PUBLICATIE_TTL_S); // verloopt na 7 dagen
      await del(KEY_CONCEPT(id));
      await vervalSnapshots();
      return res.status(200).json({ ok: true, publicatie, snapshotVervallen: true });
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
      // KILL-SWITCH. Eerst het record weg, dan de momentopname: in die volgorde
      // kan een gelijktijdige aanvraag van /api/actueel nooit opnieuw bakken
      // mét het artikel dat net is weggehaald.
      await del(KEY_PUBLICATIE(id));
      await vervalSnapshots();
      return res.status(200).json({ ok: true, snapshotVervallen: true });
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
      // Het artikel verhuist van zijn live tegel naar de Archief-tegel: dat is
      // een zichtbare verandering op /actueel, dus de momentopname klopt niet meer.
      await vervalSnapshots();
      return res.status(200).json({ ok: true, publicatie: pub, snapshotVervallen: true });
    }

    if (actie === "keten") {
      // Antwoord op een keten-vraag bij een overheidsbericht. SERVERSIDE
      // AFGEDWONGEN: de UI stuurt alleen ja/nee + de smaak; welke records
      // veranderen en hoe, wordt hier bepaald.
      const soort = body.soort === "aanvulling" ? "aanvulling" : "vervangen";
      const antwoord = body.antwoord === "ja" ? "ja" : "nee";
      const doc = await getJSON(KEY_OVERHEID(id));
      if (!doc) {
        return res.status(404).json({ ok: false, fout: "Overheidsbericht niet gevonden." });
      }
      const vraag = doc.ketenVraag;
      if (!vraag || !vraag.doelId) {
        return res.status(409).json({ ok: false, fout: "Voor dit bericht staat geen keten-vraag open." });
      }

      if (antwoord === "nee") {
        // Geen keten: de records blijven los. De vraag verdwijnt en komt niet
        // terug (de detectie draait alleen bij instroom van een nieuw bericht).
        delete doc.ketenVraag;
        doc.ketenAntwoord = { soort, antwoord, op: new Date().toISOString() };
        await setJSON(KEY_OVERHEID(id), doc, OVERHEID_TTL_S);
        return res.status(200).json({ ok: true, keten: "geen" });
      }

      // "Ja": beide kanten moeten registerrecords zijn, want de keten hoort in
      // het duurzame register thuis. Staat een van de twee er nog niet in (het
      // nieuwe bericht is meestal nog live), dan nemen we het nu alvast op. Bij
      // het verstrijken van de live periode ziet de cron dat het al opgenomen is
      // en ruimt alleen het live record op.
      const nuIso = Date.now();
      let doelRecord = await getJSON(KEY_REGISTER(vraag.doelId));
      if (!doelRecord) {
        const doelLive = await getJSON(KEY_OVERHEID(vraag.doelId));
        if (!doelLive) {
          return res.status(404).json({ ok: false, fout: "Het bericht uit de keten is niet meer te vinden." });
        }
        doelRecord = maakRegisterRecord(doelLive, nuIso);
      }
      let bronRecord = await getJSON(KEY_REGISTER(id));
      if (!bronRecord) bronRecord = maakRegisterRecord(doc, nuIso);

      const uitkomst =
        soort === "vervangen"
          ? pasVervangingToe(doelRecord, bronRecord, nuIso)
          : pasAanvullingToe(doelRecord, bronRecord, nuIso);

      // Nooit verwijderen: beide records worden geschreven, zonder TTL.
      await setJSON(KEY_REGISTER(uitkomst.oud.id), uitkomst.oud);
      await setJSON(KEY_REGISTER(uitkomst.nieuw.id), uitkomst.nieuw);

      delete doc.ketenVraag;
      doc.ketenAntwoord = { soort, antwoord, doelId: vraag.doelId, op: new Date().toISOString() };
      await setJSON(KEY_OVERHEID(id), doc, OVERHEID_TTL_S);
      return res.status(200).json({
        ok: true,
        keten: soort,
        oud: { id: uitkomst.oud.id, status: uitkomst.oud.status },
        nieuw: { id: uitkomst.nieuw.id, status: uitkomst.nieuw.status },
      });
    }

    // ---- Infofrankrijk: verwijzen (publiek) --------------------------------
    if (actie === "verwijs" || actie === "verwijs-weg") {
      const ifId = Number(body.ifId);
      if (!ifId) return res.status(400).json({ ok: false, fout: "ifId vereist." });
      const bericht = await zoekBericht(id);
      if (!bericht) return res.status(404).json({ ok: false, fout: "Bericht niet gevonden." });

      const bestaand = (await getJSON(KEY_VERWIJZING(id))) || { id, items: [] };
      let items = Array.isArray(bestaand.items) ? bestaand.items : [];

      if (actie === "verwijs-weg") {
        items = items.filter((x) => Number(x.ifId) !== ifId);
      } else {
        if (items.some((x) => Number(x.ifId) === ifId)) {
          return res.status(200).json({ ok: true, items, ongewijzigd: true });
        }
        if (items.length >= IF_VERWIJZING_MAX) {
          return res.status(409).json({
            ok: false,
            fout: `Hooguit ${IF_VERWIJZING_MAX} verwijzingen per bericht. Haal er eerst een weg.`,
          });
        }
        const index = await leesIfIndex();
        const artikel = index ? artikelUitIndex(index, ifId) : null;
        if (!artikel) {
          return res.status(404).json({ ok: false, fout: "Dit artikel staat niet in de Infofrankrijk-index." });
        }
        const oordeel = keurIfUrl(artikel.url);
        if (!oordeel.ok) {
          return res.status(409).json({ ok: false, fout: `Onbruikbare link: ${oordeel.reden}` });
        }
        items = items.concat({
          ifId,
          titel: artikel.titel,
          url: oordeel.url,
          modified: artikel.modified || null,
          gekozenOp: new Date().toISOString(),
        });
      }

      if (!items.length) {
        // Geen verwijzingen meer: het record hoort weg, niet leeg blijven staan.
        await del(KEY_VERWIJZING(id));
      } else {
        await setJSON(
          KEY_VERWIJZING(id),
          { id, items, bijgewerktOp: new Date().toISOString() },
          VERWIJZING_TTL_S
        );
      }
      // En meteen de voorgebakken leveringen ongeldig maken, anders serveert
      // /api/actueel nog tot een uur (zonder cron: tot zes uur) de momentopname
      // van vóór deze klik.
      await vervalSnapshots();
      // De pagina bakt bij de eerstvolgende aanvraag opnieuw. Wat er dan nog
      // tussen zit is de randcache van /api/actueel (s-maxage 900), dus hoogstens
      // de croninterval — niet meer de levensduur van de momentopname.
      return res.status(200).json({ ok: true, items, snapshotVervallen: true });
    }

    // ---- Infofrankrijk: nakijken (alleen redactie) --------------------------
    if (actie === "nakijken") {
      const ifId = Number(body.ifId);
      if (!ifId) return res.status(400).json({ ok: false, fout: "ifId vereist." });
      const index = await leesIfIndex();
      const artikel = index ? artikelUitIndex(index, ifId) : null;
      if (!artikel) {
        return res.status(404).json({ ok: false, fout: "Dit artikel staat niet in de Infofrankrijk-index." });
      }
      const bericht = await zoekBericht(id);
      if (!bericht) return res.status(404).json({ ok: false, fout: "Bericht niet gevonden." });

      const bestaand = (await getJSON(KEY_NAKIJKEN(ifId))) || null;
      const aanleidingen = (bestaand && Array.isArray(bestaand.aanleidingen) ? bestaand.aanleidingen : [])
        .filter((a) => a && a.id !== id)
        .concat({
          id,
          soort: bericht.soort,
          kop: bericht.kop,
          bron: bericht.bron,
          datum: bericht.datum,
          op: new Date().toISOString(),
        });
      const record = {
        ifId,
        titel: artikel.titel,
        url: artikel.url,
        modified: artikel.modified || null,
        aanleidingen,
        gezetOp: (bestaand && bestaand.gezetOp) || new Date().toISOString(),
      };
      // BEWUST ZONDER TTL: dit is een takenlijst, geen momentopname. Hij
      // verdwijnt als de redactie hem afvinkt, niet als de tijd verstrijkt.
      await setJSON(KEY_NAKIJKEN(ifId), record);
      return res.status(200).json({ ok: true, record });
    }

    if (actie === "nakijken-klaar") {
      const ifId = Number(body.ifId || id);
      if (!ifId) return res.status(400).json({ ok: false, fout: "ifId vereist." });
      await del(KEY_NAKIJKEN(ifId));
      return res.status(200).json({ ok: true });
    }

    if (actie === "verwijder-overheid") {
      // Kill-switch voor een automatisch gepubliceerd overheidsbericht. Zelfde
      // volgorde als bij depubliceer: eerst het record, dan de momentopname.
      await del(KEY_OVERHEID(id));
      await vervalSnapshots();
      return res.status(200).json({ ok: true, snapshotVervallen: true });
    }

    return res.status(400).json({ ok: false, fout: `Onbekende actie: ${actie}` });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, fout: "Methode niet toegestaan." });
}
