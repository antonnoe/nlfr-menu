// De brug /redactie -> Nieuwsvoorziening: sleutel, acties en meldingen in gewone taal,
// de nieuwe pagina en de doorverwijzing van de gearchiveerde schermen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { roepMotor, leesOpdracht, sleutel, MELDING, NV_SLEUTEL_NAAM } from "../lib/redactie-nv.js";

const lees = (n) => fs.readFileSync(new URL("../" + n, import.meta.url), "utf8");
const antw = (status, body) => async () => ({ status, ok: status < 300, json: async () => body });

test("zonder NV_REDACTIE_SECRET: duidelijke melding, geen aanroep", async () => {
  let geroepen = false;
  const uit = await roepMotor({ methode: "GET", env: {}, haal: async () => { geroepen = true; } });
  assert.equal(geroepen, false);
  assert.equal(uit.body.soort, "geen-sleutel");
  assert.equal(uit.body.fout, MELDING.geenSleutel);
  assert.equal(NV_SLEUTEL_NAAM, "NV_REDACTIE_SECRET");
});

test("sleutel gaat als Bearer naar nieuws.infofrankrijk.com/api/redactie en nooit terug in het antwoord", async () => {
  let gezien;
  const uit = await roepMotor({ methode: "POST", body: { id: "a1", actie: "weg" }, env: { NV_REDACTIE_SECRET: "geheim-waarde" },
    haal: async (u, o) => { gezien = { u, o }; return { status: 200, ok: true, json: async () => ({ bericht: { id: "a1" } }) }; } });
  assert.equal(gezien.u, "https://nieuws.infofrankrijk.com/api/redactie");
  assert.equal(gezien.o.headers.Authorization, "Bearer geheim-waarde");
  assert.equal(uit.status, 200);
  assert.ok(!JSON.stringify(uit).includes("geheim-waarde"));
});

test("onbereikbaar, geweigerd en dicht geven elk hun eigen gewone-taalmelding", async () => {
  const env = { NV_REDACTIE_SECRET: "x" };
  assert.equal((await roepMotor({ methode: "GET", env, haal: async () => { throw new Error("net"); } })).body.fout, MELDING.onbereikbaar);
  assert.equal((await roepMotor({ methode: "GET", env, haal: antw(401, { fout: "Niet toegestaan." }) })).body.fout, MELDING.geweigerd);
  assert.equal((await roepMotor({ methode: "GET", env, haal: antw(503, { fout: "Redactie is dicht." }) })).body.fout, MELDING.dicht);
  assert.equal((await roepMotor({ methode: "GET", env, haal: antw(429, {}) })).body.fout, MELDING.teVaak);
  const poort = await roepMotor({ methode: "POST", env, body: {}, haal: antw(409, { fout: "De kwaliteitspoort heeft dit bericht tegengehouden." }) });
  assert.equal(poort.status, 409);
  assert.match(poort.body.fout, /kwaliteitspoort/);
});

test("alleen de zes bekende acties en vijf kanalen gaan door", () => {
  assert.equal(leesOpdracht({ id: "a-1", actie: "weg" }).ok, true);
  assert.equal(leesOpdracht({ id: "a-1", actie: "wis" }).ok, false);
  assert.equal(leesOpdracht({ id: "../x", actie: "weg" }).ok, false);
  assert.equal(leesOpdracht({ id: "a1", actie: "kanaal", kanaal: "zijbalk", aan: false }).ok, true);
  assert.equal(leesOpdracht({ id: "a1", actie: "kanaal", kanaal: "mail", aan: false }).ok, false);
  assert.equal(leesOpdracht({ id: "a1", actie: "kanaal", kanaal: "zijbalk" }).ok, false);
  assert.deepEqual(leesOpdracht({ id: "a1", actie: "bewerk", kop: "Nieuwe kop", rommel: 1 }).opdracht, { id: "a1", actie: "bewerk", kop: "Nieuwe kop" });
  assert.equal(sleutel({ NV_REDACTIE_SECRET: "  " }), "");
});

test("de pagina: drie tabs, geen webfonts, 5 schakelaars, geen waarde van een sleutel", () => {
  const h = lees("redactie.html");
  for (const t of ["Vandaag", "Niet geplaatst", "Meer", "Wacht op jou", "Ongedaan maken", "Opnieuw laten schrijven", "Café Jeudi", "Zo staat het er nu", "Dit apparaat"]) assert.ok(h.includes(t), t);
  for (const p of ["Nederlanders.fr nieuws", "Nieuwsbrief", "Infopoche", "Zijbalk van het forum", "Infofrankrijk"]) assert.ok(h.includes(p), p);
  assert.ok(!/fonts\.googleapis|BANNER_TOKEN|NV_REDACTIE_SECRET|CRON_SECRET/.test(h));
  assert.ok(h.includes("/api/redactie-nv") && h.includes("/api/regie") && h.includes("/api/redactie-banner"));
});

test("gearchiveerde schermen staan in archief/ en sturen door naar /redactie", () => {
  const v = JSON.parse(lees("vercel.json"));
  for (const s of ["/review", "/regie", "/banner-beheer", "/selectie"]) {
    assert.ok(v.redirects.some((r) => r.source === s && r.destination === "/redactie"), s);
    assert.ok(!fs.existsSync(new URL("../" + s.slice(1) + ".html", import.meta.url)), s + ".html hoort in archief/");
    assert.ok(fs.existsSync(new URL("../archief/" + s.slice(1) + ".html", import.meta.url)));
  }
  assert.ok(v.redirects.some((r) => r.source === "/archief/:path+"), "archief/ niet publiek");
  assert.ok(!v.redirects.some((r) => r.source === "/archief"), "/archief (archief.html, het nieuwsarchief) blijft staan");
});
