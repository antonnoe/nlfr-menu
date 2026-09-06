// Het vijfde tabblad "Uitgelegd" op /actueel.
// ---------------------------------------------------------------------------
// WAAROM HET BESTAAT. Een redactionele verwijzing naar een achtergrondartikel op
// Infofrankrijk staat in een tegel ONDER de bronnen van een artikel, dus pas
// zichtbaar nadat de lezer eerst het artikel en dan de bronnen heeft
// uitgeklapt. Gemeten op productie op 5 september 2026: van de 74 lopende
// berichten had er nul een zichtbare verwijzing, en de enige twee die bestonden
// hingen aan ARCHIEFberichten — achter de archieftegel, achter het openklappen.
// Werk dat met de hand wordt gekozen en dat vervolgens niemand ziet.
//
// Dit tabblad zet die verwijzingen vooraan, dwars door tegels en regimes heen.
//
// De renderfuncties komen UIT actueel.html, net als in tegelkop.test.mjs — een
// kopie zou groen blijven terwijl de pagina anders rendert.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../actueel.html", import.meta.url), "utf8");

const begin = html.indexOf("function bronHTML(b){");
const eind = html.indexOf("function leegHTML(){");
assert.ok(begin > 0 && eind > begin, "renderfuncties niet gevonden in actueel.html");
const bron = html.slice(begin, eind);

const esc = (x) =>
  String(x == null ? "" : x)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function maakUitgelegd(teksten = null) {
  // eslint-disable-next-line no-new-func
  return new Function(
    "esc", "ico", "datum", "artOpen", "teksten", "tekstStatus",
    "archiefArtikelen", "archiefStatus", "open", "themaIco", "meerv", "CATS", "VERWIJS_KOP",
    `${bron}; return { verzamelUitgelegd: verzamelUitgelegd, uitgelegdKaart: uitgelegdKaart, uitgelegdBody: uitgelegdBody };`
  )(
    esc, (n) => `<svg data-ic="${n}"></svg>`, (d) => String(d || "").slice(0, 10), {}, teksten, "klaar",
    null, "niet-nodig", {}, () => "ic-thema", (n) => `${n} artikel${n === 1 ? "" : "en"}`, [], "Meer hierover op Infofrankrijk"
  );
}

const VW = [{ titel: "Diploma's laten erkennen in Frankrijk", url: "https://infofrankrijk.com/onderwijs-diplomas/" }];

function perCat({ metVerwijzing = true } = {}) {
  return {
    nieuws: [
      {
        id: "pers-landelijk", soort: "pers", label: "Landelijk nieuws",
        artikelen: [
          { id: "p1", soort: "pers", titel: "Nieuwe regels voor diploma-erkenning", datum: "2026-09-06T08:00:00.000Z",
            verwijzingen: metVerwijzing ? VW : [] },
          { id: "p2", soort: "pers", titel: "Zonder verwijzing", datum: "2026-09-06T09:00:00.000Z" },
        ],
      },
    ],
    overheid: [
      {
        id: "overheid-praktisch", soort: "overheid", label: "Praktisch",
        artikelen: [
          { id: "o1", soort: "overheid", titel: "Aangifte verschuift", bronMeta: { naam: "Service-Public", datum: "2026-09-05T10:00:00.000Z" },
            verwijzingen: metVerwijzing ? VW : [] },
        ],
      },
    ],
    nlers: [
      // Een platte tegel zonder artikelenlijst: mag de verzamelaar niet laten struikelen.
      { id: "agenda", soort: "agenda", label: "Agenda", plat: "<div></div>" },
    ],
    uitgelegd: [],
    archief: [
      {
        id: "archief", soort: "archief", label: "Archief", artikelenApart: true,
        artikelen: [{ id: "x1", soort: "pers", titel: "Oud bericht", datum: "2026-09-06T23:00:00.000Z", verwijzingen: VW }],
      },
    ],
  };
}

test("verzamelt de artikelen met een verwijzing, dwars door tegels en regimes", () => {
  const { verzamelUitgelegd } = maakUitgelegd();
  const rijen = verzamelUitgelegd(perCat());
  assert.equal(rijen.length, 2, "een persartikel en een overheidsbericht");
  assert.deepEqual(rijen.map((r) => r.art.id), ["p1", "o1"]);
});

test("het archief doet niet mee, ook al heeft het de nieuwste verwijzing", () => {
  const { verzamelUitgelegd } = maakUitgelegd();
  const rijen = verzamelUitgelegd(perCat());
  assert.ok(!rijen.some((r) => r.art.id === "x1"),
    "een bericht dat zijn tijd op de pagina heeft gehad, hoort hier niet alsnog bovenaan");
});

test("nieuwste bovenaan, ook als de datum uit de bronregel moet komen", () => {
  const { verzamelUitgelegd } = maakUitgelegd();
  const rijen = verzamelUitgelegd(perCat());
  // p1 is 6 september, o1 is 5 september en draagt zijn datum alleen in bronMeta.
  assert.equal(rijen[0].art.id, "p1");
  assert.equal(rijen[1].art.id, "o1");
  assert.ok(rijen[0].t > rijen[1].t, "de sorteersleutel hoort een leesbare tijd te zijn");
});

test("een artikel zonder verwijzing komt er niet in", () => {
  const { verzamelUitgelegd } = maakUitgelegd();
  assert.equal(verzamelUitgelegd(perCat({ metVerwijzing: false })).length, 0);
});

test("de verwijzing uit de tweede levering telt net zo goed mee", () => {
  // In de praktijk komen verwijzingen niet op het artikel binnen maar in de
  // tekst-levering; die weg mag niet stilletjes leeg blijven.
  const teksten = { "pers-landelijk/p2": { tekst: "x", bronnen: [], verwijzingen: VW } };
  const { verzamelUitgelegd } = maakUitgelegd(teksten);
  const rijen = verzamelUitgelegd(perCat({ metVerwijzing: false }));
  assert.equal(rijen.length, 1);
  assert.equal(rijen[0].art.id, "p2");
});

test("een tegel zonder artikelenlijst laat de verzamelaar niet struikelen", () => {
  const { verzamelUitgelegd } = maakUitgelegd();
  assert.doesNotThrow(() => verzamelUitgelegd(perCat()));
});

// ---- De kaart ---------------------------------------------------------------

test("de kaart toont kop, herkomst, bron en datum", () => {
  const { verzamelUitgelegd, uitgelegdKaart } = maakUitgelegd();
  const rijen = verzamelUitgelegd(perCat());
  const kaart = uitgelegdKaart(rijen[1]); // het overheidsbericht
  assert.match(kaart, /<h4>Aangifte verschuift<\/h4>/);
  assert.match(kaart, /Praktisch/, "de tegel waar het vandaan komt");
  assert.match(kaart, /Service-Public/, "de bron");
  assert.match(kaart, /2026-09-05/, "en de datum");
});

test("een perssynthese draagt de redactie, niet de eerste krant", () => {
  const { verzamelUitgelegd, uitgelegdKaart } = maakUitgelegd();
  const kaart = uitgelegdKaart(verzamelUitgelegd(perCat())[0]);
  assert.match(kaart, /Redactie NLFR/,
    "eigen redactioneel werk op meerdere bronnen staat niet op naam van één krant");
});

test("de verwijzing staat prominent, niet weggestopt onder de bronnen", () => {
  const { verzamelUitgelegd, uitgelegdKaart } = maakUitgelegd();
  const kaart = uitgelegdKaart(verzamelUitgelegd(perCat())[0]);
  assert.match(kaart, /class="uitlegverwijzing"/);
  assert.match(kaart, /Meer hierover op Infofrankrijk/);
  assert.match(kaart, /infofrankrijk\.com\/onderwijs-diplomas\//);
  assert.match(kaart, /rel="noopener"/, "externe link opent veilig in een nieuw tabblad");
  // Geen bronnenknop, geen uitklapniveau: dit tabblad bestaat juist omdat de
  // verwijzing daar onvindbaar was.
  assert.doesNotMatch(kaart, /bronknop|bronlijst/);
});

test("de kop wordt geëscaped", () => {
  const { uitgelegdKaart } = maakUitgelegd();
  const kaart = uitgelegdKaart({
    tegel: { label: "T" },
    art: { id: "a", soort: "pers", titel: '<script>x</script>', datum: "2026-09-06T08:00:00.000Z" },
    verwijzingen: [{ titel: "<b>t</b>", url: "https://infofrankrijk.com/a/" }],
    t: 1,
  });
  assert.doesNotMatch(kaart, /<script>/);
  assert.doesNotMatch(kaart, /<b>t<\/b>/);
});

// ---- Het tabblad zelf -------------------------------------------------------

test("bij nul verwijzingen verdwijnt het tabblad volledig", () => {
  const blok = html.slice(html.indexOf("function renderTabs"), html.indexOf("function renderScroller"));
  assert.match(blok, /if \(aantalUitgelegd > 0\) keys\.push\("uitgelegd"\)/,
    "niet grijs en niet leeg met een uitleg erin: weg");
});

test("het aantal staat in het label van het tabblad", () => {
  const blok = html.slice(html.indexOf("function renderTabs"), html.indexOf("function renderScroller"));
  assert.match(blok, /"Uitgelegd \(" \+ aantalUitgelegd \+ "\)"/);
});

test("wie op het tabblad staat als het verdwijnt, valt terug op Nieuws", () => {
  const blok = html.slice(html.indexOf("function render(){"), html.indexOf("function renderStatus"));
  assert.match(blok, /if \(actief === "uitgelegd" && !rijen\.length\) actief = "nieuws";/,
    "anders kijkt de lezer naar een leeg scherm");
});

test("Uitgelegd wordt bij elke hertekening opnieuw afgeleid", () => {
  // De verwijzingen komen met de tweede levering binnen; bij de eerste weergave
  // zijn het er nog nul. Eenmalig afleiden bij het laden zou het tabblad nooit
  // laten verschijnen.
  const blok = html.slice(html.indexOf("function render(){"), html.indexOf("function renderStatus"));
  assert.match(blok, /verzamelUitgelegd\(laatste\)/);
});

test("de twee huiskleuren staan in de stijl van het tabblad", () => {
  const blok = html.slice(html.indexOf(".cat-uitgelegd{"), html.indexOf(".cat-uitgelegd{") + 400);
  assert.match(blok, /--c-main:#800000/, "primair bordeaux");
  assert.match(blok, /--c-tweede:#2f6b3a/, "secundair flessengroen");
});

test("de lijst staat rechtstreeks in de scroller, zonder tegel eromheen", () => {
  // Een tegel begint dichtgeklapt, en dat is precies het wegstoppen dat dit
  // tabblad moest oplossen. Op de andere tabbladen is de tegel de groepering;
  // hier is het tabblad zelf de groep.
  const blok = html.slice(html.indexOf("function renderScroller"), html.indexOf("function render(){"));
  assert.match(blok, /if \(actief === "uitgelegd"\)\{/);
  assert.match(blok, /scrollerEl\.innerHTML = lijst\.length \? lijst\[0\]\.plat : leegHTML\(\);/);
});

test("zonder tegel draagt de scroller zelf de categoriekleur", () => {
  const blok = html.slice(html.indexOf("function render(){"), html.indexOf("function renderStatus"));
  assert.match(blok, /scrollerEl\.className = "scroller" \+ \(actief === "uitgelegd" \? " cat-uitgelegd" : ""\);/);
});

test("Alles uitklappen verdwijnt op een tabblad zonder klapjes", () => {
  const blok = html.slice(html.indexOf("function render(){"), html.indexOf("function renderStatus"));
  assert.match(blok, /allesBtn\.hidden = \(actief === "uitgelegd"\);/,
    "een knop die niets doet is erger dan geen knop");
});

test("de pijltjestoetsen volgen de tabbalk, niet een lijst ernaast", () => {
  // Het tabblad verschijnt en verdwijnt met het aantal verwijzingen. Een vaste
  // lijst zou het overslaan als het er is, en naar een knop wijzen als het er
  // niet is — terwijl role="tablist" toetsenbordnavigatie belooft.
  const blok = html.slice(html.indexOf('tabsEl.addEventListener("keydown"'), html.indexOf("scrollerEl.addEventListener"));
  assert.match(blok, /tabsEl\.querySelectorAll\("\.tab"\)/, "de volgorde komt uit de tabbalk zelf");
  assert.doesNotMatch(blok, /\["nieuws","overheid","nlers","archief"\]/, "de hardgecodeerde lijst is weg");
  assert.match(blok, /if \(i < 0\) return;/, "een tab die net verdween laat de pijltjes niet ontsporen");
});
