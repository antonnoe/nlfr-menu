// Café Jeudi ja/nee via de routes: POST /api/review {actie:"cafejeudi"} schrijft,
// GET /api/banner leest dezelfde bron. Alles tegen een nagebootste KV en een
// nagebootste Supabase-sessie: er wordt NIETS naar het live record geschreven.

import test from "node:test";
import assert from "node:assert/strict";
import { startNepSessie } from "./fixtures/nep-supabase.mjs";

process.env.KV_REST_API_URL = "https://kv.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

const { cookie, sluit } = await startNepSessie();
test.after(sluit);

const { default: review } = await import("../api/review.js");
const { default: banner } = await import("../api/banner.js");
const { inParijs } = await import("../lib/banner.js");

const origineleFetch = globalThis.fetch;
let kv;
let gezet;

function zetKvOp(begin) {
  kv = new Map(begin || []);
  gezet = [];
  globalThis.fetch = async (url, opties = {}) => {
    if (!String(url).startsWith(process.env.KV_REST_API_URL)) return origineleFetch(url, opties);
    const args = JSON.parse(opties.body);
    const cmd = String(args[0]).toUpperCase();
    let result;
    if (cmd === "GET") result = kv.has(args[1]) ? kv.get(args[1]) : null;
    else if (cmd === "SET") { kv.set(args[1], args[2]); gezet.push(args); result = "OK"; }
    else throw new Error("onverwacht KV-commando: " + cmd);
    return { ok: true, status: 200, json: async () => ({ result }), text: async () => "" };
  };
}
test.afterEach(() => { globalThis.fetch = origineleFetch; });

function nepRes() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
async function roep(handler, req) { const res = nepRes(); await handler(req, res); return res; }
const postReview = (body, metCookie = true) =>
  ({ method: "POST", headers: { ...(metCookie ? { cookie } : {}), host: "nlfr-menu.test" }, url: "/api/review", body });
const getBanner = () => ({ method: "GET", headers: {}, query: {} });

test("zonder sessie: 401 en niets geschreven", async () => {
  zetKvOp();
  const res = await roep(review, postReview({ actie: "cafejeudi", ja: true }, false));
  assert.equal(res.statusCode, 401);
  assert.equal(gezet.length, 0);
});

test("ja schrijft aan + aanTot, en GET /api/banner geeft effectief aan met datum", async () => {
  // Het verse record uit het gewone ritme: uit, zoals bij de start.
  zetKvOp([["banner", JSON.stringify({ aan: false, aanTot: null })]]);
  const res = await roep(review, postReview({ actie: "cafejeudi", ja: true }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.aan, true);
  assert.match(res.body.datum, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(gezet.length, 1);
  const opgeslagen = JSON.parse(gezet[0][2]);
  assert.equal(opgeslagen.aan, true);
  assert.equal(opgeslagen.aanTot, res.body.datum);
  assert.ok(res.body.datum >= inParijs(new Date()).iso, "de donderdag ligt niet in het verleden");

  const g = await roep(banner, getBanner());
  assert.equal(g.statusCode, 200);
  assert.equal(g.body.aan, true);
  assert.equal(g.body.datum, res.body.datum);
  assert.equal(g.body.aanIngesteld, true);
  assert.equal(g.body.bron, "kv");
  // De pagina leest dezelfde stand via de sessie-GET van /api/review.
  const k = await roep(review, { method: "GET", headers: { cookie, host: "nlfr-menu.test" }, url: "/api/review?deel=banner" });
  assert.deepEqual([k.body.aan, k.body.datum], [true, res.body.datum]);
  assert.ok(Date.parse(g.body.bijgewerkt) > 0);
});

test("nee zet aan uit en leegt aanTot; GET toont aan:false en datum:null", async () => {
  zetKvOp([["banner", JSON.stringify({ aan: true, aanTot: "2999-12-31" })]]);
  const res = await roep(review, postReview({ actie: "cafejeudi", ja: false }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.aan, false);
  assert.equal(res.body.datum, null);
  const opgeslagen = JSON.parse(gezet[0][2]);
  assert.equal(opgeslagen.aan, false);
  assert.equal(opgeslagen.aanTot, null);
  const g = await roep(banner, getBanner());
  assert.equal(g.body.aan, false);
  assert.equal(g.body.datum, null);
});

test("een verlopen ja: raw aan:true maar GET meldt effectief uit", async () => {
  zetKvOp([["banner", JSON.stringify({ aan: true, aanTot: "2020-01-02" })]]);
  const g = await roep(banner, getBanner());
  assert.equal(g.body.aan, false, "effectief");
  assert.equal(g.body.aanIngesteld, true, "ruw, voor de beheerpagina");
  assert.equal(g.body.datum, null);
  assert.equal(gezet.length, 0, "lezen schrijft niets");
});

test("ongeldige invoer: 400 en niets geschreven", async () => {
  zetKvOp();
  const res = await roep(review, postReview({ actie: "cafejeudi", ja: "ja" }));
  assert.equal(res.statusCode, 400);
  assert.equal(gezet.length, 0);
});

test("de respons bevat geen token of persoonsgegevens", async () => {
  zetKvOp([["banner", JSON.stringify({ aan: true, aanTot: "2999-12-31" })]]);
  const g = await roep(banner, getBanner());
  const tekst = JSON.stringify(g.body);
  assert.ok(!/token|@|cookie|session/i.test(tekst.replace(/meet\.google\.com/g, "")), tekst);
});

// --- de pagina ---------------------------------------------------------------

import { readFileSync } from "node:fs";
const reviewHtml = readFileSync(new URL("../review.html", import.meta.url), "utf8");

test("review.html: blok met Ja en Nee, via de sessie en zonder BANNER_TOKEN", () => {
  assert.match(reviewHtml, /id="cafejeudi"/);
  assert.match(reviewHtml, /id="cjja"[^>]*>Ja</);
  assert.match(reviewHtml, /id="cjnee"[^>]*>Nee</);
  assert.match(reviewHtml, /actie: "cafejeudi"/);
  assert.match(reviewHtml, /deel=banner/);
  assert.ok(!/BANNER_TOKEN|Bearer/.test(reviewHtml), "geen beheertoken in de pagina");
  // Het blok staat boven de tabbladen, dus bovenaan de ronde.
  assert.ok(reviewHtml.indexOf('id="cafejeudi"') < reviewHtml.indexOf('class="tabs"'));
});
