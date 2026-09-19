// POST /api/inloglink — stuurt de magic link, maar alleen naar een adres dat
// op de lijst staat.
// ---------------------------------------------------------------------------
// DE ALLOWLIST WORDT HIER GECONTROLEERD, OP DE SERVER, VÓÓR SUPABASE. Niet in
// de browser: wat daar wordt gecontroleerd kan worden overgeslagen. En niet pas
// bij /api/review: dan zou iedereen die het adres van de pagina kent een mail
// kunnen laten versturen naar een willekeurig adres, met onze afzender erop.
//
// HET ANTWOORD IS ALTIJD HETZELFDE, of het adres nu op de lijst staat of niet.
// Anders is deze route een middel om uit te vinden wie er toegang heeft: tik
// adressen in tot er één "verstuurd" zegt. Wie niet op de lijst staat krijgt
// dus dezelfde bevestiging — en geen mail.
//
// SHOULDCREATEUSER STAAT AAN. Supabase maakt bij de eerste inlog een gebruiker
// aan. Dat is hier gewenst: de allowlist in Vercel bepaalt wie er binnen mag,
// en zonder die eerste aanmaak zou er handwerk in het Supabase-dashboard nodig
// zijn voordat iemand kan inloggen. De lijst is de deur, niet het bestaan van
// het account.
//
// De PKCE-code-verifier die Supabase hierbij aanmaakt, wordt door
// @supabase/ssr als cookie op DIT antwoord gezet. /auth/callback leest hem
// weer. Daarom moet deze route de server-client gebruiken en niet de browser:
// beide kanten van de uitwisseling moeten dezelfde cookie zien.

import { maakServerClient } from "../lib/auth-node.js";
import { adresToegestaan } from "../lib/auth.js";

// Eén nette, neutrale zin. Staat hier één keer, zodat de twee uitgangen van de
// controle onmogelijk uit elkaar kunnen lopen in bewoording of leestekens —
// juist dat verschil zou de lijst verraden.
const NEUTRAAL = "Als dit adres toegang heeft, staat er nu een inloglink in de mailbox.";

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

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, fout: "Alleen POST." });
  }

  const body = await leesBody(req);
  const adres = String((body && body.email) || "").trim();

  // Vormcontrole vóór de lijst. Een lege of onzinnige invoer krijgt wél een
  // eigen melding: dat verraadt niets over wie toegang heeft, en zonder die
  // melding staat iemand met een typefout naar een lege mailbox te kijken.
  if (!adres || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(adres)) {
    return res.status(400).json({ ok: false, fout: "Vul een geldig e-mailadres in." });
  }

  if (!adresToegestaan(adres)) {
    console.warn("[inloglink] adres staat niet op ALLOWED_LOGIN_EMAILS — geen mail verstuurd");
    return res.status(200).json({ ok: true, melding: NEUTRAAL });
  }

  const client = maakServerClient(req, res);
  if (!client) {
    return res.status(503).json({ ok: false, fout: "Inloggen is op deze omgeving niet ingesteld." });
  }

  // De bestemming van de link is AFGELEID VAN DEZE OMGEVING, niet vastgezet op
  // productie. Zo komt een inloglink die op een preview-deploy is aangevraagd
  // ook op diezelfde preview terug, in plaats van op productie waar de PKCE-
  // cookie niet staat. Elke host die hier gebruikt wordt, moet wel in Supabase
  // als Redirect URL zijn toegestaan — zie docs/login.md.
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const terug = `${proto}://${host}/auth/callback`;

  const { error } = await client.auth.signInWithOtp({
    email: adres,
    options: { emailRedirectTo: terug, shouldCreateUser: true },
  });

  if (error) {
    // De reden gaat naar de logs, niet naar het scherm: hij kan verraden of het
    // account bestaat. Op het scherm blijft de neutrale zin staan, behalve bij
    // een duidelijke storing aan onze kant.
    console.warn(`[inloglink] signInWithOtp mislukt: ${error.message}`);
    return res.status(502).json({ ok: false, fout: "De inloglink kon niet worden verstuurd. Probeer het zo opnieuw." });
  }

  return res.status(200).json({ ok: true, melding: NEUTRAAL });
}
