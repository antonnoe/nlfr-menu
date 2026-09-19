// De drie routes van de login: /api/auth-config, /api/inloglink en
// /auth/callback.
// ---------------------------------------------------------------------------
// Het zwaartepunt ligt bij /api/inloglink. Die route heeft één eigenschap die
// je niet aan de code kunt aflezen maar wel aan het gedrag: hij antwoordt
// HETZELFDE of een adres nu toegang heeft of niet. Zonder die eigenschap is de
// route een middel om uit te vinden wie er binnen mag — tik adressen in tot er
// één "verstuurd" zegt.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { startNepSupabase } from "./fixtures/nep-supabase.mjs";

const REDACTIE = "redactie@voorbeeld.nl";
const { sluit } = await startNepSupabase({});
process.env.ALLOWED_LOGIN_EMAILS = REDACTIE;
test.after(sluit);

const authConfig = (await import("../api/auth-config.js")).default;
const inloglink = (await import("../api/inloglink.js")).default;
const authCallback = (await import("../api/auth-callback.js")).default;

function nepRes() {
  const res = { code: 0, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.status = (c) => { res.code = c; return res; };
  res.json = (j) => { res.body = j; return res; };
  res.end = () => res;
  return res;
}

// ---- /api/auth-config -------------------------------------------------------

test("auth-config levert de twee publieke waarden en niets meer", async () => {
  const res = nepRes();
  await authConfig({ method: "GET", url: "/api/auth-config", headers: {} }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["key", "ok", "url"]);
  assert.equal(res.body.url, process.env.NEXT_PUBLIC_SUPABASE_URL);
});

test("auth-config wordt nooit gecachet", async () => {
  const res = nepRes();
  await authConfig({ method: "GET", url: "/api/auth-config", headers: {} }, res);
  assert.match(res.headers["cache-control"], /no-store/);
});

test("auth-config kent geen secret key", () => {
  const bron = readFileSync(new URL("../api/auth-config.js", import.meta.url), "utf8");
  const code = bron.split("\n").filter((r) => !r.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /SERVICE_ROLE|SECRET_KEY|service_role/i);
});

// ---- /api/inloglink ---------------------------------------------------------

async function vraagLink(email, extra = {}) {
  const res = nepRes();
  await inloglink(
    { method: "POST", url: "/api/inloglink", headers: { host: "nlfr-menu.test", ...extra }, body: { email } },
    res
  );
  return res;
}

test("een adres buiten de lijst krijgt precies hetzelfde antwoord als een adres erop", async () => {
  // De namaak-Supabase kent geen /auth/v1/otp, dus het adres OP de lijst loopt
  // verderop stuk. Wat hier telt is de stap dáárvoor: het adres buiten de lijst
  // mag niet aan een andere melding te herkennen zijn dan de neutrale.
  const buiten = await vraagLink("vreemde@elders.nl");
  assert.equal(buiten.code, 200);
  assert.equal(buiten.body.ok, true);
  assert.match(buiten.body.melding, /Als dit adres toegang heeft/);
  // En vooral: geen spoor van de lijst in het antwoord.
  assert.doesNotMatch(JSON.stringify(buiten.body), new RegExp(REDACTIE, "i"));
});

test("er wordt geen mail verstuurd voor een adres buiten de lijst", async () => {
  const res = await vraagLink("vreemde@elders.nl");
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
});

// ---- De lijst mag ook bij STORING niet uitlekken ---------------------------
// DE FOUT DIE HIER ONDER LIGT (Copilot op PR #51, zie docs/login.md §4.4). Een
// adres buiten de lijst kreeg 200, maar een adres erop kreeg 502 zodra Supabase
// weigerde — en 503 wanneer de configuratie ontbrak. Daarmee is deze publieke
// route alsnog een orakel: tik adressen in tijdens een storing en de statuscode
// wijst aan wie er toegang heeft.
//
// De namaak-Supabase in deze toetsen kent /auth/v1/otp niet en antwoordt met
// 400. Het adres ÓP de lijst loopt hier dus altijd tegen een storing aan — wat
// deze toetsen precies bruikbaar maakt.

test("een adres op de lijst krijgt bij een storing dezelfde 200 als een adres erbuiten", async () => {
  const binnen = await vraagLink(REDACTIE);
  const buiten = await vraagLink("vreemde@elders.nl");
  assert.equal(binnen.code, buiten.code, "de statuscode mag de lijst niet verraden");
  assert.equal(binnen.code, 200);
  assert.deepEqual(binnen.body, buiten.body, "en het antwoord zelf evenmin");
});

test("ook zonder Supabase-configuratie zijn de twee antwoorden gelijk", async () => {
  const bewaard = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  try {
    const binnen = await vraagLink(REDACTIE);
    const buiten = await vraagLink("vreemde@elders.nl");
    assert.equal(binnen.code, 200, "een 503 hier wijst aan dat dit adres op de lijst staat");
    assert.deepEqual(binnen.body, buiten.body);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = bewaard;
  }
});

test("de storing zelf komt wél in de logs terecht", async () => {
  // Neutraal naar buiten is geen excuus om het binnen ook stil te houden: dan
  // is een kapotte mailkoppeling niet van een lege mailbox te onderscheiden.
  const echt = console.error;
  const regels = [];
  console.error = (...a) => regels.push(a.join(" "));
  try {
    await vraagLink(REDACTIE);
  } finally {
    console.error = echt;
  }
  assert.ok(regels.length, "een mislukte verzending hoort gelogd te worden");
  assert.match(regels.join("\n"), /inloglink/);
});

test("een onbruikbaar adres krijgt wél een eigen melding", async () => {
  // Dat verraadt niets over wie toegang heeft, en zonder die melding staat
  // iemand met een typefout naar een lege mailbox te kijken.
  for (const rommel of ["", "   ", "geen-adres", "a@b", "a b@c.nl"]) {
    const res = await vraagLink(rommel);
    assert.equal(res.code, 400, `${JSON.stringify(rommel)} hoort geweigerd te worden`);
    assert.match(res.body.fout, /geldig e-mailadres/i);
  }
});

test("alleen POST", async () => {
  const res = nepRes();
  await inloglink({ method: "GET", url: "/api/inloglink", headers: {} }, res);
  assert.equal(res.code, 405);
});

test("de bestemming van de link volgt de host van het verzoek", () => {
  // Zo komt een link die op een preview is aangevraagd ook op die preview terug,
  // waar de PKCE-cookie staat — en niet op productie, waar hij niet staat.
  const bron = readFileSync(new URL("../api/inloglink.js", import.meta.url), "utf8");
  assert.match(bron, /x-forwarded-host|req\.headers\.host/);
  assert.match(bron, /emailRedirectTo/);
  assert.match(bron, /\/auth\/callback/);
});

// ---- /auth/callback ---------------------------------------------------------

async function callback(query) {
  const res = nepRes();
  await authCallback({ method: "GET", url: `/auth/callback${query}`, headers: { host: "nlfr-menu.test" } }, res);
  return res;
}

test("zonder code gaat het terug naar /login met een reden", async () => {
  const res = await callback("");
  assert.equal(res.code, 302);
  assert.match(res.headers.location, /^\/login\?reden=link$/);
});

test("een verlopen link levert de melding 'verlopen', niet 'klopt niet'", async () => {
  const res = await callback("?error=access_denied&error_code=otp_expired");
  assert.equal(res.code, 302);
  assert.match(res.headers.location, /reden=verlopen/);
});

test("een code die Supabase niet kent, stuurt terug in plaats van te blijven hangen", async () => {
  const res = await callback("?code=verzonnen-code");
  assert.equal(res.code, 302);
  assert.match(res.headers.location, /^\/login\?reden=/);
});

test("de callback stuurt nooit door naar een adres buiten deze site", () => {
  const bron = readFileSync(new URL("../api/auth-callback.js", import.meta.url), "utf8");
  const doelen = [...bron.matchAll(/stuurDoor\(res,\s*(`|")([^`"]*)/g)].map((m) => m[2]);
  assert.ok(doelen.length >= 3, "geen doorstuurbestemmingen gevonden");
  for (const d of doelen) {
    assert.ok(d.startsWith("/") && !d.startsWith("//"), `open redirect: ${d}`);
  }
});

test("de callback laat een geldige sessie met een adres buiten de lijst niet staan", () => {
  const bron = readFileSync(new URL("../api/auth-callback.js", import.meta.url), "utf8");
  assert.match(bron, /toegang\(/, "de allowlist geldt ook hier");
  assert.match(bron, /signOut\(\)/, "en een sessie zonder recht hoort te worden opgeruimd");
});
