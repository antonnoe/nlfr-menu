// Geen webfonts meer: de vier pagina's halen Poppins en Mulish niet meer bij
// Google op.
//
// WAAROM. Elke bezoeker betaalde een externe download (en een DNS-lookup en een
// TLS-handshake naar fonts.googleapis.com) voordat er tekst stond. Wie de
// fonts lokaal heeft ziet ze nog steeds; de rest krijgt meteen het systeemfont.
// Dat betekent wel dat de fontstapel ECHT moet doorlopen: staat er alleen
// 'Poppins', sans-serif, dan valt de rest terug op het kale schreefloze font
// van de browser in plaats van op het systeemfont.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BESTANDEN = ["index.html", "actueel.html", "archief.html", "banner-beheer.html", "lib/banner.js"];
const lees = (naam) => readFileSync(new URL("../" + naam, import.meta.url), "utf8");

// De stapel die overal achter 'Poppins' en 'Mulish' hoort te staan.
const STAPEL = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

for (const naam of BESTANDEN) {
  test(naam + ": geen enkele verwijzing naar Google Fonts", () => {
    const s = lees(naam);
    assert.ok(!/fonts\.googleapis\.com/.test(s), "geen stylesheet van fonts.googleapis.com");
    assert.ok(!/fonts\.gstatic\.com/.test(s), "geen preconnect naar fonts.gstatic.com");
    assert.ok(!/<link[^>]+preconnect/i.test(s), "geen preconnect-regels meer");
  });

  test(naam + ": elke fontstapel loopt door naar het systeemfont", () => {
    const s = lees(naam);
    const stapels = s.match(/font-family\s*:\s*[^;}"']*/g) || [];
    assert.ok(stapels.length > 0, "er staan fontstapels in dit bestand");
    for (const stapel of stapels) {
      if (!/'(Poppins|Mulish)'/.test(stapel)) continue;   // Georgia van de bannertitel e.d.
      assert.ok(stapel.includes("system-ui"), "stapel zonder systeemfont: " + stapel.trim());
      assert.ok(stapel.includes("-apple-system"), "stapel zonder -apple-system: " + stapel.trim());
      assert.ok(/Segoe UI/.test(stapel), "stapel zonder Segoe UI: " + stapel.trim());
      assert.ok(/Roboto/.test(stapel), "stapel zonder Roboto: " + stapel.trim());
      assert.ok(/sans-serif/.test(stapel), "stapel zonder sans-serif: " + stapel.trim());
    }
  });
}

test("de gewichten en groottes zijn niet meegewijzigd", () => {
  // Steekproef op de maten die in de opdracht vastliggen; als iemand bij het
  // omzetten van de fonts ook aan de typografie zit, valt dat hier om.
  const menu = lees("index.html");
  assert.match(menu, /\.sknop \{[^}]*font-weight: 700; font-size: 16px/, "Menu-knop");
  assert.match(menu, /\.deurkop \.dn \{[^}]*font-weight: 700; font-size: 15px/, "deurkop");
  assert.match(menu, /\.gk \{[^}]*font-weight: 700; font-size: 11\.5px/, "groepskop");
  assert.match(menu, /\.grp a \{[^}]*font-size: 13\.5px/, "menulinks");

  const banner = lees("lib/banner.js");
  assert.match(banner, /\.bnr-titel \{ font-family:Georgia/, "de bannertitel blijft een serif");
  assert.match(banner, /font-size:24px/, "en houdt zijn 24px");
});

test("Poppins en Mulish staan nog wel vooraan, voor wie ze lokaal heeft", () => {
  for (const naam of BESTANDEN) {
    const s = lees(naam);
    if (!/font-family/.test(s)) continue;
    assert.match(s, /'Poppins',\s*system-ui/, naam + ": Poppins hoort de eerste keus te blijven");
    assert.match(s, /'Mulish',\s*system-ui/, naam + ": Mulish hoort de eerste keus te blijven");
  }
});
