// Wat er op /login en /review te zien en te doen is, en wat de middleware doet.
// ---------------------------------------------------------------------------
// Deze toetsen lezen de uitgeleverde bestanden. Dat is grof, maar het is
// precies wat er op productie staat: dit project heeft geen buildstap, dus wat
// in de repo staat is wat de browser krijgt.
//
// WAT HIER NIET GETOETST KAN WORDEN: de WebAuthn-ceremonie zelf. Een
// vingerafdruk of gezichtsscan komt van de authenticator van het apparaat, en
// die is niet na te doen in Node en niet aan te sturen in een headless browser.
// Wat hier wél wordt vastgelegd, is dat de knoppen bestaan, de juiste
// Supabase-aanroep doen, en zich gedragen als de browser geen passkeys kan.
// De handmatige test staat in docs/login.md.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lees = (naam) => readFileSync(new URL(`../${naam}`, import.meta.url), "utf8");
const login = lees("login.html");
const review = lees("review.html");
const middleware = lees("middleware.js");
const inlogbron = lees("src/inlog.js");
const bundel = lees("assets/inlog.js");

// ---- /login -----------------------------------------------------------------

test("de loginpagina toont beide opties", () => {
  assert.match(login, /Inloggen met vingerafdruk/, "de passkey-knop");
  assert.match(login, /Stuur inloglink/, "de knop voor de magic link");
  assert.match(login, /<input[^>]*type="email"/, "en het veld waar het adres in gaat");
});

test("de passkey-knop roept signInWithPasskey aan, de mailknop de eigen route", () => {
  assert.match(login, /auth\.signInWithPasskey\(\)/);
  assert.match(login, /fetch\("\/api\/inloglink"/);
});

test("de passkey-knop blijft weg in een browser die geen passkeys kan", () => {
  // Een knop die bij indrukken altijd "ondersteunt geen passkeys" zegt, is een
  // knop te veel.
  assert.match(login, /NLFRAuth\.passkeysMogelijk\(\)/);
  assert.match(login, /<div class="vak" id="passkeyvak" hidden>/, "hij begint verborgen");
});

test("de loginpagina stuurt nooit door naar een adres buiten deze site", () => {
  // /login?terug=https://… mag geen keurig ogende link naar elders opleveren.
  assert.match(login, /\/\^\\\/\[\^\\\/\]\/\.test\(ruw\)|\/\^\\\/\[\^\\\/\]\//,
    "er hoort een controle op een enkel beginnend schuin streepje te staan");
  const fn = login.slice(login.indexOf("function bestemming()"), login.indexOf("// De reden waarmee"));
  assert.match(fn, /"\/review"/, "en een vaste terugval");
});

test("de loginpagina stuurt niet door als er een reden in de URL staat", () => {
  // Anders ontstaat er een lus: sessie geldig maar geen recht -> /review ->
  // middleware -> /login?reden=geenrecht -> /review -> …
  assert.match(login, /if \(new URLSearchParams\(location\.search\)\.get\("reden"\)\) return;/);
});

test("de korte foutmeldingen zijn Nederlands en kort", () => {
  for (const zin of ["Geannuleerd.", "Deze browser ondersteunt geen passkeys.", "De link is verlopen."]) {
    assert.ok(inlogbron.includes(zin), `ontbreekt: ${zin}`);
  }
  // En ze staan ook in de uitgeleverde bundel, niet alleen in de bron.
  assert.ok(bundel.includes("Deze browser ondersteunt geen passkeys."));
});

test("de loginpagina staat niet in zoekmachines", () => {
  assert.match(login, /<meta name="robots" content="noindex, nofollow">/);
});

// ---- /review ----------------------------------------------------------------

test("de reviewtool kent geen beheertoken meer", () => {
  const code = review.split("\n").filter((r) => !r.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /REVIEW_TOKEN/);
  assert.doesNotMatch(code, /X-Review-Token/i);
  assert.doesNotMatch(code, /nlfr_review_token/);
  assert.doesNotMatch(code, /tokenvak|tokenveld|tokenweg/);
});

test("de reviewtool draagt geen geheim in een verzoek-URL", () => {
  for (const m of review.matchAll(/fetch\(\s*([^)]{0,120})/g)) {
    assert.doesNotMatch(m[1], /token=/i, `een geheim in de URL: ${m[1]}`);
  }
});

test("de verzoeken sturen de sessiecookie mee, expliciet", () => {
  assert.match(review, /credentials: "same-origin"/);
});

test("een 401 stuurt door naar /login, op elk verzoek", () => {
  assert.match(review, /if \(r\.status === 401\)\{ naarLogin\(\); return/);
  // Eén keer, nooit twee keer: meerdere verzoeken tegelijk mogen geen tweede
  // navigatie starten.
  assert.match(review, /if \(wegGestuurd\) return;/);
});

test("het apparaatblok kent alle drie de handelingen", () => {
  assert.match(review, /auth\.registerPasskey\(\)/, "instellen");
  assert.match(review, /auth\.passkey\.list\(\)/, "tonen");
  assert.match(review, /auth\.passkey\.delete\(\{ passkeyId: id \}\)/, "verwijderen");
  assert.match(review, /auth\.signOut\(\)/, "uitloggen");
});

test("de lijst toont naam en datum van elk apparaat", () => {
  assert.match(review, /friendly_name/);
  assert.match(review, /created_at/);
});

test("verwijderen vraagt eerst om bevestiging", () => {
  const blok = review.slice(
    review.indexOf("passkeyLijstEl.addEventListener"),
    review.indexOf("uitlogKnopEl.addEventListener")
  );
  assert.match(blok, /window\.confirm\(/);
});

test("de reviewtool laadt de inlogbundel uit deze repo, niet van een CDN", () => {
  assert.match(review, /<script src="\/assets\/inlog\.js"><\/script>/);
  assert.match(login, /<script src="\/assets\/inlog\.js"><\/script>/);
  for (const pagina of [login, review]) {
    assert.doesNotMatch(pagina, /src="https?:\/\/[^"]*(esm\.sh|jsdelivr|unpkg|cdn)/i,
      "de deur van deze tool hoort niet aan een derde partij te hangen");
  }
});

// ---- middleware -------------------------------------------------------------

test("de middleware bewaakt beide paden waarop de pagina te bereiken is", () => {
  // /review via cleanUrls, én het bestand zelf. Wie er één noemt, laat de
  // andere openstaan.
  assert.match(middleware, /matcher: \["\/review", "\/review\.html"\]/);
});

test("de middleware stuurt naar /login en laat niets door zonder oordeel", () => {
  assert.match(middleware, /new URL\("\/login", url\)/);
  assert.match(middleware, /status: 302/);
  // Ontbrekende configuratie of een onbereikbare Supabase: deur dicht.
  assert.match(middleware, /if \(!compleet\) return naarLogin/);
  assert.match(middleware, /return naarLogin\(request\.url, "onbereikbaar"\)/);
});

test("de middleware stuurt alleen naar een pad binnen deze site", () => {
  const fn = middleware.slice(middleware.indexOf("function naarLogin"), middleware.indexOf("export default"));
  assert.match(fn, /doel\.searchParams\.set\("terug", "\/review"\)/,
    "alleen het pad, nooit een URL uit het verzoek");
});

test("de redirect naar de login wordt niet gecachet", () => {
  assert.match(middleware, /"Cache-Control": "no-store"/);
});

// ---- de bundel --------------------------------------------------------------

test("de bundel hoort bij de geïnstalleerde pakketten", async () => {
  // Wordt @supabase/* bijgewerkt zonder `npm run bouw:inlog`, dan draait de
  // browser op oude code terwijl package-lock.json iets anders belooft.
  const versies = JSON.parse(lees("assets/inlog.versies.json"));
  const eis = (await import("node:module")).createRequire(import.meta.url);
  assert.equal(versies.ssr, eis("@supabase/ssr/package.json").version, "draai `npm run bouw:inlog`");
  assert.equal(versies.supabaseJs, eis("@supabase/supabase-js/package.json").version, "draai `npm run bouw:inlog`");
});

test("de bundel heeft de passkey-opt-in aan boord", () => {
  // Zonder auth.experimental.passkey bestaan signInWithPasskey en
  // registerPasskey niet op de client.
  assert.match(inlogbron, /experimental: \{ passkey: true \}/);
  assert.ok(bundel.includes("passkey"), "de opt-in hoort ook in de uitgeleverde bundel te staan");
});

test("de bundel bewaart de sessie in cookies, niet in localStorage", () => {
  // Alleen dan ziet de server hem. Dat is het hele punt van createBrowserClient.
  assert.match(inlogbron, /createBrowserClient/);
  const code = inlogbron.split("\n").filter((r) => !r.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /localStorage|sessionStorage/);
});
