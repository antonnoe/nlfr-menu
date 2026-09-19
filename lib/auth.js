// Gedeelde loginlaag: Supabase Auth voor /review.
// ---------------------------------------------------------------------------
// Deze module is de ENIGE plek waar wordt vastgesteld wie er binnen mag. Alles
// wat daarover een oordeel velt — de middleware, /api/review, /api/inloglink —
// haalt het hier op. Eén bron, zodat een wijziging in de regel niet op drie
// plekken half wordt doorgevoerd.
//
// TWEE EISEN, ALLEBEI NODIG (zie toegang()):
//   1. een geldige Supabase-sessie (de cookie is echt en niet verlopen), en
//   2. het e-mailadres van die sessie staat in ALLOWED_LOGIN_EMAILS.
//
// Waarom die tweede eis er is terwijl het Supabase-project van ons is: een
// Supabase-project kan méér gebruikers hebben dan deze tool toegang moet geven,
// en de projectinstellingen staan los van deze repo. De lijst in Vercel is de
// deur van dit gereedschap, en die deur hoort in de code te staan die hem
// bewaakt.
//
// De onderdelen die GEEN Node-API's gebruiken (de lijst, de omgeving, het
// oordeel) staan bewust bovenaan en zonder imports, zodat ook de edge-runtime
// van middleware.js ze kan gebruiken.

// ---- De naam van de sessiecookie -------------------------------------------
// VASTGEZET, en niet afgeleid van de project-URL. @supabase/ssr leidt de naam
// standaard af uit het eerste deel van de hostnaam ("sb-<ref>-auth-token").
// Dat werkt, maar het koppelt de naam van de cookie aan een URL die kan
// veranderen — en het maakt de naam onvoorspelbaar voor code die hem moet
// herkennen, zoals de tests. Eén vaste naam, op alle drie de plekken waar een
// client wordt gemaakt (browser, serverless function, middleware).
//
// LET OP BIJ WIJZIGEN: wie deze naam verandert, logt iedereen uit. De oude
// cookie blijft staan maar wordt niet meer gelezen.
export const COOKIE_NAAM = "nlfr-auth";

// ---- Omgeving ---------------------------------------------------------------
// De namen dragen het voorvoegsel NEXT_PUBLIC_ omdat ze in Vercel al zo heten.
// Dit project is geen Next.js — het voorvoegsel doet hier dus niets bijzonders
// en is puur een naam. De publishable key is ontworpen om publiek te zijn; hij
// staat in de browser en dat hoort zo. De secret key van Supabase komt in dit
// project niet voor en is er ook niet voor nodig.
export function supabaseOmgeving(env) {
  const bron = env || (typeof process !== "undefined" ? process.env : {}) || {};
  const url = String(bron.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(bron.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();
  return { url, key, compleet: Boolean(url && key) };
}

// ---- De lijst met toegestane adressen ---------------------------------------
// Kommagescheiden in Vercel. Witruimte eromheen wordt weggehaald en de
// vergelijking is hoofdletterongevoelig: een adres dat als "Anton@…" is
// ingetypt en als "anton@…" terugkomt uit Supabase is hetzelfde adres, en dat
// verschil hoort niemand buiten te sluiten.
export function toegestaneAdressen(env) {
  const bron = env || (typeof process !== "undefined" ? process.env : {}) || {};
  return String(bron.ALLOWED_LOGIN_EMAILS || "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
}

// LEEGE LIJST = NIEMAND. Bewust niet "iedereen": een env-var die per ongeluk
// niet is gezet, of een runtime waarin hij ontbreekt, mag de deur niet
// openzetten. Dan liever een tool die niemand binnenlaat en waarvan meteen
// duidelijk is dat er iets mis is.
export function adresToegestaan(adres, env) {
  const lijst = toegestaneAdressen(env);
  if (!lijst.length) return false;
  const a = String(adres || "").trim().toLowerCase();
  return Boolean(a) && lijst.includes(a);
}

// ---- Het oordeel ------------------------------------------------------------
// Krijgt de user zoals Supabase hem teruggeeft (of null) en geeft een uitspraak
// terug die elke aanroeper letterlijk kan gebruiken. De `reden` is voor de
// serverlogs, niet voor het scherm: hij mag geen aanwijzing geven of een adres
// wel of niet op de lijst staat.
export function toegang(user, env) {
  if (!user) return { ok: false, reden: "geen-sessie" };
  const adres = String(user.email || "").trim().toLowerCase();
  if (!adres) return { ok: false, reden: "sessie-zonder-adres" };
  if (!adresToegestaan(adres, env)) return { ok: false, reden: "adres-niet-toegestaan" };
  return { ok: true, adres };
}

// ---- Cookies ----------------------------------------------------------------
// @supabase/ssr levert de sessie aan als een lijst { name, value, options } en
// verwacht dezelfde vorm terug bij het lezen. De twee runtimes waarin dat hier
// moet gebeuren — een Node serverless function en de edge-middleware — hebben
// allebei een andere cookie-API, dus staan hier twee kleine vertalers in plaats
// van een extra afhankelijkheid.

// "a=1; b=2" -> [{ name:"a", value:"1" }, …]
export function leesCookieKop(kop) {
  const uit = [];
  for (const stuk of String(kop || "").split(";")) {
    const s = stuk.trim();
    if (!s) continue;
    const is = s.indexOf("=");
    if (is < 1) continue;
    const name = s.slice(0, is).trim();
    let value = s.slice(is + 1).trim();
    // Supabase schrijft base64url en heeft dus geen aanhalingstekens nodig,
    // maar een cookie MAG ze dragen (RFC 6265) en andere schrijvers doen dat.
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    try {
      uit.push({ name, value: decodeURIComponent(value) });
    } catch {
      uit.push({ name, value });
    }
  }
  return uit;
}

// { name, value, options } -> "naam=waarde; Path=/; …"
// De standaardopties staan hier, niet bij de aanroepers: een sessiecookie die
// per plek andere eigenschappen krijgt is een fout die je pas merkt wanneer een
// van de plekken de sessie niet meer ziet.
export function schrijfCookie(name, value, options) {
  const o = options || {};
  const delen = [`${name}=${encodeURIComponent(value == null ? "" : value)}`];
  delen.push(`Path=${o.path || "/"}`);
  // SameSite=Lax, niet Strict: de magic link komt uit een mailprogramma, dus de
  // eerste terugkomst op /auth/callback is een navigatie vanaf een ander domein.
  // Met Strict stuurt de browser de PKCE-cookie daarbij niet mee en mislukt de
  // uitwisseling met "code verifier ontbreekt".
  delen.push(`SameSite=${o.sameSite || "Lax"}`);
  // Alleen over HTTPS. Uitgezonderd localhost, waar geen HTTPS is en de cookie
  // anders nooit aankomt.
  if (o.secure !== false) delen.push("Secure");
  // BEWUST GEEN HttpOnly. De browser-client van Supabase leest en vernieuwt de
  // sessie zelf uit deze cookies; met HttpOnly kan hij dat niet en verloopt de
  // sessie stil. Dat is de afweging die @supabase/ssr ook maakt. De cookie is
  // daarmee leesbaar voor scripts op dit domein — de bescherming tegen misbruik
  // zit in het korte verloop van het access token en in de allowlist, niet in
  // het verbergen van de cookie.
  if (o.httpOnly) delen.push("HttpOnly");
  if (o.domain) delen.push(`Domain=${o.domain}`);
  if (typeof o.maxAge === "number") delen.push(`Max-Age=${Math.floor(o.maxAge)}`);
  if (o.expires instanceof Date) delen.push(`Expires=${o.expires.toUTCString()}`);
  return delen.join("; ");
}
