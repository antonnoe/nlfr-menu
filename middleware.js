// Vercel Routing Middleware — de deur vóór /review.
// ---------------------------------------------------------------------------
// Dit is GEEN Next.js-middleware. Vercel draait een middleware.js in de wortel
// van elk project, ook een project zonder framework zoals dit. Hij draait op de
// edge, vóór het statische bestand wordt uitgeleverd.
//
// WAT HIJ DOET, EN WAT NIET. Hij bewaakt de PAGINA: wie zonder geldige sessie
// /review opvraagt, wordt naar /login gestuurd in plaats van een lege schil te
// krijgen. Hij bewaakt de GEGEVENS niet — dat doet /api/review zelf, in dezelfde
// runtime als de gegevens. Twee redenen om dat daar te laten:
//
//   1. Een API die zijn eigen toegang controleert, blijft veilig ook als deze
//      middleware ooit niet draait (een configuratiefout, een rewrite die
//      ertussen komt). Een pagina die op de middleware vertrouwt lekt in dat
//      geval hoogstens een leeg scherm.
//   2. De controle in de route is te testen met de testsuite van dit project;
//      middleware is dat niet.
//
// De matcher hieronder noemt bewust ALLEBEI de paden waarop review.html te
// bereiken is: /review (via cleanUrls in vercel.json) en /review.html (het
// bestand zelf). Wie er maar één noemt, laat de andere openstaan.

import { next } from "@vercel/functions";
import { createServerClient } from "@supabase/ssr";
import { supabaseOmgeving, toegang, COOKIE_NAAM, schrijfCookie } from "./lib/auth.js";

export const config = {
  matcher: ["/review", "/review.html"],
};

function naarLogin(url, reden, cookies) {
  const doel = new URL("/login", url);
  // Waar de bezoeker heen wilde, zodat /login na het inloggen daarheen kan
  // terugsturen. Alleen het PAD, nooit een volledige URL uit het verzoek: een
  // open redirect is precies de fout die je met een loginpagina niet wilt maken.
  doel.searchParams.set("terug", "/review");
  if (reden) doel.searchParams.set("reden", reden);
  const kop = new Headers({
    Location: doel.toString(),
    // Een redirect naar de login mag nooit in een cache blijven hangen: dan
    // ziet een ingelogde bezoeker hem alsnog.
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  // OOK OP DE WEGSTUUR-ROUTE. Is de sessie onderweg ververst of juist gewist,
  // dan hoort de browser dat te weten. Laat je het hier achterwege, dan houdt
  // hij een refresh token dat Supabase al heeft verbruikt, en mislukt de
  // volgende inlogpoging zonder dat ergens staat waarom.
  for (const regel of cookies || []) kop.append("Set-Cookie", regel);
  return new Response(null, { status: 302, headers: kop });
}

export default async function middleware(request) {
  const { url, key, compleet } = supabaseOmgeving();
  // Ontbreekt de configuratie, dan is er geen manier om een sessie te
  // beoordelen. Dan gaat de deur DICHT, niet open.
  if (!compleet) return naarLogin(request.url, "configuratie");

  // DE MIDDLEWARE SCHRIJFT WEL DEGELIJK COOKIES, en dat is geen keuze maar een
  // eis. getUser() doet meer dan lezen: is het access token verlopen terwijl het
  // refresh token nog geldig is, dan VERVERST hij de sessie en roept setAll aan
  // met een nieuw stel cookies. Supabase roteert het refresh token daarbij — het
  // oude is verbruikt.
  //
  // Hier stond eerst een lege setAll. Gevolg: de middleware liet de bezoeker
  // door, maar de nieuwe cookies verdwenen. De browser hield een refresh token
  // dat al was ingewisseld, en zodra de hergebruiksmarge van Supabase voorbij
  // was, vloog de redacteur er midden in zijn werk uit — zonder dat ergens te
  // zien was waaraan het lag. Zie test/inlog-middleware.test.mjs.
  //
  // De cookies worden verzameld en op ELK antwoord gezet: op de doorlaat via
  // next() van @vercel/functions, en op de redirect naar /login via naarLogin().
  const verseCookies = [];
  // Alleen over HTTPS, behalve op localhost waar geen HTTPS is.
  const veilig = new URL(request.url).protocol === "https:";
  const client = createServerClient(url, key, {
    cookieOptions: { name: COOKIE_NAAM },
    cookies: {
      getAll() {
        const uit = [];
        const kop = request.headers.get("cookie") || "";
        for (const stuk of kop.split(";")) {
          const s = stuk.trim();
          const is = s.indexOf("=");
          if (is < 1) continue;
          try {
            uit.push({ name: s.slice(0, is).trim(), value: decodeURIComponent(s.slice(is + 1).trim()) });
          } catch {
            uit.push({ name: s.slice(0, is).trim(), value: s.slice(is + 1).trim() });
          }
        }
        return uit;
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          verseCookies.push(schrijfCookie(name, value, { ...options, secure: veilig }));
        }
      },
    },
  });

  let user = null;
  try {
    const { data, error } = await client.auth.getUser();
    if (!error) user = data && data.user;
  } catch {
    // Netwerkfout richting Supabase: geen oordeel mogelijk, dus geen toegang.
    return naarLogin(request.url, "onbereikbaar", verseCookies);
  }

  const oordeel = toegang(user);
  if (!oordeel.ok) {
    return naarLogin(request.url, oordeel.reden === "geen-sessie" ? "" : "geenrecht", verseCookies);
  }

  // Sessie in orde: het statische bestand mag worden uitgeleverd. next() zegt
  // "ga door" én draagt de antwoordkoppen mee naar de bezoeker — undefined
  // teruggeven zou dat laatste niet doen, en juist de ververste cookies moeten
  // mee.
  const kop = new Headers();
  for (const regel of verseCookies) kop.append("Set-Cookie", regel);
  return next({ headers: kop });
}
