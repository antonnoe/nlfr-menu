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

// Leest de sessie terug uit een Set-Cookie-regel, zoals @supabase/ssr hem
// schrijft: "naam=base64-<base64url van de JSON>; Path=/; …".
function leesSessieUitCookie(regel) {
  const waarde = regel.split(";")[0].split("=").slice(1).join("=");
  if (!waarde.startsWith("base64-")) return waarde;
  try {
    return Buffer.from(waarde.slice("base64-".length), "base64url").toString("utf8");
  } catch {
    return waarde;
  }
}

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
  // next() geeft een Response met x-middleware-next: 1 — "ga door naar het
  // statische bestand". Geen 302, geen eigen inhoud.
  assert.equal(uit.status, 200);
  assert.equal(uit.headers.get("x-middleware-next"), "1");
});

// ---- De ververste sessie ----------------------------------------------------
// DE FOUT DIE HIER ONDER LIGT (Codex op PR #51, zie docs/login.md §4.1).
// getUser() doet meer dan lezen: bij een verlopen access token ververst hij de
// sessie en roept setAll aan. Die setAll was leeg, dus de nieuwe cookies
// verdwenen terwijl de pagina doorging — en Supabase had het oude refresh token
// intussen wél verbruikt. De redacteur vloog er dan even later uit, midden in
// zijn werk, zonder dat ergens te zien was waaraan het lag.

test("een verlopen access token met geldig refresh token wordt ververst én doorgegeven", async () => {
  const verlopen = nepSessie(REDACTIE, { token: "oud-token", refresh: "refresh-oud", verlopen: true });
  const vers = nepSessie(REDACTIE, { token: "vers-token", refresh: "refresh-vers" });
  const { sluit: sluitVers } = await startNepSupabase(
    { "vers-token": vers.user },
    { "refresh-oud": vers }
  );
  try {
    const uit = await middleware(verzoek("/review", cookieKop(verlopen)));
    assert.equal(uit.status, 200, "de sessie is geldig, dus de pagina hoort door te gaan");
    assert.equal(uit.headers.get("x-middleware-next"), "1");

    const koekjes = uit.headers.getSetCookie();
    assert.ok(koekjes.length >= 1, "de ververste sessie hoort op het antwoord te staan");
    const inhoud = koekjes.map(leesSessieUitCookie).join(" ");
    assert.match(inhoud, /vers-token/, "de cookie hoort het NIEUWE access token te dragen");
    assert.doesNotMatch(inhoud, /oud-token/, "en niet het verbruikte oude");
  } finally {
    await sluitVers();
  }
});

test("ook op de weg naar /login gaan ververste cookies mee", async () => {
  // Zelfde verversing, maar het adres staat niet op de lijst. De bezoeker gaat
  // naar /login — en hoort daar niet aan te komen met een refresh token dat
  // Supabase al heeft ingewisseld.
  const verlopen = nepSessie(VREEMDE, { token: "oud-v", refresh: "refresh-v", verlopen: true });
  const vers = nepSessie(VREEMDE, { token: "vers-v", refresh: "refresh-v2" });
  const { sluit: sluitVers } = await startNepSupabase({ "vers-v": vers.user }, { "refresh-v": vers });
  try {
    const uit = await middleware(verzoek("/review", cookieKop(verlopen)));
    assert.equal(uit.status, 302);
    assert.match(uit.headers.get("location"), /reden=geenrecht/);
    assert.ok(uit.headers.getSetCookie().length >= 1, "de ververste cookie hoort ook hier mee te gaan");
  } finally {
    await sluitVers();
  }
});

test("de cookies die de middleware zet zijn Secure en gelden voor de hele site", async () => {
  const verlopen = nepSessie(REDACTIE, { token: "oud-s", refresh: "refresh-s", verlopen: true });
  const vers = nepSessie(REDACTIE, { token: "vers-s", refresh: "refresh-s2" });
  const { sluit: sluitVers } = await startNepSupabase({ "vers-s": vers.user }, { "refresh-s": vers });
  try {
    const uit = await middleware(verzoek("/review", cookieKop(verlopen)));
    for (const regel of uit.headers.getSetCookie()) {
      assert.match(regel, /Path=\//);
      assert.match(regel, /Secure/, "het verzoek kwam over https binnen");
      assert.match(regel, /SameSite=Lax/);
    }
  } finally {
    await sluitVers();
  }
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
