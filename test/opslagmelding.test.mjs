// De opslagmelding: blijft staan, gaat naar de server, en wijst een oorzaak aan.
// ---------------------------------------------------------------------------
// AANLEIDING. De diagnose op /review verscheen op Android en verdween binnen een
// fractie van een seconde: te snel om te lezen, te snel voor een schermafdruk.
// Een diagnose die je alleen kunt zien als alles al goed gaat, is geen diagnose.
//
// Twee dingen moesten daarom veranderen. De melding verdwijnt niet meer vanzelf
// — alleen de sluitknop haalt hem weg — en hij gaat mee met het beheertoken naar
// de server, zodat hij zonder de telefoon te lezen is.
//
// EN HIJ MOET EEN OORZAAK AANWIJZEN. Twee heel verschillende storingen zien er
// op het scherm hetzelfde uit: een browser die weigert weg te schrijven, en een
// browser die wél wegschrijft en het naderhand opruimt. De eerste is niet op te
// lossen met een cookie van de server, de tweede wel — en de tweede is precies
// wat Samsung Internet doet met "persoonlijke gegevens verwijderen bij
// afsluiten". Alleen het gedrag over twee bezoeken scheidt ze.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normaliseerMelding, beoordeelMeldingen, browserNaam, voegToe } from "../lib/opslagmelding.js";
import { OPSLAGMELDING_MAX } from "../lib/config.js";

const review = readFileSync(new URL("../review.html", import.meta.url), "utf8");

const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";

// ---- Wat er binnenkomt ------------------------------------------------------

test("geen enkel veld uit de browser wordt ongezien overgenomen", () => {
  const m = normaliseerMelding(
    { waar: "van-alles", localReden: "x".repeat(1000), ingebed: "ja", getekend: -5, onbekendVeld: "weg", ua: "u".repeat(9999) },
    "2026-09-06T12:00:00.000Z"
  );
  assert.equal(m.waar, "onbekend", "een onbekende opslagplek wordt niet overgenomen");
  assert.equal(m.localReden.length, 300, "lange tekst wordt afgekapt");
  assert.equal(m.ingebed, null, '"ja" is geen boolean');
  assert.equal(m.getekend, null, "een negatief getal telt niet");
  assert.equal(m.ua.length, 400);
  assert.ok(!("onbekendVeld" in m), "wat niet op de lijst staat, komt er niet in");
});

test("het tijdstip komt van de server, niet uit de browser", () => {
  const m = normaliseerMelding({ op: "1999-01-01T00:00:00.000Z", waar: "local" }, "2026-09-06T12:00:00.000Z");
  assert.equal(m.op, "2026-09-06T12:00:00.000Z",
    "een klok die verkeerd staat mag de volgorde van de ring niet bepalen");
});

test("de ring groeit niet oneindig, nieuwste vooraan", () => {
  let ring = [];
  for (let i = 0; i < OPSLAGMELDING_MAX + 5; i += 1) {
    ring = voegToe(ring, normaliseerMelding({ waar: "local" }, `2026-09-06T12:00:${String(i).padStart(2, "0")}.000Z`));
  }
  assert.equal(ring.length, OPSLAGMELDING_MAX);
  assert.equal(ring[0].op, `2026-09-06T12:00:${String(OPSLAGMELDING_MAX + 4).padStart(2, "0")}.000Z`);
});

// ---- Het oordeel ------------------------------------------------------------
// PER TOESTEL. De ring bevat de meldingen van élke browser die /review opent: de
// telefoon die onderzocht wordt én de desktop waarop het resultaat wordt
// gelezen. Eén oordeel over die hoop keek naar de NIEUWSTE melding — bijna
// altijd de desktop waarop je zit te lezen — en telde "geen spoor" over alle
// toestellen samen, terwijl elke browser die hier voor het eerst komt er per
// definitie één oplevert.

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const melding = (over = {}) =>
  normaliseerMelding(
    { waar: "local", ingebed: false, bakenGeschreven: true, tokenGeschreven: true, ua: SAMSUNG, ...over },
    over.op || "2026-09-06T12:00:00.000Z"
  );

// Eén oordeel eruit halen op browsernaam, zodat een toets over de telefoon niet
// per ongeluk de desktop beoordeelt.
const voor = (oordelen, deel) => oordelen.filter((o) => (o.browser || "").includes(deel))[0];

test("zonder meldingen wordt er niets beweerd", () => {
  assert.deepEqual(beoordeelMeldingen([]), []);
  assert.deepEqual(beoordeelMeldingen(null), []);
});

test("een toestel waar alles werkt, krijgt dat te horen en geen huiswerk", () => {
  // DIT ONTBRAK, en het was de ergste. Een toestel waar niets mis was viel door
  // naar "onbekend", en dan stond er "open /review nog een keer" tegen iemand
  // die het al zes keer had gedaan.
  const uit = beoordeelMeldingen([
    melding({ ua: ANDROID, vorigBaken: "2026-09-06T11:54:25.837Z", op: "2026-09-06T11:57:00.000Z" }),
    melding({ ua: ANDROID, vorigBaken: "2026-09-06T11:50:37.078Z", op: "2026-09-06T11:54:00.000Z" }),
  ]);
  assert.equal(uit.length, 1);
  assert.equal(uit[0].code, "opslag-werkt");
  assert.match(uit[0].tekst, /niets te repareren/);
  assert.doesNotMatch(uit[0].tekst, /nog een keer/, "geen huiswerk voor wie klaar is");
  assert.match(uit[0].tekst, /AFGESLOTEN/, "maar wel wat dit NIET aantoont");
});

test("de desktop waarop je leest, beoordeelt de telefoon niet", () => {
  // De zes meldingen van 6 september 13:49-13:58, in de volgorde waarin ze
  // binnenkwamen: vier van de telefoon, twee van de desktop ertussendoor.
  const uit = beoordeelMeldingen([
    melding({ ua: WINDOWS, vorigBaken: "2026-09-06T11:51:30.656Z", op: "2026-09-06T11:58:00.000Z" }),
    melding({ ua: ANDROID, vorigBaken: "2026-09-06T11:54:25.837Z", op: "2026-09-06T11:57:00.000Z" }),
    melding({ ua: ANDROID, vorigBaken: "2026-09-06T11:50:37.078Z", op: "2026-09-06T11:54:00.000Z" }),
    melding({ ua: WINDOWS, vorigBaken: null, op: "2026-09-06T11:51:00.000Z" }),
    melding({ ua: ANDROID, vorigBaken: "2026-09-06T11:49:42.221Z", op: "2026-09-06T11:50:00.000Z" }),
    melding({ ua: ANDROID, vorigBaken: "2026-09-06T11:48:22.804Z", op: "2026-09-06T11:49:00.000Z" }),
  ]);
  assert.equal(uit.length, 2, "twee toestellen, twee oordelen");
  assert.equal(voor(uit, "Android").aantal, 4);
  assert.equal(voor(uit, "Windows").aantal, 2);
  assert.equal(voor(uit, "Android").code, "opslag-werkt", "deze telefoon bewaart het token gewoon");
  assert.equal(voor(uit, "Windows").code, "opslag-werkt");
});

test("twee verse desktops wijzen samen geen telefoon aan", () => {
  // De oude telling deed dat wel: "geen spoor" werd over alle toestellen samen
  // opgeteld, en elke browser die hier voor het eerst komt levert er één op.
  const uit = beoordeelMeldingen([
    melding({ ua: WINDOWS, vorigBaken: null, op: "2026-09-06T12:00:00.000Z" }),
    melding({ ua: ANDROID, vorigBaken: null, op: "2026-09-06T11:00:00.000Z" }),
  ]);
  assert.equal(voor(uit, "Android").code, "eerste-bezoek");
  assert.equal(voor(uit, "Windows").code, "eerste-bezoek");
});

test("één bezoek zegt dat het er één is, en wat je dan doet", () => {
  const uit = beoordeelMeldingen([melding({ vorigBaken: null })]);
  assert.equal(uit[0].code, "eerste-bezoek");
  assert.match(uit[0].tekst, /nog een keer/);
});

test("een browser die niets bewaart, is een andere storing dan een die opruimt", () => {
  const uit = beoordeelMeldingen([melding({ waar: "session", localReden: "QuotaExceededError: quota" })]);
  assert.equal(uit[0].code, "schrijven-mislukt");
  assert.match(uit[0].tekst, /QuotaExceededError/);
  assert.match(uit[0].tekst, /cookie van de server lost dit niet op/,
    "dat onderscheid bepaalt of een servercookie zin heeft");
});

test("wél wegschrijven en toch elk bezoek niets: sitegegevens worden gewist", () => {
  const uit = beoordeelMeldingen([
    melding({ vorigBaken: null, op: "2026-09-06T12:00:00.000Z" }),
    melding({ vorigBaken: null, op: "2026-09-05T12:00:00.000Z" }),
  ]);
  assert.equal(uit[0].code, "gewist-tussen-bezoeken");
  assert.match(uit[0].tekst, /opruiming achteraf/);
  assert.match(uit[0].tekst, /afsluiten/);
});

test("bij Samsung Internet staat erbij wáár die instelling zit", () => {
  const uit = beoordeelMeldingen([
    melding({ vorigBaken: null, op: "2026-09-06T12:00:00.000Z" }),
    melding({ vorigBaken: null, op: "2026-09-05T12:00:00.000Z" }),
  ]);
  assert.equal(uit[0].browser, "Samsung Internet op Android");
  assert.match(uit[0].tekst, /Persoonlijke browsegegevens/,
    "een oorzaak zonder de weg ernaartoe kost dezelfde zoektijd als geen oorzaak");
});

test("het oordeel hangt aan het gemeten gedrag, niet aan de naam van de browser", () => {
  const uit = beoordeelMeldingen([
    melding({ vorigBaken: null, ua: ANDROID, op: "2026-09-06T12:00:00.000Z" }),
    melding({ vorigBaken: null, ua: ANDROID, op: "2026-09-05T12:00:00.000Z" }),
  ]);
  assert.equal(uit[0].code, "gewist-tussen-bezoeken");
  assert.equal(uit[0].browser, "Chrome op Android");
  assert.doesNotMatch(uit[0].tekst, /Samsung/, "de weg naar de instelling verschilt per browser");
});

test("browserNaam noemt het toestel erbij, niet alleen de browser", () => {
  // Zonder platform heten een telefoon en een desktop allebei "Chrome", en dan
  // staan er twee identieke regels boven twee verschillende metingen.
  assert.equal(browserNaam(ANDROID), "Chrome op Android");
  assert.equal(browserNaam(WINDOWS), "Chrome op Windows");
  assert.equal(browserNaam(SAMSUNG), "Samsung Internet op Android");
  assert.equal(browserNaam("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) ... FBAN/FBIOS ..."), "Facebook-app op iOS");
  assert.equal(browserNaam(""), null);
});

// ---- De pagina --------------------------------------------------------------

test("de melding verdwijnt niet meer vanzelf", () => {
  const blok = review.slice(review.indexOf("function tekenOpslagstand"), review.indexOf("function meldOpslagAanServer"));
  assert.match(blok, /if \(opslagGetoond\) return;/,
    "wat er eenmaal stond, blijft staan tot de lezer hem zelf sluit");
  assert.match(blok, /id="opslagsluit"/, "en er is een knop om dat te doen");
  assert.match(blok, /opslagWeggeklikt = true/);
});

test("een poging tot verbergen wordt geteld en meegestuurd", () => {
  // Het knipperen zelf is meetdata. Het gedrag wegnemen zonder het te tellen
  // zou de vraag "waarom knipperde hij" onbeantwoord laten.
  const blok = review.slice(review.indexOf("function tekenOpslagstand"), review.indexOf("function tekenToken"));
  assert.match(blok, /opslagZouVerbergen \+= 1;/);
  assert.match(blok, /zouVerbergen: opslagZouVerbergen/);
  assert.match(blok, /getekend: opslagGetekend/);
});

test("de sluitknop heeft een echt tikdoel", () => {
  const stijl = review.slice(review.indexOf("<style>"), review.indexOf("</style>"));
  const regel = stijl.split("\n").find((r) => r.includes(".opslagsluit {"));
  assert.ok(regel, ".opslagsluit niet gevonden in de stylesheet");
  assert.match(regel, /min-height:44px/);
});

test("de melding gaat met het token mee, niet langs een open route", () => {
  const blok = review.slice(review.indexOf("function meldOpslagAanServer"), review.indexOf("function tekenMeldingen"));
  assert.match(blok, /api\("POST", \{ actie: "opslagmelding"/,
    "api() stuurt de X-Review-Token-header mee");
  assert.match(blok, /if \(opslagGemeld \|\| !token\) return;/, "zonder token wordt er niets verstuurd");
});

test("de melding vertrekt pas na een geslaagde GET, niet ernaast", () => {
  // Ernaast betekende twee verzoeken tegelijk met hetzelfde token: kwam er op
  // één een 401, dan wiste die het token en werd het antwoord van de ander als
  // verouderd weggegooid — leeg scherm zonder reden.
  const laadStart = review.indexOf("function laad(behoudMelding)");
  assert.ok(laadStart > 0, "laad() niet gevonden in review.html");
  const laad = review.slice(laadStart, review.indexOf("Netwerkfout", laadStart));
  assert.match(laad, /render\(\);\s*\n\s*\/\/ PAS HIER/);
  assert.match(laad, /meldOpslagAanServer\(\);/);
});

test("de meldingen zijn op een groot scherm na te lezen, achter één regel", () => {
  assert.match(review, /id="meldingen"/);
  const blok = review.slice(review.indexOf("function tekenMeldingen"), review.indexOf("function tekenToken"));
  for (const veld of ["waar", "localReden", "vorigBaken", "bakenGeschreven", "tokenGeschreven", "zouVerbergen", "ua"]) {
    assert.ok(blok.includes(veld), `de melding toont ${veld} niet`);
  }
  assert.match(blok, /o\.tekst/, "het oordeel per toestel staat er meteen");
  assert.match(blok, /id="meldknop"/, "de kaarten zelf zitten achter een regel die je openklapt");
  assert.match(blok, /aria-expanded/);
});

test("het paneel staat onder het redactiewerk, niet erboven", () => {
  // Zes kaarten met user-agent-strings pal boven Concepten is
  // ontwikkelaarsgereedschap in een productiegereedschap.
  const meldingen = review.indexOf('id="meldingen"');
  const inhoud = review.indexOf('<div id="inhoud"');
  assert.ok(meldingen > inhoud, "de meldingen horen ná de inhoud te staan");
});

test("een oordeel dat zegt dat alles werkt, oogt niet als waarschuwing", () => {
  const blok = review.slice(review.indexOf("function tekenMeldingen"), review.indexOf("function tekenToken"));
  assert.match(blok, /o\.code === "schrijven-mislukt" \|\| o\.code === "gewist-tussen-bezoeken"/,
    "alleen een echte storing krijgt de rode rand");
});

// ---- De route ---------------------------------------------------------------
// De echte route tegen een namaak-KV; geen nagedane logica.

import { startNepKv, roeper } from "./fixtures/nep-kv.mjs";

const { db, sluit } = await startNepKv();
process.env.REVIEW_TOKEN = "geheim";
test.after(sluit);

const C = await import("../lib/config.js");
const handler = (await import("../api/review.js")).default;
const roep = roeper(handler, "geheim");

test("POST opslagmelding bewaart hem en geeft het oordeel terug", async () => {
  db.delete(C.KEY_OPSLAGMELDING);
  const res = await roep("POST", {
    actie: "opslagmelding",
    melding: { waar: "local", ingebed: false, vorigBaken: null, bakenGeschreven: true, tokenGeschreven: true, ua: SAMSUNG },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.bewaard.waar, "local");
  assert.ok(res.body.bewaard.op, "de server zet het tijdstip erop");
  assert.equal(res.body.oordeel[0].code, "eerste-bezoek", "één bezoek wijst nog niets aan");
  assert.equal(JSON.parse(db.get(C.KEY_OPSLAGMELDING)).length, 1);
});

test("twee bezoeken zonder spoor leveren het oordeel op dat we zoeken", async () => {
  db.delete(C.KEY_OPSLAGMELDING);
  const melding = {
    actie: "opslagmelding",
    melding: { waar: "local", ingebed: false, vorigBaken: null, bakenGeschreven: true, tokenGeschreven: true, ua: SAMSUNG },
  };
  await roep("POST", melding);
  const res = await roep("POST", melding);
  assert.equal(res.body.oordeel[0].code, "gewist-tussen-bezoeken");
  assert.match(res.body.oordeel[0].tekst, /Samsung Internet/);
});

test("GET levert de meldingen en het oordeel mee aan de reviewtool", async () => {
  const res = await roep("GET");
  assert.equal(res.code, 200);
  assert.ok(Array.isArray(res.body.opslagmeldingen));
  assert.equal(res.body.opslagmeldingen.length, 2, "nieuwste eerst, ring van twee");
  assert.equal(res.body.opslagoordeel[0].code, "gewist-tussen-bezoeken");
  assert.equal(res.body.opslagoordeel[0].aantal, 2, "één oordeel per toestel, niet per melding");
});

test("zonder token komt er niets binnen", async () => {
  const res = { code: 0, body: null, headers: {} };
  res.setHeader = () => {};
  res.status = (c) => { res.code = c; return res; };
  res.json = (j) => { res.body = j; return res; };
  res.end = () => res;
  await handler(
    { method: "POST", url: "/api/review", headers: {}, body: { actie: "opslagmelding", melding: { waar: "local" } } },
    res
  );
  assert.equal(res.code, 401, "een open schrijfroute zou een vreemde de ring laten volduwen");
});
