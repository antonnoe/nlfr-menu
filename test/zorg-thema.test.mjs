// Het thema "zorg" ("Zorg en gezondheid") in de indeling van perspublicaties.
// Volgorde in persTegelVoor(): bosbranden -> verkeer -> zorg -> brontthema.

import { test } from "node:test";
import assert from "node:assert/strict";

import { persTegelVoor } from "../lib/tegels.js";
import { PERS_TEGELS, PERS_TEGEL_LABEL } from "../lib/config.js";

const naamNaarThema = new Map([
  ["Le Monde — À la une", "landelijk-fr"],
  ["Sud Ouest", "regionaal-fr"],
]);
const LM = "Le Monde — À la une";
const pubT = (kop, tekst, naam = LM) => ({ kop, tekst, bronnen: [{ naam }] });
const tegel = (kop, tekst, naam) => persTegelVoor(pubT(kop, tekst, naam), naamNaarThema);

test("zorg staat in PERS_TEGELS vóór landelijk, met het juiste label", () => {
  assert.ok(PERS_TEGELS.includes("zorg"));
  assert.ok(PERS_TEGELS.indexOf("zorg") < PERS_TEGELS.indexOf("landelijk"));
  assert.equal(PERS_TEGEL_LABEL.zorg, "Zorg en gezondheid");
});

test("zorgnieuws komt in de tegel zorg", () => {
  const gevallen = [
    ["Zorgverzekering duurder", "De premie van de mutuelle stijgt volgend jaar."],
    ["Wachtlijsten", "Het ziekenhuis in Lyon kampt met personeelstekort."],
    ["Nieuwe regels", "Een hôpital in Nantes sluit de spoedafdeling."],
    ["Huisarts gezocht", "Het aantal huisartsen daalt; patiënten zoeken een médecin traitant."],
    ["Ameli wijzigt", "Op ameli.fr staat een nieuwe procedure voor de carte vitale."],
    ["Verpleeghuis", "Een EHPAD in de Dordogne vraagt om extra geld."],
    ["Kosten", "De CPAM past de vergoeding voor medicijnen aan."],
    ["Hulp thuis", "De APA voor ouderen wordt verhoogd; de ouderen krijgen thuiszorg."],
    ["Afspraak", "De apotheek en de pharmacie sluiten vaker."],
    ["Pilotproject", "Santé publique waarschuwt voor dementie en palliatieve zorg."],
    ["Zorg", "De zorg voor patiënten staat onder druk, meldt de verzekeraar."],
  ];
  for (const [kop, tekst] of gevallen) assert.equal(tegel(kop, tekst), "zorg", kop);
});

test("zorg buiten de bron-terugval: ook bij een regionale bron", () => {
  assert.equal(tegel("Ziekenhuis in Toulouse", "Het ziekenhuis in Toulouse breidt uit.", "Sud Ouest"), "zorg");
});

test("'zich zorgen maken' en andere valse treffers zijn geen zorgnieuws", () => {
  const negatief = [
    ["Premier maakt zich zorgen", "De premier maakt zich zorgen over de begroting."],
    ["Zorgen over de economie", "Er zijn zorgen over de groei van de economie."],
    ["Apart overleg", "Het apart overleg van de partijen duurde lang."],
    ["Appartement", "Het appartement in Nice werd verkocht."],
    ["Amélie wint", "Amélie wint de wedstrijd in Parijs."],
    ["Puma", "Het merk Puma opent een winkel in Parijs."],
    ["Arbeidscontract", "Het parket onderzoekt de aanklacht tegen de burgemeester."],
  ];
  for (const [kop, tekst] of negatief) assert.equal(tegel(kop, tekst), "landelijk", kop);
});

test("verkeer en bosbranden houden hun tegel, ook met zorgwoorden erbij", () => {
  assert.equal(tegel("Files op de autosnelweg", "Lange files voor automobilisten richting het zuiden."), "verkeer");
  assert.equal(tegel("Treinstaking", "De treinstaking treft ook patiënten op weg naar het ziekenhuis."), "verkeer");
  assert.equal(tegel("Brand bij Marseille", "De brandweer bestrijdt de vlammen, al 300 hectare is verwoest."), "bosbranden");
  assert.equal(tegel("Bosbrand", "Een bosbrand dwingt een ziekenhuis tot evacuatie."), "bosbranden");
});
