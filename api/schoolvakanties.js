// GET /api/schoolvakanties — eerstvolgende schoolvakantie per zone, live uit de
// open data van het Franse onderwijsministerie (geverifieerd werkende dataset).
// Bron: fr-en-calendrier-scolaire (Opendatasoft Explore v2.1).
// Vaste verwijzing naar de service-public-pagina staat in het antwoord.

const DATASET_URL =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records";
const SERVICE_PUBLIC =
  "https://www.service-public.gouv.fr/particuliers/vosdroits/F31952";

export default async function handler(req, res) {
  const nu = Date.now();
  let zones = [];
  let ok = false;

  try {
    const params = new URLSearchParams({
      where: "end_date >= now()",
      order_by: "start_date asc",
      limit: "80",
      select: "description,start_date,end_date,zones,population,annee_scolaire",
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
      zones = eersteVakantiePerZone(records, nu);
      ok = true;
    }
  } catch {
    ok = false;
  }

  const antwoord = {
    bijgewerkt: new Date(nu).toISOString(),
    ok,
    zones,
    servicePublic: SERVICE_PUBLIC,
  };

  const swr = "public, s-maxage=21600, stale-while-revalidate=86400"; // 6 u vers, 1 dag stale
  res.setHeader("Cache-Control", `public, max-age=3600, ${swr.replace("public, ", "")}`);
  res.setHeader("CDN-Cache-Control", swr);
  res.setHeader("Vercel-CDN-Cache-Control", swr);
  res.status(200).json(antwoord);
}

function eersteVakantiePerZone(records, nu) {
  const perZone = new Map();
  for (const r of records) {
    const zone = r.zones || r.zone;
    if (!zone) continue;
    // Alleen leerling-vakanties; docentendata ("Enseignants") overslaan.
    if (r.population && /enseignant/i.test(r.population) && !/élève|eleve/i.test(r.population)) {
      continue;
    }
    const start = r.start_date;
    const eind = r.end_date;
    if (!start || !eind) continue;
    if (Date.parse(eind) < nu) continue; // al voorbij

    // Records zijn op start_date oplopend; eerste per zone = eerstvolgende.
    if (!perZone.has(zone)) {
      perZone.set(zone, {
        zone,
        vakantie: r.description || "",
        start,
        eind,
        schooljaar: r.annee_scolaire || null,
      });
    }
  }
  // Vaste zone-volgorde voor nette weergave.
  const volgorde = ["Zone A", "Zone B", "Zone C", "Corse"];
  return [...perZone.values()].sort((a, b) => {
    const ia = volgorde.indexOf(a.zone);
    const ib = volgorde.indexOf(b.zone);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}
