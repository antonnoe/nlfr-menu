// GET /auth/callback — hier komt de magic link terug.
// ---------------------------------------------------------------------------
// Bereikbaar op /auth/callback via een rewrite in vercel.json; het bestand zelf
// heet api/auth-callback.js omdat Vercel functions uit api/ haalt.
//
// De link uit de mail draagt een eenmalige `code`. Die wordt hier ingewisseld
// voor een sessie, en die sessie gaat als cookie op het antwoord mee. Daarna:
// door naar /review.
//
// WAAROM OP DE SERVER EN NIET IN DE BROWSER. De uitwisseling is PKCE: de code
// hoort bij een verifier die bij het AANVRAGEN van de link is aangemaakt. Die
// staat in een cookie die /api/inloglink heeft gezet. Alleen een server-client
// die diezelfde cookies leest, kan de uitwisseling afmaken.
//
// DE CODE GAAT NIET VERDER DAN DEZE FUNCTIE. Er wordt doorgestuurd met een
// SCHONE URL, zodat de eenmalige code niet in de browsergeschiedenis blijft
// staan en niet als Referer meelift.

import { maakServerClient } from "../lib/auth-node.js";
import { toegang } from "../lib/auth.js";

function stuurDoor(res, pad) {
  res.setHeader("Location", pad);
  res.setHeader("Cache-Control", "no-store");
  return res.status(302).end();
}

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const code = url.searchParams.get("code");
  const fout = url.searchParams.get("error_code") || url.searchParams.get("error");

  // Supabase stuurt een verlopen of al gebruikte link terug mét een reden. Die
  // vertalen we naar één van de korte meldingen die /login kent.
  if (fout) {
    const verlopen = /expired|otp_expired/i.test(fout);
    return stuurDoor(res, `/login?reden=${verlopen ? "verlopen" : "link"}`);
  }
  if (!code) return stuurDoor(res, "/login?reden=link");

  const client = maakServerClient(req, res);
  if (!client) return stuurDoor(res, "/login?reden=configuratie");

  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn(`[auth-callback] uitwisseling mislukt: ${error.message}`);
    // De meest voorkomende oorzaak is een link die al is gebruikt of verlopen,
    // of die in een ANDERE browser wordt geopend dan waar hij is aangevraagd —
    // dan staat de PKCE-cookie er niet.
    return stuurDoor(res, "/login?reden=verlopen");
  }

  // DE ALLOWLIST GELDT OOK HIER. Een adres kan van de lijst zijn gehaald tussen
  // het aanvragen en het aanklikken van de link. Dan hoort er geen sessie te
  // blijven staan.
  const oordeel = toegang(data && data.user);
  if (!oordeel.ok) {
    try {
      await client.auth.signOut();
    } catch {
      /* de cookies worden hoe dan ook niet gebruikt; doorsturen is wat telt */
    }
    return stuurDoor(res, "/login?reden=geenrecht");
  }

  return stuurDoor(res, "/review");
}
