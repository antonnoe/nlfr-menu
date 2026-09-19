// Bron van assets/inlog.js — de Supabase-client voor de browser.
// ---------------------------------------------------------------------------
// DIT BESTAND WORDT NIET RECHTSTREEKS UITGELEVERD. Het wordt gebundeld tot
// assets/inlog.js, en dát bestand staat in de repo:
//
//     npm run bouw:inlog
//
// WAAROM EEN GEBUNDELD BESTAND IN DE REPO. Dit project heeft geen buildstap:
// Vercel zet de repo neer zoals hij is. De pagina's zijn losse .html-bestanden
// en kunnen geen npm-pakket importeren. Er waren drie wegen:
//
//   1. Een <script> naar een CDN (esm.sh, jsdelivr). Dan hangt de deur van deze
//      tool aan een derde partij die wij niet beheren — inloggen kan niet meer
//      wanneer hun CDN eruit ligt. Afgewezen.
//   2. Een buildstap toevoegen aan Vercel. Dan verandert de manier waarop deze
//      site wordt uitgeleverd (build command, output directory), en dat raakt
//      elke pagina, niet alleen de login. Te veel risico voor te weinig winst.
//   3. Één keer bundelen, het resultaat meecommitten, en het commando
//      documenteren. Gekozen: de deploy blijft precies zo simpel als hij was,
//      er is geen partij bij betrokken die wij niet beheren, en de versie ligt
//      vast in package-lock.json.
//
// Na een `npm update` van @supabase/* hoort `npm run bouw:inlog` opnieuw te
// draaien, en ook na elke wijziging in dit bestand zelf of in lib/auth.js.
// test/inlog-schermen.test.mjs slaat alarm als dat is vergeten: het vergelijkt
// de hashes in assets/inlog.versies.json met de bronnen op schijf.

import { createBrowserClient } from "@supabase/ssr";
import { COOKIE_NAAM } from "../lib/auth.js";

// De configuratie komt van de server (zie api/auth-config.js), want een
// statisch bestand kan process.env niet lezen. Eén keer ophalen per pagina.
let configBelofte = null;
function haalConfig() {
  if (!configBelofte) {
    configBelofte = fetch("/api/auth-config", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((j) => {
        if (!j || !j.ok) throw new Error(j && j.fout ? j.fout : "Inloggen is niet ingesteld.");
        return j;
      })
      .catch((e) => {
        // Niet blijvend onthouden: een netwerkstoring bij het eerste bezoek mag
        // de pagina niet voor de rest van zijn leven kapot maken.
        configBelofte = null;
        throw e;
      });
  }
  return configBelofte;
}

let clientBelofte = null;

// De client. createBrowserClient (en niet createClient) omdat hij de sessie in
// COOKIES bewaart in plaats van in localStorage: alleen dan kan de server —
// middleware.js en /api/review — diezelfde sessie zien. Dat is het hele punt.
//
// auth.experimental.passkey is de opt-in die Supabase eist zolang passkeys
// experimenteel zijn; zonder die vlag bestaan signInWithPasskey,
// registerPasskey en auth.passkey niet op de client.
export function client() {
  if (!clientBelofte) {
    clientBelofte = haalConfig()
      .then((c) =>
        createBrowserClient(c.url, c.key, {
          // Dezelfde vaste cookienaam als de server gebruikt; zie lib/auth.js.
          cookieOptions: { name: COOKIE_NAAM },
          auth: { experimental: { passkey: true } },
        })
      )
      .catch((e) => {
        clientBelofte = null;
        throw e;
      });
  }
  return clientBelofte;
}

// Ondersteunt deze browser passkeys? Wordt gebruikt om de knop te verbergen in
// plaats van hem te laten mislukken. `PublicKeyCredential` bestaat alleen in
// een veilige context (HTTPS of localhost).
export function passkeysMogelijk() {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

// KORTE FOUTMELDINGEN. Wat Supabase en de browser teruggeven is Engels en
// technisch ("The operation either timed out or was not allowed"). Hier wordt
// dat één Nederlandse zin. Onbekende gevallen vallen terug op de oorspronkelijke
// tekst: liever een lelijke melding die klopt dan een nette die niets zegt.
export function foutTekst(e) {
  const ruw = String((e && (e.message || e.msg)) || e || "").trim();
  const code = String((e && (e.code || e.name)) || "");
  if (/NotAllowedError|AbortError|timed out|not allowed/i.test(code + " " + ruw)) {
    return "Geannuleerd.";
  }
  if (/NotSupportedError|SecurityError/i.test(code) || /not supported|unsupported/i.test(ruw)) {
    return "Deze browser ondersteunt geen passkeys.";
  }
  if (/passkey_disabled/i.test(code + ruw)) return "Passkeys staan uit in het project.";
  if (/webauthn_credential_exists/i.test(code + ruw)) return "Dit apparaat is hier al ingesteld.";
  if (/webauthn_challenge_expired|otp_expired|expired/i.test(code + ruw)) return "De link is verlopen.";
  if (/webauthn_credential_not_found/i.test(code + ruw)) return "Deze vingerafdruk is hier niet bekend.";
  if (/too_many_passkeys/i.test(code + ruw)) return "Het maximum aantal apparaten is bereikt.";
  if (/Failed to fetch|NetworkError|network/i.test(ruw)) return "Netwerkfout.";
  return ruw || "Er ging iets mis.";
}
