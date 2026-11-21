// Tests van het regelbestand (lib/redactieregels.js), de leesbare versie
// (docs/redactieregels.md), de zeven op de selectiestroom, het leersignaal, het
// meten en de overheidspoort in het scenario van 20-11-2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as R from "../lib/redactieregels.js";
import { SCORE_DREMPEL, SYNTHESE_MIN_BRONNEN } from "../lib/config.js";
import {
  SYSTEM_SELECTIE, zeefDoorlaat, maxPerBron, plekkenVoorSoort, leesModelAntwoord, voorbeeldenVoorModel,
  voorbeeldRegel, bouwInvoer, meetVoorstel, redactieBesluit, CATEGORIEEN, REDENEN,
} from "../lib/selectie/kern.js";
import { SELECTIE_PERS_BRONNEN } from "../lib/selectie/bronnen.js";
import { poortUitslag, verwerkPoort, overheidIsLive } from "../lib/overheidpoort.js";

const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const doc = lees("../docs/redactieregels.md");

test("regelbestand en document zijn gelijk: elke regel-id en elke waarde staat in het document", () => {
  for (const r of R.REGELS) assert.ok(doc.includes(`**${r.id}**`), `regel ${r.id} ontbreekt in docs/redactieregels.md`);
  for (const p of R.PLEKKEN_VIJF) assert.ok(doc.includes(p.naam), `plek ${p.naam} ontbreekt`);
  for (const k of R.RUBRIEKEN) assert.ok(doc.includes(R.RUBRIEK_LABEL[k]), `rubriek ${k} ontbreekt`);
  for (const d of R.CAFE_DOMEINEN) assert.ok(doc.includes(d), `domein ${d} ontbreekt`);
  for (const n of [R.SCORE_DREMPEL, R.LOS_SCORE_DREMPEL, R.MIN_KRANTEN, R.SELECTIE_MAX_PER_BRON, R.VOORBEELDEN_MAX_PER_SOORT, R.METEN_MIN_BESLUITEN, R.METEN_DAGEN]) {
    assert.ok(doc.includes(`\`${n}\``), `waarde ${n} ontbreekt (tussen backticks)`);
  }
  // en andersom: elke R-id in het document bestaat
  for (const m of doc.matchAll(/\*\*(R\d\d)\*\*/g)) assert.ok(R.REGELS.some((r) => r.id === m[1]), `${m[1]} staat in het document maar niet in het regelbestand`);
  // elke regel heeft een herkomst en een status
  for (const r of R.REGELS) { assert.ok(r.herkomst.length > 5); assert.ok(["besloten", "code"].includes(r.status)); }
});

test("één plek: config, prompt, kern en bronnen lezen het regelbestand", () => {
  assert.equal(SCORE_DREMPEL, R.SCORE_DREMPEL);
  assert.equal(SYNTHESE_MIN_BRONNEN, R.MIN_KRANTEN);
  assert.deepEqual(CATEGORIEEN, R.RUBRIEKEN);
  assert.deepEqual(REDENEN, R.REDENEN);
  assert.equal(SELECTIE_PERS_BRONNEN, R.SELECTIE_PERS_BRONNEN);
  // geen tweede lijst meer in de bestanden zelf
  assert.ok(!/const FRANKRIJK_WOORDEN = \[/.test(lees("../lib/selectie/kern.js")));
  assert.ok(!/const FRANKRIJK_TREFWOORDEN = \[/.test(lees("../lib/feeds.js")));
  assert.ok(!/export const SCORE_DREMPEL = \d/.test(lees("../lib/config.js")));
});

test("prompt kent de vijf plekken en zegt dat een los krantenbericht nooit op de nieuwspagina komt", () => {
  for (const id of R.PLEK_IDS) assert.ok(SYSTEM_SELECTIE.includes(`"${id}"`), `prompt noemt ${id} niet`);
  assert.equal(R.PLEK_IDS.length, 5);
  assert.match(SYSTEM_SELECTIE, /los krantenbericht[^.]*NOOIT op de nieuwspagina/);
  assert.ok(!/"nieuwspagina" bij prio 1 tot en met 4 als er genoeg inhoud is voor een eigen tekst; "beide"/.test(SYSTEM_SELECTIE));
  assert.match(SYSTEM_SELECTIE, /geld, bureaucratie, zorg, wonen/);
});

test("een los krantenbericht krijgt nooit nieuwspagina, nieuwsbrief of Infopoche, ook als het model dat voorstelt", () => {
  const items = [{ id: "a1", soort: "pers", titel: "a", peilAangeboden: [] }, { id: "b2", soort: "overheid", titel: "b", peilAangeboden: [] }];
  const ruw = JSON.stringify([
    { nr: 1, score: 90, prio: "1", plekken: ["nieuwspagina", "nieuwsbrief", "infopoche", "zijbalk", "infofrankrijk"], categorie: "regelgeving" },
    { nr: 2, score: 90, prio: "1", plekken: ["nieuwspagina", "nieuwsbrief", "zijbalk"], categorie: "regelgeving" },
  ]);
  const uit = leesModelAntwoord(ruw, items);
  assert.deepEqual(uit.get("a1").plekken, ["zijbalk", "infofrankrijk"]);
  assert.equal(uit.get("a1").plek, "zijbalk");
  assert.deepEqual(uit.get("b2").plekken, ["nieuwspagina", "nieuwsbrief", "zijbalk"]);
  // nieuwsbrief zonder nieuwspagina kan niet
  assert.deepEqual(plekkenVoorSoort("overheid", ["nieuwsbrief", "zijbalk"]), ["zijbalk"]);
  // onder de drempel: nergens
  const laag = leesModelAntwoord(JSON.stringify([{ nr: 1, score: SCORE_DREMPEL - 1, plekken: ["zijbalk"] }]), [items[0]]);
  assert.deepEqual(laag.get("a1").plekken, []);
});

test("losse kranten hebben drempel 70, overheid en meteo houden drempel 40", () => {
  assert.equal(R.LOS_SCORE_DREMPEL, 70);
  assert.equal(R.SCORE_DREMPEL, 40);
  for (const [soort, grens] of [["pers", 70], ["overheid", 40], ["meteo", 40]]) {
    for (const score of [grens - 1, grens]) {
      const item = { id: "grens", soort, titel: "Grensgeval" };
      for (const advies of [{ plekken: ["zijbalk"] }, { plek: "zijbalk" }]) {
        const uit = leesModelAntwoord(JSON.stringify([{ nr: 1, score, ...advies }]), [item]);
        assert.deepEqual(uit.get(item.id).plekken, score < grens ? [] : ["zijbalk"], `${soort}, score ${score}`);
      }
    }
  }
  assert.ok(SYSTEM_SELECTIE.includes(`onder de ${R.LOS_SCORE_DREMPEL}`));
});

test("toetsset: de zeven op de selectiestroom geven de verwachte uitkomst (30 tot 50 verzonnen koppen)", () => {
  const set = JSON.parse(lees("./fixtures/redactie-toetsset.json"));
  assert.ok(set.items.length >= 30 && set.items.length <= 50, `${set.items.length} items`);
  for (const i of set.items) {
    const door = zeefDoorlaat(i) ? "door" : "weg";
    assert.ok(!i.bekendGat, "de bekende gaten zijn gedicht");
    assert.equal(door, i.verwacht, `${i.verwacht} verwacht, ${door} gekregen: ${i.titel}`);
  }
  assert.ok(set.items.some((i) => i.verwacht === "weg") && set.items.some((i) => i.verwacht === "door"));
});

test("maximum per bron: de nieuwste, uitzonderingen per bron instelbaar", () => {
  const maak = (n, bron) => Array.from({ length: n }, (_, k) => ({ bron, titel: `${bron} ${k}`, datum: new Date(Date.UTC(2026, 10, 20, 0, k)).toISOString() }));
  const items = [...maak(100, "Midi Libre"), ...maak(5, "Sud Ouest")];
  const uit = maxPerBron(items, 15, {});
  assert.equal(uit.filter((i) => i.bron === "Midi Libre").length, 15);
  assert.equal(uit.filter((i) => i.bron === "Sud Ouest").length, 5);
  assert.ok(uit.filter((i) => i.bron === "Midi Libre").every((i) => Number(i.titel.split(" ").pop()) >= 85), "de nieuwste 15");
  assert.equal(maxPerBron(items, 15, { "Midi Libre": 30 }).filter((i) => i.bron === "Midi Libre").length, 30);
  assert.equal(maxPerBron(items, 15, {}, () => "feed").length, 15);
  assert.ok(R.SELECTIE_MAX_PER_BRON > 0);
});

const BESLUIT = (o) => ({ besluit: "go", titel: "T", bron: "NOS", besluitOp: "2026-11-20T10:00:00Z", ai: { score: 70, plekken: ["zijbalk"] }, kanalen: ["zijbalk"], categorie: "algemeen", ...o });

test("leersignaal: bron, eigen voorstel, gekozen plekken en reden bij Nee; verschillen eerst; begrensd", () => {
  const nee = BESLUIT({ besluit: "nogo", kanalen: [], reden: "Dubbel", titel: "Dubbel bericht" });
  const regel = voorbeeldRegel(nee);
  assert.match(regel, /NO-GO \[NOS\] Dubbel bericht/);
  assert.match(regel, /voorstel: zijbalk \(score 70\)/);
  assert.match(regel, /gekozen: weg/);
  assert.match(regel, /reden: Dubbel/);
  const go = voorbeeldRegel(BESLUIT({ plekken: ["nieuwspagina", "zijbalk"], titel: "Goed" }));
  assert.match(go, /gekozen: nieuwspagina\+zijbalk/);
  const veel = Array.from({ length: 80 }, (_, k) => BESLUIT({ titel: `B${k}`, besluitOp: new Date(Date.UTC(2026, 10, 1, 0, k)).toISOString() }));
  const verschil = BESLUIT({ titel: "Oud verschil", besluitOp: "2026-10-01T00:00:00Z", plekken: ["nieuwspagina"] });
  const v = voorbeeldenVoorModel([...veel, verschil]);
  assert.equal(v.go.length, R.VOORBEELDEN_MAX_PER_SOORT);
  assert.equal(v.go[0].titel, "Oud verschil", "een besluit waarin voorstel en keuze verschilden gaat voor");
  assert.ok(voorbeeldRegel(BESLUIT({ titel: "x".repeat(900) })).length <= R.VOORBEELD_MAX_TEKENS);
  assert.match(bouwInvoer([{ soort: "pers", bron: "NOS", land: "NL", titel: "Test", peilAangeboden: [] }], { go: [], nogo: [nee] }), /reden: Dubbel/);
});

test("redactieBesluit bewaart de gekozen plekken (voor meten en leren)", () => {
  const b = redactieBesluit({ herkomst: "publicatie", doc: { id: "p1", kop: "K", gepubliceerdOp: "2026-11-20T10:00:00Z" }, kanalen: ["zijbalk"], opPagina: true }).besluit;
  assert.deepEqual(b.plekken, ["zijbalk", "nieuwspagina"]);
  const nee = redactieBesluit({ herkomst: "publicatie", doc: { id: "p2", kop: "K" }, weg: true, zijbalk: false }).besluit;
  assert.deepEqual(nee.plekken, []);
});

test("meten: klopt bij x van y, grens van 7 dagen, tonen pas bij minstens 5 besluiten", () => {
  const nu = Date.parse("2026-11-20T12:00:00Z");
  const klopt = BESLUIT({});
  const kloptNiet = BESLUIT({ plekken: ["nieuwspagina"] });
  const oud = BESLUIT({ besluitOp: "2026-11-01T10:00:00Z", plekken: ["nieuwspagina"] });
  const zonderVoorstel = BESLUIT({ ai: null });
  const vier = meetVoorstel([klopt, klopt, kloptNiet, klopt, oud, zonderVoorstel], nu);
  assert.deepEqual([vier.klopt, vier.totaal, vier.tonen], [3, 4, false]);
  const vijf = meetVoorstel([klopt, klopt, kloptNiet, klopt, klopt], nu);
  assert.deepEqual([vijf.klopt, vijf.totaal, vijf.tonen], [4, 5, true]);
  // weg voorgesteld en Nee gekozen klopt ook
  assert.equal(meetVoorstel([BESLUIT({ besluit: "nogo", kanalen: [], ai: { score: 10, plek: "weg" } })], nu).klopt, 1);
  const html = lees("../redactie.html");
  assert.match(html, /Deze week klopte het voorstel bij/);
  assert.match(html, /m\.tonen/);
  assert.match(lees("../api/selectie.js"), /meting: meetVoorstel\(besluiten\)/);
});

// ---- Punt 0: het live-scenario van 20-11-2026 -----------------------------------
const NU = Date.parse("2026-11-20T17:07:00Z");
const RIJK = (id, kop) => ({ id, url: `https://www.rijksoverheid.nl/actueel/nieuws/2026/11/20/${id}`, kop, bron: "Rijksoverheid — Nieuws", thema: "nl-overheid", samenvatting: "x", datum: "2026-11-20T12:30:00Z", gepubliceerdOp: "2026-11-20T12:35:00Z" });
const KOPPEN = ["Openstelling burgemeestersvacature Lingewaard", "Zr.Ms. Evertsen helpt schepen beschermen in de Rode Zee", "Kabinet zet werk en meedoen centraal in de Participatiewet", "Benoeming directeur-generaal Digitaliseringsbeleid"];

test("live-scenario: overheidsdocs van vóór de poort (geen poortveld) zijn NIET live", () => {
  const docs = KOPPEN.map((k, i) => RIJK(`r${i}`, k));
  assert.ok(docs.every((d) => !overheidIsLive(d)), "zonder poortveld is een doc niet live");
  assert.ok(!overheidIsLive({ ...docs[0], poort: { status: "wacht" } }));
  assert.ok(overheidIsLive({ ...docs[0], poort: { status: "ok", door: "model", score: 60 } }));
});

test("live-scenario: zonder score, met score onder de drempel en zonder redactiekeuze blijft alles achter de poort; de poort schrijft het op", async () => {
  const docs = KOPPEN.map((k, i) => RIJK(`r${i}`, k));
  const kandidaten = [{ id: "k1", url: docs[0].url, ai: { score: 25 } }, { id: "k2", url: docs[1].url, ai: { score: 39 } }, { id: "k3", url: docs[2].url, ai: null }];
  const opslag = new Map(docs.map((d) => [d.id, structuredClone(d)]));
  const tel = await verwerkPoort(docs, { kandidaten, besluiten: [] }, {
    lees: async (d) => structuredClone(opslag.get(d.id)),
    schrijf: async (d) => { opslag.set(d.id, structuredClone(d)); },
    verwijder: async () => {}, afgewezen: async () => {},
  }, NU);
  assert.equal(tel.wacht, 4);
  assert.equal(tel.ok, 0);
  assert.ok([...opslag.values()].every((d) => d.poort.status === "wacht" && !overheidIsLive(d)));
  // een tweede ronde wijzigt niets meer
  const again = await verwerkPoort([...opslag.values()], { kandidaten, besluiten: [] }, { lees: async (d) => d, schrijf: async () => { throw new Error("niet schrijven"); }, verwijder: async () => {}, afgewezen: async () => {} }, NU);
  assert.equal(again.gewijzigd, 0);
});

test("live-scenario (keuze A): een overheidsbericht dat NL'ers in het buitenland raakt gaat vanzelf live", () => {
  const d = RIJK("r9", "AOW voor Nederlanders in Frankrijk verandert");
  assert.equal(poortUitslag(d, { kandidaten: [{ url: d.url, ai: { score: SCORE_DREMPEL } }] }).status, "ok");
  assert.equal(poortUitslag(d, { kandidaten: [{ url: d.url, ai: { score: 5 } }] }).status, "ok");
  assert.equal(poortUitslag(d, {}).status, "ok");
  const weg = { besluit: "nogo", redactie: { reviewId: d.id, weg: true } };
  assert.equal(poortUitslag(d, { besluiten: [weg] }).status, "afgewezen");
});

test("de cron en /api/actueel kennen geen 'zonder poortveld = live' meer", () => {
  assert.ok(!/!d\.poort \|\| d\.poort\.status === "ok"/.test(lees("../api/cron.js")));
  assert.match(lees("../api/cron.js"), /\[cron\] overheidpoort: ok=/);
  assert.match(lees("../lib/antwoord.js"), /overheidDocs\.filter\(overheidIsLive\)/);
});

test("R17: Rijksoverheid-berichten van 20-11 komen ook bij een hoge modelscore niet live, behalve wat Nederlanders in het buitenland raakt", () => {
  const set = JSON.parse(lees("./fixtures/redactie-toetsset.json"));
  assert.equal(set.overheid.filter((o) => o.verwacht === "wacht").length, 15);
  for (const o of set.overheid) {
    if (o.verwacht === "twijfel") continue;
    const d = { id: "x", url: "https://www.rijksoverheid.nl/actueel/nieuws/2026/11/20/x", thema: "nl-overheid", kop: o.kop, samenvatting: o.samenvatting };
    const u = poortUitslag(d, { kandidaten: [{ url: d.url, ai: { score: 90 } }] });
    assert.equal(u.status === "ok" ? "ok" : "wacht", o.verwacht, o.kop);
  }
  // een franse overheidsbron valt hier niet onder
  assert.equal(poortUitslag({ id: "f", url: "https://www.service-public.gouv.fr/a", thema: "geld-belasting", kop: "Nieuwe regels", samenvatting: "x" }, { kandidaten: [{ url: "https://www.service-public.gouv.fr/a", ai: { score: 60 } }] }).status, "ok");
  assert.ok(R.REGELS.some((r) => r.id === "R17"));
  assert.match(SYSTEM_SELECTIE, /Nederlands binnenlands nieuws en bestuur/);
  assert.match(SYSTEM_SELECTIE, /Caribisch Nederland altijd/);
});

test("synthese zonder AI-oordeel: standaard alleen zijbalk en Infofrankrijk", () => {
  const html = lees("../redactie.html");
  assert.match(html, /if \(!it\.ai && \(it\.soort === "concept"[^\n]*k\.zijbalk = true; k\.infofrankrijk = true; return schoon/);
  assert.match(html, /voorstel: ai && ai\.plek \? ai\.plek : "zijbalk", altijd: true/);
  assert.ok(!/ai\.plek : "beide"/.test(html));
});

// ---- Herstelronde 1 op PR 79 ------------------------------------------------------
const OKDOC = (o) => ({ id: "x", url: "https://www.rijksoverheid.nl/actueel/nieuws/2026/11/20/x", thema: "nl-overheid", kop: o.kop, samenvatting: o.samenvatting, poort: { status: "ok", score: 80, door: "model" } });

test("R17 geldt ook voor wat al ok door model staat; plaatsing door de redactie blijft staan", () => {
  const set = JSON.parse(lees("./fixtures/redactie-toetsset.json"));
  for (const o of set.overheid) {
    if (o.verwacht === "twijfel") continue;
    assert.equal(poortUitslag(OKDOC(o), {}).status, o.verwacht === "ok" ? "ok" : "wacht", o.kop);
  }
  const door = { ...OKDOC(set.overheid[0]), poort: { status: "ok", door: "redactie", keuze: true } };
  assert.equal(poortUitslag(door, {}).status, "ok");
});

const VIJF = ["Zr.Ms. Evertsen", "Kabinet zet werk en meedoen", "Benoeming directeur-generaal", "Openstelling burgemeestersvacature", "IBO-onderzoek"];

test("de vijf Rijksoverheid-berichten van 20-11: niet live als ok door model, door redactie zonder keuze of via oud selectie-go", () => {
  const set = JSON.parse(lees("./fixtures/redactie-toetsset.json"));
  const vijf = VIJF.map((k) => set.overheid.find((o) => o.kop.startsWith(k)));
  assert.ok(vijf.every(Boolean));
  for (const o of vijf) {
    assert.equal(poortUitslag(OKDOC(o), {}).status, "wacht", `ok door model: ${o.kop}`);
    assert.equal(poortUitslag({ ...OKDOC(o), poort: { status: "ok", score: 55, door: "model" } }, {}).status, "wacht", `score 55: ${o.kop}`);
    assert.equal(poortUitslag({ ...OKDOC(o), poort: { status: "ok", score: 55, door: "redactie" } }, {}).status, "wacht", `redactie zonder keuze: ${o.kop}`);
  }
});

test("R17 streng: losse buitenlandse namen en Buitenlandse Zaken tellen niet; AOW, pensioen en zorgverzekering alleen voor wie in het buitenland woont", () => {
  assert.equal(R.raaktBuitenland("Zr.Ms. Evertsen in de Rode Zee, overleg met Buitenlandse Zaken, Franse schepen"), false);
  assert.equal(R.raaktBuitenland("Een DG die eerder in het buitenland bij een ambassade werkte"), false);
  assert.equal(R.raaktBuitenland("Militairen in het buitenland ingezet, bedrijven naar het buitenland"), false);
  assert.equal(R.raaktBuitenland("Erfbelasting in het buitenland"), true);
  assert.equal(R.raaktBuitenland("Nederlandse ambassade Parijs"), true);
  assert.equal(R.raaktBuitenland("Consulaire dienstverlening in Parijs"), true);
  assert.equal(R.raaktBuitenland("Armoede bij ouderen, AOW en pensioen"), false);
  assert.equal(R.raaktBuitenland("Nederlanders in de zorg"), false);
  assert.equal(R.raaktBuitenland("AOW voor wie in het buitenland woont"), true);
  assert.equal(R.raaktBuitenland("Zorgverzekering voor Nederlanders in Frankrijk"), true);
  assert.equal(R.raaktBuitenland("Nieuwe grensregeling"), true);
  assert.equal(R.raaktBuitenland("Remigratie neemt toe"), true);
});

test("R17-kenmerken: zorgverzekering telt; pensioen en verdrag alleen met buitenlandcontext", () => {
  assert.equal(R.raaktBuitenland("Zorgverzekering: premie stijgt"), false);
  assert.equal(R.raaktBuitenland("Zorgverzekering in verdragsland: premie stijgt"), true);
  assert.equal(R.raaktBuitenland("Pensioenakkoord voor ambtenaren"), false);
  assert.equal(R.raaktBuitenland("Verdrag tussen Nederland en Italië over grondstoffen"), false);
  assert.equal(R.raaktBuitenland("Pensioen van Nederlanders in Frankrijk"), true);
  assert.equal(R.raaktBuitenland("Pensioen en AOW over de grens"), true);
});

test("de zeven: woordgrenzen voor korte termen; deze koppen komen door", () => {
  const door = [["Mutuelles : les tarifs vont augmenter", "FR"], ["Prix du gazole actuellement", "FR"], ["Frontière fermée au Perthus", "FR"], ["Spanje sluit grens bij Le Perthus", "NL"], ["Drogue : la France lance un plan national", "FR"], ["Cambriolages : conseils avant les vacances", "FR"]];
  for (const [titel, land] of door) assert.equal(zeefDoorlaat({ titel, land }), true, titel);
  const weg = [["Un homme tué à Marseille", "FR"], ["Femme violée à Lyon", "FR"], ["Rixe à Nîmes : trois blessés", "FR"]];
  for (const [titel, land] of weg) assert.equal(zeefDoorlaat({ titel, land }), false, titel);
  const set = JSON.parse(lees("./fixtures/redactie-toetsset.json"));
  for (const [titel] of door) assert.ok(set.items.some((i) => i.titel === titel && i.verwacht === "door"), `${titel} staat in de toetsset`);
});

test("een synthese leidt zijn voorstel los af en het besluit meet tegen het getoonde voorstel", () => {
  const html = lees("../redactie.html");
  assert.match(html, /it\.soort === "concept" \|\| it\.soort === "publicatie"\) \{\s*var laag/);
  assert.match(html, /function voorstelLijst\(it\)/);
  assert.ok((html.match(/voorstel: voorstelLijst\(it\)/g) || []).length >= 4);
  // getoond voorstel gaat voor het modelvoorstel
  const b = BESLUIT({ voorstelPlekken: ["nieuwspagina", "zijbalk"], plekken: ["nieuwspagina", "zijbalk"], ai: { score: 70, plek: "zijbalk" } });
  assert.equal(meetVoorstel([b], Date.parse("2026-11-20T12:00:00Z")).klopt, 1);
  // een gepubliceerde synthese heeft nieuwspagina in plekken
  const p = redactieBesluit({ herkomst: "publicatie", doc: { id: "p3", kop: "K" }, kanalen: [], zijbalk: false, elders: false, voorstelLijst: ["nieuwspagina"] }).besluit;
  assert.ok(p.plekken.includes("nieuwspagina"));
  assert.deepEqual(p.voorstelPlekken, ["nieuwspagina"]);
});

// ---- Vervolg: /redactie bij een R17-bericht --------------------------------------
test("R17 op /redactie: de poort legt de reden vast en het voorstel is Nee, met de reden uit de API", async () => {
  const d = { id: "r17", url: "https://www.rijksoverheid.nl/actueel/nieuws/2026/11/20/r17", thema: "nl-overheid", kop: "Benoeming directeur-generaal", samenvatting: "Een benoeming.", gepubliceerdOp: "2026-11-20T08:00:00Z" };
  const u = poortUitslag(d, { kandidaten: [{ url: d.url, ai: { score: 80 } }] });
  assert.equal(u.status, "wacht");
  assert.equal(u.reden, "r17");
  // verwerkPoort schrijft de reden op, ook bij een doc dat al op wacht stond
  const opslag = new Map([[d.id, { ...d, poort: { status: "wacht", score: null, door: null } }]]);
  const tel = await verwerkPoort([opslag.get(d.id)], { kandidaten: [{ url: d.url, ai: { score: 80 } }], besluiten: [] }, {
    lees: async (x) => structuredClone(opslag.get(x.id)), schrijf: async (x) => { opslag.set(x.id, structuredClone(x)); }, verwijder: async () => {}, afgewezen: async () => {},
  }, NU);
  assert.equal(tel.gewijzigd, 1);
  assert.equal(opslag.get(d.id).poort.reden, "r17");
  // de pagina: geen eigen lijst of tekst, het voorstel is Nee
  const html = lees("../redactie.html");
  assert.match(html, /function r17\(it\)[^\n]*poort\.reden === "r17"/);
  assert.match(html, /if \(r17\(it\)\) return \{\}/);
  assert.match(html, /R17_REDEN = rg\.r17Reden/);
  assert.match(html, /var advies = r17\(it\) \? "Nee" : lijstTekst\(vk\);/);
  assert.match(html, /if \(it && r17\(it\)\) \{ besluit\(it, \{ soort: "nee"/);
  assert.ok(!html.includes(R.R17_REDEN), "de redentekst staat niet in de pagina zelf");
  assert.match(lees("../api/selectie.js"), /r17Reden: R17_REDEN/);
  assert.equal(R.R17_REDEN, "Nederlands binnenlands nieuws, raakt Nederlanders in het buitenland niet");
});

test("R17 blijft staan over twee rondes, ook als de gekoppelde kandidaat uit het venster is (Codex P2 PR 80)", async () => {
  const d = { id: "r18", url: "https://www.rijksoverheid.nl/actueel/nieuws/2026/11/20/r18", thema: "nl-overheid", kop: "Benoeming directeur-generaal", samenvatting: "Een benoeming.", gepubliceerdOp: "2026-11-20T08:00:00Z", poort: { status: "ok", score: 80, door: "model" } };
  const opslag = new Map([[d.id, structuredClone(d)]]);
  const io = { lees: async (x) => structuredClone(opslag.get(x.id)), schrijf: async (x) => { opslag.set(x.id, structuredClone(x)); }, verwijder: async () => {}, afgewezen: async () => {} };
  // ronde 1: kandidaat nog in het venster
  await verwerkPoort([opslag.get(d.id)], { kandidaten: [{ url: d.url, ai: { score: 80 } }], besluiten: [] }, io, NU);
  assert.equal(opslag.get(d.id).poort.reden, "r17");
  // ronde 2: geen kandidaat meer, dus geen score
  const tel = await verwerkPoort([opslag.get(d.id)], { kandidaten: [], besluiten: [] }, io, NU + 3600e3);
  assert.equal(opslag.get(d.id).poort.status, "wacht");
  assert.equal(opslag.get(d.id).poort.reden, "r17", "de markering blijft bij ontbrekende score");
  assert.equal(opslag.get(d.id).poort.score, 80);
  assert.equal(tel.gewijzigd, 0);
  // maar een bericht dat inmiddels wel het buitenland raakt, verliest de markering
  const nieuw = { ...opslag.get(d.id), kop: "Pensioen van Nederlanders in Frankrijk" };
  assert.notEqual(poortUitslag(nieuw, {}).reden, "r17");
});

const ZES = ["Benoeming directeur-generaal", "Participatiewet", "burgemeestersvacature Lingewaard", "Zr.Ms. Evertsen", "Economische ministeries op Salon des maires", "IBO-onderzoek"];

test("de zes berichten van de live-controle 19:07 zijn niet live, hoe ze ook gestempeld staan", () => {
  const set = JSON.parse(lees("./fixtures/redactie-toetsset.json"));
  for (const k of ZES) {
    const o = set.overheid.find((x) => x.kop.includes(k) && x.verwacht === "wacht");
    assert.ok(o, k);
    const d = { id: "z", url: "https://www.rijksoverheid.nl/actueel/nieuws/2026/11/20/z", thema: "nl-overheid", kop: o.kop, samenvatting: o.samenvatting };
    const nietLive = (poort, ctx = {}) => assert.equal(poortUitslag({ ...d, poort }, ctx).status, "wacht", `${k}: ${JSON.stringify(poort)}`);
    nietLive({ status: "ok", score: 2, door: "redactie" });
    nietLive({ status: "ok", score: 5, door: "redactie" });
    nietLive({ status: "ok", score: 55, door: "model" });
    nietLive({ status: "wacht" }, { besluiten: [{ besluit: "go", redactie: { reviewId: "z", herkomst: "overheid", nieuwspagina: true } }] });
    nietLive({ status: "ok", score: 3, door: "redactie" }, { besluiten: [{ besluit: "go", redactie: { reviewId: "z", herkomst: "overheid", nieuwspagina: true } }] });
    nietLive({ status: "wacht" }, { besluiten: [{ besluit: "go", url: d.url, kanalen: ["zijbalk"] }], kandidaten: [{ url: d.url, ai: { score: 55 } }] });
    assert.equal(poortUitslag({ ...d }, { besluiten: [{ besluit: "nogo", redactie: { reviewId: "z", herkomst: "overheid" } }] }).status, "wacht");
  }
});

test("buitenlandKenmerk: gelden-per-zin en het kenmerk is benoembaar (voor de cron-log)", () => {
  assert.equal(R.buitenlandKenmerk("De AOW en het pensioen zijn goed. In het buitenland ligt dat anders."), null);
  assert.match(R.buitenlandKenmerk("AOW voor wie in het buitenland woont"), /buitenland/);
  assert.equal(R.buitenlandKenmerk("Zr.Ms. Evertsen in de Rode Zee"), null);
});

test("R17 zinsgrens: kop telt mee met de eerste zin van de samenvatting; afkortingen breken geen zin", () => {
  assert.ok(R.raaktBuitenland("Kabinet past AOW aan.", "Ook in het buitenland."));
  assert.ok(R.raaktBuitenland("Pensioen", "Uitbetaling aan gepensioneerden in het buitenland"));
  // verder in de samenvatting (niet de eerste zin) telt niet
  assert.ok(!R.raaktBuitenland("Kabinet past AOW aan", "Het kabinet wil dit snel regelen. Ook in het buitenland is er aandacht."));
  // afkortingen en datums
  assert.ok(R.raaktBuitenland("Nieuwe regels", "De AOW is o.a. aangepast voor wie in het buitenland woont."));
  assert.equal(R.raaktBuitenland("Zr.Ms. Evertsen helpt schepen", "Het schip is op 20.11.2026 in het buitenland ingezet."), false);
  assert.equal(R.raaktBuitenland("Pensioen en AOW", "Op 20.11.2026 besloten. Ministers zijn in het buitenland."), false);
  assert.ok(R.buitenlandKenmerk("AOW", "Voor wie ca. 20.5 jaar in het buitenland woont, ook o.a. in Frankrijk."));
});

test("redactie.html: overheid, ook onder 'Al automatisch live', stuurt de echte nieuwspagina-keuze en live:true mee", () => {
  const html = lees("../redactie.html");
  assert.match(html, /opPagina: it\.soort === "overheid" \|\| it\.wacht \? !!k\.nieuwspagina : true/);
  assert.match(html, /live: !weg && \(it\.soort === "overheid" \|\| it\.wacht\) && k\.nieuwspagina \? true : undefined/);
});
