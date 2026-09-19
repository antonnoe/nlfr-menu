// Namaak-Supabase voor de tests van de loginlaag.
// ---------------------------------------------------------------------------
// De echte route doet wat hij in productie doet: hij maakt een Supabase-client,
// leest de sessiecookie en laat Supabase het access token controleren. Wat hier
// wordt nagedaan is alleen het ANDERE EIND van die lijn — een HTTP-server die
// zich als Supabase Auth gedraagt. Er wordt dus niets in de route zelf
// omzeild of vervangen; de cookie die deze fixture maakt, is de cookie die de
// browser ook zou sturen.
//
// Waarom dat zo moet: een toets die de toegangscontrole wegmockt, toetst de
// toegangscontrole niet. Juist bij een loginlaag is dat de hele oefening.

import http from "node:http";
import { COOKIE_NAAM } from "../../lib/auth.js";

// @supabase/ssr schrijft de sessie als "base64-" + base64url(JSON). Dezelfde
// vorm maken we hier, zodat de route hem leest zoals hij uit een browser komt.
function cookieWaarde(sessie) {
  const json = JSON.stringify(sessie);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  return `base64-${b64}`;
}

// Een sessie die er voor supabase-js geldig uitziet: niet verlopen, zodat hij
// niet eerst gaat verversen, en met een token dat onze namaakserver herkent.
//
// `verlopen: true` maakt het access token OUD terwijl het refresh token blijft
// staan. Dat is de stand waarin supabase-js eerst gaat verversen voordat hij
// iets anders doet, en precies de stand waarin de middleware de nieuwe cookies
// moet doorgeven. Zie test/inlog-middleware.test.mjs.
export function nepSessie(adres, { token = "nep-access-token", refresh = "nep-refresh-token", verlopen = false } = {}) {
  const nu = Math.floor(Date.now() / 1000);
  return {
    access_token: token,
    refresh_token: refresh,
    token_type: "bearer",
    expires_in: verlopen ? 0 : 3600,
    expires_at: verlopen ? nu - 60 : nu + 3600,
    user: { id: "00000000-0000-4000-8000-000000000001", email: adres, aud: "authenticated" },
  };
}

// De cookiekop zoals een browser hem stuurt.
export function cookieKop(sessie) {
  return `${COOKIE_NAAM}=${cookieWaarde(sessie)}`;
}

// Start de namaakserver en zet de omgevingsvariabelen die lib/auth.js leest.
// `gebruikers` koppelt een access token aan het profiel dat /auth/v1/user
// teruggeeft; een token dat er niet in staat krijgt 401, net als bij Supabase.
//
// `verversingen` koppelt een refresh token aan de sessie die
// /auth/v1/token?grant_type=refresh_token teruggeeft. Laat je dat leeg, dan
// gedraagt de server zich als Supabase met een ingetrokken refresh token.
export async function startNepSupabase(gebruikers = {}, verversingen = {}) {
  const server = http.createServer((req, res) => {
    const pad = (req.url || "").split("?")[0];
    res.setHeader("Content-Type", "application/json");

    if (pad === "/auth/v1/token") {
      let ruw = "";
      req.on("data", (b) => { ruw += b; });
      return req.on("end", () => {
        let body = {};
        try { body = JSON.parse(ruw || "{}"); } catch { /* onleesbaar = ongeldig */ }
        const nieuw = verversingen[body.refresh_token];
        if (!nieuw) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token" }));
        }
        res.statusCode = 200;
        res.end(JSON.stringify(nieuw));
      });
    }

    if (pad === "/auth/v1/user") {
      const auth = String(req.headers.authorization || "");
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      const user = gebruikers[token];
      if (!user) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ code: 401, msg: "invalid claim: missing sub claim" }));
      }
      res.statusCode = 200;
      return res.end(JSON.stringify(user));
    }

    // Een verversing wordt in deze toetsen niet uitgelokt (de sessies verlopen
    // pas over een uur), maar als hij toch komt hoort hij te falen en niet te
    // blijven hangen.
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "niet nagedaan in de test", pad }));
  });

  await new Promise((klaar) => server.listen(0, "127.0.0.1", klaar));
  const poort = server.address().port;
  const url = `http://127.0.0.1:${poort}`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "nep-publishable-key";

  return {
    url,
    sluit: () => new Promise((klaar) => server.close(klaar)),
  };
}

// Het korte pad voor een test die alleen "er zit iemand ingelogd" nodig heeft:
// zet de omgeving, de allowlist en de namaakserver in één keer, en geef de
// cookiekop terug die daarbij hoort.
export async function startNepSessie(adres = "redactie@voorbeeld.nl") {
  const sessie = nepSessie(adres);
  const { sluit } = await startNepSupabase({ [sessie.access_token]: sessie.user });
  process.env.ALLOWED_LOGIN_EMAILS = adres;
  return { adres, sessie, cookie: cookieKop(sessie), sluit };
}
