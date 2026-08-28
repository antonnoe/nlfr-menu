// Sonde op de LIVE UITVOER van /actueel.
// ---------------------------------------------------------------------------
// WAAROM. De tests bewaken de code op de bronnen die de tests aanleveren. Ze
// zeggen niets over wat er op productie daadwerkelijk uitkomt zodra een echte
// bron zich anders gaat gedragen — precies wat er misging bij de bronlink-
// storing (Infofrankrijk-items die naar fonts.googleapis.com wezen). Deze
// sonde haalt de echte productiedata op en toetst invarianten.
//
// DETERMINISTISCH. Geen AI-oordeel: elke toets is een harde regel met een
// bestaande drempel uit lib/config.js. Bij een schending eindigt het proces met
// code 1, zodat GitHub Actions de run rood maakt en zelf mailt.
//
// Draaien: node scripts/sonde.mjs
//   SONDE_URL          overschrijft de productie-URL (standaard nlfr-menu.vercel.app)
//   SONDE_TOON_LINKS=1 drukt elke titel met zijn bron-URL af
//   SONDE_TOON_FILTER  beperkt die lijst tot titels die deze tekst bevatten
//   SONDE_WEBHOOK_URL  optioneel; ontbreekt hij, dan wordt die stap overgeslagen.

import { laadBronnen } from "../lib/feeds.js";
import { artikelSleutel } from "../lib/levering.js";
import { bronUrlOordeel, bronVoorNaam, bronVoorThema, isAssetHost } from "../lib/bronurl.js";
import { kernUitTekst, zelfdeVerhaal } from "../lib/cluster.js";
import {
  PUBLICATIE_TTL_S,
  VENSTER_VERENIGINGEN_DAGEN,
  OVERHEID_TTL_S,
  IF_VERWIJZING_MAX,
} from "../lib/config.js";

const BASIS = (process.env.SONDE_URL || "https://nlfr-menu.vercel.app").replace(/\/+$/, "");
const API = `${BASIS}/api/actueel`;
// De nieuwspagina wordt in DRIE leveringen geserveerd (zie lib/levering.js).
// `tekst` en de volledige `bronnen`-arrays staan niet meer in /api/actueel maar
// in de tweede levering, en de 86 ARTIKELEN VAN DE ARCHIEFTEGEL staan compleet
// in de derde. De sonde MOET die er dus allebei bij halen en per artikel weer
// samenvoegen — anders zouden de bronlinktoetsen (I3, I4, I9) en de
// tekstinvarianten (I5) stilzwijgend over lege velden lopen, en zouden 86
// artikelen buiten élke invariant vallen. Precies de bewaking die ze moeten
// leveren, zou dan wegvallen.
const API_TEKST = `${BASIS}/api/actueel-tekst`;
const API_ARCHIEF = `${BASIS}/api/actueel-archief`;
const STATISCH = `${BASIS}/actueel.json`;
const DAG = 24 * 60 * 60 * 1000;
// De croninterval (vercel.json: */15). Binnen dit venster mogen de leveringen
// uit verschillende rondes komen zonder dat er iets stuk is — zie I10.
const CRON_INTERVAL_MS = 15 * 60 * 1000;

// Ruimste bewaartermijn die de code zelf hanteert, plus een dag speling voor
// caching. Alles daarbuiten is per definitie fout: het had opgeruimd moeten zijn.
const MAX_LEEFTIJD_DAGEN =
  Math.max(PUBLICATIE_TTL_S / 86400, OVERHEID_TTL_S / 86400, VENSTER_VERENIGINGEN_DAGEN) + 1;

const bevindingen = [];
function meld(invariant, detail) {
  bevindingen.push({ invariant, detail });
}

async function haalJson(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "NLFR-Sonde/1.0" },
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const tekst = await r.text();
  try {
    return JSON.parse(tekst);
  } catch (e) {
    throw new Error(`geen geldige JSON (${e.message}); eerste 120 tekens: ${tekst.slice(0, 120)}`);
  }
}

// Alle artikelen van de pagina, met hun tegel erbij, en met `tekst` en
// `bronnen` uit de tweede/derde levering er weer aan geplakt. Vanaf hier kijkt
// de rest van de sonde naar dezelfde artikelvorm als vóór de splitsing.
//
// De archieftegel komt in de compacte levering ZONDER artikelen binnen (alleen
// `artikelAantal` en `artikelenApart`); zijn artikelen worden hier uit de derde
// levering aangevuld.
function alleArtikelen(data, teksten, archief) {
  const perSleutel = {
    ...((teksten && teksten.artikelen) || {}),
    ...((archief && archief.teksten) || {}),
  };
  const archiefArtikelen = (archief && Array.isArray(archief.artikelen) ? archief.artikelen : []);
  const uit = [];
  for (const t of data.tegels || []) {
    const lijst = t.artikelenApart ? archiefArtikelen : (t.artikelen || []);
    for (const a of lijst) {
      const sleutel = artikelSleutel(t.id, a.id);
      const extra = perSleutel[sleutel] || null;
      uit.push({
        tegel: t,
        art: extra
          ? {
              ...a,
              tekst: extra.tekst,
              bronnen: extra.bronnen,
              // Alleen aanwezig als de redactie een verwijzing heeft gekozen;
              // I13 toetst hem, de rest van de sonde raakt hem niet aan.
              ...(extra.verwijzingen ? { verwijzingen: extra.verwijzingen } : {}),
            }
          : { ...a },
        sleutel,
        // Of dit artikel een tegenhanger in een tekstlevering had. I10 toetst
        // dat; de overige invarianten mogen niet stil doorlopen op een gat.
        gekoppeld: Boolean(extra),
      });
    }
  }
  return uit;
}

async function main() {
  const nu = Date.now();

  // ---- I1. Het antwoord is geldige JSON en bevat items ---------------------
  let data;
  try {
    data = await haalJson(API);
  } catch (e) {
    meld("I1 api-bereikbaar", `${API}: ${e.message}`);
    return klaar(nu);
  }
  // De tweede en derde levering. Ontbreekt er een, dan is dat zelf een
  // bevinding EN mogen de bronlinktoetsen hieronder niet stilzwijgend groen
  // worden.
  let teksten = null;
  let archief = null;
  try {
    teksten = await haalJson(API_TEKST);
  } catch (e) {
    meld("I10 tekstlevering", `${API_TEKST}: ${e.message}`);
  }
  try {
    archief = await haalJson(API_ARCHIEF);
  } catch (e) {
    meld("I10 tekstlevering", `${API_ARCHIEF}: ${e.message}`);
  }

  const artikelen = alleArtikelen(data, teksten, archief);
  if (!artikelen.length) {
    meld("I1 items-aanwezig", `${API} leverde 0 artikelen in ${(data.tegels || []).length} tegels`);
  }

  // ---- I10. De drie leveringen dekken elkaar exact -------------------------
  // Elk artikel van de pagina hoort een tekst-record te hebben, en andersom
  // mogen de tekstleveringen geen wezen bevatten. Loopt dat uiteen, dan klapt
  // de lezer een artikel open en krijgt hij niets.
  //
  // OVER DE BAKMOMENTEN. Elke levering heeft een eigen URL en dus een eigen
  // edge-cache-entry; die kunnen binnen één cronronde uit elkaar lopen zonder
  // dat er iets stuk is (de ene is net ververst, de andere wordt nog stale
  // geserveerd). Daarom is een verschil pas een bevinding als het GROTER is dan
  // de croninterval — dan hangt een levering echt achter. En daarom telt een
  // wees (een tekst-record zonder artikel) alleen als de bakmomenten gelijk
  // zijn: bij normale skew draagt de oudere levering nog records van artikelen
  // die inmiddels verlopen zijn, en dáár heeft geen lezer last van.
  //
  // Een ONTBREKEND record telt altijd: dat is de kant die de lezer wél merkt.
  const bakmomenten = [
    ["compact", data.gebakkenOp],
    ["tekst", teksten && teksten.gebakkenOp],
    ["archief", archief && archief.gebakkenOp],
  ].filter(([, v]) => Boolean(v));
  const tijden = bakmomenten.map(([, v]) => Date.parse(v)).filter((t) => !Number.isNaN(t));
  const spreiding = tijden.length > 1 ? Math.max(...tijden) - Math.min(...tijden) : 0;
  const gelijkGebakken = spreiding === 0;
  if (spreiding > CRON_INTERVAL_MS) {
    meld(
      "I10 leveringen",
      `bakmomenten lopen ${Math.round(spreiding / 60000)} min uiteen (meer dan de croninterval): ` +
        bakmomenten.map(([n, v]) => `${n} ${v}`).join(", ")
    );
  }

  if (teksten || archief) {
    const zonder = artikelen.filter((r) => !r.gekoppeld);
    for (const r of zonder.slice(0, 10)) {
      meld("I10 leveringen", `geen tekst-record voor ${r.sleutel} · "${kort(r.art.titel)}"`);
    }
    if (zonder.length > 10) {
      meld("I10 leveringen", `... en nog ${zonder.length - 10} artikel(en) zonder tekst-record`);
    }
    if (gelijkGebakken) {
      const bekend = new Set(artikelen.map((r) => r.sleutel));
      const wezen = [
        ...Object.keys((teksten && teksten.artikelen) || {}),
        ...Object.keys((archief && archief.teksten) || {}),
      ].filter((k) => !bekend.has(k));
      for (const k of wezen.slice(0, 10)) {
        meld("I10 leveringen", `tekst-record ${k} hoort bij geen enkel artikel`);
      }
    }
  }

  // ---- I12. De archieftegel klopt met zijn eigen levering -------------------
  // De kop toont "86 artikelen" uit `artikelAantal`, terwijl de artikelen zelf
  // uit de derde levering komen. Lopen die twee uiteen, dan belooft de kop iets
  // anders dan de tegel levert.
  for (const t of data.tegels || []) {
    if (!t.artikelenApart) continue;
    const geleverd = (archief && Array.isArray(archief.artikelen) ? archief.artikelen : []).length;
    if (!archief) {
      meld("I12 archieflevering", `tegel ${t.id} verwijst naar een aparte levering, maar die is niet opgehaald`);
    } else if (t.artikelAantal !== geleverd) {
      meld(
        "I12 archieflevering",
        `tegel ${t.id}: kop belooft ${t.artikelAantal} artikelen, levering bevat er ${geleverd}`
      );
    }
    if (archief && archief.tegelId && archief.tegelId !== t.id) {
      meld("I12 archieflevering", `levering hoort bij tegel ${archief.tegelId}, niet bij ${t.id}`);
    }
  }
  // En andersom: een tegel met artikelenlijst hoort een kloppend artikelAantal
  // te hebben, want dat is wat de kop toont.
  for (const t of data.tegels || []) {
    if (t.artikelenApart || !Array.isArray(t.artikelen)) continue;
    if (typeof t.artikelAantal === "number" && t.artikelAantal !== t.artikelen.length) {
      meld(
        "I12 archieflevering",
        `tegel ${t.id}: artikelAantal ${t.artikelAantal} maar ${t.artikelen.length} artikelen meegestuurd`
      );
    }
  }

  // ---- I11. De compacte velden kloppen met de volledige bronnenlijst -------
  // bronAantal is het getal op de knop "Bronnen (n)" en bronMeta is de
  // onderregel; allebei afgeleid van de bronnen die in de tweede levering
  // staan. Lopen ze uiteen, dan liegt de dichte staat tegen de lezer.
  for (const { tegel, art, gekoppeld } of artikelen) {
    if (!gekoppeld) continue;
    const bronnen = art.bronnen || [];
    if (art.bronAantal !== bronnen.length) {
      meld(
        "I11 compacte-velden",
        `tegel ${tegel.id} · "${kort(art.titel)}" · bronAantal ${art.bronAantal} maar ${bronnen.length} bronnen`
      );
    }
    const eerste = bronnen[0] || null;
    const meta = art.bronMeta || null;
    if (Boolean(eerste) !== Boolean(meta)) {
      meld(
        "I11 compacte-velden",
        `tegel ${tegel.id} · "${kort(art.titel)}" · bronMeta ${meta ? "aanwezig" : "ontbreekt"} bij ${bronnen.length} bronnen`
      );
    } else if (eerste && meta && ((eerste.naam || null) !== meta.naam || (eerste.datum || null) !== meta.datum)) {
      meld(
        "I11 compacte-velden",
        `tegel ${tegel.id} · "${kort(art.titel)}" · bronMeta (${meta.naam} · ${meta.datum}) wijkt af van de eerste bron (${eerste.naam} · ${eerste.datum})`
      );
    }
  }

  // ---- I13. Redactionele verwijzingen naar Infofrankrijk -------------------
  // Deze verwijzingen worden met de hand gekozen en staan in een eigen blok
  // onder de bronnen. Vier dingen mogen niet stil misgaan:
  //   * een link naar een andere host dan infofrankrijk.com — precies de
  //     storing waar lib/bronurl.js voor is gebouwd, nu op een tweede plek;
  //   * een verwijzing die als BRON in de bronnenlijst belandt (dan claimt de
  //     pagina ons eigen artikel als attributie voor de synthese);
  //   * meer dan IF_VERWIJZING_MAX onder één bericht;
  //   * dezelfde verwijzing meer dan één keer binnen dezelfde tegel.
  const ifBron = bronVoorNaam("Infofrankrijk") || {};
  const verwijzingPerTegel = new Map();
  for (const { tegel, art } of artikelen) {
    const lijst = Array.isArray(art.verwijzingen) ? art.verwijzingen : [];
    if (!lijst.length) continue;
    if (lijst.length > IF_VERWIJZING_MAX) {
      meld(
        "I13 verwijzingen",
        `tegel ${tegel.id} · "${kort(art.titel)}" · ${lijst.length} verwijzingen, maximaal ${IF_VERWIJZING_MAX}`
      );
    }
    if (!verwijzingPerTegel.has(tegel.id)) verwijzingPerTegel.set(tegel.id, new Set());
    const gezien = verwijzingPerTegel.get(tegel.id);
    for (const v of lijst) {
      const oordeel = bronUrlOordeel(v && v.url, ifBron);
      if (!oordeel.ok) {
        meld("I13 verwijzingen", `tegel ${tegel.id} · "${kort(art.titel)}" · ${oordeel.reden}: ${v && v.url}`);
        continue;
      }
      if (!String((v && v.titel) || "").trim()) {
        meld("I13 verwijzingen", `tegel ${tegel.id} · verwijzing zonder titel: ${oordeel.url}`);
      }
      if (gezien.has(oordeel.url)) {
        meld("I13 verwijzingen", `tegel ${tegel.id} · dezelfde verwijzing twee keer: ${oordeel.url}`);
      }
      gezien.add(oordeel.url);
      if ((art.bronnen || []).some((b) => b && b.url === oordeel.url)) {
        meld(
          "I13 verwijzingen",
          `tegel ${tegel.id} · "${kort(art.titel)}" · de verwijzing staat óók in de bronnenlijst: ${oordeel.url}`
        );
      }
    }
  }

  // ---- I2. actueel.json is geldige JSON ------------------------------------
  try {
    const stat = await haalJson(STATISCH);
    if (!Array.isArray(stat.kaarten) || !stat.kaarten.length) {
      meld("I2 actueel.json", "geen (of lege) lijst 'kaarten'");
    }
  } catch (e) {
    meld("I2 actueel.json", `${STATISCH}: ${e.message}`);
  }

  // ---- I3. Elke bronlink hoort bij zijn bron -------------------------------
  // De storing die deze sonde bestaansrecht geeft. Toetst met exact dezelfde
  // regels als de productiecode (lib/bronurl.js).
  for (const { tegel, art } of artikelen) {
    for (const b of art.bronnen || []) {
      // Een onderdrukte link (url null + reden) is op zichzelf goed gedrag —
      // de server heeft hem al geweigerd. Maar hij is wél een bevinding: de
      // lezer verliest een bronlink, en de oorzaak is meestal dat een uitgever
      // onder een tweede domein publiceert dat nog niet in `linkDomeinen`
      // staat. Precies zo bleek Franceinfo zijn artikelen op franceinfo.fr te
      // zetten terwijl de feed op francetvinfo.fr staat. Stil laten passeren
      // is hoe de oorspronkelijke storing zo lang onzichtbaar bleef.
      if (!b.url) {
        meld(
          "I9 onderdrukte-bronlink",
          `tegel ${tegel.id} · "${kort(art.titel)}" · bron ${b.naam || "?"} · ${b.urlGeweigerd || "reden onbekend"}`
        );
        continue;
      }
      // Zelfde valkuil als in lib/tegels.js: bij een AGGREGAATFEED draagt het
      // item de naam van de vereniging, niet die van de geconfigureerde bron.
      // Opzoeken op naam levert dan niets op; het thema van de tegel wel.
      const bron = bronVoorNaam(b.naam) || bronVoorThema(tegel.thema) || {};
      const oordeel = bronUrlOordeel(b.url, bron);
      if (!oordeel.ok) {
        meld(
          "I3 bronlink-herkomst",
          `tegel ${tegel.id} · "${kort(art.titel)}" · bron ${b.naam || "?"} · ${b.url} · ${oordeel.reden}`
        );
      }
    }
    // Ook de artikel-URL zelf (die IF-Mobiel gebruikt) moet deugen.
    if (art.url && isAssetHost(hostVan(art.url))) {
      meld("I3 bronlink-herkomst", `tegel ${tegel.id} · "${kort(art.titel)}" · artikel-URL is asset-host: ${art.url}`);
    }
  }

  // ---- I4. Elk artikel heeft minstens één bron -----------------------------
  for (const { tegel, art } of artikelen) {
    if (!(art.bronnen || []).length) {
      meld("I4 bron-aanwezig", `tegel ${tegel.id} · "${kort(art.titel)}" heeft geen enkele bron`);
    }
  }

  // ---- I5. Geen twee LIVE artikelen met bijna gelijk verhaal ---------------
  // Gebruikt de BESTAANDE drempels: zelfdeVerhaal() met DEDUP_GEDEELD_MIN en
  // DEDUP_JACCARD_MIN uit lib/config.js — de drempel waarop de cron BESLIST,
  // niet de ruimere waarschuwingsdrempel van de reviewtool.
  //
  // Twee afbakeningen, allebei nodig om echte bevindingen over te houden:
  //   1. Alleen LIVE tegels. De archieftegel bevat per definitie de oudere
  //      versie van verhalen die live een vervolg kregen; die twee naast
  //      elkaar leggen levert structureel valse treffers op.
  //   2. Op kop + tekst, niet op de kale titel. zelfdeVerhaal() is gemaakt
  //      voor de kern van de VOLLEDIGE tekst; op losse titels betekent
  //      dezelfde drempel iets anders — en dan is het feitelijk een nieuwe
  //      drempel. Formuleachtige koppen ("Zeven departementen … oranje voor
  //      onweer" vs "Zestien departementen … oranje voor onweer") zijn dan
  //      bijna gelijk terwijl het twee verschillende waarschuwingen zijn.
  const kernen = artikelen
    .filter(({ tegel }) => tegel.soort !== "archief" && tegel.id !== "archief")
    .map(({ tegel, art }) => ({
      tegel, art, kern: kernUitTekst(`${art.titel || ""} ${art.tekst || art.summary || ""}`),
    }));
  for (let i = 0; i < kernen.length; i += 1) {
    for (let j = i + 1; j < kernen.length; j += 1) {
      if (zelfdeVerhaal(kernen[i].kern, kernen[j].kern)) {
        meld(
          "I5 geen-dubbele-titels",
          `"${kort(kernen[i].art.titel)}" (${kernen[i].tegel.id}) ≈ "${kort(kernen[j].art.titel)}" (${kernen[j].tegel.id})`
        );
      }
    }
  }

  // ---- I6. Datums binnen een plausibel venster -----------------------------
  for (const { tegel, art } of artikelen) {
    const kandidaten = [art.datum, ...(art.bronnen || []).map((b) => b && b.datum)].filter(Boolean);
    if (!kandidaten.length) continue; // datumloos is geen datumfout
    for (const d of kandidaten) {
      const t = Date.parse(d);
      if (Number.isNaN(t)) {
        meld("I6 datum-plausibel", `tegel ${tegel.id} · "${kort(art.titel)}" · onleesbare datum: ${d}`);
      } else if (t > nu + DAG) {
        meld("I6 datum-plausibel", `tegel ${tegel.id} · "${kort(art.titel)}" · datum in de toekomst: ${d}`);
      } else if (nu - t > MAX_LEEFTIJD_DAGEN * DAG) {
        meld(
          "I6 datum-plausibel",
          `tegel ${tegel.id} · "${kort(art.titel)}" · ouder dan ${MAX_LEEFTIJD_DAGEN} dagen: ${d}`
        );
      }
    }
  }

  // ---- I7. Elke bronnaam staat in bronnen.json en is actief ----------------
  // Storingshistorie: de bronnenlijst werd ooit ongefilterd gebruikt, waardoor
  // uitgezette bronnen alsnog op de pagina kwamen. Dit is de directe toets
  // daarop, op de uitvoer in plaats van op de code.
  const bekend = new Map(laadBronnen().map((b) => [b.naam, b]));
  const perItemBronnaam = new Set();
  for (const { art } of artikelen) {
    for (const b of art.bronnen || []) if (b && b.naam) perItemBronnaam.add(b.naam);
  }
  for (const naam of perItemBronnaam) {
    const bron = bekend.get(naam) || bronVoorNaam(naam);
    if (!bron) {
      // Verenigingsitems dragen de naam van de vereniging, niet van de feed.
      // Die zijn per definitie niet in bronnen.json terug te vinden en worden
      // hier dus overgeslagen; hun URL is al door I3 getoetst.
      continue;
    }
    if (bron.actief === false) {
      meld("I7 bron-actief", `bron "${naam}" staat op actief:false maar levert wel items`);
    }
  }

  // ---- I8. Stabiele, unieke identiteit per artikel -------------------------
  // Storingshistorie: dubbele overheidsberichten door een instabiele id. Twee
  // artikelen met dezelfde id in één antwoord is per definitie fout.
  const gezien = new Map();
  for (const { tegel, art } of artikelen) {
    const sleutel = `${tegel.id}/${art.id}`;
    if (!art.id) {
      meld("I8 identiteit", `tegel ${tegel.id} · "${kort(art.titel)}" heeft geen id`);
    } else if (gezien.has(sleutel)) {
      meld("I8 identiteit", `dubbele id ${sleutel} · "${kort(art.titel)}"`);
    } else {
      gezien.set(sleutel, true);
    }
  }

  toonInventaris(data, artikelen, teksten, archief);
  return klaar(nu);
}

// BEWUST NIET GETOETST.
//   - "Feed X levert 0 items": een bron kan legitiem een dag niets publiceren,
//     en een tijdelijke 403/timeout van een externe site is geen fout van deze
//     repo. Dagelijks rood op andermans uptime maakt de sonde waardeloos. De
//     bron-status staat wél in het antwoord en in de logs.
//   - "De synthesetekst klopt inhoudelijk": niet deterministisch te toetsen.
//     Daar is de reviewtool voor; een sonde die smaak toetst faalt willekeurig.
//   - "Aantal items daalde t.o.v. gisteren": zonder opgeslagen historie niet
//     betrouwbaar te meten, en nieuwsvolume schommelt legitiem.

function hostVan(u) {
  try { return new URL(u).hostname; } catch { return ""; }
}
function kort(s, n = 70) {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// Wat heeft de sonde gezien? Altijd een compacte inventaris, zodat een run
// achteraf te lezen is zonder hem opnieuw te draaien. Met SONDE_TOON_LINKS=1
// ook elke titel met de bron-URL erachter — voor als je één specifiek item wilt
// natrekken.
function toonInventaris(data, artikelen, teksten, archief) {
  console.log(`Tegels: ${(data.tegels || []).length}, artikelen: ${artikelen.length}`);
  const tekstAantal = teksten ? Object.keys(teksten.artikelen || {}).length : "(niet opgehaald)";
  const archiefAantal = archief ? (archief.artikelen || []).length : "(niet opgehaald)";
  console.log(
    `Tekst-levering: ${tekstAantal} record(s), archieflevering: ${archiefAantal} artikel(en), ` +
      `bronStatus: ${(data.bronStatus || []).length} bron(nen)`
  );
  // Handmatig gekozen Infofrankrijk-verwijzingen. Nul is een geldige uitkomst
  // (de redactie hoeft niets te kiezen), maar het getal hoort zichtbaar te zijn:
  // zakt het onverwacht naar nul, dan is er iets stuk in de keten.
  const verwijzingen = artikelen.reduce(
    (n, r) => n + (Array.isArray(r.art.verwijzingen) ? r.art.verwijzingen.length : 0),
    0
  );
  const metVerwijzing = artikelen.filter((r) => (r.art.verwijzingen || []).length).length;
  console.log(`Infofrankrijk-verwijzingen: ${verwijzingen} onder ${metVerwijzing} artikel(en)`);
  for (const t of data.tegels || []) {
    const n = t.artikelenApart
      ? `${typeof t.artikelAantal === "number" ? t.artikelAantal : "?"} (aparte levering)`
      : (t.artikelen || []).length;
    console.log(`  ${t.id} (${t.soort}): ${n} artikel(en)`);
  }
  if (process.env.SONDE_TOON_LINKS !== "1") return;
  // Optioneel filter op titel: bij ~150 artikelen is de volledige lijst
  // onleesbaar als je één item wilt natrekken.
  const filter = (process.env.SONDE_TOON_FILTER || "").trim().toLowerCase();
  const tonen = filter
    ? artikelen.filter(({ art }) => String(art.titel || "").toLowerCase().includes(filter))
    : artikelen;
  console.log(`\nTitel -> bron-URL${filter ? ` (filter: "${filter}", ${tonen.length} treffer(s))` : ""}:`);
  for (const { tegel, art } of tonen) {
    const urls = (art.bronnen || []).map((b) => b.url || `(geweigerd: ${b.urlGeweigerd || "?"})`);
    console.log(`  [${tegel.id}] ${art.titel}`);
    console.log(`      artikel-URL: ${art.url || "(geen)"}`);
    for (const u of urls) console.log(`      bron:        ${u}`);
  }
}

async function klaar(nu) {
  const groen = bevindingen.length === 0;
  const datum = new Date(nu).toISOString().slice(0, 10);
  const regels = bevindingen.map((b) => `${b.invariant}: ${b.detail}`);

  console.log(`Sonde ${datum} — doel ${API}`);
  console.log(groen ? "VERDICT: groen — alle invarianten gehaald." : `VERDICT: rood — ${bevindingen.length} bevinding(en):`);
  for (const r of regels) console.log(`  - ${r}`);

  await meldWebhook({ datum, verdict: groen ? "groen" : "rood", bevindingen: regels });
  process.exitCode = groen ? 0 : 1;
}

// Eén POST aan het eind. Ontbreekt de secret, dan stilzwijgend overslaan: de
// bewaking zelf moet ook zonder webhook werken. Een mislukte POST mag de sonde
// evenmin rood maken — het verdict staat al in de exitcode.
async function meldWebhook({ datum, verdict, bevindingen: regels }) {
  const url = process.env.SONDE_WEBHOOK_URL;
  if (!url) return;
  const body = {
    datum,
    verdict,
    aantal: regels.length,
    bevindingen: verdict === "rood" ? regels.join("\n") : "",
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    console.log(`Webhook: HTTP ${r.status}`);
  } catch (e) {
    console.log(`Webhook niet bereikt (${e.message}) — dit maakt de sonde niet rood.`);
  }
}

await main();
