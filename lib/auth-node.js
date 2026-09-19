// De loginlaag voor de Node-kant: de serverless functions in api/*.js.
// ---------------------------------------------------------------------------
// Hier wordt het verzoek/antwoord-paar van Vercel (req/res, de vorm van Node)
// vertaald naar de cookie-API die @supabase/ssr verwacht. De middleware doet
// hetzelfde voor de edge-runtime (Request/Response); zie middleware.js.
//
// Waarom @supabase/ssr en niet de sessie zelf uitlezen: het access token
// verloopt (standaard na een uur) en moet met het refresh token worden
// vernieuwd, de cookie wordt boven een bepaalde lengte in stukken geknipt
// (…auth-token.0, .1), en de codering is base64url met een voorvoegsel. Dat is
// drie keer een detail dat stilletjes kan veranderen. De bibliotheek die de
// cookie schrijft, hoort hem ook te lezen.

import { createServerClient } from "@supabase/ssr";
import { supabaseOmgeving, toegang, leesCookieKop, schrijfCookie, COOKIE_NAAM } from "./auth.js";

// Set-Cookie AANVULLEN, niet overschrijven. Eén antwoord kan meerdere cookies
// zetten (een gesplitste sessie is er al twee) en res.setHeader vervangt de
// vorige waarde. Dit is precies het soort fout dat pas opvalt wanneer een lange
// sessie niet meer terugkomt.
function voegCookieToe(res, regel) {
  const bestaand = res.getHeader("Set-Cookie");
  const lijst = bestaand == null ? [] : Array.isArray(bestaand) ? bestaand.slice() : [String(bestaand)];
  lijst.push(regel);
  res.setHeader("Set-Cookie", lijst);
}

// Draait deze runtime op localhost? Dan mag de cookie niet Secure zijn, want
// daar is geen HTTPS en komt hij nooit aan. Op Vercel is alles HTTPS.
function onveiligeOmgeving(req) {
  const host = String((req && req.headers && req.headers.host) || "").toLowerCase();
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

// Een Supabase-client die zijn sessie uit de cookies van DIT verzoek haalt en
// nieuwe cookies op DIT antwoord zet.
export function maakServerClient(req, res) {
  const { url, key, compleet } = supabaseOmgeving();
  if (!compleet) return null;
  const secure = !onveiligeOmgeving(req);
  return createServerClient(url, key, {
    cookieOptions: { name: COOKIE_NAAM },
    cookies: {
      getAll() {
        return leesCookieKop(req && req.headers ? req.headers.cookie : "");
      },
      setAll(cookies) {
        // Bij een HEAD/GET die alleen leest gebeurt hier niets; @supabase/ssr
        // roept setAll alleen aan als er werkelijk iets te schrijven valt.
        for (const { name, value, options } of cookies) {
          voegCookieToe(res, schrijfCookie(name, value, { ...options, secure }));
        }
      },
    },
  });
}

// DE POORT. Geeft { ok:true, adres, user } of { ok:false, reden, status }.
//
// getUser() en niet getSession(): getSession leest alleen wat er in de cookie
// staat en gelooft dat op zijn woord. getUser() laat Supabase het token
// controleren. Een cookie is door de bezoeker te bewerken, dus alleen de
// tweede is een controle. Dat kost één netwerkaanroep per verzoek; voor een
// redactiegereedschap met één gebruiker is dat de juiste ruil.
export async function toegangVanVerzoek(req, res) {
  const client = maakServerClient(req, res);
  if (!client) {
    console.warn("[auth] NEXT_PUBLIC_SUPABASE_URL of NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ontbreekt in deze runtime");
    return { ok: false, reden: "supabase-niet-geconfigureerd", status: 503 };
  }
  let user = null;
  try {
    const { data, error } = await client.auth.getUser();
    if (error) {
      // Een verlopen of ontbrekende sessie is geen storing; die hoort bij het
      // normale verloop en wordt op niveau "info" gelogd noch geteld.
      return { ok: false, reden: "geen-sessie", status: 401 };
    }
    user = data && data.user;
  } catch (e) {
    console.warn(`[auth] sessiecontrole mislukt: ${e && e.message}`);
    return { ok: false, reden: "sessiecontrole-mislukt", status: 503 };
  }
  const oordeel = toegang(user);
  if (!oordeel.ok) {
    console.warn(`[auth] toegang geweigerd: ${oordeel.reden}`);
    return { ok: false, reden: oordeel.reden, status: 401 };
  }
  return { ok: true, adres: oordeel.adres, user };
}
