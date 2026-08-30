// Bronnen verkennen op pagina's die hun inhoud met JavaScript opbouwen.
// ---------------------------------------------------------------------------
// WAAROM DIT ER NAAST DE GEWONE VERKENNER STAAT. verken-bronnen.mjs haalt de
// kale HTML op. Dat werkt prima bij een WordPress- of een klassieke site, en
// helemaal niet bij een moderne overheidssite: rijksoverheid.nl levert 223 kB
// HTML met 25 links, want de pagina wordt pas in de browser opgebouwd. Een
// abonneerknop die zijn feed-URL ter plekke samenstelt, bestaat in die kale
// HTML domweg niet — daar valt met geen enkele regexp omheen te werken.
//
// Deze verkenner laat daarom een echte browser de pagina uitvoeren en leest
// pas dáárna wat er staat. Hij kijkt op vier plaatsen:
//
//   1. <link rel="alternate"> in de opgebouwde <head>;
//   2. elke <a href> in de opgebouwde pagina;
//   3. elk feed-achtig adres in de uiteindelijke HTML (ook in JSON-payloads);
//   4. de netwerkverzoeken die de pagina zelf doet — als de pagina zijn
//      feedlijst uit een API haalt, staat die API hier.
//
// Punt 4 is het krachtigst en tegelijk het eerlijkst: dat zijn adressen die de
// site zelf aanroept, niet adressen die ik verzin.
//
// Draaien:  node scripts/verken-render.mjs <url> [<url> ...]
//           BRONNEN="url1,url2" node scripts/verken-render.mjs
// Vereist een geïnstalleerde Chromium (workflow "Bronnen verkennen (browser)").

import pw from "playwright-core";
import {
  ACCEPT_FEED, UA_BROWSER,
  feedLinksUitTekst, feedSamenvatting, haal, isFeed,
} from "./feedtoets.mjs";

const { chromium } = pw;
const PAGINA_TIMEOUT_MS = 45000;
const MAX_KANDIDATEN = 30;

// Waar de browser staat. De GitHub-runner zet dit zelf via de installatie;
// lokaal wijst PLAYWRIGHT_BROWSERS_PATH naar de voorgeïnstalleerde Chromium.
const BROWSER_PAD = process.env.CHROOM_PAD || undefined;

async function rendersessie(url) {
  const browser = await chromium.launch({
    executablePath: BROWSER_PAD,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const ctx = await browser.newContext({ userAgent: UA_BROWSER, locale: "nl-NL" });
    const pagina = await ctx.newPage();

    // Alles wat de pagina zelf opvraagt. Hier zit de API waar een dynamische
    // feedlijst vandaan komt.
    const verzoeken = new Set();
    pagina.on("request", (r) => verzoeken.add(r.url()));

    let status = 0;
    try {
      const resp = await pagina.goto(url, { waitUntil: "networkidle", timeout: PAGINA_TIMEOUT_MS });
      status = resp ? resp.status() : 0;
    } catch (e) {
      // Een pagina die nooit "networkidle" haalt (peilingen, analytics) is nog
      // steeds bruikbaar: wat er tot nu toe staat, lezen we gewoon uit.
      if (!/timeout/i.test(e.message)) throw e;
    }

    const html = await pagina.content();
    const ankers = await pagina.$$eval("a[href]", (as) => as.map((a) => a.href));
    const aangekondigd = await pagina.$$eval(
      'link[rel="alternate"]',
      (ls) => ls.map((l) => ({ url: l.href, type: l.type || "", titel: l.title || "" }))
    );
    return { status, html, ankers, aangekondigd, verzoeken: [...verzoeken] };
  } finally {
    await browser.close();
  }
}

const lijktFeed = (u) =>
  /\.rss(\?|$)|\.atom(\?|$)|(^|[/.?=&-])rss([/.?&=-]|$)|(^|[/?=&-])feed([/.?&=-]|$)/i.test(u) &&
  !/sitemap/i.test(u);

async function verken(ingang) {
  console.log(`## ${ingang}\n`);
  let sessie;
  try {
    sessie = await rendersessie(ingang);
  } catch (e) {
    console.log(`**Renderen mislukt** — ${e.message}\n`);
    return;
  }

  // Kandidaten uit alle vier de bronnen, met vermelding waar ze vandaan komen.
  // Die herkomst is het halve antwoord: "uit een netwerkverzoek" betekent dat
  // de site het adres zelf gebruikt.
  const herkomst = new Map();
  const zet = (u, waar) => {
    if (!u || !/^https?:/i.test(u)) return;
    if (!herkomst.has(u)) herkomst.set(u, waar);
  };
  for (const a of sessie.aangekondigd) if (/rss|atom|xml/i.test(a.type) || lijktFeed(a.url)) zet(a.url, "aangekondigd in de head");
  for (const u of sessie.ankers) if (lijktFeed(u)) zet(u, "link op de pagina");
  for (const u of sessie.verzoeken) if (lijktFeed(u)) zet(u, "netwerkverzoek van de pagina zelf");
  for (const k of feedLinksUitTekst(sessie.html, ingang)) zet(k.url, "adres in de opgebouwde HTML");

  console.log(
    `Gerenderd (HTTP ${sessie.status}) · ${sessie.html.length} tekens · ` +
      `${sessie.ankers.length} links · ${sessie.verzoeken.length} netwerkverzoeken · ` +
      `${herkomst.size} feed-kandidaten\n`
  );

  // Met BRON_DUMP=1: álle verzoeken die de pagina doet, niet alleen de
  // feed-achtige. Bouwt een pagina zijn feedlijst uit een API op, dan staat die
  // API hier — en dat is de enige manier om hem te vinden zonder te gokken.
  // Statisch materiaal (afbeeldingen, lettertypen, scripts, stijl) blijft weg;
  // dat is ruis.
  if (process.env.BRON_DUMP) {
    const boeiend = sessie.verzoeken.filter(
      (u) => !/\.(js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm)(\?|$)/i.test(u)
    );
    console.log(`Netwerkverzoeken zonder statisch materiaal (${boeiend.length} van ${sessie.verzoeken.length}):\n`);
    for (const u of boeiend) console.log(`- ${u}`);
    console.log("");
  }

  if (!herkomst.size) {
    console.log("Geen enkel feed-achtig adres, ook niet na renderen.\n");
    return;
  }

  const treffers = [];
  for (const [url, waar] of [...herkomst].slice(0, MAX_KANDIDATEN)) {
    const r = await haal(url, ACCEPT_FEED);
    if (!r.ok || !isFeed(r.type, r.tekst)) continue;
    treffers.push({ url, waar, status: r.status, ...feedSamenvatting(r.tekst) });
  }

  if (!treffers.length) {
    console.log(`${herkomst.size} kandidaten nagetrokken, geen daarvan bleek een werkende feed. De kandidaten:\n`);
    for (const [url, waar] of [...herkomst].slice(0, MAX_KANDIDATEN)) console.log(`- ${url}  _(${waar})_`);
    console.log("");
    return;
  }

  console.log("| feed | items | nieuwste | titel | gevonden via |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const t of treffers) {
    console.log(`| ${t.url} | ${t.items} | ${t.dagenOud == null ? "—" : `${t.dagenOud} d oud`} | ${t.titel} | ${t.waar} |`);
  }
  console.log("");
}

const ingangen = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : String(process.env.BRONNEN || "").split(/[\s,]+/)
).map((s) => s.trim()).filter(Boolean);

if (!ingangen.length) {
  console.error("Geef een of meer URL's op, of zet BRONNEN=\"url1,url2\".");
  process.exit(2);
}

console.log(`# Bronverkenning met browser — ${new Date().toISOString()}\n`);
for (const ingang of ingangen) await verken(ingang);
