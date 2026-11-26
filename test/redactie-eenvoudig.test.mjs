// Het eenvoudige redactiescherm (26-11-2026): de echte paginacode in een vm, met alleen netwerk,
// klok en DOM-randen vervangen. Toetst de lijst, het geopende bericht, het verbeterscherm en de PEIL-kaarten.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../redactie.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const NU = Date.parse("2026-11-26T12:30:00Z");
const iso = (uur, min = 0) => new Date(Date.UTC(2026, 10, 26, uur, min)).toISOString();

const bericht = (id, extra = {}) => ({ id, kop: "Kop " + id, samenvatting: "Samenvatting " + id, categorie: "algemeen", soort: "pers", geplaatst: true, gepubliceerdOp: iso(10), kanalen: { actueel: true, nieuwsbrief: true, infopoche: true, zijbalk: true, infofrankrijk: true }, bronnen: [{ naam: "A", datum: iso(9) }, { naam: "B", datum: iso(9) }], ...extra });

async function scherm({ motor, regie, posts = [] } = {}) {
  const els = new Map(), luisteraars = {};
  const el = (id) => { if (!els.has(id)) els.set(id, { id, innerHTML: "", textContent: "", hidden: false, value: "", classList: { add() {}, remove() {} } }); return els.get(id); };
  class Klok extends Date { constructor(...a) { super(...(a.length ? a : [NU])); } static now() { return NU; } }
  const geschiedenis = { state: null, pushState(s) { this.state = s; }, replaceState(s) { this.state = s; }, back() {} };
  const ctx = vm.createContext({
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {} } }, visibilityState: "visible", addEventListener(t, f) { (luisteraars[t] ||= []).push(f); } },
    window: { addEventListener(t, f) { (luisteraars["w:" + t] ||= []).push(f); }, scrollTo() {}, confirm: () => true },
    history: geschiedenis, location: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URL, Date: Klok, Promise, JSON, Object, Array, String, Number, Math, isNaN, encodeURIComponent,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async (pad, o = {}) => {
      const body = o.body ? JSON.parse(o.body) : null;
      if (o.method === "POST") {
        posts.push({ pad, body });
        if (pad === "/api/redactie-nv" && body.actie === "peil") return { status: 200, json: async () => ({ ok: true }) };
        if (pad === "/api/redactie-nv") return { status: 200, json: async () => ({ ok: true, bericht: { ...(motor.berichten.find((b) => b.id === body.id) || {}), ...(body.actie === "weg" ? { redactie: "weg", redactieOp: iso(12) } : {}), ...(body.actie === "bewerk" ? { kop: body.kop, samenvatting: body.samenvatting, categorie: body.categorie } : {}) } }) };
        if (pad === "/api/regie") return { status: 200, json: async () => ({ ok: true, besluiten: { [body.mutatie]: { keuze: body.keuze } } }) };
        return { status: 200, json: async () => ({ ok: true }) };
      }
      if (pad.startsWith("/api/redactie-nv")) return { status: motor.status || 200, json: async () => motor.status ? { ok: false, fout: motor.fout } : { ok: true, ...motor } };
      if (pad === "/api/regie") return { status: 200, json: async () => ({ ok: true, ...(regie || { peil: null }), besluiten: {} }) };
      return { status: 200, json: async () => ({ ok: false }) };
    },
  });
  vm.runInContext(script, ctx);
  const rust = () => new Promise((r) => setImmediate(r));
  await rust(); await rust();
  const knop = (attrs) => ({ id: attrs.id || "", getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs, classList: { contains: () => false }, disabled: false });
  return {
    posts, app: () => els.get("app").innerHTML, kop: () => els.get("kop").innerHTML,
    async klik(attrs) { const b = knop(attrs); for (const f of luisteraars.click) f({ target: { closest: () => b } }); await rust(); await rust(); },
    zetWaarde(id, v) { el(id).value = v; },
  };
}

const basis = () => ({ laatsteRun: { klaarOp: iso(11) }, berichten: [
  bericht("a1", { gepubliceerdOp: iso(10), categorie: "economie en ondernemen" }),
  bericht("a2", { soort: "overheid", domein: "service-public.gouv.fr", gepubliceerdOp: iso(9) }),
  bericht("a3", { gepubliceerdOp: iso(8), kanalen: { actueel: true, nieuwsbrief: false, infopoche: true, zijbalk: true, infofrankrijk: true } }),
  bericht("a4", { gepubliceerdOp: iso(7), redactie: "weg", redactieOp: iso(11) }),
  bericht("n1", { geplaatst: false, gepubliceerdOp: null, kanPlaatsen: true, redenTekst: "Te weinig van belang voor onze lezers.", bronnen: [{ naam: "A", datum: iso(11) }] }),
] });

test("lijst: stand, rijen met alleen Weg, Overheid, niet in de brief, weggehaald met Terug, niet geplaatst onderaan", async () => {
  const s = await scherm({ motor: basis() });
  const h = s.app();
  assert.ok(!h.includes('class="wacht'), "zonder wachtende zaken geen kaarten");
  assert.match(h, /3 berichten geplaatst vandaag, motor liep om \d\d:\d\d/);
  assert.match(h, /Economie · \d\d:\d\d/);
  assert.match(h, /Overheid · \d\d:\d\d/);
  assert.match(h, /<b>niet in de brief<\/b>/);
  assert.match(h, /rij isweg/);
  assert.match(h, /data-actie="terug" data-id="a4">Terug/);
  assert.match(h, /data-actie="weg" data-id="a1">Weg</);
  assert.ok(!/score|portemonnee/i.test(h));
  assert.match(h, /1 niet geplaatst<\/span><button[^>]*data-ga="niet">Bekijken ›/);
  assert.match(s.kop(), /Instellingen/);
});

test("bericht openen: rubriek, tijd, bronnen, schakelaar, verbeteren, andere plekken, Weg overal", async () => {
  const s = await scherm({ motor: basis() });
  await s.klik({ "data-open": "a3" });
  const h = s.app();
  assert.match(h, /Algemeen · geplaatst \d\d:\d\d · 2 bronnen/);
  assert.match(h, /Staat uit, gaat niet mee in de brief van morgen 06:00/);
  assert.match(h, /Kop of samenvatting verbeteren/);
  assert.match(h, /Andere plekken <span>overal aan ›/);
  assert.match(h, /Weg, overal/);
  assert.match(s.kop(), /Bekijk op de site ↗/);
  assert.ok(!h.includes("Zijbalk van het forum"), "de vier plekken staan pas na een tik");
  await s.klik({ "data-plekken": "1" });
  for (const p of ["Nederlanders.fr nieuws", "Infopoche", "Zijbalk van het forum", "Infofrankrijk"]) assert.ok(s.app().includes(p), p);
  await s.klik({ "data-kanaal": "nieuwsbrief", "data-id": "a3", "aria-checked": "false" });
  assert.deepEqual(s.posts.at(-1).body, { id: "a3", actie: "kanaal", kanaal: "nieuwsbrief", aan: true });
});

test("Weg stuurt de actie en laat de rij doorgestreept staan", async () => {
  const m = basis(); const s = await scherm({ motor: m });
  await s.klik({ "data-actie": "weg", "data-id": "a1" });
  assert.deepEqual(s.posts.at(-1).body, { id: "a1", actie: "weg" });
  assert.match(s.app(), /rij isweg[^]*Kop a1/);
});

test("verbeteren: kop, samenvatting en rubriek als keuzelijst; bewaren stuurt bewerk", async () => {
  const s = await scherm({ motor: basis() });
  await s.klik({ "data-verbeter": "a1" });
  const h = s.app();
  assert.match(h, /<textarea[^>]*id="vb-kop"/); assert.match(h, /<textarea[^>]*id="vb-sam"/); assert.match(h, /<select[^>]*id="vb-cat"/);
  assert.match(h, /<option value="economie en ondernemen" selected>Economie en ondernemen/);
  assert.match(h, /Na bewaren laat de motor kop en samenvatting met rust/);
  assert.ok(!/id="vb-tekst"/.test(h));
  s.zetWaarde("vb-kop", "Nieuwe kop"); s.zetWaarde("vb-sam", "Alinea een.\n\nAlinea twee."); s.zetWaarde("vb-cat", "politiek");
  await s.klik({ "data-bewaar-vb": "a1" });
  assert.deepEqual(s.posts.at(-1).body, { id: "a1", actie: "bewerk", kop: "Nieuwe kop", samenvatting: "Alinea een.\n\nAlinea twee.", categorie: "politiek" });
});

test("niet geplaatst: reden in gewone taal, Plaats en Opnieuw laten schrijven", async () => {
  const s = await scherm({ motor: basis() });
  await s.klik({ "data-ga": "niet" });
  const h = s.app();
  assert.match(h, /Te weinig van belang voor onze lezers/);
  assert.match(h, /data-actie="plaats"[^>]*>Plaats/);
  assert.match(h, /Opnieuw laten schrijven/);
});

test("storing: één rode regel bovenaan, de rest blijft werken", async () => {
  const s = await scherm({ motor: { status: 502, fout: "De nieuwsmotor is nu niet bereikbaar." }, regie: { peil: null } });
  const h = s.app();
  assert.equal((h.match(/class="storing"/g) || []).length, 1);
  assert.match(h, /^<div class="storing">De nieuwsmotor is nu niet bereikbaar\./);
  assert.ok(!/geplaatst vandaag/.test(h));
});

const peilNv = [
  { id: "p1", soort: "wijziging", zekerheid: "groen", titel: "Tarief gaat omhoog", huidige: "10%", nieuw: "12%", vanaf: "2027-01-01", berichtKop: "Het tarief stijgt", bronUrl: "https://www.service-public.gouv.fr/x", advies: "vastgesteld" },
  { id: "p2", soort: "wijziging", zekerheid: "oranje", titel: "Plafond verandert mogelijk", nieuw: "5.000", twijfel: "Alleen een voorstel, nog niet gestemd.", advies: "verwacht" },
  { id: "p3", soort: "ontbreekt", zekerheid: "oranje", titel: "Nieuwe belasting niet in PEIL", berichtKop: "Nieuwe heffing", bronUrl: "https://impots.gouv.fr/y", advies: "lijst" },
  { id: "p4", soort: "wijziging", zekerheid: "groen", titel: "Vierde" },
];

test("PEIL uit de nieuwe motor: groen, oranje en ontbreekt; hooguit twee kaarten, daaronder Nog N wachten op jou", async () => {
  const m = basis(); m.peil = peilNv;
  const s = await scherm({ motor: m });
  let h = s.app();
  assert.equal((h.match(/class="wacht/g) || []).length, 2, "hooguit twee kaarten tegelijk");
  assert.match(h, /data-wacht="1"[^>]*>Nog 2 wachten op jou/);
  await s.klik({ "data-wacht": "1" });
  h = s.app();
  assert.equal((h.match(/class="wacht peil"/g) || []).length, 4);
  assert.match(h, /PEIL · wijziging/); assert.match(h, /PEIL · twijfel/); assert.match(h, /PEIL · ontbreekt/);
  assert.match(h, /Nu in PEIL <s>10%<\/s> → nieuw <b>12%<\/b>, vanaf 1 januari 2027/);
  assert.match(h, /Alleen een voorstel, nog niet gestemd\./);
  assert.match(h, /<a href="https:\/\/www\.service-public\.gouv\.fr\/x"[^>]*>Bron ↗<\/a><\/div>/, "bronlink staat op de regel met de tekstlinks");
  assert.match(h, /knop peilknop groen"[^>]*data-peil-keuze="vastgesteld">Klopt, zo in PEIL/);
  assert.match(h, /knop peilknop oranje"[^>]*data-peil-keuze="verwacht">Nog niet definitief/);
  assert.match(h, /data-peil-keuze="lijst">Zet op de lijst voor PEIL/);
  assert.match(h, /data-peil-keuze="niet_nodig">Niet nodig/);
  assert.match(h, /data-peil-keuze="raakt_niet">Raakt PEIL niet/);
  assert.match(h, /data-peil-keuze="vastgesteld">Toch vastgesteld/);
  await s.klik({ "data-peil-bron": "nv", "data-peil-id": "p3", "data-peil-keuze": "lijst" });
  assert.deepEqual(s.posts.at(-1), { pad: "/api/redactie-nv", body: { actie: "peil", id: "p3", keuze: "lijst" } });
  assert.ok(!s.app().includes("Nieuwe belasting niet in PEIL"), "beantwoorde kaart verdwijnt");
});

test("zonder veld peil toont het scherm geen PEIL-kaarten en geen fout", async () => {
  const s = await scherm({ motor: basis() });
  assert.ok(!s.app().includes("PEIL ·"));
  assert.ok(!s.app().includes("storing"));
});

test("bestaande PEIL-bewaking: groen bij twee kloppende citaten met dezelfde waarde, anders oranje; keuzes b, a en niets", async () => {
  const o = (w, k) => ({ door: "x", nieuwe_waarde: w, citaat: "c", citaat_klopt: k, ingangsdatum: "2027-01-01" });
  const regie = { peil: { besluiten: [
    { mutatie: "m.2026.0001", naam: "Groen punt", bron_url: "https://a.gouv.fr/z", reden: "", oordelen: [o("7%", true), o("7%", true)] },
    { mutatie: "m.2026.0002", naam: "Oranje punt", bron_url: "https://b.gouv.fr/z", reden: "de twee controles verschillen van mening", oordelen: [o("7%", true), o("8%", true)] },
    { mutatie: "m.2026.0003", naam: "Oranje citaat", reden: "", oordelen: [o("7%", true), o("7%", false)] },
  ] } };
  const s = await scherm({ motor: basis(), regie });
  await s.klik({ "data-wacht": "1" });
  const h = s.app();
  const kaarten = h.split('<div class="wacht peil"').slice(1);
  assert.equal(kaarten.length, 3);
  assert.match(kaarten[0], /data-zeker="groen"/); assert.match(kaarten[0], /PEIL · wijziging/); assert.match(kaarten[0], /Klopt, zo in PEIL/);
  assert.match(kaarten[1], /data-zeker="oranje"/); assert.match(kaarten[1], /PEIL · twijfel/); assert.match(kaarten[1], /De twee controles verschillen van mening\./); assert.match(kaarten[1], /peilknop oranje[^>]*data-peil-keuze="verwacht"/);
  assert.match(kaarten[2], /data-zeker="oranje"/);
  await s.klik({ "data-peil-bron": "regie", "data-peil-id": "m.2026.0001", "data-peil-keuze": "vastgesteld" });
  assert.deepEqual(s.posts.at(-1), { pad: "/api/regie", body: { mutatie: "m.2026.0001", keuze: "b" } });
  await s.klik({ "data-peil-bron": "regie", "data-peil-id": "m.2026.0002", "data-peil-keuze": "verwacht" });
  assert.equal(s.posts.at(-1).body.keuze, "a");
  await s.klik({ "data-peil-bron": "regie", "data-peil-id": "m.2026.0003", "data-peil-keuze": "raakt_niet" });
  assert.equal(s.posts.at(-1).body.keuze, "niets");
});

test("instellingen: Café Jeudi, Bronnen, Dit apparaat en Zo staat het er nu", async () => {
  const s = await scherm({ motor: basis() });
  await s.klik({ "data-ga": "instellingen" });
  const h = s.app();
  for (const t of ["Café Jeudi", "Bronnen", "Dit apparaat", "Zo staat het er nu", "Uitloggen"]) assert.ok(h.includes(t), t);
});

test("herstelronde 1: geen Bekijk op de site bij een weggehaald bericht; Dit apparaat staat direct onder Café Jeudi", async () => {
  const s = await scherm({ motor: basis() });
  await s.klik({ "data-open": "a4" });
  assert.ok(!/Bekijk op de site/.test(s.kop()), "weggehaald bericht heeft geen sitelink");
  await s.klik({ "data-terug": "1" });
  await s.klik({ "data-ga": "instellingen" });
  const h = s.app();
  assert.ok(h.indexOf("Dit apparaat") > h.indexOf("Café Jeudi") && h.indexOf("Dit apparaat") < h.indexOf(">Bronnen<"));
});
