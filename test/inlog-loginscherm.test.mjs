// Het gedrag van /login bij het openen van de pagina.
// ---------------------------------------------------------------------------
// Het script van login.html wordt hier uit de pagina gehaald en echt gedraaid,
// tegen een nagebootste DOM en een nagebootste Supabase-client. Dat is de enige
// manier om de LUS te toetsen die hieronder ligt: die ontstaat uit de
// samenwerking van twee beslissingen (hier en in de middleware) en is in geen
// van beide bestanden apart te zien.
//
// DE FOUT (Codex en Copilot op PR #51, zie docs/login.md §4.2). Deze pagina
// stuurde door naar /review zodra getSession() een sessie teruggaf. getSession()
// leest alleen de cookie en gelooft die op zijn woord. Bij een vervalste cookie,
// of een sessie waarvan de gebruiker is verwijderd, kwam de middleware met
// getUser() tot een ander oordeel en stuurde terug naar /login — zonder reden,
// dus langs de vangregel heen. Eindeloos heen en weer, alleen te doorbreken door
// de cookie met de hand te wissen.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const login = readFileSync(new URL("../login.html", import.meta.url), "utf8");
const script = login.slice(
  login.lastIndexOf("<script>") + "<script>".length,
  login.lastIndexOf("</script>")
);

const ORIGIN = "https://nlfr-menu.vercel.app";

function maakEl(naam) {
  const el = {
    naam,
    innerHTML: "",
    textContent: "",
    value: "",
    className: "",
    hidden: false,
    disabled: false,
    listeners: {},
    addEventListener: (soort, fn) => { (el.listeners[soort] = el.listeners[soort] || []).push(fn); },
    focus: () => { el.heeftFocus = true; },
    heeftFocus: false,
  };
  return el;
}

// `client` is de nagebootste Supabase-client; `zoek` de querystring.
function start({ zoek = "", client, passkeys = true } = {}) {
  const registry = new Map();
  const haal = (id) => {
    if (!registry.has(id)) registry.set(id, maakEl(id));
    return registry.get(id);
  };
  const document = { getElementById: haal, querySelector: () => null, querySelectorAll: () => [] };

  const navigaties = [];
  const location = {
    search: zoek,
    origin: ORIGIN,
    replace: (u) => navigaties.push(u),
  };

  const NLFRAuth = {
    passkeysMogelijk: () => passkeys,
    client: () => Promise.resolve(client),
    foutTekst: (e) => String((e && e.message) || e),
  };

  // eslint-disable-next-line no-new-func
  new Function("document", "location", "fetch", "window", "URL", "URLSearchParams", "NLFRAuth", script)(
    document,
    location,
    () => Promise.reject(new Error("niet gebruikt in deze toets")),
    { confirm: () => false },
    URL,
    URLSearchParams,
    NLFRAuth
  );

  return { haal, navigaties };
}

// De pagina werkt met beloftes; een paar microtaken volstaan om ze af te wikkelen.
async function wikkelAf() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

// ---- De lus ----------------------------------------------------------------

test("een cookie die de server afwijst geeft GEEN doorsturing — het inlogscherm blijft", async () => {
  const gedaan = [];
  const tool = start({
    client: {
      auth: {
        getUser: () => { gedaan.push("getUser"); return Promise.resolve({ data: { user: null }, error: { message: "invalid" } }); },
        getSession: () => { gedaan.push("getSession"); return Promise.resolve({ data: { session: { access_token: "vervalst" } } }); },
        signOut: (o) => { gedaan.push(`signOut:${o && o.scope}`); return Promise.resolve({ error: null }); },
      },
    },
  });
  await wikkelAf();

  assert.deepEqual(tool.navigaties, [], "er hoort niet doorgestuurd te worden — dit is de lus");
  assert.ok(gedaan.includes("getUser"), "de pagina hoort het aan de server te vragen");
  assert.ok(
    gedaan.some((g) => g.startsWith("signOut:local")),
    "en de waardeloze cookie hoort opgeruimd te worden, alleen op dit apparaat"
  );
});

test("de pagina vraagt het aan de server, niet aan de cookie", async () => {
  // getSession() alleen is niet genoeg: dat is precies de fout die de lus gaf.
  const volgorde = [];
  start({
    client: {
      auth: {
        getUser: () => { volgorde.push("getUser"); return Promise.resolve({ data: { user: null } }); },
        getSession: () => { volgorde.push("getSession"); return Promise.resolve({ data: { session: null } }); },
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  });
  await wikkelAf();
  assert.equal(volgorde[0], "getUser", "de servercontrole hoort als eerste te komen");
});

test("zonder cookie gebeurt er niets bijzonders: gewoon het inlogscherm", async () => {
  const gedaan = [];
  const tool = start({
    client: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: null } }),
        getSession: () => Promise.resolve({ data: { session: null } }),
        signOut: () => { gedaan.push("signOut"); return Promise.resolve({ error: null }); },
      },
    },
  });
  await wikkelAf();
  assert.deepEqual(tool.navigaties, []);
  assert.deepEqual(gedaan, [], "er valt niets op te ruimen, dus geen signOut");
});

// ---- Wat er wél moet gebeuren ----------------------------------------------

test("een sessie die de server goedkeurt stuurt door naar /review", async () => {
  const tool = start({
    client: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { email: "redactie@voorbeeld.nl" } } }),
        getSession: () => Promise.resolve({ data: { session: {} } }),
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  });
  await wikkelAf();
  assert.deepEqual(tool.navigaties, ["/review"]);
});

test("met een reden in de URL wordt er niet doorgestuurd, ook niet met een geldige sessie", async () => {
  // Dit is de TWEEDE lus: een account met een echte sessie maar zonder recht op
  // de redactie. Die sessie komt door getUser() heen, dus alleen de reden in de
  // URL houdt hem hier. Zonder deze regel knippert de melding voorbij en kom je
  // er nooit achter waarom je niet binnen komt.
  const gedaan = [];
  const tool = start({
    zoek: "?terug=/review&reden=geenrecht",
    client: {
      auth: {
        getUser: () => { gedaan.push("getUser"); return Promise.resolve({ data: { user: { email: "x@y.nl" } } }); },
        getSession: () => Promise.resolve({ data: { session: {} } }),
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  });
  await wikkelAf();
  assert.deepEqual(tool.navigaties, [], "anders ontstaat er een lus met de middleware");
  assert.deepEqual(gedaan, [], "er hoeft niet eens gevraagd te worden");
});

test("de reden komt op het scherm te staan", async () => {
  const tool = start({
    zoek: "?reden=verlopen",
    client: { auth: { getUser: () => Promise.resolve({ data: { user: null } }), getSession: () => Promise.resolve({ data: { session: null } }), signOut: () => Promise.resolve({}) } },
  });
  await wikkelAf();
  const melding = tool.haal("melding");
  assert.equal(melding.hidden, false);
  assert.match(melding.textContent, /verlopen|al gebruikt/i);
});

test("een storing bij het ophalen van de client laat het inlogscherm staan", async () => {
  // Geen configuratie, geen netwerk: dan hoort de pagina niet leeg te blijven en
  // niet door te sturen, maar gewoon bruikbaar te zijn voor de mailroute.
  const tool = start({
    client: {
      auth: {
        getUser: () => Promise.reject(new Error("onbereikbaar")),
        getSession: () => Promise.resolve({ data: { session: null } }),
        signOut: () => Promise.resolve({}),
      },
    },
  });
  await wikkelAf();
  assert.deepEqual(tool.navigaties, [], "een storing mag niet in een doorsturing eindigen");
  // Het mailformulier staat er nog: dat is de weg die dan overblijft.
  assert.ok(tool.haal("mailform").listeners.submit, "het inlogformulier hoort te werken");
});
