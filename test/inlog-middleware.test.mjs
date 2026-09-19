// De middleware, draaiend — niet gelezen maar aangeroepen.
// ---------------------------------------------------------------------------
// middleware.js is het enige stuk van de loginlaag dat op Vercel in de
// edge-runtime draait en niet in een serverless function. Die runtime is hier
// niet na te bootsen, maar de FUNCTIE wel: hij krijgt een standaard Request en
// geeft een standaard Response terug, en allebei bestaan in Node 22. Wat hier
// wordt getoetst is dus het echte gedrag van de deur, met dezelfde cookies en
// dezelfde (namaak-)Supabase als in test/inlog-poort.test.mjs.
//
// Wat hier NIET uit blijkt: of Vercel deze middleware daadwerkelijk aanroept op
// /review. Dat hangt aan de matcher en aan de platformconfiguratie, en dat is
// alleen op een echte deploy vast te stellen. Juist daarom zit de tweede
// controle in /api/review zelf.

import test from "node:test";
import assert from "node:assert/strict";

import { startNepSupabase, nepSessie, cookieKop } from "./fixtures/nep-supabase.mjs";

const REDACTIE = "redactie@voorbeeld.nl";
const VREEMDE = "iemand.anders@voorbeeld.nl";

const sessieRedactie = nepSessie(REDACTIE, { token: "token-redactie" });
const sessieVreemde = nepSessie(VREEMDE, { token: "token-vreemde" });

const { sluit } = await startNepSupabase({
  "token-redactie": sessieRedactie.user,
  "token-vreemde": sessieVreemde.user,
});
process.env.ALLOWED_LOGIN_EMAILS = REDACTIE;
test.after(sluit);

const { default: middleware, config } = await import("../middleware.js");

function verzoek(pad, cookie) {
  const kop = new Headers();
  if (cookie) kop.set("cookie", cookie);
  return new Request(`https://nlfr-menu.vercel.app${pad}`, { headers: kop });
}

test("zonder sessie: 302 naar /login", async () => {
  const uit = await middleware(verzoek("/review"));
  assert.ok(uit instanceof Response);
  assert.equal(uit.status, 302);
  const doel = new URL(uit.headers.get("location"));
  assert.equal(doel.pathname, "/login");
  assert.equal(doel.searchParams.get("terug"), "/review");
});

test("die redirect wordt niet gecachet en niet geïndexeerd", async () => {
  const uit = await middleware(verzoek("/review"));
  assert.match(uit.headers.get("cache-control"), /no-store/);
  assert.match(uit.headers.get("x-robots-tag"), /noindex/);
});

test("een sessie met een adres buiten de lijst komt er ook niet in", async () => {
  const uit = await middleware(verzoek("/review", cookieKop(sessieVreemde)));
  assert.equal(uit.status, 302);
  // Mét een reden, zodat /login kan uitleggen dat het aan het account ligt en
  // niet aan een ontbrekende sessie — anders blijft iemand eindeloos inloggen.
  assert.match(uit.headers.get("location"), /reden=geenrecht/);
});

test("een cookie met een token dat Supabase niet kent, helpt niet", async () => {
  const verzonnen = nepSessie(REDACTIE, { token: "zelf-verzonnen" });
  const uit = await middleware(verzoek("/review", cookieKop(verzonnen)));
  assert.equal(uit.status, 302);
});

test("een geldige sessie op de lijst laat het verzoek door", async () => {
  const uit = await middleware(verzoek("/review", cookieKop(sessieRedactie)));
  // undefined = doorlaten; er komt geen Response.
  assert.equal(uit, undefined);
});

test("ook /review.html wordt bewaakt, niet alleen /review", async () => {
  assert.deepEqual(config.matcher, ["/review", "/review.html"]);
  const uit = await middleware(verzoek("/review.html"));
  assert.equal(uit.status, 302);
});

test("zonder Supabase-configuratie gaat de deur DICHT, niet open", async () => {
  const bewaard = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  try {
    const uit = await middleware(verzoek("/review", cookieKop(sessieRedactie)));
    assert.equal(uit.status, 302);
    assert.match(uit.headers.get("location"), /reden=configuratie/);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = bewaard;
  }
});

test("is Supabase onbereikbaar, dan ook dicht", async () => {
  const bewaard = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Een poort waar niets luistert: getUser() gooit, en dat mag geen toegang geven.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
  try {
    const uit = await middleware(verzoek("/review", cookieKop(sessieRedactie)));
    assert.equal(uit.status, 302, "een storing mag de deur niet openzetten");
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = bewaard;
  }
});
