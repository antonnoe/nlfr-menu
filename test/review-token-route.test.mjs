// Waar api/review.js het token vandaan haalt — en waar níét meer.
// ---------------------------------------------------------------------------
// UITSLUITEND DE HEADER. Een token in een URL belandt in de browsergeschiedenis
// en in de serverlogs van elke aanvraag, en lift mee als Referer naar elke
// externe link die op /review wordt aangeklikt; die pagina staat vol met links
// naar bronnen en naar Infofrankrijk. Een header doet dat alle drie niet.
//
// DE QUERYSTRING IS ER TWEE KEER GEWEEST. Eerst als enige weg, daarna opnieuw
// als terugval toen een geldig token werd geweigerd — een oorzaak die elders
// bleek te liggen (een wachtwoordveld waar de wachtwoordmanager in schreef).
// Nu de headerroute op productie bewezen is, is de terugval eruit. Deze toetsen
// leggen vast dat hij er ook uit blijft: een route die "voor de zekerheid" ook
// nog een querystring leest, is een route die het argument hierboven weggeeft.
//
// De echte route draait hier tegen een namaak-KV; er wordt geen logica nagedaan.

import test from "node:test";
import assert from "node:assert/strict";

import { startNepKv } from "./fixtures/nep-kv.mjs";

const { sluit } = await startNepKv();
const TOKEN = "s3cr3t-review-token";
process.env.REVIEW_TOKEN = TOKEN;
test.after(sluit);

const review = (await import("../api/review.js")).default;

async function roep({ url = "/api/review", headers = {}, query } = {}) {
  const res = { code: 0, body: null };
  res.setHeader = () => {};
  res.status = (c) => { res.code = c; return res; };
  res.json = (j) => { res.body = j; return res; };
  res.end = () => res;
  const req = { method: "GET", url, headers };
  // Vercel vult req.query zelf; een test die dat weglaat mist juist de weg die
  // hier dicht moet blijven.
  if (query) req.query = query;
  await review(req, res);
  return res;
}

test("de header laat je binnen", async () => {
  const res = await roep({ headers: { "x-review-token": TOKEN } });
  assert.notEqual(res.code, 401, JSON.stringify(res.body));
});

test("een token in de querystring laat je NIET meer binnen", async () => {
  const res = await roep({ url: `/api/review?token=${TOKEN}` });
  assert.equal(res.code, 401, "de querystring hoort geen toegang meer te geven");
  assert.match(res.body.fout, /token/i);
});

test("ook niet als de runtime req.query zelf vult", async () => {
  // Op Vercel is req.query gevuld door het platform, niet door de URL. Zonder
  // deze toets zou het weghalen van alleen de URL-parser onopgemerkt blijven.
  const res = await roep({ query: { token: TOKEN } });
  assert.equal(res.code, 401);
});

test("een geldige querystring redt een verkeerde header niet", async () => {
  const res = await roep({
    url: `/api/review?token=${TOKEN}`,
    headers: { "x-review-token": "iets-anders-maar-even-lang" },
  });
  assert.equal(res.code, 401, "de header is de enige bron, dus die beslist");
});

test("witruimte om het token heen blijft vergeven", async () => {
  // Een uit een wachtwoordmanager geplakte waarde kan een spatie of een
  // regelovergang meedragen. Dat is geen reden om iemand buiten te sluiten, en
  // deze soepelheid mag niet sneuvelen bij het opruimen hierboven.
  for (const variant of [` ${TOKEN}`, `${TOKEN} `, `${TOKEN}\n`, `\t${TOKEN}\t`]) {
    const res = await roep({ headers: { "x-review-token": variant } });
    assert.notEqual(res.code, 401, `geweigerd op witruimte: ${JSON.stringify(variant)}`);
  }
});

test("zonder token kom je er niet in", async () => {
  assert.equal((await roep()).code, 401);
});

test("de route leest de querystring nergens meer", async () => {
  // Bewijs uit de bron zelf, naast het gedrag hierboven: zo valt ook een
  // tweede, ongebruikte leesplek op als die ooit terugkomt.
  const { readFileSync } = await import("node:fs");
  const bron = readFileSync(new URL("../api/review.js", import.meta.url), "utf8");
  const leesToken = bron.slice(bron.indexOf("function leesToken(req)"), bron.indexOf("function tokenGeldig"));
  assert.ok(!/req\.query/.test(leesToken), `leesToken raakt req.query nog aan:\n${leesToken}`);
  assert.ok(!/searchParams/.test(leesToken), `leesToken parst de URL nog:\n${leesToken}`);
  assert.match(leesToken, /req\.headers\["x-review-token"\]/, "de header blijft de bron");
});
