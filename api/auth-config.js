// GET /api/auth-config — de twee publieke Supabase-waarden, voor de browser.
// ---------------------------------------------------------------------------
// WAAROM DEZE ROUTE BESTAAT. In een Next.js-project zet de buildstap een
// NEXT_PUBLIC_-variabele in de uitgeleverde code. Dit project heeft geen
// buildstap: /login en /review zijn statische .html-bestanden, en die kunnen
// process.env niet lezen. De browser moet de waarden dus ophalen.
//
// IS DAT VEILIG? Ja. De publishable key (voorheen "anon key") is ontworpen om
// in de browser te staan — hij staat in elke Supabase-webapp in de paginabron.
// Hij geeft niets meer dan wat het project publiek toestaat; de rechten van een
// bezoeker hangen aan zijn sessie, niet aan deze sleutel. De SECRET key van
// Supabase komt in dit project niet voor en is er ook niet voor nodig.
//
// Deze route is bewust publiek: hij moet werken vóórdat iemand is ingelogd.

import { supabaseOmgeving } from "../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // Kort cachen mag, maar niet op de randcache van Vercel: wisselt een sleutel,
  // dan wil je niet een kwartier wachten. Een paar seconden dekt de dubbele
  // aanroep van één paginabezoek af.
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, fout: "Alleen GET." });
  }

  const { url, key, compleet } = supabaseOmgeving();
  if (!compleet) {
    console.warn("[auth-config] NEXT_PUBLIC_SUPABASE_URL of NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ontbreekt");
    return res.status(503).json({ ok: false, fout: "Inloggen is op deze omgeving niet ingesteld." });
  }
  return res.status(200).json({ ok: true, url, key });
}
