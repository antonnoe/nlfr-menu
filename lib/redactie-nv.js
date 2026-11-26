// Koppeling /redactie -> Nieuwsvoorziening (nieuws.infofrankrijk.com/api/redactie).
// Besluit opdrachtgever 26-11-2026: de nieuwsmotor is Nieuwsvoorziening, de
// redactietool grijpt alleen in. Deze module bevat de pure delen (adres, sleutel,
// toegestane acties, foutmeldingen in gewone taal) zodat route en test dezelfde
// code gebruiken. De sleutel staat in de omgevingsvariabele NV_REDACTIE_SECRET
// (in Vercel, project nlfr-menu); hier staat alleen de NAAM.
export const NV_BASIS = "https://nieuws.infofrankrijk.com";
export const NV_PAD = "/api/redactie";
export const NV_SLEUTEL_NAAM = "NV_REDACTIE_SECRET";
export const NV_ACTIES = ["weg", "terug", "kanaal", "plaats", "herschrijf", "bewerk", "peil"];
// PEIL-keuzes (26-11-2026): de motor levert in de GET een veld `peil`; de keuze gaat als
// { actie: "peil", id, keuze } terug naar dezelfde koppeling.
export const NV_PEIL_KEUZES = ["vastgesteld", "verwacht", "raakt_niet", "lijst", "niet_nodig"];
export const NV_KANALEN = ["actueel", "nieuwsbrief", "infopoche", "zijbalk", "infofrankrijk"];

// Gewone taal bij elke storing. `soort` laat het scherm kiezen wat het toont.
export const MELDING = {
  geenSleutel: "De koppeling met de nieuwsmotor is nog niet ingesteld. Café Jeudi, PEIL en Bronnen werken gewoon.",
  onbereikbaar: "De nieuwsmotor is nu niet bereikbaar. Probeer het zo opnieuw. Café Jeudi, PEIL en Bronnen werken gewoon.",
  geweigerd: "De nieuwsmotor weigert de sleutel van deze tool. De sleutel moet gelijk zijn aan die van de nieuwsmotor.",
  dicht: "De nieuwsmotor staat op slot (hij heeft zelf nog geen sleutel).",
  teVaak: "De nieuwsmotor kreeg te veel verkeerde pogingen en wacht tien minuten. Probeer het later.",
};

export function sleutel(env = process.env) {
  const s = env[NV_SLEUTEL_NAAM];
  return typeof s === "string" && s.trim() ? s.trim() : "";
}

// Controleert een POST van het scherm voordat hij naar de motor gaat. De motor
// valideert zelf ook; dit houdt rommel buiten en geeft een nette fout.
export function leesOpdracht(body) {
  if (!body || typeof body !== "object") return { ok: false, fout: "Geen geldige opdracht." };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!NV_ACTIES.includes(body.actie)) return { ok: false, fout: "Onbekende actie." };
  // Een PEIL-punt heeft een eigen id-vorm (letters, cijfers, punt, streepje, underscore, dubbele punt).
  if (body.actie === "peil") {
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) return { ok: false, fout: "Ongeldig PEIL-punt." };
    if (!NV_PEIL_KEUZES.includes(body.keuze)) return { ok: false, fout: "Onbekende PEIL-keuze." };
    return { ok: true, opdracht: { id, actie: "peil", keuze: body.keuze } };
  }
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) return { ok: false, fout: "Ongeldig bericht." };
  const uit = { id, actie: body.actie };
  if (body.actie === "kanaal") {
    if (!NV_KANALEN.includes(body.kanaal) || typeof body.aan !== "boolean") return { ok: false, fout: "Kanaal of stand ontbreekt." };
    uit.kanaal = body.kanaal;
    uit.aan = body.aan;
  }
  if (body.actie === "bewerk") {
    for (const k of ["kop", "samenvatting", "tekst", "categorie"]) if (typeof body[k] === "string") uit[k] = body[k];
  }
  return { ok: true, opdracht: uit };
}

// Roept de motor aan. `haal` is te vervangen in tests. Geeft { status, body }.
export async function roepMotor({ methode, query, body, haal = globalThis.fetch, env = process.env }) {
  const sl = sleutel(env);
  if (!sl) return { status: 503, body: { ok: false, soort: "geen-sleutel", fout: MELDING.geenSleutel } };
  const url = NV_BASIS + NV_PAD + (query ? "?" + query : "");
  let r;
  try {
    r = await haal(url, {
      method: methode,
      headers: { Authorization: "Bearer " + sl, Accept: "application/json", ...(methode === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: methode === "POST" ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { status: 502, body: { ok: false, soort: "onbereikbaar", fout: MELDING.onbereikbaar } };
  }
  let d = null;
  try { d = await r.json(); } catch { d = null; }
  if (r.status === 401) return { status: 502, body: { ok: false, soort: "geweigerd", fout: MELDING.geweigerd } };
  if (r.status === 503 && d && /dicht/i.test(String(d.fout || ""))) return { status: 502, body: { ok: false, soort: "dicht", fout: MELDING.dicht } };
  if (r.status === 429) return { status: 502, body: { ok: false, soort: "te-vaak", fout: MELDING.teVaak } };
  if (!d || typeof d !== "object") return { status: 502, body: { ok: false, soort: "onbereikbaar", fout: MELDING.onbereikbaar } };
  if (!r.ok) return { status: r.status === 404 || r.status === 409 ? r.status : 502, body: { ok: false, soort: "motor", fout: String(d.fout || "De nieuwsmotor kon dit niet uitvoeren.").slice(0, 400) } };
  return { status: 200, body: { ok: true, ...d } };
}
