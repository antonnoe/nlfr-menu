// Een terugvraag van het model mag nooit als overheidsnieuws live gaan.
// Aanleiding: 6 november 2026 stond "Ik heb alleen de titel ontvangen, niet de
// tekst van het bericht…" als kop op de openbare actueelpagina.
import test from "node:test";
import assert from "node:assert/strict";
import { isTerugvraag } from "../lib/synthese.js";

test("terugvraag van 6 november 2026 wordt herkend", () => {
  assert.equal(
    isTerugvraag(
      "Ik heb alleen de titel ontvangen, niet de tekst van het bericht. Zonder de inhoud kan ik niet feitelijk vaststellen wat er verandert, voor wie en per wanneer, en ik wil niets verzinnen",
      "Kun je de volledige tekst of de kernpassages van het vie-publique.fr-bericht plakken?"
    ),
    true
  );
  assert.equal(isTerugvraag("Kerstvakantie", "Kun je de tekst plakken?"), true);
});

test("gewone overheidskoppen zijn geen terugvraag", () => {
  for (const [kop, tekst] of [
    ["Einde cumulatie AAH en ASS per 2027", "De overgangsperiode loopt af op 31 december 2026. Wie nu beide uitkeringen ontvangt, moet rekening houden met minder inkomen."],
    ["Aanslagen CFE en IFER 2026 online beschikbaar", "Bedrijven kunnen hun aanslag online inzien. De betaling moet uiterlijk 15 december."],
    ["EU-heffing op alle pakketten vanaf november", "Vanaf 1 november 2026 geldt een heffing van 2 euro per productcategorie."],
  ]) assert.equal(isTerugvraag(kop, tekst), false, kop);
});
