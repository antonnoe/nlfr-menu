import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { PLEKKEN_VIJF, RUBRIEKEN, RUBRIEK_LABEL, REDENEN, LOS_TEKST } from "../lib/redactieregels.js";

const html = fs.readFileSync(new URL("../redactie.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const regels = { plekken: PLEKKEN_VIJF, rubrieken: RUBRIEKEN.map((key) => ({ key, label: RUBRIEK_LABEL[key] })), redenen: REDENEN, losTekst: LOS_TEKST };

// De echte paginacode, met alleen netwerk, klok en DOM-randen vervangen.
// Geen browser of nieuwe afhankelijkheid nodig voor de beslis- en timerregels.
async function scherm({ fout = false, traag = false } = {}) {
  let nu = Date.parse("2026-11-21T08:00:00Z"), timerNr = 0, voltooi;
  const timers = new Map(), listeners = {}, elements = new Map(), posts = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: "", textContent: "", hidden: false, style: {},
      addEventListener() {}, querySelectorAll() { return []; },
      querySelector(s) { return s === ".t" || s === "button" ? element(id + s) : null; },
      insertAdjacentHTML(_, s) { this.innerHTML += s; },
    });
    return elements.get(id);
  };
  const document = {
    visibilityState: "visible", getElementById: element, querySelector() { return null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  class Klok extends Date {
    constructor(...args) { super(...(args.length ? args : [nu])); }
    static now() { return nu; }
  }
  const iso = new Klok().toISOString();
  const pers = (id, score) => ({ id, soort: "pers", titel: id, bron: "Krant", url: `https://krant.example/${id}`, datum: iso, ai: { score, plekken: ["zijbalk", "infofrankrijk"] } });
  const rev = {
    ok: true,
    concepten: [
      { id: "synthese", kop: "Eigen synthese", tekst: "Eigen tekst zonder herhaling.", aangemaaktOp: iso, bronnen: [], poort: { publiceerbaar: true } },
      { id: "laag", kop: "Synthese lage score", tekst: "Andere tekst", aangemaaktOp: iso, bronnen: [{ url: "https://krant.example/laag-bron" }], poort: { publiceerbaar: true } },
    ],
    overheid: [{ id: "overheid", kop: "Overheidsbericht", samenvatting: "Uitleg", url: "https://www.service-public.gouv.fr/test", gepubliceerdOp: iso, poort: { status: "wacht" } }],
    publicaties: [{ id: "publicatie", kop: "Al verschenen synthese", tekst: "Gepubliceerde tekst", gepubliceerdOp: iso, bronnen: [] }],
  };
  const sel = { ok: true, drempel: 40, losDrempel: 70, regels, kandidaten: [pers("krant98", 98), pers("krant70", 70), pers("krant69", 69), pers("laag-bron", 20), { ...pers("weer", 65), soort: "meteo" }] };
  const context = vm.createContext({
    document, window: { addEventListener() {} }, location: {}, URL, Date: Klok,
    setTimeout(fn, ms) { timers.set(++timerNr, { fn, op: nu + ms }); return timerNr; },
    clearTimeout(id) { timers.delete(id); }, setInterval() {},
    fetch: async (pad, opties) => {
      if (!opties.method) return { status: 200, json: async () => pad === "/api/review" ? rev : sel };
      posts.push({ pad, body: JSON.parse(opties.body), keepalive: opties.keepalive });
      if (traag) await new Promise((resolve) => { voltooi = resolve; });
      return { status: fout ? 503 : 200, json: async () => fout ? { ok: false, fout: "Opslag niet bereikbaar" } : { ok: true, besluit: { id: JSON.parse(opties.body).id } } };
    },
  });
  const extra = "window.__redactie = { st: st, tekenLijst: tekenLijst, itemHtml: itemHtml, voorstelK: voorstelK };";
  vm.runInContext(script.replace("window.__redactie = { st: st };", extra), context);
  const rustig = () => new Promise((resolve) => setImmediate(resolve));
  await rustig();
  return {
    ...context.window.__redactie, posts, elements, rustig,
    click(dataset) {
      const button = { dataset };
      const event = { target: { closest: (s) => s === "button" ? button : null }, preventDefault() {}, stopPropagation() {} };
      for (const fn of listeners.click) fn(event);
    },
    async verder(ms) {
      const eind = nu + ms;
      for (;;) {
        const volgende = [...timers].filter(([, t]) => t.op <= eind).sort((a, b) => a[1].op - b[1].op)[0];
        if (!volgende) break;
        timers.delete(volgende[0]); nu = volgende[1].op; volgende[1].fn(); await rustig();
      }
      nu = eind; await rustig();
    },
    achtergrond() { document.visibilityState = "hidden"; for (const fn of listeners.visibilitychange) fn(); },
    input(dataset, value) {
      const target = { dataset, value, style: {}, scrollHeight: 180 };
      for (const fn of listeners.input) fn({ target });
      return target;
    },
    voltooi() { voltooi(); },
  };
}

test("redactie: syntheses zonder of met lage score en overheid gaan voor krant 98", async () => {
  const s = await scherm(), lijst = s.elements.get("lijst").innerHTML;
  for (const id of ["synthese", "laag", "publicatie", "overheid"]) {
    assert.ok(lijst.indexOf(`data-item="${id}"`) < lijst.indexOf('data-item="krant98"'), id);
  }
  assert.ok(lijst.indexOf('data-item="krant98"') < lijst.indexOf('data-item="krant70"'));
});

test("redactie: bestaande losse krant 69 verdwijnt uit de werklijst, 70 en meteo 65 blijven", async () => {
  const s = await scherm();
  assert.equal(s.st.lijst.some((i) => i.id === "krant69"), false);
  assert.equal(s.st.nietAi.some((i) => i.id === "krant69"), true);
  for (const id of ["krant70", "weer", "synthese", "laag", "overheid"]) assert.ok(s.st.lijst.some((i) => i.id === id), id);
});

test("redactie: advies staat buiten de afgekapt weergegeven bronregel", async () => {
  const s = await scherm(), it = s.st.lijst.find((i) => i.id === "publicatie"), uit = s.itemHtml(it);
  assert.match(uit, /class="advies">Advies: <b>Nieuwspagina, nieuwsbrief en Infopoche<\/b>/);
  assert.ok(uit.indexOf('class="advies"') > uit.indexOf('</span></button>'));
});

test("redactie: tot vijf seconden geen opslag, Ongedaan maken voorkomt iedere POST", async () => {
  const s = await scherm();
  s.click({ nee: "synthese" });
  await s.verder(4999);
  assert.equal(s.posts.length, 0);
  assert.equal(s.st.besluit.synthese.status, "wacht");
  s.click({ terug: "synthese" });
  await s.verder(10);
  assert.equal(s.posts.length, 0);
  assert.equal(s.st.besluit.synthese, undefined);
});

test("redactie: na vijf seconden opslaan en onder Gedaan, de werklijst bevat het bericht niet meer", async () => {
  const s = await scherm();
  s.click({ ja: "krant98" });
  await s.verder(5000);
  assert.equal(s.posts.length, 1);
  assert.equal(s.st.besluit.krant98.status, "klaar");
  assert.equal(s.elements.get("gedaan").hidden, false);
  assert.equal(s.elements.get("gedaan-n").textContent, 1);
  s.tekenLijst();
  assert.ok(!s.elements.get("lijst").innerHTML.includes('data-item="krant98"'));
  assert.ok(s.elements.get("gedaan-lijst").innerHTML.includes('data-item="krant98"'));
});

test("redactie: trage opslag blijft zichtbaar en wordt pas na bevestiging Gedaan", async () => {
  const s = await scherm({ traag: true });
  s.click({ ja: "krant98" });
  await s.verder(5000);
  assert.equal(s.st.besluit.krant98.status, "bezig");
  assert.equal(s.elements.get("gedaan").hidden, true);
  s.voltooi(); await s.rustig();
  assert.equal(s.st.besluit.krant98.status, "klaar");
});

test("redactie: opslagfout brengt de keuze terug met een zichtbare fout en zonder Gedaan", async () => {
  const s = await scherm({ fout: true });
  s.click({ nee: "synthese" });
  await s.verder(5000);
  assert.equal(s.st.besluit.synthese, undefined);
  assert.equal(s.st.fout.synthese.tekst, "Opslag niet bereikbaar");
  assert.equal(s.elements.get("gedaan").hidden, true);
  assert.match(s.itemHtml(s.st.bewaard.synthese), /role="alert"/);
});

test("redactie: terug naar de achtergrond verkort de vijf seconden niet", async () => {
  const s = await scherm();
  s.click({ nee: "synthese" });
  await s.verder(1000); s.achtergrond();
  assert.equal(s.posts.length, 0);
  await s.verder(3999);
  assert.equal(s.posts.length, 0);
  s.click({ terug: "synthese" });
  await s.verder(1);
  assert.equal(s.posts.length, 0);
});

test("redactie: Rest telt en weigert uitsluitend open losse kranten", async () => {
  const s = await scherm();
  assert.equal(s.elements.get("rest").textContent, "Rest van vandaag: nee (2)");
  s.click({ rest: "1" });
  assert.deepEqual(Object.keys(s.st.besluit).sort(), ["krant70", "krant98"]);
  assert.equal(s.elements.get("rest").disabled, true);
  await s.verder(5000);
  assert.deepEqual(s.posts.map((p) => p.body.id).sort(), ["krant70", "krant98"]);
  assert.ok(s.posts.every((p) => p.pad === "/api/selectie" && p.body.actie === "nogo"));
});

test("redactie: Rest bovenaan en de hele bulkkeuze ongedaan maken zonder opslag", async () => {
  const s = await scherm(), romp = s.elements.get("romp").innerHTML;
  assert.ok(romp.indexOf('id="rest"') < romp.indexOf('id="lijst"'));
  s.click({ rest: "1" });
  await s.verder(1000); s.click({ toastTerug: "1" });
  await s.verder(5000);
  assert.equal(s.posts.length, 0);
  assert.equal(Object.keys(s.st.besluit).length, 0);
});

test("redactie: Anders bevat de bewerkbare kop en tekst slechts eenmaal en precies vijf plekknoppen", async () => {
  const s = await scherm(), it = s.st.lijst.find((i) => i.id === "synthese");
  s.click({ anders: it.id });
  const uit = s.itemHtml(it);
  assert.equal(uit.split("Eigen synthese").length - 1, 1);
  assert.equal(uit.split("Eigen tekst zonder herhaling.").length - 1, 1);
  assert.equal((uit.match(/data-plek=/g) || []).length, 5);
  assert.ok(!uit.includes('class="voorstel"'));
  assert.ok(!uit.includes('<small>'));
});

test("redactie: in Anders blijven de drie verboden plekken voor een losse krant uitgeschakeld", async () => {
  const s = await scherm(), it = s.st.lijst.find((i) => i.id === "krant98");
  s.click({ anders: it.id });
  const uit = s.itemHtml(it);
  for (const plek of ["nieuwspagina", "nieuwsbrief", "infopoche"]) {
    assert.match(uit, new RegExp(`data-plek="${plek}"[^>]* disabled`));
    s.click({ plek, id: it.id });
    assert.equal(s.st.cn[it.id].k[plek], false);
  }
  assert.match(uit, /Eén krant: volgens de huisregel/);
});

test("redactie: getypte tekst groeit mee en blijft bewaard als een ander bericht naar Gedaan gaat", async () => {
  const s = await scherm(), it = s.st.lijst.find((i) => i.id === "synthese");
  s.click({ anders: it.id }); s.itemHtml(it);
  s.input({ kop: it.id }, "Mijn eigen kop");
  const veld = s.input({ tekst: it.id }, "Mijn aangepaste tekst\nmet een tweede alinea.");
  assert.equal(veld.style.height, "182px");
  s.click({ ja: "krant98" }); await s.verder(5000);
  assert.equal(s.st.cn[it.id].kop, "Mijn eigen kop");
  assert.equal(s.st.cn[it.id].tekst, "Mijn aangepaste tekst\nmet een tweede alinea.");
  assert.match(s.itemHtml(it), /Mijn aangepaste tekst/);
});

test("redactie: Wijzig haalt een opgeslagen keuze uit Gedaan en bewaart de gekozen plekken", async () => {
  const s = await scherm();
  s.click({ ja: "krant98" }); await s.verder(5000);
  s.click({ wijzig: "krant98" });
  assert.equal(s.st.besluit.krant98, undefined);
  assert.equal(s.st.open.krant98, true);
  assert.equal(s.st.cn.krant98.k.zijbalk, true);
  assert.equal(s.elements.get("gedaan").hidden, true);
  assert.equal(s.elements.get("gedaan-n").textContent, 0);
});
