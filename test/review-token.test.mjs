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

test("de Beheer-lade heeft een regel naar /review, in een nieuw tabblad", () => {
  const regel = menu.match(/\["Redactie[^\]]*"\/review"[^\]]*\]/);
  assert.ok(regel, "de regel Redactie — Actueel ontbreekt in ADMIN_LINKS");
  assert.ok(regel[0].includes('"_blank"'), "hij hoort in een nieuw tabblad te openen");
  assert.ok(menu.indexOf("ADMIN_LINKS") < menu.indexOf('"/review"'), "en in ADMIN_LINKS te staan");
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
    "fetch", "token",
    `${review.slice(begin, eind)}; return apiGet;`
  );
  let gezien = "";
  const apiGet = maakApiGet(
    (u) => { gezien = u; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
    "geheim"
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
