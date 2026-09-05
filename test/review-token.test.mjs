// Hoe /review aan zijn beheertoken komt — en waar hij níét mag staan.
// ---------------------------------------------------------------------------
// DE AANLEIDING. De reviewtool krijgt een regel in de Beheer-lade van het menu.
// Die menubron (index.html) is een STATISCH BESTAND dat iedereen kan opvragen:
// een token in die link zou daarmee publiek zijn. Dus draagt de link geen token
// en vraagt de pagina er zelf één keer om, net als /banner-beheer al doet.
//
// DRIE EISEN, en alle drie staan ze hier vast omdat je ze met het oog niet ziet:
//   1. geen token in de menubron;
//   2. een token uit ?token=… wordt bewaard én meteen uit de adresbalk gehaald,
//      want een URL komt in de browsergeschiedenis en in serverlogs terecht;
//   3. verzoeken dragen het token als header, niet in de querystring.
//
// WAT DIT NIET IS. localStorage beschermt niets tegen iemand die al toegang
// heeft tot de browser van de beheerder. De beveiliging is het token op de
// server (api/review.js vergelijkt met REVIEW_TOKEN); dit gaat er alleen over
// dat het token niet op plekken belandt waar het niet hoort.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");
const menu = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// ---- 1. De menuregel --------------------------------------------------------

// De echte ADMIN_LINKS-array uit index.html, uitgevoerd en niet als tekst
// bekeken. Een toets op tekenposities ("staat ADMIN_LINKS eerder in het bestand
// dan /review") bewijst niets: die naam staat ook in het commentaar erboven, dus
// zo'n assert slaagt om de verkeerde reden. Zelfde aanpak als menuData() in
// test/menu.test.mjs.
function adminLinks() {
  const begin = menu.indexOf("var ADMIN_LINKS =");
  const eind = menu.indexOf("var PERKS");
  assert.ok(begin > 0 && eind > begin, "ADMIN_LINKS niet gevonden in index.html");
  // eslint-disable-next-line no-new-func
  return new Function("U", `${menu.slice(begin, eind)}; return ADMIN_LINKS;`)(
    (pad) => `https://www.nederlanders.fr${pad}`
  );
}

test("de Beheer-lade heeft een regel naar /review, in een nieuw tabblad", () => {
  const regel = adminLinks().find((l) => l[1] === "/review");
  assert.ok(regel, `geen regel naar /review in ADMIN_LINKS: ${JSON.stringify(adminLinks())}`);
  assert.equal(regel[0], "Redactie — Actueel", "met dit label");
  assert.equal(regel[2], "_blank", "en in een nieuw tabblad");
});

test("de bestaande volgorde van de Beheer-lade blijft staan", () => {
  // test/menu.test.mjs pint vast dat de lade met Banner beheren begint. Die
  // afspraak omgooien voor een nieuwe regel is de moeite niet; hier staat dat
  // de nieuwe regel er echt achter is gezet en niet ervoor.
  const links = adminLinks();
  assert.equal(links[0][1], "/banner-beheer");
  assert.equal(links[1][1], "/review");
});

test("in de menubron staat nergens een token", () => {
  // Het hele bestand, niet alleen die ene regel: één geplakt token waar dan ook
  // maakt hem publiek. index.html wordt statisch geserveerd, dus wat hier staat
  // is wat iedereen kan opvragen.
  assert.ok(!/REVIEW_TOKEN/.test(menu), "REVIEW_TOKEN hoort hier niet te staan");
  assert.ok(!/BANNER_TOKEN/.test(menu), "en BANNER_TOKEN evenmin");
  assert.ok(!/[?&]token=/.test(menu), "geen enkele link mag een ?token= dragen");
});

// ---- 2. Het token in de browser --------------------------------------------

test("de pagina bewaart het token in deze browser, met een eigen sleutel", () => {
  assert.match(review, /var TOKENSLEUTEL = "nlfr_review_token";/);
  // Niet dezelfde sleutel als /banner-beheer: dat zijn twee tokens
  // (REVIEW_TOKEN en BANNER_TOKEN) en die horen elkaar niet te overschrijven.
  const banner = readFileSync(new URL("../banner-beheer.html", import.meta.url), "utf8");
  const bannerSleutel = banner.match(/const TOKENSLEUTEL = "([^"]+)"/)[1];
  assert.notEqual(bannerSleutel, "nlfr_review_token", "de twee tools delen hun sleutel niet");
});

test("een token uit de URL wordt bewaard en meteen uit de adresbalk gehaald", () => {
  assert.match(review, /params\.delete\("token"\)/, "het token gaat uit de querystring");
  assert.match(review, /history\.replaceState/, "en de adresbalk wordt bijgewerkt");
  assert.match(review, /bewaarToken\(uitUrl\)/, "maar niet vóór hij bewaard is");
});

test("alles rond localStorage staat in een try/catch", () => {
  // Een browser met site-data uit gooit bij localStorage een uitzondering. Die
  // mag de tool niet neerhalen; hij hoort dan gewoon om het token te vragen.
  const blok = review.slice(review.indexOf("var TOKENSLEUTEL"), review.indexOf("var params = new URLSearchParams"));
  const regels = blok.split("\n").filter((r) => /localStorage/.test(r));
  assert.ok(regels.length >= 2, "beide functies horen localStorage aan te raken");
  for (const r of regels) {
    assert.match(r, /try \{/, `localStorage zonder vangnet: ${r.trim()}`);
  }
});

// ---- 3. Waar het token wél en niet heen gaat --------------------------------

test("verzoeken dragen het token als header, niet in de querystring", () => {
  // Een querystring komt in de serverlogs van elke aanvraag terecht; een header
  // niet. api/review.js leest allebei, dus een oude bookmark blijft werken.
  assert.ok(
    !/\/api\/review\?token=/.test(review),
    "er hoort geen ?token= meer in een verzoek-URL te staan"
  );
  assert.match(review, /"X-Review-Token": token/, "het token gaat als header mee");
});

test("api/review.js accepteert die header ook echt", () => {
  const route = readFileSync(new URL("../api/review.js", import.meta.url), "utf8");
  assert.match(route, /req\.headers\["x-review-token"\]/);
});

test("de kandidatenlijst bouwt een geldige querystring zonder token", () => {
  // apiGet krijgt "&deel=if&artikel=…" mee — dat "&" moet een "?" worden nu het
  // token niet meer vooraan staat, anders vraagt de pagina "/api/review&deel=if"
  // op en krijgt de server nooit een deel-parameter te zien.
  const begin = review.indexOf("function apiGet(extra){");
  const eind = review.indexOf("function bronnenHtml(");
  assert.ok(begin > 0 && eind > begin, "apiGet niet gevonden");
  const maakApiGet = new Function(
    "fetch", "token", "verwerkAntwoord", "tokenGeneratie",
    `${review.slice(begin, eind)}; return apiGet;`
  );
  let gezien = "";
  const apiGet = maakApiGet(
    (u) => { gezien = u; return Promise.resolve({ ok: true, status: 200 }); },
    "geheim",
    (r) => Promise.resolve({ ok: r.ok, status: r.status, data: {} }),
    0
  );
  apiGet("&deel=if&artikel=o1");
  assert.equal(gezien, "/api/review?deel=if&artikel=o1");
});

// ---- 4. De zichtbaarheid van de Beheer-lade --------------------------------

test("het tandwiel is voor een gewone bezoeker onzichtbaar", () => {
  // Weergave, geen beveiliging — zie de test hieronder. Maar het hoort wel te
  // kloppen: de lade is niet bedoeld voor een gewone bezoeker.
  assert.match(menu, /\.sadmin \{[^}]*display: none/, "standaard verborgen");
  assert.match(menu, /\.sadmin\.show \{[^}]*display: inline-flex/, "en alleen zichtbaar met .show");
  assert.match(menu, /function syncAdmin\(\)\{ adminbtn\.classList\.toggle\("show", isAdmin\); \}/);
  assert.match(menu, /isAdmin = !!\(p && p\.id === ADMIN_ID\);/);
});

test("maar de regel is wél te vinden in de opgehaalde menubron", () => {
  // DIT IS GEEN BUG DIE HIER WORDT VASTGELEGD, MAAR EEN FEIT DAT NIEMAND MAG
  // VERGETEN. index.html wordt statisch geserveerd: ADMIN_LINKS staat er als
  // letterlijke tekst in en is voor iedereen leesbaar, ook zonder
  // beheerdersprofiel. Het tandwiel verbergt de lade voor het oog, niet voor
  // wie de bron opvraagt.
  //
  // Daarom mag er nooit een token in deze lijst staan, en is het token op
  // /review de enige echte grens. Wordt dat ooit anders opgevat, dan faalt deze
  // test met de reden erbij.
  assert.ok(menu.includes('"/review"'), "de regel staat gewoon in de bron");
  assert.ok(menu.includes('"/banner-beheer"'), "net als die van de bannerbeheerder");
  assert.ok(menu.includes("ADMIN_ID"), "en het beheerders-id ook");
  // De consequentie: geen geheim in dit bestand. Zie de tweede test hierboven.
});

// ---- De twee standen van het tokenvak, met de pagina echt gestart ----------
// De toetsen hierboven lezen de bron. Deze twee DRAAIEN het script, tegen een
// nagebootste DOM: alleen zo zie je of de weghaalknop na het inloggen ook
// werkelijk bereikbaar blijft, en of een 401 halverwege het tokenvak terugbrengt.
// Zelfde stub-aanpak als test/review-overheid-tab.test.mjs.

function maakDom(zonder = []) {
  const registry = new Map();
  const maakEl = (naam) => {
    const el = {
      naam, innerHTML: "", textContent: "", disabled: false, hidden: false,
      attrs: new Map(), listeners: {},
      getAttribute: (k) => (el.attrs.has(k) ? el.attrs.get(k) : null),
      setAttribute: (k, v) => el.attrs.set(k, String(v)),
      hasAttribute: (k) => el.attrs.has(k),
      removeAttribute: (k) => el.attrs.delete(k),
      addEventListener: (soort, fn) => { (el.listeners[soort] = el.listeners[soort] || []).push(fn); },
      querySelectorAll: () => [], querySelector: () => null, closest: () => null,
      focus: () => {}, value: "",
      klik: () => (el.listeners.click || []).forEach((fn) => fn()),
      toets: (key) => (el.listeners.keydown || []).forEach((fn) => fn({ key, preventDefault: () => {} })),
    };
    return el;
  };
  // `zonder` bootst een markup-wijziging na: een element dat er niet (meer) is.
  const haal = (id) => {
    if (zonder.indexOf(id) > -1) return null;
    if (!registry.has(id)) registry.set(id, maakEl(id));
    return registry.get(id);
  };
  // Het invoervak begint verborgen, de standregel ook — het script bepaalt welke.
  haal("tokenvak").setAttribute("hidden", "");
  haal("tokenstand").setAttribute("hidden", "");
  const tabs = [haal("tabRedactie"), haal("tabOverheid")];
  tabs[0].setAttribute("data-tab", "redactie");
  tabs[1].setAttribute("data-tab", "overheid");
  return {
    haal,
    document: {
      getElementById: haal,
      querySelector: (sel) => (sel === ".tabs" ? maakEl("tabs") : null),
      querySelectorAll: (sel) => (sel === ".tab[data-tab]" ? tabs : []),
    },
  };
}

async function start({ zoek = "", status = 200, body = { ok: true, concepten: [] }, zonder = [], hangend = false } = {}) {
  const { document, haal } = maakDom(zonder);
  const gezien = [];
  // Met `hangend` blijft elk verzoek open staan tot de test hem zelf afwikkelt.
  // Dat is de enige manier om een race na te spelen: het antwoord komt dan
  // aantoonbaar ná de handeling die ertussendoor plaatsvindt.
  const open = [];
  const fetchStub = (url, opties) => {
    gezien.push({ url: String(url), headers: (opties && opties.headers) || {} });
    const antwoord = { ok: status < 400, status, json: () => Promise.resolve(body) };
    if (!hangend) return Promise.resolve(antwoord);
    return new Promise((res) => open.push((over) => res({ ...antwoord, ...(over || {}) })));
  };
  const script = review.slice(
    review.lastIndexOf("<script>") + "<script>".length,
    review.lastIndexOf("</script>")
  );
  // eslint-disable-next-line no-new-func
  new Function("document", "location", "fetch", "window", "history", "localStorage", script)(
    document,
    { search: zoek, pathname: "/review", hash: "" },
    fetchStub,
    { confirm: () => false },
    { replaceState: () => {} },
    undefined // geen localStorage: elke aanroep hoort in een try/catch te zitten
  );
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  const leegLoop = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
  const wikkelAf = async (over) => { open.splice(0).forEach((fn) => fn(over)); await leegLoop(); };
  // Alleen het OUDSTE openstaande verzoek afwikkelen. Nodig om een laat antwoord
  // na te spelen zonder de verzoeken die daarna zijn vertrokken mee te nemen.
  const wikkelEerste = async (over) => { const fn = open.shift(); if (fn) fn(over); await leegLoop(); };
  return { haal, gezien, wikkelAf, wikkelEerste, verborgen: (id) => haal(id).hasAttribute("hidden") };
}

test("zonder token: het invoervak staat open en de standregel niet", async () => {
  const t = await start();
  assert.equal(t.verborgen("tokenvak"), false, "het invoervak hoort open te staan");
  assert.equal(t.verborgen("tokenstand"), true, "en de standregel niet");
  assert.equal(t.gezien.length, 0, "er wordt niets opgehaald zonder token");
});

test("mét token blijft de weghaalknop bereikbaar", async () => {
  // DE BEVINDING DIE DIT AFDEKT: de weghaalknop zat in het invoervak, en dat
  // verbergt zichzelf zodra je binnen bent. Op een gedeelde browser kon je je
  // toegang daarna niet meer opheffen.
  const t = await start({ zoek: "?token=geheim" });
  assert.equal(t.verborgen("tokenvak"), true, "het invoervak is weg zodra je binnen bent");
  assert.equal(t.verborgen("tokenstand"), false, "maar de standregel staat er, mét de weghaalknop");

  // En die knop doet ook echt iets: hij zet de pagina terug op vragen.
  t.haal("tokenweg").klik();
  assert.equal(t.verborgen("tokenvak"), false, "na weghalen wordt er opnieuw gevraagd");
  assert.equal(t.verborgen("tokenstand"), true);
});

test("een 401 op een willekeurig verzoek brengt het tokenvak terug", async () => {
  // DE TWEEDE BEVINDING: dit werd alleen bij het laden afgevangen. Wordt
  // REVIEW_TOKEN gewisseld terwijl de pagina openstaat, dan liep elke knop in
  // een foutmelding zonder plek om het nieuwe token in te vullen.
  const t = await start({ zoek: "?token=verlopen", status: 401, body: { ok: false, fout: "Ongeldig of ontbrekend token." } });
  assert.equal(t.verborgen("tokenvak"), false, "het invoervak hoort terug te komen");
  assert.equal(t.verborgen("tokenstand"), true, "en de standregel weg, want dit token is dood");
});

test("het token gaat als header mee, en niet in de URL", async () => {
  const t = await start({ zoek: "?token=geheim" });
  assert.ok(t.gezien.length > 0, "er is iets opgehaald");
  for (const v of t.gezien) {
    assert.ok(!/token=/.test(v.url), `token in de URL: ${v.url}`);
    assert.equal(v.headers["X-Review-Token"], "geheim");
  }
});

test("Enter in het tokenveld werkt ook zonder de knop ernaast", async () => {
  // Enter riep eerst tokenokEl.click() aan, zonder te kijken of die knop er is,
  // terwijl hij er twee regels eerder wél op werd gecontroleerd. Bij een
  // gewijzigde markup is dat een TypeError op de enige toets die een redacteur
  // op een telefoon gebruikt. Nu roepen knop en Enter dezelfde functie aan.
  const t = await start({ zonder: ["tokenok"] });
  const veld = t.haal("tokenveld");
  veld.value = "een-nieuw-token";
  assert.doesNotThrow(() => veld.toets("Enter"));
  // En hij doet ook echt wat de knop zou doen: het token is aangenomen.
  assert.equal(t.verborgen("tokenstand"), false, "de standregel hoort nu te staan");
  assert.equal(t.verborgen("tokenvak"), true, "en het invoervak weg");
});

// ---- De twee races -----------------------------------------------------------

test('"Token vergeten" tijdens een lopend verzoek vult het scherm niet alsnog', async () => {
  // P1 uit de review van #28. Het verzoek dat nog onderweg is draagt de OUDE,
  // geldige header. Zonder een generatieteller zou het antwoord daarna gewoon
  // render() aanroepen en de kaarten terugzetten — nadat de redacteur op een
  // geleende computer net zijn toegang had opgeheven. Dat is de knop precies
  // waardeloos maken.
  const t = await start({
    zoek: "?token=geheim",
    hangend: true,
    body: { ok: true, concepten: [{ id: "c1", kop: "Geheim concept", tekst: "Vertrouwelijk." }] },
  });
  assert.ok(t.gezien.length > 0, "het eerste verzoek is vertrokken");

  t.haal("tokenweg").klik();
  assert.equal(t.verborgen("tokenvak"), false, "het invoervak staat open");
  assert.equal(t.haal("inhoud").innerHTML, "", "en het scherm is leeg");

  // Nú pas komt het antwoord van vóór de klik binnen.
  await t.wikkelAf();
  assert.equal(t.haal("inhoud").innerHTML, "", `het scherm hoort leeg te blijven: ${t.haal("inhoud").innerHTML.slice(0, 120)}`);
  assert.equal(t.verborgen("tokenvak"), false, "en het invoervak open");
  // En de melding blijft staan waar de redacteur hem achterliet. Zonder de
  // vangregel in laad() zou het late antwoord hier "Toegang geweigerd" van
  // maken: een foutmelding voor een handeling die precies deed wat hij moest.
  // Zonder déze regel slaagt de test hierboven ook zonder die vangregel, want
  // het scherm wordt dan langs een andere weg leeggemaakt.
  assert.match(t.haal("melding").innerHTML, /Token vergeten/,
    `de melding is overschreven door een verouderd antwoord: ${t.haal("melding").innerHTML}`);
});

test("een late 401 wist een net ingevuld nieuw token niet", async () => {
  // P2 uit dezelfde review. Twee verzoeken met een verlopen token overlappen:
  // de eerste 401 opent het vak, de redacteur tikt een nieuw en geldig token in,
  // en dán komt de tweede 401 van het oude verzoek binnen. Zonder de teller
  // wist die het zojuist ingevulde token weer.
  const t = await start({ zoek: "?token=verlopen", hangend: true, status: 401, body: { ok: false, fout: "Ongeldig of ontbrekend token." } });

  const veld = t.haal("tokenveld");
  veld.value = "nieuw-en-geldig";
  t.haal("tokenok").klik();
  assert.equal(t.verborgen("tokenstand"), false, "het nieuwe token is aangenomen");

  // De late 401 van het verzoek met het OUDE token. Alleen dát verzoek; het
  // verzoek dat ná het nieuwe token vertrok blijft openstaan, net als in het echt.
  await t.wikkelEerste();
  assert.equal(t.verborgen("tokenstand"), false, "het nieuwe token hoort te blijven staan");
  assert.equal(t.verborgen("tokenvak"), true, "en er hoort niet opnieuw om gevraagd te worden");

  // En het nieuwe token gaat ook echt mee met het verzoek dat erna vertrok.
  const laatste = t.gezien[t.gezien.length - 1];
  assert.equal(laatste.headers["X-Review-Token"], "nieuw-en-geldig");
});
