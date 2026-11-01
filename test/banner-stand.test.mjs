// Café Jeudi ja/nee: de effectieve stand van de banner.
// ---------------------------------------------------------------------------
// De banner is aan als aan === true EN aanTot gevuld is EN vandaag (Parijs)
// niet na aanTot ligt. Geen cronjob: de terugval naar "nee" is het verstrijken
// van de datum. Alles hier draait op vaste momenten, zonder KV en zonder netwerk.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STANDAARD, effectieveStand, cafeJeudiZetten, bannerHTML, normaliseer, valideer,
} from "../lib/banner.js";

const REC = (extra) => ({ ...STANDAARD, aan: true, ...extra });
const maandag7sep = new Date("2026-09-07T10:00Z");   // 12:00 Parijs

test("aan zonder aanTot is effectief uit", () => {
  const s = effectieveStand(REC({ aanTot: null }), maandag7sep);
  assert.deepEqual(s, { aan: false, datum: null, aanTot: null });
  assert.equal(bannerHTML(REC({ aanTot: null }), maandag7sep), "");
});

test("aan met aanTot in de toekomst is effectief aan, met die datum", () => {
  const s = effectieveStand(REC({ aanTot: "2026-09-10" }), maandag7sep);
  assert.deepEqual(s, { aan: true, datum: "2026-09-10", aanTot: "2026-09-10" });
  assert.match(bannerHTML(REC({ aanTot: "2026-09-10" }), maandag7sep), /Donderdag 10 september/);
});

test("op de dag zelf blijft hij aan, de hele dag, ook na de eindtijd", () => {
  const rec = REC({ aanTot: "2026-09-10" });
  assert.equal(effectieveStand(rec, new Date("2026-09-10T06:00Z")).aan, true, "08:00 Parijs");
  assert.equal(effectieveStand(rec, new Date("2026-09-10T16:30Z")).aan, true, "18:30, bezig");
  assert.equal(effectieveStand(rec, new Date("2026-09-10T21:59Z")).aan, true, "23:59 Parijs");
  // Na 19:30 wijst de gewone logica al naar volgende week; de banner noemt dan
  // nog steeds de donderdag van het "ja", niet een week later.
  const h = bannerHTML(rec, new Date("2026-09-10T19:00Z"));
  assert.match(h, /Donderdag 10 september/);
  assert.ok(!/17 september/.test(h), "geen datum waar niemand ja op zei");
});

test("de dag erna is hij uit", () => {
  const rec = REC({ aanTot: "2026-09-10" });
  const s = effectieveStand(rec, new Date("2026-09-10T22:00Z"));   // 00:00 vrijdag Parijs
  assert.equal(s.aan, false);
  assert.equal(s.datum, null);
  assert.equal(bannerHTML(rec, new Date("2026-09-11T08:00Z")), "");
});

test("aan:false blijft uit, ook met een geldige aanTot", () => {
  assert.equal(effectieveStand(REC({ aan: false, aanTot: "2026-09-10" }), maandag7sep).aan, false);
});

test("een ongeldige aanTot telt als leeg", () => {
  assert.equal(effectieveStand(REC({ aanTot: "morgen" }), maandag7sep).aan, false);
  assert.equal(effectieveStand(REC({ aanTot: "2026-02-31" }), maandag7sep).aan, false);
});

test("overslaan: staat de datum van het ja in overslaan, dan is hij uit", () => {
  const rec = REC({ aanTot: "2026-09-10", overslaan: ["2026-09-10"] });
  assert.equal(effectieveStand(rec, maandag7sep).aan, false);
});

test("zomer/wintertijd: het omslagpunt ligt op middernacht in Parijs, niet in UTC", () => {
  // Zomertijd (UTC+2) tot zondag 25 oktober 2026. Donderdag 22 oktober.
  const zomer = REC({ aanTot: "2026-10-22" });
  assert.equal(effectieveStand(zomer, new Date("2026-10-22T21:30Z")).aan, true, "23:30 Parijs");
  assert.equal(effectieveStand(zomer, new Date("2026-10-22T22:30Z")).aan, false, "00:30 Parijs, vrijdag");
  // Wintertijd (UTC+1). Donderdag 29 oktober.
  const winter = REC({ aanTot: "2026-10-29" });
  assert.equal(effectieveStand(winter, new Date("2026-10-29T22:30Z")).aan, true, "23:30 Parijs");
  assert.equal(effectieveStand(winter, new Date("2026-10-29T23:30Z")).aan, false, "00:30 Parijs; in UTC nog donderdag");
  // Voorjaar: zomertijd begint zondag 29 maart 2026. Donderdag 2 april.
  const lente = REC({ aanTot: "2026-04-02" });
  assert.equal(effectieveStand(lente, new Date("2026-04-02T21:30Z")).aan, true);
  assert.equal(effectieveStand(lente, new Date("2026-04-02T22:30Z")).aan, false);
});

// --- ja/nee zetten ----------------------------------------------------------

test("ja op maandag: aan en aanTot = komende donderdag", () => {
  const u = cafeJeudiZetten({ ...STANDAARD, aan: false }, true, maandag7sep);
  assert.equal(u.ok, true);
  assert.equal(u.record.aan, true);
  assert.equal(u.record.aanTot, "2026-09-10");
});

test("ja op donderdag vóór de eindtijd telt vandaag mee; erna de volgende", () => {
  assert.equal(cafeJeudiZetten(STANDAARD, true, new Date("2026-09-10T16:30Z")).record.aanTot, "2026-09-10");
  assert.equal(cafeJeudiZetten(STANDAARD, true, new Date("2026-09-10T17:30Z")).record.aanTot, "2026-09-17");
});

test("ja slaat een overgeslagen donderdag over", () => {
  const u = cafeJeudiZetten({ ...STANDAARD, overslaan: ["2026-09-10"] }, true, maandag7sep);
  assert.equal(u.record.aanTot, "2026-09-17");
});

test("nee zet uit en leegt aanTot", () => {
  const u = cafeJeudiZetten(REC({ aanTot: "2026-09-10" }), false, maandag7sep);
  assert.equal(u.ok, true);
  assert.equal(u.record.aan, false);
  assert.equal(u.record.aanTot, null);
});

test("ja zonder weekschema of met een niet-boolean wordt geweigerd", () => {
  assert.equal(cafeJeudiZetten({ ...STANDAARD, wekelijks: null }, true, maandag7sep).ok, false);
  assert.equal(cafeJeudiZetten(STANDAARD, "ja", maandag7sep).ok, false);
  assert.equal(cafeJeudiZetten(STANDAARD, undefined, maandag7sep).ok, false);
});

test("het resultaat is een geldig record en behoudt de overige velden", () => {
  const eigen = { ...STANDAARD, titel: "Boekencafé", kleur: "#6b3a8f", overslaan: ["2026-12-24"] };
  const u = cafeJeudiZetten(eigen, true, maandag7sep);
  assert.equal(valideer(u.record).ok, true);
  assert.equal(u.record.titel, "Boekencafé");
  assert.equal(u.record.kleur, "#6b3a8f");
  assert.deepEqual(u.record.overslaan, ["2026-12-24"]);
});

test("valideer bewaart aanTot en weigert rommel", () => {
  assert.equal(valideer({ ...STANDAARD, aanTot: "2026-09-10" }).record.aanTot, "2026-09-10");
  assert.equal(valideer({ ...STANDAARD, aanTot: "" }).record.aanTot, null);
  assert.equal(valideer({ ...STANDAARD, aanTot: "10-09-2026" }).ok, false);
  assert.equal(normaliseer({}).aanTot, null, "een oud record zonder aanTot normaliseert tot null");
});
