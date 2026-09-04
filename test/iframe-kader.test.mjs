// /actueel en /archief draaien als iframe op nederlanders.fr en in nlfr-m.
// Twee dingen die daar stuk gingen en hier vastgelegd worden:
//   1. Een interne link met target="_top" gooit de bezoeker uit het frame, op
//      de kale Vercel-pagina zonder sitekop of menu. Interne routes blijven in
//      hetzelfde frame; alleen nederlanders.fr mag _top gebruiken.
//   2. Chrome/Android paste "auto dark theme" toe; bordeaux #800000 werd op een
//      geïnverteerde achtergrond onleesbaar. index.html loste dat op met
//      color-scheme:only light (meta + CSS); actueel en archief nu ook.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lees = (naam) => fs.readFileSync(new URL("../" + naam, import.meta.url), "utf8");
const PAGINAS = ["actueel.html", "archief.html"];

// href="/iets" — een eigen route op Vercel, geen absoluut https://-adres en geen
// href die de JS ter plekke samenstelt (die wijzen naar nederlanders.fr of extern).
const EIGEN_ROUTE_TOP = /<a [^>]*href="[/][^"]*"[^>]*target="_top"/gi;

for (const naam of PAGINAS){
  test(`${naam}: geen enkele eigen route opent met target="_top"`, () => {
    const treffers = lees(naam).match(EIGEN_ROUTE_TOP) || [];
    assert.deepEqual(treffers, [], "deze links gooien de bezoeker uit het iframe");
  });

  test(`${naam}: auto dark theme is geblokkeerd`, () => {
    const html = lees(naam);
    assert.ok(
      html.includes('<meta name="color-scheme" content="only light">'),
      "de meta color-scheme hoort in de head te staan"
    );
    assert.ok(/color-scheme\s*:\s*only light/.test(html), ":root hoort color-scheme:only light te zetten");
    assert.ok(
      /html,body\{[^}]*background:var\(--bg\)/.test(html),
      "html en body horen een expliciete achtergrondkleur te hebben"
    );
  });
}

test("externe links houden _blank rel=noopener, nederlanders.fr houdt _top", () => {
  const html = lees("actueel.html");
  assert.ok(
    html.includes('href="\'+VERENIGINGEN_PAGINA+\'" target="_top" rel="noopener"'),
    "de verenigingenpagina op nederlanders.fr hoort de hele pagina te openen"
  );
  assert.ok(/target="_blank" rel="noopener"/.test(html), "externe bronlinks blijven _blank rel=noopener");
});

test("/archief heeft een zichtbare terugweg naar /actueel in hetzelfde frame", () => {
  const html = lees("archief.html");
  assert.ok(
    html.includes('<a class="terug" href="/actueel" target="_self">← Terug naar actueel</a>'),
    "de terugweglink hoort bovenaan het archief te staan"
  );
});

test("/archief meldt zijn hoogte net als /actueel (kaarthoogte, alleen bij wijziging)", () => {
  const html = lees("archief.html");
  assert.ok(html.includes("nlfrActueelHeight"), "zelfde berichtnaam als /actueel");
  assert.ok(html.includes("nlfrViewport"), "en dezelfde cap op de vensterhoogte van de ouder");
  assert.ok(
    !/body\.scrollHeight/.test(html),
    "de meting gaat over de kaart (bar + scroller + voet), niet over body.scrollHeight"
  );
  assert.ok(
    /Math\.abs\(h-lastH\)\s*>=\s*8/.test(html),
    "er wordt alleen gemeld bij een wijziging van minstens 8px"
  );
});
