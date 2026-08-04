// GET /api/cron — serverless job met TWEE stromen. Draait op Vercel Cron (elke
// 15 min; alleen op productie) en is handmatig aanroepbaar met
// `Authorization: Bearer <CRON_SECRET>`.
// ---------------------------------------------------------------------------
// 1) OVERHEID (Licence Ouverte): elk nieuw item uit de vijf overheidsthema's
//    krijgt een NL-samenvatting (2-4 zinnen) via de Anthropic API en gaat
//    DIRECT live (geen review). Dit garandeert dagelijkse NL-vulling.
// 2) PERS: items eerst door de faits-divers-zeef; daarna clusteren. Een cluster
//    met >= SYNTHESE_MIN_BRONNEN (2) onafhankelijke bronnen krijgt een NL-
//    synthese als CONCEPT (48 u TTL) -> reviewtool -> pas na akkoord live.
// `?force=1` beperkt de ronde tot het best scorende perscluster (max. 1), zodat
// je gericht één concept kunt testen. Force beïnvloedt ALLEEN de sortering en de
// limiet: de faits-divers-zeef en de eis van >= 2 onafhankelijke outlets gelden
// onverkort. Elke ronde ruimt bovendien concepten op die de huidige huisregels
// niet meer doorstaan (zie lib/poort.js).

import { haalAlleItems, faitsDiversDoorlaat, sportDoorlaat, buitenlandDoorlaatNL, hashId } from "../lib/feeds.js";
import { clusterItems, zelfdeVerhaal, outletNamen } from "../lib/cluster.js";
import { structureelGeldig } from "../lib/poort.js";
import { getJSON, setJSON, del, listJSON, kvBeschikbaar } from "../lib/store.js";
import { synthetiseer, samenvatOverheid } from "../lib/synthese.js";
import {
  CONCEPT_TTL_S,
  OVERHEID_TTL_S,
  MAX_SYNTHESE_PER_RONDE,
  MAX_OVERHEID_PER_RONDE,
  MAX_OPENSTAANDE_CONCEPTEN,
  SYNTHESE_MIN_BRONNEN,
  OVERHEID_THEMAS,
  KEY_CONCEPT,
  KEY_PUBLICATIE,
  KEY_AFGEWEZEN,
  KEY_OVERHEID,
  SCAN_CONCEPT,
  SCAN_OVERHEID,
  SCAN_REGISTER,
  KEY_REGISTER,
  OVERHEID_ARCHIEF_NA_DAGEN,
} from "../lib/config.js";
import { dedupOverheid, alBekend, overheidSleutel } from "../lib/overheid.js";
import { maakRegisterRecord, zoekKeten } from "../lib/register.js";

function leesForce(req) {
  let f = req && req.query ? req.query.force : undefined;
  if (!f && req && req.url) {
    try {
      f = new URL(req.url, "http://localhost").searchParams.get("force");
    } catch {
      f = null;
    }
  }
  return /^(1|true|ja|yes)$/i.test(String(f || "").trim());
}

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    return res.status(503).json({ ok: false, fout: "CRON_SECRET niet ingesteld." });
  }
  const auth = (req.headers.authorization || "").trim();
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, fout: "Niet geautoriseerd." });
  }
  if (!kvBeschikbaar()) {
    return res.status(503).json({ ok: false, fout: "KV niet geconfigureerd." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ ok: false, fout: "ANTHROPIC_API_KEY ontbreekt." });
  }

  const nu = Date.now();
  const force = leesForce(req);
  const { items } = await haalAlleItems(nu);

  // ---- 1) OVERHEID: nieuwe items -> NL-samenvatting, direct live -----------
  // Eerst de bestaande voorraad ontdubbelen. Service-Public publiceert dezelfde
  // actualité op de particuliers- én de professionnels-feed, met verschillende
  // URL's; op de oude URL-sleutel werden dat twee records met elk een eigen
  // samenvatting. dedupOverheid() groepeert op het actualité-nummer (A18905) en
  // houdt per groep het OUDSTE record, zodat de levenscyclus intact blijft (zie
  // lib/overheid.js). Draait elke ronde, dus de huidige tweelingen verdwijnen
  // bij de eerstvolgende cron.
  const overheidVoorraad = await listJSON(SCAN_OVERHEID);
  const { behouden: overheidBehouden, weg: overheidWeg } = dedupOverheid(overheidVoorraad);
  for (const d of overheidWeg) if (d && d.id) await del(KEY_OVERHEID(d.id));
  const overheidSamengevoegd = overheidWeg.length;

  // Het register is de ketencontext: nieuwe berichten worden hiertegen getoetst.
  const registerVoorraad = await listJSON(SCAN_REGISTER);

  const overheidItems = items.filter((i) => OVERHEID_THEMAS.includes(i.thema));
  const overheidVerwerkt = [];
  let nieuwOverheid = 0;
  let overheidDubbelOvergeslagen = 0;
  let ketenVragen = 0;
  for (const item of overheidItems) {
    if (nieuwOverheid >= MAX_OVERHEID_PER_RONDE) break;
    const id = hashId(item.url);
    if (await getJSON(KEY_OVERHEID(id))) {
      overheidVerwerkt.push({ id, status: "overgeslagen" });
      continue;
    }
    // Zelfde bericht, andere feed of andere tracking-parameter? Dan geen tweede
    // record en geen tweede AI-call. Dit vangt ook een gewijzigde ?xtor=-waarde,
    // die anders een "nieuw" bericht zou lijken en de levenscyclus zou resetten.
    if (alBekend(item, overheidBehouden)) {
      overheidDubbelOvergeslagen += 1;
      overheidVerwerkt.push({ id, status: "duplicaat-overgeslagen", bron: item.bron });
      continue;
    }
    try {
      const { kop, samenvatting, model } = await samenvatOverheid(item);
      const doc = {
        id,
        // Actualité-nummer (A18905) als dat in de URL zit: de identiteit die
        // over alle feeds heen gelijk is. Null voor bronnen zonder zo'n nummer;
        // die vallen terug op de titelvergelijking.
        sleutel: overheidSleutel(item.url),
        thema: item.thema,
        bron: item.bron,
        url: item.url,
        datum: item.datum,
        titelBron: item.titel, // Franse brontitel (niet getoond, wel bewaard)
        kop, // NL-kop voor de artikelweergave
        samenvatting, // NL
        model,
        gepubliceerdOp: new Date().toISOString(),
      };
      // KETEN-DETECTIE. Toetst dit bericht tegen het register én de live
      // overheidsvoorraad in dezelfde rubriek. Een match BLOKKEERT DE LIVEGANG
      // NIET — het bericht gaat gewoon live — maar zet een vraagvlag die de
      // redacteur in de reviewtool beantwoordt (zie lib/register.js).
      const vraag = zoekKeten(
        { ...doc, rubriek: doc.thema, titel: doc.kop, tekst: doc.samenvatting },
        [...registerVoorraad, ...overheidBehouden]
      );
      if (vraag) {
        doc.ketenVraag = vraag;
        ketenVragen += 1;
      }
      await setJSON(KEY_OVERHEID(id), doc, OVERHEID_TTL_S);
      overheidBehouden.push(doc); // volgende items in deze ronde hiertegen dedupen
      nieuwOverheid += 1;
      overheidVerwerkt.push({ id, status: "live", bron: item.bron });
    } catch (e) {
      overheidVerwerkt.push({
        id,
        status: "mislukt",
        reden: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---- 1b) REGISTEROPNAME: overheid na zijn live periode -------------------
  // De oude opruimlogica (na de archiefperiode verdwijnen) is vervangen door
  // opname in het duurzame register. Een bericht dat OVERHEID_ARCHIEF_NA_DAGEN
  // dagen live is geweest, verhuist: het registerrecord wordt aangemaakt (zonder
  // TTL, dus permanent) en het live record verdwijnt uit de overheidsvoorraad.
  // Dit is meteen de eenmalige migratie: alles wat nu in het weergave-archief
  // staat, is per definitie ouder dan die grens en gaat bij deze ronde mee.
  // Alleen de OVERHEIDSSTROOM; pers, Infofrankrijk en verenigingen raakt dit niet.
  const registerBekend = new Set(registerVoorraad.map((r) => r && r.id).filter(Boolean));
  const OPNAME_GRENS_MS = OVERHEID_ARCHIEF_NA_DAGEN * 24 * 60 * 60 * 1000;
  let naarRegister = 0;
  let registerOvergeslagen = 0;
  const overheidLive = [];
  for (const d of overheidBehouden) {
    if (!d || !d.id) continue;
    const t = Date.parse(d.datum || d.gepubliceerdOp) || 0;
    if (!t || nu - t < OPNAME_GRENS_MS) {
      overheidLive.push(d);
      continue;
    }
    if (registerBekend.has(d.id)) {
      // Al opgenomen (bv. een eerdere ronde die halverwege afbrak): alleen het
      // live record opruimen, het registerrecord blijft zoals het is.
      await del(KEY_OVERHEID(d.id));
      registerOvergeslagen += 1;
      continue;
    }
    const record = maakRegisterRecord(d, nu);
    await setJSON(KEY_REGISTER(record.id), record); // GEEN TTL: nooit weggooien
    registerVoorraad.push(record);
    registerBekend.add(record.id);
    await del(KEY_OVERHEID(d.id)); // pas verwijderen ná een geslaagde opname
    naarRegister += 1;
  }

  // ---- 2) PERS: faits-divers-zeef -> clusteren -> concept bij >= 2 bronnen --
  const persItems = items.filter(
    (i) => i.regime === "pers" && faitsDiversDoorlaat(i.titel) && sportDoorlaat(i.titel)
  );
  const clusters = clusterItems(persItems, nu);
  // Synthese-drempel (auteursrechtelijk hard): een verhaal moet door minstens
  // SYNTHESE_MIN_BRONNEN VERSCHILLENDE kranten zijn gebracht (aantalBronnen), én
  // door evenveel ONAFHANKELIJKE (niet-wire-copy) berichten (onafhankelijkeBronnen).
  //   - aantalBronnen >= 2  -> niet uit één krant (twee artikelen van Le Figaro
  //     over hetzelfde onderwerp tellen NIET als bevestiging; ook niet als ze uit
  //     twee rubrieksfeeds van diezelfde krant komen — zie outletId).
  //   - onafhankelijkeBronnen >= 2 -> twee kranten die exact dezelfde wire
  //     overnemen tellen samen als één (geen schijnbevestiging).
  const geschiktVoorSynthese = (c) =>
    c.aantalBronnen >= SYNTHESE_MIN_BRONNEN &&
    c.onafhankelijkeBronnen >= SYNTHESE_MIN_BRONNEN;
  // Prioriteit zit al in cluster.score verwerkt (boost), dus sorteren op score
  // brengt belangrijk nieuws vanzelf bovenaan.
  // FORCE: mag alleen de SORTERING/limiet beïnvloeden (één cluster, het best
  // scorende), nooit de inhoudelijke drempels. De faits-divers-zeef (hierboven,
  // op persItems) en de eis van >= 2 onafhankelijke outlets gelden dus ook in
  // force-modus. Levert de selectie niets op, dan maakt force géén concept —
  // beter geen testconcept dan een concept dat de huisregels breekt.
  const geschikt = clusters.filter(geschiktVoorSynthese).sort((a, b) => b.score - a.score);
  const kandidaten = force ? geschikt.slice(0, 1) : geschikt;

  // Auto-prune: snoei de conceptenberg elke ronde terug tot MAX_OPENSTAANDE_
  // CONCEPTEN. Behoud de BESTE (score = bronnen × recency × prioriteitsboost) en
  // altijd de handmatig bewerkte concepten; gooi de rest weg. Zo blijft de
  // reviewlijst behapbaar zonder belangrijk nieuws te verliezen.
  const CONCEPT_MS = CONCEPT_TTL_S * 1000;
  const pruneScore = (c) => {
    const basis = c.onafhankelijkeBronnen || c.aantalBronnen || 1;
    const t = Date.parse(c.clusterLaatste || c.aangemaaktOp) || 0;
    const rec = Math.max(0, 1 - (nu - t) / CONCEPT_MS);
    return basis * (0.4 + 0.6 * rec) * (c.prioriteit ? 2 : 1);
  };
  let bestaande = await listJSON(SCAN_CONCEPT);

  // KV-opschoning: concepten die de HUIDIGE huisregels niet doorstaan, worden
  // verwijderd — ook als ze onder oudere regels zijn aangemaakt. Getoetst wordt
  // op de opgeslagen bronkoppen: faits-divers-zeef en >= 2 onafhankelijke
  // outlets (zie lib/poort.js). De gelijkenistoets op de TEKST hoort hier niet
  // bij: die kan de redactie nog wegschrijven. Overheid/verenigingen blijven
  // buiten schot. Draait elke ronde, dus ook zelfherstellend.
  let opgeruimd = 0;
  const opgeruimdeRedenen = {};
  const schoon = [];
  for (const c of bestaande) {
    const oordeel = structureelGeldig(c);
    if (oordeel.ok) {
      schoon.push(c);
      continue;
    }
    if (c && c.id) await del(KEY_CONCEPT(c.id));
    opgeruimd += 1;
    opgeruimdeRedenen[oordeel.code] = (opgeruimdeRedenen[oordeel.code] || 0) + 1;
  }
  bestaande = schoon;

  let gesnoeid = 0;
  if (!force && bestaande.length > MAX_OPENSTAANDE_CONCEPTEN) {
    const gesorteerd = [...bestaande].sort((a, b) => {
      const ea = a.bewerktOp ? 1 : 0;
      const eb = b.bewerktOp ? 1 : 0;
      if (ea !== eb) return eb - ea; // bewerkte concepten altijd behouden
      return pruneScore(b) - pruneScore(a);
    });
    const weg = gesorteerd.slice(MAX_OPENSTAANDE_CONCEPTEN);
    for (const c of weg) if (c && c.id) await del(KEY_CONCEPT(c.id));
    bestaande = gesorteerd.slice(0, MAX_OPENSTAANDE_CONCEPTEN);
    gesnoeid = weg.length;
  }

  // Vingerafdrukken van de overgebleven concepten, voor dedup over rondes heen.
  const bestaandeKernen = bestaande.map((c) => c.kernTokens).filter(Boolean);

  const openstaand = bestaande.length;
  const ruimte = Math.max(0, MAX_OPENSTAANDE_CONCEPTEN - openstaand);
  const limiet = force ? 1 : Math.min(MAX_SYNTHESE_PER_RONDE, ruimte);

  const persVerwerkt = [];
  let nieuwConcept = 0;
  for (const cluster of kandidaten) {
    if (nieuwConcept >= limiet) break;
    const id = cluster.sleutel;
    const [c1, c2, c3] = await Promise.all([
      getJSON(KEY_CONCEPT(id)),
      getJSON(KEY_PUBLICATIE(id)),
      getJSON(KEY_AFGEWEZEN(id)),
    ]);
    if (c1 || c2 || c3) {
      persVerwerkt.push({ id, status: "overgeslagen" });
      continue;
    }
    // "Laatste productie wint": betreft dit cluster hetzelfde verhaal als een
    // bestaand concept (ook al is de sleutel gedrift)? Dan geen tweede concept.
    if (bestaandeKernen.some((k) => zelfdeVerhaal(cluster.kernTokens, k))) {
      persVerwerkt.push({ id, status: "duplicaat-overgeslagen" });
      continue;
    }
    // Buitenland-zeef vóór de synthese (bespaart een API-call): clusters waarvan
    // de gezamenlijke brontitels het buitenland betreffen zonder Frankrijk-link.
    const koppenBlob = cluster.items.map((i) => i.titel || "").join(" · ");
    if (!buitenlandDoorlaatNL(koppenBlob)) {
      await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString(), reden: "buitenland" }, CONCEPT_TTL_S);
      persVerwerkt.push({ id, status: "buitenland-geweigerd" });
      continue;
    }
    try {
      const synth = await synthetiseer(cluster);
      // "GEEN": het model vond geen enkel onderwerp met >= 2 kranten in dit
      // (vervuilde) cluster. Geen concept, geen excuustekst.
      if (synth.geenVerhaal) {
        await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString(), reden: "geen-verhaal" }, CONCEPT_TTL_S);
        persVerwerkt.push({ id, status: "geen-verhaal-geweigerd" });
        continue;
      }
      // Tweede laag: de NL-synthese kan een land noemen dat in de Franse titels
      // ontbrak. Dan geen concept, en onthouden als afwijzing (geen regeneratie).
      if (!buitenlandDoorlaatNL(`${synth.kop || ""} ${synth.tekst || ""}`)) {
        await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString(), reden: "buitenland" }, CONCEPT_TTL_S);
        persVerwerkt.push({ id, status: "buitenland-geweigerd" });
        continue;
      }
      // Het model gaf aan welke bronnen het echt gebruikte. Blijven er minder dan
      // SYNTHESE_MIN_BRONNEN VERSCHILLENDE kranten over, dan was het cluster
      // vervuild/één-bron (bv. losse faits-divers) -> geen concept.
      if ((synth.onafhankelijkeGebruikt || 0) < SYNTHESE_MIN_BRONNEN) {
        await setJSON(KEY_AFGEWEZEN(id), { id, op: new Date().toISOString(), reden: "te-smal" }, CONCEPT_TTL_S);
        persVerwerkt.push({ id, status: "te-smal-geweigerd", gebruikt: synth.onafhankelijkeGebruikt || 0 });
        continue;
      }
      const concept = {
        id,
        sleutel: id,
        kop: synth.kop, // korte NL-kop voor de artikelweergave
        tekst: synth.tekst,
        // Uitsluitend de bronnen die de synthese echt heeft gebruikt (gematcht
        // op URL tegen de clusteritems). Clusterbijvangst valt hier weg; alleen
        // als de opgave van het model onbruikbaar was staat de volledige lijst
        // er nog, en dan is bronnenTerugval waar.
        bronnen: synth.bronnen,
        bronnenTerugval: !!synth.bronnenTerugval,
        model: synth.model,
        aantalBronnen: synth.bronnen.length, // daadwerkelijk gebruikte bronlinks
        // Onafhankelijke OUTLETS achter de gebruikte bronlinks — niet het aantal
        // links. Twee artikelen van dezelfde krant leveren twee links maar één
        // outlet; de reviewtool toont dit getal, niet aantalBronnen.
        onafhankelijkeOutlets: synth.onafhankelijkeGebruikt || 0,
        outletNamen: outletNamen(
          (synth.bronnen || []).map((b) => ({ titel: b.titel, bron: b.naam }))
        ),
        onafhankelijkeBronnen: cluster.onafhankelijkeBronnen, // voor prune-score
        prioriteit: cluster.prioriteit, // prune-bescherming + markering
        kernTokens: cluster.kernTokens, // vingerafdruk voor cross-ronde dedup
        clusterLaatste: cluster.laatste, // voor de versheids-dot bij weergave
        aangemaaktOp: new Date().toISOString(),
        gepubliceerd: false,
      };
      await setJSON(KEY_CONCEPT(id), concept, CONCEPT_TTL_S);
      bestaandeKernen.push(cluster.kernTokens); // volgende kandidaten dedupen hiertegen
      nieuwConcept += 1;
      persVerwerkt.push({ id, status: "concept-aangemaakt", bronnen: cluster.aantalBronnen });
    } catch (e) {
      persVerwerkt.push({
        id,
        status: "mislukt",
        reden: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return res.status(200).json({
    ok: true,
    modus: force ? "force (test)" : "cron",
    tijdstip: new Date(nu).toISOString(),
    totaalItems: items.length,
    overheid: {
      kandidaten: overheidItems.length,
      nieuwLive: nieuwOverheid,
      samengevoegd: overheidSamengevoegd, // dubbele records uit de voorraad gehaald
      dubbelOvergeslagen: overheidDubbelOvergeslagen, // instroom die al bestond
      ketenVragen, // nieuwe berichten met een openstaande keten-vraag
      voorraad: overheidLive.length,
      verwerkt: overheidVerwerkt,
    },
    register: {
      naarRegister, // deze ronde opgenomen (incl. de eenmalige migratie)
      overgeslagen: registerOvergeslagen, // stond al in het register
      totaal: registerVoorraad.length,
    },
    pers: {
      naZeef: persItems.length,
      clusters: clusters.length,
      geschiktVoorSynthese: clusters.filter(geschiktVoorSynthese).length,
      openstaandeConcepten: openstaand,
      opgeruimd, // concepten die de huidige huisregels niet meer doorstaan
      opgeruimdeRedenen,
      gesnoeid,
      ruimteVoorNieuwe: force ? "force" : ruimte,
      nieuweConcepten: nieuwConcept,
      verwerkt: persVerwerkt,
    },
  });
}
