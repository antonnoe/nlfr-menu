// De poort: wie komt er binnen, en wie niet.
// ---------------------------------------------------------------------------
// Dit is de belangrijkste toets van de loginlaag, en hij doet expres niets na.
// De route maakt een echte Supabase-client, leest een echte sessiecookie en
// laat het access token controleren; alleen de Supabase-server zelf is een
// namaakserver op localhost (test/fixtures/nep-supabase.mjs). Een toets die de
// toegangscontrole wegmockt, toetst de toegangscontrole niet.
//
// DRIE UITKOMSTEN, en ze zijn niet uitwisselbaar:
//   - geen cookie                          -> 401
//   - een cookie met een onbekend token    -> 401
//   - een geldige sessie, adres niet op de lijst -> 401
//   - een geldige sessie, adres wél op de lijst  -> door
//
// De vierde is de enige die binnenlaat, en de derde is waar deze laag zijn geld
// verdient: een geldig Supabase-account is niet hetzelfde als toegang tot dít
// gereedschap.

import test from "node:test";
import assert from "node:assert/strict";

import { startNepKv } from "./fixtures/nep-kv.mjs";
import { startNepSupabase, nepSessie, cookieKop } from "./fixtures/nep-supabase.mjs";

const { sluit: sluitKv } = await startNepKv();

const REDACTIE = "redactie@voorbeeld.nl";
const VREEMDE = "iemand.anders@voorbeeld.nl";

const sessieRedactie = nepSessie(REDACTIE, { token: "token-redactie" });
const sessieVreemde = nepSessie(VREEMDE, { token: "token-vreemde" });

const { sluit: sluitSb } = await startNepSupabase({
  "token-redactie": sessieRedactie.user,
  "token-vreemde": sessieVreemde.user,
});
process.env.ALLOWED_LOGIN_EMAILS = REDACTIE;

test.after(sluitKv);
test.after(sluitSb);

const review = (await import("../api/review.js")).default;

async function roep({ cookie, method = "GET", url = "/api/review" } = {}) {
  const res = { code: 0, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.status = (c) => { res.code = c; return res; };
  res.json = (j) => { res.body = j; return res; };
  res.end = () => res;
  const headers = { host: "nlfr-menu.test" };
  if (cookie) headers.cookie = cookie;
  await review({ method, url, headers }, res);
  return res;
}

test("zonder sessie kom je er niet in", async () => {
  const res = await roep();
  assert.equal(res.code, 401);
  assert.match(res.body.fout, /niet ingelogd|geen toegang/i);
});

test("een sessiecookie met een onbekend token laat je er niet in", async () => {
  const verzonnen = nepSessie(REDACTIE, { token: "dit-token-bestaat-niet" });
  const res = await roep({ cookie: cookieKop(verzonnen) });
  assert.equal(res.code, 401, "de server controleert het token, hij gelooft de cookie niet op zijn woord");
});

test("een geldige sessie met een adres buiten de lijst komt er niet in", async () => {
  const res = await roep({ cookie: cookieKop(sessieVreemde) });
  assert.equal(res.code, 401, "een Supabase-account is geen toegang tot dit gereedschap");
});

test("een geldige sessie met een adres op de lijst komt er wél in", async () => {
  const res = await roep({ cookie: cookieKop(sessieRedactie) });
  assert.notEqual(res.code, 401, JSON.stringify(res.body));
});

test("de melding bij een 401 verraadt niet welke van de twee eisen faalde", async () => {
  const zonder = await roep();
  const buiten = await roep({ cookie: cookieKop(sessieVreemde) });
  assert.equal(
    zonder.body.fout,
    buiten.body.fout,
    "anders is deze route een middel om uit te vinden wie er toegang heeft"
  );
});

test("de route leest geen token uit de querystring of een header", async () => {
  const bron = (await import("node:fs")).readFileSync(new URL("../api/review.js", import.meta.url), "utf8");
  const code = bron.split("\n").filter((r) => !r.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /x-review-token/i, "de headerroute hoort weg te zijn");
  assert.doesNotMatch(code, /REVIEW_TOKEN/, "en de env-var ook");
  assert.doesNotMatch(code, /\btoken\b/i, "er hoort geen tokenbegrip meer in deze route te zitten");
});

test("een sessie die alleen in de cookie geldig lijkt, helpt niet", async () => {
  // Een cookie is door de bezoeker te bewerken. Hier staat een sessie in die er
  // van buiten perfect uitziet — niet verlopen, met een e-mailadres dat op de
  // lijst staat — maar met een token dat Supabase niet kent. getUser() vangt dat;
  // getSession() zou het geloofd hebben. Dat verschil is de hele reden dat
  // lib/auth-node.js getUser gebruikt.
  const vervalst = nepSessie(REDACTIE, { token: "zelf-verzonnen" });
  vervalst.user.email = REDACTIE;
  const res = await roep({ cookie: cookieKop(vervalst) });
  assert.equal(res.code, 401);
});
