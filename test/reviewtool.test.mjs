// De reviewtool zelf: bedienbaarheid en de gevaarlijke knop.
// ---------------------------------------------------------------------------
// Deze tool wordt op een TELEFOON gebruikt, en niet altijd door dezelfde
// persoon. Twee dingen die daarom niet mogen verslonzen:
//
//   1. TIKDOELEN. Elke knopstijl houdt minstens 44 px aan. Dat is geen
//      willekeurig getal maar de maat die de rest van de tool al hanteert;
//      bij het bouwen van de Infofrankrijk-knoppen was hij drie keer
//      vergeten, en dat zag je op het scherm niet.
//   2. DE ONOMKEERBARE KNOP. "Wachtrij persconcepten wissen" gooit de hele
//      conceptenwachtrij weg. Die hoort niet naast de knoppen te staan die je
//      de hele dag gebruikt; hij zit achter een laatje dat je bewust opent.
//      Bewust GEEN <details>: of dat inklapt hangt af van de browserstijl.
//      Hier doet het `hidden`-attribuut het werk, en dat is toetsbaar.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");
const stijl = review.slice(review.indexOf("<style>"), review.indexOf("</style>"));

// De hoogte van elke regel die er één opgeeft. Nodig, maar niet genoeg: zie de
// toets daaronder, die vanaf de knoppen zelf redeneert.
test("geen enkele stijl in de stylesheet zet een tikdoel onder 44 px", () => {
  const regels = stijl.split("\n").filter((r) => /min-height:\s*\d+px/.test(r));
  assert.ok(regels.length >= 5, `verwacht meerdere knopstijlen, gevonden ${regels.length}`);
  for (const regel of regels) {
    const m = regel.match(/min-height:\s*(\d+)px/);
    assert.ok(
      Number(m[1]) >= 44,
      `tikdoel te klein (${m[1]}px): ${regel.trim().slice(0, 90)}`
    );
  }
});

test("elke knop in de tool komt aan een tikdoel van 44 px", () => {
  // WAAROM DEZE ERBIJ KWAM. De toets hierboven kijkt alleen naar regels die al
  // een min-height hébben. Een nieuwe knop zonder die eigenschap glipt er dus
  // langs: de toets kan niet rood worden voor precies het geval waarvoor hij
  // bestaat. Dat gebeurde ook echt, bij het stiller maken van "Token vergeten".
  // Deze toets redeneert de andere kant op, vanaf de knoppen in de bron.

  // Klasse -> de grootste min-height die een regel voor die klasse oplevert.
  // Commentaar er eerst uit: /* ... */ staat in deze stylesheet vaak boven een
  // regel en zou anders als deel van de selector meelopen.
  const zonderUitleg = stijl.replace(/\/\*[\s\S]*?\*\//g, " ");
  const hoogte = new Map();
  for (const m of zonderUitleg.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const h = m[2].match(/min-height:\s*(\d+)px/);
    if (!h) continue;
    for (const sel of m[1].split(",")) {
      // Het ONDERWERP van de selector is het laatste stuk: bij ".pager .nav"
      // krijgt .nav de hoogte, niet .pager, en bij "button.actie" is dat .actie.
      const onderwerp = sel.trim().split(/\s+/).pop() || "";
      const klassen = [...onderwerp.matchAll(/\.([\w-]+)/g)].map((k) => k[1]);
      // Alleen bij één klasse in het onderwerp. ".ifknop.klein" eist beide
      // klassen tegelijk; die hoogte aan elk van de twee toekennen zou zeggen
      // dat .klein op zichzelf al genoeg is, en dat staat er niet.
      if (klassen.length !== 1) continue;
      hoogte.set(klassen[0], Math.max(hoogte.get(klassen[0]) || 0, Number(h[1])));
    }
  }

  // Elke knop in het bestand, ook die uit de sjablonen in het script.
  const knoppen = [...review.matchAll(/<button[^>]*class="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(knoppen.length >= 10, `verwacht meerdere knoppen, gevonden ${knoppen.length}`);

  // WAT DEZE TOETS NIET KAN. Hij leest geen cascade. Een knop kan zijn hoogte
  // ook van een containerregel krijgen, en dat is hier één keer zo. Die staat
  // met naam in de lijst hieronder, met de regel die het werk doet, en die
  // regel wordt apart nagemeten. Zonder deze lijst zou de toets een fout
  // melden die er niet is; met een stilzwijgende uitzondering zou hij een
  // echte fout kunnen missen.
  const VIA_CONTAINER = [{ klasse: "gevaar", regel: ".balk button" }];
  for (const { regel } of VIA_CONTAINER) {
    const start = zonderUitleg.indexOf(regel + " {");
    assert.ok(start >= 0, `containerregel niet gevonden: ${regel}`);
    const m = zonderUitleg.slice(start, zonderUitleg.indexOf("}", start)).match(/min-height:\s*(\d+)px/);
    assert.ok(m && Number(m[1]) >= 44,
      `${regel} zet geen tikdoel van 44px meer, terwijl een knop daarop leunt`);
  }
  const viaContainer = new Set(VIA_CONTAINER.map((v) => v.klasse));

  const teklein = [];
  for (const klassen of knoppen) {
    const lijst = klassen.split(/\s+/).filter(Boolean);
    // Eén klasse die 44 haalt is genoeg: modificatoren als .pubbtn en .ketenbtn
    // staan naast een basisklasse die de hoogte al zet.
    if (lijst.some((k) => (hoogte.get(k) || 0) >= 44)) continue;
    if (lijst.some((k) => viaContainer.has(k))) continue;
    teklein.push(klassen);
  }
  assert.deepEqual(teklein, [],
    "knop zonder klasse die min-height:44px zet; op een telefoon is dat niet te raken");
});

test("de wisknop zit in het laatje en dat laatje begint dicht", () => {
  const lade = review.match(/<div class="opruimlade" id="opruimLade" hidden>[\s\S]*?<\/div>'/);
  assert.ok(lade, "het opruimlaatje ontbreekt of begint niet met hidden");
  assert.ok(lade[0].includes('id="wisAlles"'), "de wisknop hoort in het laatje te staan");
  // En de CSS moet `hidden` ook echt honoreren, want .opruimlade zet display.
  assert.match(stijl, /\.opruimlade\[hidden\]\s*\{\s*display:\s*none/);
});

test("de knop die het laatje opent, zegt met aria wat hij doet", () => {
  assert.match(review, /id="opruimToggle" aria-expanded="false" aria-controls="opruimLade"/);
  assert.match(review, /setAttribute\("aria-expanded"/);
});

test("de tool draagt geen belofte meer die de code niet waarmaakt", async () => {
  const { CONCEPT_TTL_S } = await import("../lib/config.js");
  const uren = CONCEPT_TTL_S / 3600;
  assert.match(
    review,
    new RegExp(`verlopen na ${uren} uur`),
    `de ondertitel noemt niet ${uren} uur, terwijl CONCEPT_TTL_S dat wel is`
  );
});

// ---- De wachtrij: breedste bronbasis eerst ---------------------------------
// Afgesproken werkwijze: TWEE onafhankelijke outlets blijft de ondergrens (dat
// is de auteursrechtelijke regel), maar drie of meer is een steviger verhaal en
// dat hoort bovenaan te staan. Wie halverwege de wachtrij stopt, heeft dan de
// beste stukken gehad in plaats van de toevallig nieuwste.

test("de reviewtool markeert een concept dat op precies twee kranten steunt", () => {
  assert.match(review, /function smalleBasisHtml\(c\)\{/);
  assert.match(review, /onafhankelijkeOutlets !== 2/, "de markering hoort alleen bij precies twee");
  assert.match(review, /Smalle basis — twee kranten/);
  // Het is een signaal, geen blokkade: de knop Publiceer blijft gewoon staan.
  assert.match(review, /smalleBasisHtml\(c\)\+/, "de markering wordt ook echt getoond");
});

test("de wachtrij sorteert op bronbreedte, daarna op recentheid", async () => {
  const route = readFileSync(new URL("../api/review.js", import.meta.url), "utf8");
  assert.match(route, /const breedte = \(c\) =>/);
  assert.match(route, /breedte\(b\) - breedte\(a\) \|\|/, "breedte moet vóór de datum komen");
  // En de ondergrens zelf is NIET verschoven: dat blijft de poort.
  const { SYNTHESE_MIN_BRONNEN } = await import("../lib/config.js");
  assert.equal(SYNTHESE_MIN_BRONNEN, 2, "de ondergrens hoort ongewijzigd twee te zijn");
});
