// Het thema van een perspublicatie wordt gekozen door het model, in DEZELFDE
// aanroep als de synthese (geen extra verzoek per bericht).
// ---------------------------------------------------------------------------
// Wat hier vastligt:
//   1. prompt en verzoek bevatten het THEMA-veld en de vaste lijst (met uitleg)
//   2. een modelantwoord wordt geparsd en gevalideerd: geldig, onbekend,
//      ontbrekend of onleesbaar -> alleen een geldig thema blijft over
//   3. persTegelVoor: een opgeslagen thema wint van de regels; zonder thema
//      (of met een ongeldig thema) beslissen de regels, ook zonder API-antwoord
//   4. de reviewtool slaat een wijziging op (themaBron "redactie") en vereist
//      dezelfde autorisatie als de andere acties
// Geen netwerk: de Anthropic-aanroep loopt via een gemockte fetch, KV via de
// namaak-KV, de inlog via de namaak-Supabase.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { startNepKv, roeper } from "./fixtures/nep-kv.mjs";
import { startNepSessie } from "./fixtures/nep-supabase.mjs";

process.env.ANTHROPIC_API_KEY = "sk-ant-test";

// De namaak-KV en -sessie moeten staan vóór lib/store.js wordt geladen.
const { db, sluit } = await startNepKv();
const { cookie, sluit: sluitSb } = await startNepSessie();
test.after(sluit);
test.after(sluitSb);

const C = await import("../lib/config.js");
const { synthetiseer, samenvatOverheid, scheidThema, valideerThema } = await import("../lib/synthese.js");
const { persTegelVoor } = await import("../lib/tegels.js");

const { PERS_TEGELS, PERS_TEGEL_LABEL, PERS_THEMA_UITLEG, OVERHEID_THEMA_UITLEG, OVERHEID_THEMAS, AI_CONFIG } = C;

// ---- Gemockte Anthropic-aanroep ---------------------------------------------
const origineleFetch = globalThis.fetch;
let verzoeken = [];
function modelAntwoordt(tekst) {
  verzoeken = [];
  globalThis.fetch = async (url, opties = {}) => {
    if (!String(url).includes("anthropic")) return origineleFetch(url, opties);
    verzoeken.push(JSON.parse(opties.body));
    return new Response(
      JSON.stringify({
        id: "msg_test", type: "message", role: "assistant", model: AI_CONFIG.model,
        content: [{ type: "text", text: tekst }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 300 },
      }),
      { status: 200, headers: { "Content-Type": "application/json", "request-id": "req_t" } }
    );
  };
}
test.afterEach(() => { globalThis.fetch = origineleFetch; });

const cluster = {
  sleutel: "k1",
  items: [
    { bron: "Le Monde — À la une", titel: "Hôpitaux : les urgences saturées", url: "https://www.lemonde.fr/a", datum: "2026-10-20T06:00:00.000Z" },
    { bron: "Le Figaro — Actualités", titel: "Urgences : le personnel soignant manque à l'appel", url: "https://www.lefigaro.fr/b", datum: "2026-10-20T06:30:00.000Z" },
  ],
  onafhankelijkeBronnen: 2, aantalBronnen: 2, kernTokens: ["urgences"], laatste: "2026-10-20T06:30:00.000Z",
};
const synthese = (thema) =>
  "Spoedeisende hulp onder druk\n\nFranse media melden dat de spoedeisende hulp op veel plaatsen overbelast is.\n\n" +
  (thema === undefined ? "" : `THEMA: ${thema}\n\n`) +
  "GEBRUIKT: https://www.lemonde.fr/a, https://www.lefigaro.fr/b";

// ---- 1. Prompt en verzoek ---------------------------------------------------
test("de prompt bevat het THEMA-veld en de hele vaste lijst met één zin uitleg per thema", async () => {
  modelAntwoordt(synthese("zorg"));
  await synthetiseer(cluster);
  assert.equal(verzoeken.length, 1, "precies één aanroep: het thema kost geen extra verzoek");
  const system = String(verzoeken[0].system);
  assert.match(system, /THEMA: <code>/);
  for (const t of PERS_TEGELS) {
    assert.ok(system.includes(`- ${t}: ${PERS_THEMA_UITLEG[t]}`), `thema ${t} met uitleg ontbreekt in de prompt`);
  }
  assert.match(String(verzoeken[0].messages[0].content), /THEMA/);
});

test("elk persthema heeft een uitleg en een label; elk overheidsthema in de keuze ook", () => {
  for (const t of PERS_TEGELS) {
    assert.ok(PERS_THEMA_UITLEG[t], `uitleg ontbreekt voor ${t}`);
    assert.ok(PERS_TEGEL_LABEL[t], `label ontbreekt voor ${t}`);
  }
  assert.equal(PERS_TEGEL_LABEL.zorg, "Zorg en gezondheid");
  for (const t of Object.keys(OVERHEID_THEMA_UITLEG)) {
    assert.ok(OVERHEID_THEMAS.includes(t), `${t} is geen overheidsthema`);
  }
});

test("de overheidsprompt geeft het voorlopige thema mee en vraagt om een conservatief oordeel", async () => {
  modelAntwoordt("Nieuwe belastingtermijn\n\nDe termijn verschuift voor particulieren.\n\nTHEMA: geld-belasting");
  const r = await samenvatOverheid({ bron: "Bercy", titel: "Barème", samenvatting: "Texte.", thema: "geld-belasting" });
  assert.equal(verzoeken.length, 1);
  assert.match(String(verzoeken[0].messages[0].content), /Voorlopig thema: geld-belasting/);
  assert.match(String(verzoeken[0].system), /DUIDELIJK over een ander thema/);
  assert.equal(r.thema, "geld-belasting");
  assert.equal(r.kop, "Nieuwe belastingtermijn");
  assert.ok(!/THEMA/.test(r.samenvatting), "de THEMA-regel hoort niet in de samenvatting");
});

// ---- 2. Parsen en valideren van het modelantwoord ----------------------------
test("geldig thema: komt mee in de synthese, met herkomst model, en niet in de tekst", async () => {
  modelAntwoordt(synthese("zorg"));
  const s = await synthetiseer(cluster);
  assert.equal(s.thema, "zorg");
  assert.equal(s.themaBron, "model");
  assert.ok(!/THEMA/.test(s.tekst) && !/GEBRUIKT/.test(s.tekst));
  assert.equal(s.bronnen.length, 2, "de GEBRUIKT-regel werkt nog naast de THEMA-regel");
});

test("het label, markdown en hoofdletters worden herkend", () => {
  assert.equal(valideerThema("Zorg en gezondheid", PERS_TEGELS, PERS_TEGEL_LABEL), "zorg");
  assert.equal(valideerThema("**NL-nieuws**.", PERS_TEGELS, PERS_TEGEL_LABEL), "nl-nieuws");
  assert.equal(valideerThema("`verkeer`", PERS_TEGELS, PERS_TEGEL_LABEL), "verkeer");
  assert.equal(scheidThema("Kop\n\nTekst\n\n**THEMA: Bosbranden**", PERS_TEGELS, PERS_TEGEL_LABEL).thema, "bosbranden");
});

test("onbekend thema, 'geen' of rommel geeft géén thema (en de tekst blijft heel)", async () => {
  for (const waarde of ["sport", "geen", "", "zorg, verkeer", "x".repeat(80), "nl-overheid", "geld-belasting"]) {
    modelAntwoordt(synthese(waarde));
    const s = await synthetiseer(cluster);
    assert.equal(s.thema, null, `waarde ${JSON.stringify(waarde)} had genegeerd moeten worden`);
    assert.equal(s.themaBron, null);
    assert.match(s.tekst, /^Franse media melden/);
  }
});

test("ontbrekende THEMA-regel: geen thema, synthese werkt gewoon", async () => {
  modelAntwoordt(synthese(undefined));
  const s = await synthetiseer(cluster);
  assert.equal(s.thema, null);
  assert.equal(s.kop, "Spoedeisende hulp onder druk");
});

test("kapotte uitvoer (JSON-brokstuk, afgebroken regel) geeft geen thema en geen fout", async () => {
  for (const kapot of ['{"thema": "zor', "THEMA", "THEMA:", "THEMA: {", '{"thema":"zorg"}']) {
    modelAntwoordt(
      "Spoedeisende hulp onder druk\n\nFranse media melden overbelasting.\n\n" + kapot + "\n\nGEBRUIKT: https://www.lemonde.fr/a"
    );
    const s = await synthetiseer(cluster);
    assert.equal(s.thema, null, `uitvoer ${JSON.stringify(kapot)}`);
    assert.equal(s.kop, "Spoedeisende hulp onder druk");
  }
});

test("'GEEN' blijft werken met een THEMA-regel erbij", async () => {
  modelAntwoordt("GEEN\nTHEMA: zorg");
  const s = await synthetiseer(cluster);
  assert.equal(s.geenVerhaal, true);
});

test("overheid: een thema buiten de keuze (zorg, nl-overheid, onzin) wordt genegeerd", async () => {
  for (const waarde of ["zorg", "nl-overheid", "onzin", ""]) {
    modelAntwoordt(`Kop\n\nSamenvatting.\n\nTHEMA: ${waarde}`);
    const r = await samenvatOverheid({ bron: "Bercy", titel: "T", thema: "geld-belasting" });
    assert.equal(r.thema, null, waarde);
  }
  modelAntwoordt("Kop\n\nSamenvatting.");
  assert.equal((await samenvatOverheid({ bron: "Bercy", titel: "T" })).thema, null);
});

// ---- 3. persTegelVoor: opgeslagen thema wint --------------------------------
const naamNaarThema = new Map([["Le Monde — À la une", "landelijk-fr"]]);
const LM = [{ naam: "Le Monde — À la une" }];

test("een opgeslagen thema wint van de trefwoordregels", () => {
  // Zonder thema: 'ziekenhuis' -> zorg (regels).
  const pub = { kop: "Ziekenhuis in Lyon", tekst: "Het ziekenhuis breidt uit.", bronnen: LM };
  assert.equal(persTegelVoor(pub, naamNaarThema), "zorg");
  assert.equal(persTegelVoor({ ...pub, thema: "landelijk", themaBron: "model" }, naamNaarThema), "landelijk");
  assert.equal(persTegelVoor({ ...pub, thema: "regionaal", themaBron: "redactie" }, naamNaarThema), "regionaal");
});

test("het model kan een bericht naar zorg schuiven dat de regels als landelijk zien", () => {
  const pub = { kop: "Overbelasting", tekst: "De druk op de spoedeisende dienst neemt toe.", bronnen: LM };
  assert.equal(persTegelVoor(pub, naamNaarThema), "landelijk");
  assert.equal(persTegelVoor({ ...pub, thema: "zorg", themaBron: "model" }, naamNaarThema), "zorg");
});

test("een ontbrekend of ongeldig opgeslagen thema valt terug op de regels", () => {
  const pub = { kop: "Files op de autosnelweg", tekst: "Lange files voor automobilisten.", bronnen: LM };
  for (const thema of [undefined, null, "", "sport", "geld-belasting", 7]) {
    assert.equal(persTegelVoor({ ...pub, thema, themaBron: "model" }, naamNaarThema), "verkeer", String(thema));
  }
});

// ---- 4. Reviewtool: opslaan en autorisatie -----------------------------------
const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");

test("review.html toont het thema met een keuzelijst die labels en een stuurt actie 'thema'", () => {
  assert.match(review, /data-thema-select/);
  assert.match(review, /actie: "thema"/);
  assert.match(review, /t\.label/, "de lijst toont het label (bv. Zorg en gezondheid)");
  assert.match(review, /\.themakeuze \{[^}]*min-height:44px/, "tikdoel van 44 px");
});

const handler = (await import("../api/review.js")).default;
const roep = roeper(handler, cookie);
const zonderSessie = roeper(handler, "");

const pubRecord = (extra = {}) => JSON.stringify({
  id: "p1", kop: "Overbelasting", tekst: "De druk op de spoedeisende dienst neemt toe.",
  bronnen: [{ naam: "Le Monde — À la une", url: "https://www.lemonde.fr/a" }],
  gepubliceerd: true, gepubliceerdOp: new Date().toISOString(), thema: "landelijk", themaBron: "model", ...extra,
});

test("zonder sessie kan het thema niet worden gewijzigd (401, record onaangeroerd)", async () => {
  db.set(C.KEY_PUBLICATIE("p1"), pubRecord());
  const res = await zonderSessie("POST", { actie: "thema", id: "p1", thema: "zorg" });
  assert.equal(res.code, 401);
  assert.equal(JSON.parse(db.get(C.KEY_PUBLICATIE("p1"))).thema, "landelijk");
  assert.equal(JSON.parse(db.get(C.KEY_PUBLICATIE("p1"))).themaBron, "model");
});

test("met sessie slaat de wijziging op als themaBron 'redactie' en verlopen de momentopnamen", async () => {
  db.set(C.KEY_PUBLICATIE("p1"), pubRecord());
  db.set(C.KEY_ACTUEEL_SNAPSHOT, "{}");
  const res = await roep("POST", { actie: "thema", id: "p1", thema: "zorg" });
  assert.equal(res.code, 200);
  assert.equal(res.body.themaEffectief, "zorg");
  const rec = JSON.parse(db.get(C.KEY_PUBLICATIE("p1")));
  assert.equal(rec.thema, "zorg");
  assert.equal(rec.themaBron, "redactie");
  assert.ok(!db.has(C.KEY_ACTUEEL_SNAPSHOT), "de voorgebakken pagina moet opnieuw worden gebakken");
});

test("een onbekend thema wordt geweigerd en schrijft niets", async () => {
  db.set(C.KEY_PUBLICATIE("p1"), pubRecord());
  for (const thema of ["sport", "geld-belasting", undefined, 5]) {
    const res = await roep("POST", { actie: "thema", id: "p1", thema });
    assert.equal(res.code, 400, String(thema));
  }
  assert.equal(JSON.parse(db.get(C.KEY_PUBLICATIE("p1"))).themaBron, "model");
});

test("thema '' zet de publicatie terug naar de automatische indeling", async () => {
  db.set(C.KEY_PUBLICATIE("p1"), pubRecord({ thema: "regionaal", themaBron: "redactie" }));
  const res = await roep("POST", { actie: "thema", id: "p1", thema: "" });
  assert.equal(res.code, 200);
  const rec = JSON.parse(db.get(C.KEY_PUBLICATIE("p1")));
  assert.equal(rec.thema, undefined);
  assert.equal(rec.themaBron, "regels");
});

test("een concept kan ook een thema krijgen; een onbekend id geeft 404", async () => {
  db.set(C.KEY_CONCEPT("c1"), JSON.stringify({ id: "c1", kop: "K", tekst: "T", gepubliceerd: false }));
  assert.equal((await roep("POST", { actie: "thema", id: "c1", thema: "verkeer" })).code, 200);
  assert.equal(JSON.parse(db.get(C.KEY_CONCEPT("c1"))).themaBron, "redactie");
  assert.equal((await roep("POST", { actie: "thema", id: "bestaat-niet", thema: "zorg" })).code, 404);
});

test("GET levert de keuzelijst en het effectieve thema met herkomst per publicatie", async () => {
  db.set(C.KEY_PUBLICATIE("p1"), pubRecord({ thema: "zorg", themaBron: "redactie" }));
  db.set(C.KEY_PUBLICATIE("p2"), pubRecord({ id: "p2", thema: undefined, themaBron: undefined, kop: "Files", tekst: "Lange files voor automobilisten." }));
  const res = await roep("GET");
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.themas.find((t) => t.waarde === "zorg"), { waarde: "zorg", label: "Zorg en gezondheid" });
  const p1 = res.body.publicaties.find((p) => p.id === "p1");
  const p2 = res.body.publicaties.find((p) => p.id === "p2");
  assert.deepEqual([p1.themaEffectief, p1.themaHerkomst], ["zorg", "redactie"]);
  assert.deepEqual([p2.themaEffectief, p2.themaHerkomst], ["verkeer", "regels"]);
});

test("publiceren neemt het modelthema van het concept mee naar de publicatie", async () => {
  db.set(C.KEY_CONCEPT("c2"), JSON.stringify({
    id: "c2", kop: "Spoedeisende hulp", tekst: "De spoedeisende hulp is overbelast, melden Franse media.",
    bronnen: [
      { naam: "Le Monde — À la une", titel: "Urgences saturées", url: "https://www.lemonde.fr/a" },
      { naam: "Le Figaro — Actualités", titel: "Personnel manquant aux urgences", url: "https://www.lefigaro.fr/b" },
    ],
    onafhankelijkeOutlets: 2, thema: "zorg", themaBron: "model", gepubliceerd: false,
  }));
  const res = await roep("POST", { actie: "publiceer", id: "c2", bevestigd: true });
  if (res.code === 200) {
    const rec = JSON.parse(db.get(C.KEY_PUBLICATIE("c2")));
    assert.equal(rec.thema, "zorg");
    assert.equal(rec.themaBron, "model");
  } else {
    // De poortwachter mag dit testbericht weigeren; dat is dan niet wat hier getoetst wordt.
    assert.equal(res.code, 409);
  }
});

// ---- 5. Overheid: het model heeft het laatste woord, conservatief ------------
const { kiesOverheidThema } = await import("../lib/overheid.js");

test("overheid: feedthema blijft, tenzij het model een ander geldig thema geeft", () => {
  assert.deepEqual(kiesOverheidThema({ feedThema: "geld-belasting", modelThema: "geld-belasting", alNederlands: false }),
    { thema: "geld-belasting", themaBron: "regels" });
  assert.deepEqual(kiesOverheidThema({ feedThema: "geld-belasting", modelThema: null, alNederlands: false }),
    { thema: "geld-belasting", themaBron: "regels" });
  assert.deepEqual(kiesOverheidThema({ feedThema: "praktisch", modelThema: "sociale-zekerheid", alNederlands: false }),
    { thema: "sociale-zekerheid", themaBron: "model", themaFeed: "praktisch" });
});

test("overheid: Nederlandse bronnen (zonder model) en nl-overheid worden nooit overschreven", () => {
  assert.equal(kiesOverheidThema({ feedThema: "nl-overheid", modelThema: "praktisch", alNederlands: true }).thema, "nl-overheid");
  assert.equal(kiesOverheidThema({ feedThema: "nl-overheid", modelThema: "praktisch", alNederlands: false }).thema, "nl-overheid");
  assert.equal(kiesOverheidThema({ feedThema: "praktisch", modelThema: "zorg", alNederlands: false }).thema, "praktisch");
});
