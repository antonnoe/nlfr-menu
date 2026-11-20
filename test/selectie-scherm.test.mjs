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

// ---- Tool uit de catalogus van Infopoche (20-11-2026) ----
import { toolCatalogus, leesModelAntwoord, bouwInvoer, bouwFeed } from "../lib/selectie/kern.js";

test("toolcatalogus: alleen af, zichtbaar en met https-adres; artikel gaat voor", () => {
  const t = toolCatalogus({ modules: [
    { id: "kompas", naam: "Financieel kompas", meta: "netto", status: "af", url: "https://k.app", artikel: "https://infofrankrijk.com/financieel-kompas/" },
    { id: "auto", naam: "Auto", status: "af", url: "https://a.app" },
    { id: "nedergids", naam: "Nedergids", status: "in bouw", url: "https://n.app" },
    { id: "taal", naam: "TaalHulp", status: "in ontwikkeling", url: "https://t.app" },
    { id: "uit", naam: "Uit", status: "af", url: "https://u.app", zichtbaar: false },
    { id: "kal", naam: "Kalender", status: "af" },
  ] });
  assert.deepEqual(t.map((x) => x.id), ["kompas", "auto"]);
  assert.equal(t[0].url, "https://infofrankrijk.com/financieel-kompas/");
});

test("modelantwoord: tool alleen uit de lijst, anders null", () => {
  const tools = [{ id: "kompas", naam: "Financieel kompas", url: "https://k.app" }];
  const items = [{ id: "a", peilAangeboden: [] }, { id: "b", peilAangeboden: [] }];
  const uit = leesModelAntwoord(JSON.stringify([
    { nr: 1, categorie: "algemeen", score: 50, reden: "x", peil: [], tool: "kompas" },
    { nr: 2, categorie: "algemeen", score: 50, reden: "x", peil: [], tool: "verzonnen" },
  ]), items, tools);
  assert.deepEqual(uit.get("a").tool, { id: "kompas", naam: "Financieel kompas", url: "https://k.app" });
  assert.equal(uit.get("b").tool, null);
  assert.match(bouwInvoer([], null, tools), /kompas: Financieel kompas/);
});

test("feed geeft de tool door", () => {
  const nu = Date.parse("2026-11-20T10:00:00Z");
  const feed = bouwFeed([{ id: "x", besluit: "go", categorie: "algemeen", titel: "T", datum: "2026-11-20T08:00:00Z", ai: { peil: [], tool: { id: "kompas", naam: "Financieel kompas", url: "https://k.app" } } }], nu);
  assert.deepEqual(feed.categorieen[0].items[0].tool, { naam: "Financieel kompas", url: "https://k.app" });
});
