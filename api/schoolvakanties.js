// GET /api/schoolvakanties — genereert een NL-lopende zin (geen tabel, geen
// AI) uit de open data van het Franse onderwijsministerie.
// Bron: fr-en-calendrier-scolaire (Opendatasoft Explore v2.1).
// Logica (template):
//  - Zit heel Frankrijk in de zomervakantie -> "Inmiddels zijn de
//    zomervakanties in heel Frankrijk begonnen. De scholen beginnen weer op X;
//    in <regio> al op Y." (afwijkende regio's als Mayotte apart benoemd)
//  - Zit een deel in vakantie -> die regio's + reprise benoemen.
//  - Tussen vakanties door -> de eerstvolgende vakantie per zone benoemen.
// ALLE datums worden in Europe/Paris geformatteerd, ongeacht de tijdzone van de
// server (zie fmtDag). En de vakantieNAAM komt altijd van hetzelfde record als
// de datums die eronder staan.

import { normaliseer } from "../lib/feeds.js";

const DATASET_URL =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records";
const SERVICE_PUBLIC =
  "https://www.service-public.gouv.fr/particuliers/vosdroits/F31952";

export default async function handler(req, res) {
  const nu = Date.now();
  let zin = "";
  let ok = false;

  try {
    const params = new URLSearchParams({
      where: "end_date >= now()",
      order_by: "start_date asc",
      limit: "100",
      select: "description,start_date,end_date,zones,location,population",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const reactie = await fetch(`${DATASET_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (reactie.ok) {
      const json = await reactie.json();
      const records = Array.isArray(json.results) ? json.results : [];
      zin = bouwSchoolvakantieZin(records, nu);
      ok = Boolean(zin);
    }
  } catch {
    ok = false;
  }

  const swr = "public, s-maxage=21600, stale-while-revalidate=86400";
  res.setHeader("Cache-Control", `public, max-age=3600, ${swr.replace("public, ", "")}`);
  res.setHeader("CDN-Cache-Control", swr);
  res.setHeader("Vercel-CDN-Cache-Control", swr);
  res.status(200).json({
    bijgewerkt: new Date(nu).toISOString(),
    ok,
    zin,
    servicePublic: SERVICE_PUBLIC,
  });
}

// De schoolkalender is een FRANSE kalender: elke datum hoort in Europe/Paris
// gelezen te worden. De dataset zet de dagen op 22:00Z — middernacht Parijse
// tijd — dus zonder expliciete tijdzone valt een datum op een runtime die op
// UTC staat (zoals Vercel) een dag te vroeg uit: "31 augustus" waar
// "1 september" hoort te staan. Dat stond zo live.
// De tijdzone staat hier HARD, niet via de omgevingsvariabele TZ: dan hangt de
// uitkomst niet af van hoe de server toevallig is ingesteld.
const TIJDZONE = "Europe/Paris";

function fmtDag(iso) {
  try {
    return new Date(iso).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      timeZone: TIJDZONE,
    });
  } catch {
    return iso;
  }
}
function isZomer(desc) {
  return /\bete\b|zomer|summer/.test(normaliseer(desc));
}
function isMetropoolZone(zones) {
  const z = String(zones || "").trim();
  return /^zone\s*[abc]$/i.test(z) || /corse/i.test(z);
}
function regioLabel(r) {
  const z = String(r.zones || "").trim();
  if (isMetropoolZone(z)) return z.replace(/\s+/g, " ");
  return String(r.location || z || "").trim();
}
function isLeerlingRecord(r) {
  // Docentendata overslaan als het expliciet zo staat.
  return !(r.population && /enseignant/i.test(r.population) && !/eleve|élève/i.test(r.population));
}

// Pure functie zodat hij los te testen is.
export function bouwSchoolvakantieZin(records, nu) {
  const recs = records.filter(isLeerlingRecord).filter((r) => r.start_date && r.end_date);
  const lopend = recs.filter((r) => Date.parse(r.start_date) <= nu && nu <= Date.parse(r.end_date));
  const komend = recs.filter((r) => Date.parse(r.start_date) > nu);

  // --- Geval 1: heel Frankrijk in de zomervakantie ---
  const zomerLopend = lopend.filter((r) => isZomer(r.description));
  const zomerMetropool = zomerLopend.filter((r) => isMetropoolZone(r.zones));
  if (zomerMetropool.length) {
    // Gangbare reprise-datum (meest voorkomende end_date onder de metropoolzones).
    const telling = new Map();
    for (const r of zomerMetropool) telling.set(r.end_date, (telling.get(r.end_date) || 0) + 1);
    const gangbaar = [...telling.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // Afwijkende regio's (o.a. overzee) met een andere reprise-datum.
    const afwijkend = new Map();
    for (const r of zomerLopend) {
      if (r.end_date === gangbaar) continue;
      const regio = regioLabel(r);
      if (!regio) continue;
      if (!afwijkend.has(regio)) afwijkend.set(regio, r.end_date);
    }

    let zin = `Inmiddels zijn de zomervakanties in heel Frankrijk begonnen. De scholen beginnen weer op ${fmtDag(gangbaar)}`;
    const stukjes = [...afwijkend.entries()].map(([regio, eind]) => {
      const eerder = Date.parse(eind) < Date.parse(gangbaar);
      return `in ${regio} ${eerder ? "al" : "pas"} op ${fmtDag(eind)}`;
    });
    if (stukjes.length) zin += `; ${stukjes.join(", ")}`;
    return `${zin}.`;
  }

  // --- Geval 2: een deel van de zones heeft nu vakantie (niet-zomer) ---
  // Naam, regio's en einddatum moeten bij ELKAAR horen. Daarom groeperen op
  // vakantienaam + einddatum, en de groep nemen waarvan de scholen het eerst
  // weer beginnen; de zin noemt dan precies de regio's waarvoor hij klopt.
  // (Vóór deze wijziging kwamen de regio's uit álle lopende records en kwamen
  // naam en datum uit het eerste record — dezelfde fout als in geval 3.)
  if (lopend.length) {
    const groepen = new Map();
    for (const r of lopend) {
      const regio = regioLabel(r);
      if (!regio) continue;
      const sleutel = `${r.description}|${r.end_date}`;
      if (!groepen.has(sleutel)) {
        groepen.set(sleutel, { desc: r.description, eind: r.end_date, regios: [] });
      }
      const g = groepen.get(sleutel);
      if (!g.regios.includes(regio)) g.regios.push(regio);
    }
    const gekozen = [...groepen.values()].sort(
      (a, b) => (Date.parse(a.eind) || 0) - (Date.parse(b.eind) || 0)
    )[0];
    if (gekozen) {
      const regioTekst =
        gekozen.regios.length > 2 ? "een deel van Frankrijk" : gekozen.regios.join(" en ");
      return `Op dit moment heeft ${regioTekst} vakantie (${gekozen.desc}); de scholen beginnen daar weer op ${fmtDag(gekozen.eind)}.`;
    }
  }

  // --- Geval 3: tussen vakanties door -> eerstvolgende per zone ---
  // De NAAM moet bij de DATUMS horen. Die kwam hier uit het eerste komende
  // record van de hele lijst — en dat kon een OVERZEESE vakantie zijn (de
  // septembervakantie van Polynésie, 12 september) terwijl de afgedrukte datums
  // die van la Toussaint waren (17 oktober voor zone A, B, C en Corse). De zin
  // noemde dan een vakantie die in die zones helemaal niet begint. Nu komt de
  // naam van hetzelfde record als de datums.
  if (komend.length) {
    const zones = ["Zone A", "Zone B", "Zone C", "Corse"];
    const opStart = (a, b) => (Date.parse(a.start_date) || 0) - (Date.parse(b.start_date) || 0);
    const metropool = komend.filter((r) => isMetropoolZone(r.zones)).sort(opStart);

    if (metropool.length) {
      // De eerstvolgende vakantie VOOR DE ZONES DIE WE NOEMEN.
      const desc = metropool[0].description;
      const perZone = new Map();
      for (const r of metropool) {
        const z = String(r.zones || "").trim();
        const label = zones.find((zz) => zz.toLowerCase() === z.toLowerCase()) || z;
        if (!perZone.has(label)) perZone.set(label, r);
      }
      // Alleen de zones waarvan de eerstvolgende vakantie ook echt die vakantie
      // is; anders zou de zin een zone onder een verkeerde naam scharen.
      const delen = zones
        .filter((z) => perZone.has(z) && perZone.get(z).description === desc)
        .map((z) => `${z} vanaf ${fmtDag(perZone.get(z).start_date)}`);
      if (delen.length) {
        return `De eerstvolgende schoolvakantie (${desc}) begint in ${delen.join(", ")}.`;
      }
    }

    // Geen enkele metropoolzone in zicht: dan wél de eerstvolgende uit de hele
    // lijst, maar met de datum van datzelfde record — naam en datum blijven zo
    // hoe dan ook bij elkaar horen.
    const eerste = [...komend].sort(opStart)[0];
    return `De eerstvolgende schoolvakantie is ${eerste.description}, vanaf ${fmtDag(eerste.start_date)}.`;
  }

  return "";
}
