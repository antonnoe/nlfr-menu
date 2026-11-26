// Bouwplan AI-bewaking, ronde 2: berichten die een PEIL-waarde mogelijk wijzigen
// of een gat tonen, openbaar via /api/selectie-feed?peil=1 en als tab op /redactie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bouwPeilKandidaten } from "../lib/selectie/kern.js";

const NU = Date.parse("2026-11-21T05:00:00Z");
const k = (id, soort, datum, ai) => ({ id, soort, datum, titel: `Titel ${id}`, url: `https://x.fr/${id}`, bron: "Bron", ai });
const gew = (id) => ({ id, naam: `Naam ${id}`, waarde: "10 %", soort: "mogelijk-gewijzigd", toelichting: "bericht noemt 0 %" });

test("alleen mogelijk-gewijzigd en gat, overheid eerst, binnen 7 dagen", () => {
  const uit = bouwPeilKandidaten([
    k("raakt", "overheid", "2026-11-20T10:00:00Z", { peil: [{ ...gew("p.fr.a"), soort: "raakt" }] }),
    k("pers-gew", "pers", "2026-11-20T12:00:00Z", { peil: [gew("p.fr.ir.abattement_pensioen")] }),
    k("ov-gew", "overheid", "2026-11-19T12:00:00Z", { peil: [gew("p.fr.b")] }),
    k("gat", "overheid", "2026-11-18T12:00:00Z", { peil: [], gat: "bedrag ontbreekt" }),
    k("oud", "overheid", "2026-11-10T12:00:00Z", { peil: [gew("p.fr.c")] }),
    k("zonder-ai", "overheid", "2026-11-20T12:00:00Z", null),
  ], NU);
  assert.deepEqual(uit.kandidaten.map((x) => x.id), ["ov-gew", "gat", "pers-gew"]);
  assert.equal(uit.mogelijkGewijzigd, 2);
  assert.equal(uit.gaten, 1);
  assert.equal(uit.kandidaten[2].peil[0].id, "p.fr.ir.abattement_pensioen");
});

test("een PEIL-oordeel zonder geldig parameter-id of een bericht zonder https-adres telt niet", () => {
  const uit = bouwPeilKandidaten([
    k("geen-id", "overheid", "2026-11-20T10:00:00Z", { peil: [{ ...gew("p.fr.a"), id: "onzin" }] }),
    { ...k("http", "overheid", "2026-11-20T10:00:00Z", { peil: [gew("p.fr.a")] }), url: "http://x.fr" },
  ], NU);
  assert.equal(uit.aantal, 0);
});

test("/redactie heeft de tab PEIL-acties en leest de openbare kandidatenlijst", () => {
  const html = readFileSync(new URL("../archief/redactie-oud.html", import.meta.url), "utf8");
  assert.match(html, /data-tab="peil"/);
  assert.match(html, /\/api\/selectie-feed\?peil=1/);
  assert.match(html, /id="peilacties"/);
});

test("een bericht waarover de redactie al besliste, blijft een PEIL-kandidaat (zonder dubbel)", async () => {
  const { peilInvoer } = await import("../lib/selectie/kern.js");
  const los = k("los", "overheid", "2026-11-20T10:00:00Z", { peil: [gew("p.fr.a")] });
  const goNogo = { ...k("besloten", "overheid", "2026-11-20T11:00:00Z", { peil: [gew("p.fr.b")] }), besluit: "nogo", door: "iemand@example.org" };
  const redactie = { id: "r1", besluit: "go", redactie: { kandidaat: k("via-redactie", "pers", "2026-11-20T12:00:00Z", { peil: [gew("p.fr.c")] }) } };
  const dubbel = { ...los, besluit: "go" };
  const uit = bouwPeilKandidaten(peilInvoer([los], [goNogo, redactie, dubbel]), NU);
  assert.deepEqual(uit.kandidaten.map((x) => x.id).sort(), ["besloten", "los", "via-redactie"]);
  assert.ok(!JSON.stringify(uit).includes("example.org"), "geen persoonsgegevens");
});
