// De versiestempel in de reviewtool.
//
// AANLEIDING. "Ik zie geen verschil met de oude curator — zit ik wel op de
// goede URL?" Dat is een vraag die niemand zou moeten hoeven stellen, en die
// zonder stempel ook niet te beantwoorden is: twee versies van deze tool zien
// er van een afstand hetzelfde uit, en een browser die een oude pagina uit zijn
// cache haalt zegt dat er niet bij.
//
// De stempel bestaat daarom uit twee soorten waarheid naast elkaar:
//   * versie en datum — handwerk in lib/config.js, horen bij een verandering
//     die de redactie merkt;
//   * de commit-hash — komt uit de omgeving van Vercel en is niet met de hand
//     te zetten. Lopen die twee uiteen, dan is de stempel vergeten en zie je
//     dat meteen.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { APP_VERSIE, APP_VERSIE_DATUM } from "../lib/config.js";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");
const routeBron = readFileSync(new URL("../api/review.js", import.meta.url), "utf8");

// De twee functies uit review.html zelf halen, niet nabouwen: een kopie in een
// test bewijst alleen dat de kopie werkt.
function haalFuncties() {
  const van = review.indexOf("function toonStempel(v){");
  const tot = review.indexOf("function ifBlokHtml(id){");
  assert.ok(van > 0 && tot > van, "toonStempel/datumKort niet gevonden in review.html");
  const code = review.slice(van, tot);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return new Function("document", "esc", code + "; return { toonStempel, datumKort };")(nepDocument(), esc);
}

let laatsteEl;
function nepDocument() {
  laatsteEl = { textContent: "", innerHTML: "" };
  return { getElementById: (id) => (id === "stempel" ? laatsteEl : null) };
}

test("de stempel toont versie, datum en commit", () => {
  const { toonStempel } = haalFuncties();
  toonStempel({ versie: "2.1", datum: "2026-08-30", commit: "07068ce", omgeving: "production" });
  assert.match(laatsteEl.innerHTML, /versie 2\.1/);
  assert.match(laatsteEl.innerHTML, /30 augustus 2026/);
  assert.match(laatsteEl.innerHTML, /commit <code>07068ce<\/code>/);
  // "production" is de normale toestand en hoort geen ruis te maken.
  assert.ok(!/production/.test(laatsteEl.innerHTML));
});

test("een voorvertoning wordt als zodanig benoemd", () => {
  const { toonStempel } = haalFuncties();
  toonStempel({ versie: "2.1", datum: "2026-08-30", commit: "abc1234", omgeving: "preview" });
  assert.match(laatsteEl.innerHTML, /preview/);
});

// Draait dit buiten Vercel, dan is er geen hash. Dan zegt de stempel dat, in
// plaats van een leeg veld of — erger — een verzonnen waarde.
test("zonder commit-hash zegt de stempel dat hij buiten Vercel draait", () => {
  const { toonStempel } = haalFuncties();
  toonStempel({ versie: "2.1", datum: "2026-08-30", commit: null, omgeving: null });
  assert.match(laatsteEl.innerHTML, /buiten Vercel/);
  assert.ok(!/commit/.test(laatsteEl.innerHTML));
});

test("de datum wordt in Europe/Paris gelezen, niet in de tijdzone van de server", () => {
  const { datumKort } = haalFuncties();
  // Dezelfde valkuil als bij de schoolvakanties: een kale datum zonder tijd
  // schuift een dag op als de runtime op UTC staat en de lezer in Parijs zit.
  assert.equal(datumKort("2026-01-01"), "1 januari 2026");
  assert.equal(datumKort("2026-12-31"), "31 december 2026");
});

test("de route levert de stempel mee, uit de omgeving en niet met de hand", () => {
  assert.match(routeBron, /versie: versieStempel\(\)/);
  assert.match(routeBron, /process\.env\.VERCEL_GIT_COMMIT_SHA/);
  assert.match(routeBron, /process\.env\.VERCEL_ENV/);
});

test("versie en datum zijn bruikbaar ingevuld", () => {
  assert.match(APP_VERSIE, /^\d+\.\d+$/, "versie hoort de vorm 2.1 te hebben");
  assert.match(APP_VERSIE_DATUM, /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date(`${APP_VERSIE_DATUM}T12:00:00Z`);
  assert.ok(!Number.isNaN(d.getTime()), "onbruikbare datum");
});

test("de stempel staat in de kopbalk, waar je hem ziet zonder te zoeken", () => {
  const kop = review.slice(review.indexOf('<div class="kop-balk">'), review.indexOf('<div id="melding">'));
  assert.ok(kop.includes('id="stempel"'), "de stempel hoort in de kopbalk te staan");
});
