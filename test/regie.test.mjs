// Regiekamer (/regie, 21-11-2026): PEIL-keuzes worden alleen bewaard, de pagina
// staat achter de inlog en linkt naar /redactie en de Cockpit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leesPeilBesluit, pasBesluitToe, schoonExport, PEIL_BEWAKING_URL } from "../lib/regie.js";

test("een PEIL-keuze vraagt een geldig punt en a, b, niets of herstel", () => {
  assert.equal(leesPeilBesluit({ mutatie: "m.2026.0037", keuze: "b" }).ok, true);
  assert.equal(leesPeilBesluit({ mutatie: "m.2026.0037", keuze: "c" }).ok, false, "fase c gaat nooit via de regiekamer");
  assert.equal(leesPeilBesluit({ mutatie: "m.2026.0037; drop", keuze: "a" }).ok, false);
  assert.equal(leesPeilBesluit({}).ok, false);
});

test("keuze bewaren en ongedaan maken", () => {
  const nu = new Date("2026-11-21T10:00:00Z");
  let l = pasBesluitToe(null, { mutatie: "m.2026.0037", keuze: "b" }, nu);
  assert.deepEqual(l, { "m.2026.0037": { keuze: "b", op: nu.toISOString() } });
  l = pasBesluitToe(l, { mutatie: "m.2026.0037", keuze: "herstel" }, nu);
  assert.deepEqual(l, {});
});

test("de export wordt geschoond: alleen https-links en geldige punten", () => {
  const e = schoonExport({ meta: { run: "R", samenvatting: { waakpunten: 8 } },
    besluiten: [{ mutatie: "m.2026.0037", naam: "AOW-leeftijd", bron_url: "javascript:x", oordelen: [{ door: "auditor-1", fase: "b", citaat_klopt: true }] }, { mutatie: "onzin" }],
    niet_opgehaald: [{ mutatie: "m.2026.0034", bron_url: "https://zoek.officielebekendmakingen.nl/x.pdf", reden: "HTTP 403" }] });
  assert.equal(e.besluiten.length, 1);
  assert.equal(e.besluiten[0].bron_url, null);
  assert.equal(e.niet_opgehaald[0].bron_url, "https://zoek.officielebekendmakingen.nl/x.pdf");
  assert.equal(schoonExport(null), null);
  assert.match(PEIL_BEWAKING_URL, /^https:\/\/communitiesabroad\.com\/manifest\//);
});

test("/regie leest de vier bronnen, stuurt bij 401 naar de inlog en linkt naar redactie en Cockpit", () => {
  const html = readFileSync(new URL("../archief/regie.html", import.meta.url), "utf8");
  for (const pad of ["/api/actueel", "/api/review", "/api/selectie", "/api/regie"]) assert.ok(html.includes(`"${pad}"`), pad);
  assert.match(html, /\/login\?terug=\/regie/);
  assert.match(html, /href="\/redactie"/);
  assert.match(html, /antonnoe-antons-cockpit-private\.vercel\.app/);
  assert.match(html, /noindex/);
});

test("/redactie linkt naar de regiekamer", () => {
  assert.match(readFileSync(new URL("../archief/redactie-oud.html", import.meta.url), "utf8"), /href="\/regie"/);
});

test("/regie heeft de Café Jeudi-knoppen via dezelfde sessie-API als /review", () => {
  const html = readFileSync(new URL("../archief/regie.html", import.meta.url), "utf8");
  assert.match(html, /id="cjja"/);
  assert.match(html, /id="cjnee"/);
  assert.match(html, /\/api\/review\?deel=banner/);
  assert.match(html, /actie: "cafejeudi"/);
  const js = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(js), "script is geldige JavaScript");
});
