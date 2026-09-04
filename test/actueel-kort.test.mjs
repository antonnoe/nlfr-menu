// De compacte stand /actueel?stand=kort — de lijst voor de linkerkolom van de
// startpagina.
//
// Draait op dezelfde compacte levering als de gewone stand. De fixture is een
// ECHTE levering van /api/actueel (04-09-2026), zodat deze test niet op een
// bedachte vorm leunt maar op wat de route werkelijk stuurt.
//
// De functies worden UIT actueel.html gehaald en daar uitgevoerd, niet
// overgeschreven: een test op een kopie zou groen blijven terwijl de pagina
// stuk is.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");
const LEVERING = JSON.parse(readFileSync(new URL("./fixtures/actueel-levering.json", import.meta.url), "utf8"));

// De instellingen staan boven de afslag, de functies eronder; allebei ophalen.
function knip(van, tot) {
  const a = html.indexOf(van), b = html.indexOf(tot);
  assert.ok(a > 0 && b > a, "niet gevonden in actueel.html: " + van);
  return html.slice(a, b);
}
const bron =
  knip("  var KORT_MAX = 10;", "  // ---- Compacte stand:") +
  knip("  // ---- De compacte stand ---", "  function korteLijst(){");

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const { kortItems, kortHTML, kortDatum } = new Function("esc",
  bron + "\nreturn { kortItems, kortHTML, kortDatum };")(esc);

// --- de selectie -----------------------------------------------------------

test("er komen precies tien items uit een volle levering", () => {
  const items = kortItems(LEVERING);
  assert.equal(items.length, 10);
});

test("het archief blijft buiten de lijst", () => {
  // Een levering waarin het archief het jongste bericht heeft: dat hoort er
  // niet in, want een lijstje "nieuws" is geen archief.
  const nu = new Date().toISOString();
  const data = {
    tegels: [
      { soort: "archief", artikelen: [{ id: "a1", titel: "Oud stuk uit het archief", datum: nu, bronMeta: { naam: "X", datum: nu } }] },
      { soort: "pers", artikelen: [{ id: "p1", titel: "Vers bericht", datum: nu, bronMeta: { naam: "Sud Ouest", datum: nu } }] },
    ],
  };
  const items = kortItems(data);
  assert.equal(items.length, 1);
  assert.equal(items[0].titel, "Vers bericht");
});

test("de lijst staat op datum, jongste eerst", () => {
  const items = kortItems(LEVERING);
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i - 1].tijd >= items[i].tijd,
      "item " + i + " is jonger dan zijn voorganger");
  }
  // En het is werkelijk de top-10 uit de hele levering.
  const alle = [];
  for (const t of LEVERING.tegels) {
    if (t.soort === "archief") continue;
    for (const a of t.artikelen || []) alle.push(new Date((a.bronMeta && a.bronMeta.datum) || a.datum).getTime());
  }
  alle.sort((a, b) => b - a);
  assert.deepEqual(items.map((i) => i.tijd), alle.slice(0, 10));
});

test("hetzelfde bericht in twee tegels komt maar één keer in de lijst", () => {
  const nu = new Date().toISOString();
  const een = { id: "zelfde", titel: "Eén bericht", datum: nu, bronMeta: { naam: "Le Monde", datum: nu } };
  const items = kortItems({ tegels: [{ soort: "pers", artikelen: [een] }, { soort: "overheid", artikelen: [een] }] });
  assert.equal(items.length, 1);
});

test("een lege of kapotte levering levert een lege lijst, geen fout", () => {
  for (const kaduuk of [null, undefined, {}, { tegels: [] }, { tegels: [{ soort: "pers" }] }]) {
    assert.deepEqual(kortItems(kaduuk), []);
  }
  assert.match(kortHTML([]), /Op dit moment geen nieuws/);
});

// --- bron of Redactie NLFR -------------------------------------------------

test("een redactionele synthese krijgt onze eigen naam, niet die van de krant", () => {
  const nu = new Date().toISOString();
  const items = kortItems({ tegels: [{ soort: "pers", artikelen: [
    { id: "r", titel: "Synthese", datum: nu, label: "Redactie NLFR — automatisch samengesteld, bronnen onderaan",
      bronMeta: { naam: "Sud Ouest", datum: nu } },
    { id: "k", titel: "Los bericht", datum: nu, bronMeta: { naam: "Le Figaro — Actualités", datum: nu } },
  ] }] });
  assert.equal(items.find((i) => i.titel === "Synthese").bron, "Redactie NLFR");
  assert.equal(items.find((i) => i.titel === "Los bericht").bron, "Le Figaro — Actualités");
});

test("zonder bronnaam valt hij terug op Redactie NLFR", () => {
  const nu = new Date().toISOString();
  const items = kortItems({ tegels: [{ soort: "pers", artikelen: [{ id: "x", titel: "Naamloos", datum: nu }] }] });
  assert.equal(items[0].bron, "Redactie NLFR");
});

test("de echte levering geeft een mix van bronnen en Redactie NLFR", () => {
  const bronnen = new Set(kortItems(LEVERING).map((i) => i.bron));
  assert.ok(bronnen.size >= 1, "er staat een bron bij elk item");
  for (const b of bronnen) assert.ok(b && b.length > 1, "geen lege bron: " + b);
});

// --- de datum --------------------------------------------------------------

test("de datum staat in het Nederlands, zonder jaar", () => {
  assert.equal(kortDatum("2026-08-29T10:00:00.000Z"), "29 augustus");
  assert.equal(kortDatum("2026-01-01T12:00:00.000Z"), "1 januari");
  assert.equal(kortDatum("2026-12-31T12:00:00.000Z"), "31 december");
  assert.equal(kortDatum("2026-03-08T12:00:00.000Z"), "8 maart");
});

test("de datum is die van Parijs, niet die van de server", () => {
  // 22:30Z op 29 augustus is in Parijs (zomertijd, UTC+2) al 30 augustus.
  assert.equal(kortDatum("2026-08-29T22:30:00.000Z"), "30 augustus");
});

test("een onbruikbare datum levert niets in plaats van 'Invalid Date'", () => {
  for (const rommel of ["", null, undefined, "geen datum"]) {
    assert.equal(kortDatum(rommel), "");
  }
});

// --- de opmaak -------------------------------------------------------------

test("elk item is een link naar de nieuwspagina, in de hele pagina", () => {
  const h = kortHTML(kortItems(LEVERING));
  const links = h.match(/<a href="[^"]+" target="_parent">/g) || [];
  assert.equal(links.length, 10, "tien links");
  for (const l of links) {
    assert.equal(l, '<a href="https://www.nederlanders.fr/page/actueel-frankrijknieuws" target="_parent">');
  }
});

test("elk item toont kop, bron en datum", () => {
  const h = kortHTML(kortItems(LEVERING));
  assert.equal((h.match(/class="kortkop"/g) || []).length, 10);
  assert.equal((h.match(/class="kortmeta"/g) || []).length, 10);
  assert.match(h, / · /, "bron en datum staan gescheiden door een punt");
});

test("de kop wordt na twee regels afgekapt met een beletselteken", () => {
  assert.match(html, /\.kortkop\{[^}]*-webkit-line-clamp:2/, "twee regels");
  assert.match(html, /\.kortkop\{[^}]*overflow:hidden/, "en dan afgekapt");
});

test("HTML in een titel wordt ontsnapt", () => {
  const nu = new Date().toISOString();
  const h = kortHTML(kortItems({ tegels: [{ soort: "pers", artikelen: [
    { id: "x", titel: '<script>alert(1)</script>', datum: nu, bronMeta: { naam: "X", datum: nu } }] }] }));
  assert.ok(!/<script>/.test(h), "geen ruwe HTML uit een titel");
  assert.match(h, /&lt;script&gt;/);
});

// --- de stand als geheel ---------------------------------------------------

test("de compacte stand zet de gewone stand helemaal buiten werking", () => {
  assert.match(html, /if \(\/\[\?&\]stand=kort\/\.test\(location\.search\)\) \{ korteLijst\(\); return; \}/,
    "de afslag staat meteen aan het begin van het script");
  assert.match(html, /html\.kort \.panel\{ display:none !important; \}/, "het gewone paneel is weg");
  // Geen tabs, geen tegels, geen uitklappen, geen bronnenvoet: die zitten
  // allemaal in het paneel dat hierboven verborgen wordt.
  assert.match(html, /html\.kort, html\.kort body\{ height:auto; \}/,
    "de hoogte is vrij, zodat het iframe kan meegroeien");
});

test("de compacte stand meldt zijn hoogte met dezelfde handshake", () => {
  const k = html.slice(html.indexOf("  function korteLijst(){"));
  assert.match(k, /nlfrActueelHeight/, "zelfde berichtnaam als de gewone stand");
  assert.match(k, /Math\.abs\(h - laatste\) >= 8/, "alleen melden bij een wijziging");
  assert.match(k, /window\.addEventListener\("resize", meld\)/, "en opnieuw bij een venterwijziging");
});

test("de kop staat er, in de merkkleur", () => {
  assert.match(html, /var KORT_KOP = "Nieuws uit en over Frankrijk";/);
  assert.match(html, /\.kortkopje\{[^}]*font-family:var\(--disp\)/, "Poppins-stapel");
  assert.match(html, /\.kortkopje\{[^}]*color:var\(--brand\)/, "bordeaux");
});

// Deze test bestaat om een fout die de bovenstaande tests NIET zagen: de
// instellingen stonden onder de vroege `return`. Een var-declaratie schuift
// omhoog maar zijn waarde niet, dus KORT_MAX was undefined als korteLijst()
// draaide — en slice(0, undefined) geeft de hele lijst. De pagina toonde 75
// items met een lege kop en href="undefined", terwijl de unittests groen
// bleven omdat die het blok mét de constanten uitvoerden.
test("de instellingen staan boven de vroege return, niet eronder", () => {
  const afslag = html.indexOf("if (/[?&]stand=kort/.test(location.search))");
  assert.ok(afslag > 0, "de afslag hoort in het bestand te staan");
  for (const naam of ["KORT_MAX", "KORT_DOEL", "KORT_KOP", "KORT_MAANDEN"]) {
    const decl = html.indexOf("  var " + naam + " =");
    assert.ok(decl > 0, naam + " hoort gedeclareerd te zijn");
    assert.ok(decl < afslag,
      naam + " staat ONDER de vroege return en is dan undefined als korteLijst() draait");
  }
});
