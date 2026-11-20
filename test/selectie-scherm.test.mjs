import { test } from "node:test";
import assert from "node:assert/strict";
import { kandidatenVoorScherm } from "../lib/selectie/kern.js";

const nu = Date.parse("2026-11-20T10:00:00Z");
const uur = (h) => new Date(nu - h * 3600e3).toISOString();
const k = (id, titel, extra = {}) => ({ id, titel, soort: "pers", bron: "B" + id, datum: uur(2), ai: { score: 50 }, ...extra });

test("oud persnieuws (ouder dan 72 uur) valt weg", () => {
  const uit = kandidatenVoorScherm([k("a", "Staking bij Franse spoorwegen legt treinverkeer plat"), k("b", "Nieuwe tol op Franse snelweg A13", { datum: uur(100) })], [], nu);
  assert.deepEqual(uit.map((x) => x.id), ["a"]);
});

test("hetzelfde verhaal wordt één kaart, met de andere bron als ook bij", () => {
  const uit = kandidatenVoorScherm([
    k("a", "Laadplatform Chargemap getroffen door cyberaanval: gegevens gestolen - VRT NWS", { viaGoogleNews: true, bron: "VRT NWS", ai: { score: 45 } }),
    k("b", "Laadplatform Chargemap getroffen door cyberaanval, gegevens gestolen - HLN", { viaGoogleNews: true, bron: "HLN", ai: { score: 40 } }),
    k("c", "Marine Le Pen wil pensioenleeftijd terug naar 60 jaar"),
  ], [], nu);
  assert.equal(uit.length, 2);
  const cm = uit.find((x) => x.id === "a");
  assert.deepEqual(cm.ookBij, ["HLN"]);
});

test("een verhaal waarover al beslist is komt niet terug", () => {
  const besluiten = [{ id: "x", soort: "pers", titel: "Marine Le Pen wil pensioenleeftijd terug naar 60 jaar", besluit: "go", besluitOp: uur(1) }];
  const uit = kandidatenVoorScherm([k("c", "Marine Le Pen wil de pensioenleeftijd terug naar 60 jaar")], besluiten, nu);
  assert.equal(uit.length, 0);
});

test("meteo: verlopen weg, van dezelfde waarschuwing alleen de nieuwste", () => {
  const m = (id, h, verloopt) => ({ id, soort: "meteo", titel: "Oranje waarschuwing voor regen en overstromingen: Landes, Pas-de-Calais, Somme", bron: "Météo-France vigilance", datum: uur(h), verloopt, ai: { score: 60 } });
  const uit = kandidatenVoorScherm([m("oud", 20, uur(-5)), m("nieuw", 2, uur(-10)), m("weg", 30, uur(3))], [], nu);
  assert.deepEqual(uit.map((x) => x.id), ["nieuw"]);
});
