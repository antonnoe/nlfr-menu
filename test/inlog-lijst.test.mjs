// De allowlist en de cookielaag — de twee stukken van lib/auth.js die zonder
// netwerk te toetsen zijn.
// ---------------------------------------------------------------------------
// Dit is de deur van dit gereedschap, en de regels eromheen zijn niet
// vanzelfsprekend. Vooral de eerste: een LEGE LIJST LAAT NIEMAND BINNEN. Dat is
// de tegenovergestelde keuze van wat een weggelaten filter normaal doet, en
// precies daarom hoort er een toets omheen.

import test from "node:test";
import assert from "node:assert/strict";

import {
  toegestaneAdressen,
  adresToegestaan,
  toegang,
  leesCookieKop,
  schrijfCookie,
  COOKIE_NAAM,
} from "../lib/auth.js";

const MET = (waarde) => ({ ALLOWED_LOGIN_EMAILS: waarde });

test("de lijst wordt op komma's gesplitst en van witruimte ontdaan", () => {
  assert.deepEqual(
    toegestaneAdressen(MET(" een@a.nl ,twee@b.nl,\n drie@c.nl ")),
    ["een@a.nl", "twee@b.nl", "drie@c.nl"]
  );
});

test("hoofdletters maken geen verschil", () => {
  assert.ok(adresToegestaan("Anton@Voorbeeld.NL", MET("anton@voorbeeld.nl")));
  assert.ok(adresToegestaan("anton@voorbeeld.nl", MET("Anton@Voorbeeld.NL")));
});

test("een LEGE lijst laat niemand binnen, niet iedereen", () => {
  // Een env-var die per ongeluk niet gezet is, mag de deur niet openzetten.
  for (const leeg of ["", "   ", ",,", undefined]) {
    assert.equal(adresToegestaan("anton@voorbeeld.nl", MET(leeg)), false, `leeg: ${JSON.stringify(leeg)}`);
  }
});

test("een adres dat er niet in staat, komt er niet in", () => {
  assert.equal(adresToegestaan("vreemde@elders.nl", MET("anton@voorbeeld.nl")), false);
});

test("een deelstring is geen adres", () => {
  // "ton@voorbeeld.nl" zit letterlijk in "anton@voorbeeld.nl". Een controle met
  // includes() op de hele string zou dat doorlaten.
  assert.equal(adresToegestaan("ton@voorbeeld.nl", MET("anton@voorbeeld.nl")), false);
});

test("toegang() weigert een sessie zonder gebruiker en zonder adres", () => {
  assert.equal(toegang(null, MET("a@b.nl")).ok, false);
  assert.equal(toegang({ id: "x" }, MET("a@b.nl")).ok, false);
  assert.equal(toegang({ id: "x", email: "" }, MET("a@b.nl")).ok, false);
});

test("toegang() geeft het genormaliseerde adres terug", () => {
  const uit = toegang({ id: "x", email: "  Anton@Voorbeeld.NL " }, MET("anton@voorbeeld.nl"));
  assert.equal(uit.ok, true);
  assert.equal(uit.adres, "anton@voorbeeld.nl");
});

// ---- De cookielaag ----------------------------------------------------------

test("de cookiekop wordt gesplitst op naam en waarde", () => {
  assert.deepEqual(leesCookieKop("a=1; b=twee;  c=drie"), [
    { name: "a", value: "1" },
    { name: "b", value: "twee" },
    { name: "c", value: "drie" },
  ]);
});

test("een waarde met een '=' erin blijft heel", () => {
  // base64 eindigt geregeld op '='. Splitsen op elke '=' zou de sessie slopen.
  const [eerste] = leesCookieKop("nlfr-auth=base64-abc==");
  assert.equal(eerste.value, "base64-abc==");
});

test("aanhalingstekens om een waarde worden weggehaald", () => {
  const [eerste] = leesCookieKop('nlfr-auth="waarde"');
  assert.equal(eerste.value, "waarde");
});

test("een lege of rommelige kop levert geen halve cookies op", () => {
  assert.deepEqual(leesCookieKop(""), []);
  assert.deepEqual(leesCookieKop(";;"), []);
  assert.deepEqual(leesCookieKop("=geenNaam"), []);
});

test("de sessiecookie is Secure, SameSite=Lax en geldt voor de hele site", () => {
  const regel = schrijfCookie(COOKIE_NAAM, "waarde", {});
  assert.match(regel, /Path=\//);
  assert.match(regel, /Secure/);
  // Lax en niet Strict: de magic link komt uit een mailprogramma, dus de
  // terugkomst op /auth/callback is een navigatie van buitenaf. Met Strict
  // stuurt de browser de PKCE-cookie niet mee en mislukt de uitwisseling.
  assert.match(regel, /SameSite=Lax/);
  assert.doesNotMatch(regel, /SameSite=Strict/);
});

test("op localhost blijft Secure weg, anders komt de cookie daar nooit aan", () => {
  assert.doesNotMatch(schrijfCookie("x", "y", { secure: false }), /Secure/);
});

test("de cookienaam staat vast en wordt niet uit de URL afgeleid", () => {
  assert.equal(COOKIE_NAAM, "nlfr-auth");
});
