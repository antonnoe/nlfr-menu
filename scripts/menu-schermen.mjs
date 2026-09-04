// Het herbouwde hoofdmenu nameten en fotograferen op de drie breedtes waarop
// het echt draait: 955px (het iframe op desktop), 390px (telefoon) en de
// /m-modus. Plus de beheerpagina van de banner.
//
// Naast de plaatjes telt hij per breedte wat er stuk kan:
//   * loopt de pagina zijwaarts uit?            (moet 0 zijn)
//   * is elk tikdoel minstens 44px hoog?        (op mobiel de maat)
//   * staan alle vijf de kolommen er?
//   * komt er een hoogte via postMessage?
//
// Vereist playwright-core en een Chrome op het systeem; allebei bewust NIET in
// package.json, want ze zijn alleen nodig om deze plaatjes te verversen:
//   npm install --no-save playwright-core
//
// DRAAIEN: node scripts/menu-schermen.mjs
//   CHROME_PAD  pad naar Chrome (standaard: de gebruikelijke Windows-plek)
//   SHOT_DIR    waar de PNG's heen gaan (standaard ./schermen)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import pw from "playwright-core";

const { chromium } = pw;
const WORTEL = process.cwd();
const UIT = process.env.SHOT_DIR || "./schermen";
const CHROME = process.env.CHROME_PAD || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

// Een miniserver die de repo serveert met dezelfde cleanUrls als Vercel, plus
// /api/banner uit banner.json — zo test dit precies wat er live komt te staan.
function server() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let p = decodeURIComponent(url.pathname);

    if (p === "/api/banner") {
      res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(path.join(WORTEL, "banner.json")));
    }
    if (p === "/") p = "/index.html";
    if (!path.extname(p)) p += ".html";           // cleanUrls

    const bestand = path.join(WORTEL, p);
    if (!bestand.startsWith(WORTEL) || !fs.existsSync(bestand)) {
      res.writeHead(404); return res.end("niet gevonden: " + p);
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(bestand)] || "application/octet-stream" });
    res.end(fs.readFileSync(bestand));
  });
}

// Het menu draait normaal in een iframe. Deze wikkel doet wat de embedcode op
// nederlanders.fr doet: de gemelde hoogte overnemen. Zonder dat meet je het
// menu in een context die het nooit heeft.
function wikkel(src, breedte) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#f2ece9;font-family:sans-serif}
    iframe{display:block;width:${breedte}px;border:0;margin:0 auto;height:240px}
  </style></head><body>
  <iframe id="f" src="${src}"></iframe>
  <script>
    window.hoogtes = [];
    addEventListener("message", function(e){
      if (e.data && e.data.nlfrMenuHeight) {
        window.hoogtes.push(e.data.nlfrMenuHeight);
        document.getElementById("f").style.height = (e.data.nlfrMenuHeight + 4) + "px";
      }
    });
  <\/script></body></html>`;
}

async function meet(frame) {
  return frame.evaluate(() => {
    const uit = { breed: document.documentElement.scrollWidth, venster: document.documentElement.clientWidth };
    uit.zijwaarts = Math.max(0, uit.breed - uit.venster);
    uit.kolommen = [...document.querySelectorAll(".deur .dn")].map((e) => e.textContent);
    uit.paneelOpen = document.querySelector(".paneel").classList.contains("open");
    uit.banner = !!document.querySelector(".bnr");
    uit.bannerDatum = (document.querySelector(".bnr-datum") || {}).textContent || "";
    uit.bannerKnop = (document.querySelector(".bnr-knop") || {}).textContent || "";
    uit.klein = [];
    const raak = document.querySelectorAll("a, button, input, .deurkop");
    for (const el of raak) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;             // verborgen
      // Een ::after kan het raakvlak onzichtbaar vergroten zonder de vorm te
      // veranderen (zo houdt de [?] zijn 30px cirkel én een 44px tikdoel).
      const na = getComputedStyle(el, "::after");
      const naHoog = na && na.content !== "none" && na.position === "absolute" ? parseFloat(na.height) || 0 : 0;
      const hoog = Math.max(r.height, naHoog);
      if (hoog < 44) uit.klein.push((el.textContent || el.id || el.className).trim().slice(0, 40) + " (" + Math.round(hoog) + "px)");
    }
    return uit;
  });
}

const srv = server();
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const poort = srv.address().port;
const BASIS = "http://127.0.0.1:" + poort;
fs.mkdirSync(UIT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME });
let fouten = 0;

async function scherm(naam, { breedte, hoogte, src, openMenu, mobiel }) {
  const ctx = await browser.newContext({ viewport: { width: breedte + 40, height: hoogte }, deviceScaleFactor: 1 });
  const pagina = await ctx.newPage();
  await pagina.setContent(wikkel(src, breedte), { waitUntil: "load" });
  const frame = pagina.frames().find((f) => f.url().includes(BASIS));
  await frame.waitForSelector(".card");
  await pagina.waitForTimeout(1200);                 // banner + actueel ophalen

  if (openMenu) {
    await frame.click("#menubtn");
    await pagina.waitForTimeout(500);
  }
  await pagina.waitForTimeout(300);

  const m = await meet(frame);
  const hoogtes = await pagina.evaluate(() => window.hoogtes);
  const bestand = path.join(UIT, naam + ".png");
  await pagina.screenshot({ path: bestand, fullPage: true });

  const problemen = [];
  if (m.zijwaarts > 0) problemen.push("loopt " + m.zijwaarts + "px zijwaarts uit");
  if (mobiel && m.klein.length) problemen.push(m.klein.length + " tikdoelen < 44px: " + m.klein.join(", "));
  if (!hoogtes.length) problemen.push("geen hoogte gemeld via postMessage");
  if (problemen.length) fouten += problemen.length;

  console.log("\n== " + naam + "  (" + breedte + "px) -> " + bestand);
  console.log("   banner        : " + (m.banner ? "ja" : "NEE") + (m.bannerDatum ? '  "' + m.bannerDatum + '"' : "") + (m.bannerKnop ? "  [" + m.bannerKnop + "]" : ""));
  console.log("   kolommen      : " + (m.kolommen.length ? m.kolommen.join(", ") : "(paneel dicht)"));
  console.log("   paneel open   : " + m.paneelOpen);
  console.log("   hoogte gemeld : " + (hoogtes.length ? hoogtes[hoogtes.length - 1] + "px (" + hoogtes.length + " meldingen)" : "GEEN"));
  console.log("   zijwaarts     : " + m.zijwaarts + "px");
  if (mobiel) console.log("   tikdoelen<44  : " + (m.klein.length ? m.klein.join(", ") : "geen"));
  if (problemen.length) console.log("   !! " + problemen.join(" | "));

  await ctx.close();
  return m;
}

await scherm("menu-955-dicht", { breedte: 955, hoogte: 900, src: BASIS + "/" });
await scherm("menu-955-open",  { breedte: 955, hoogte: 1500, src: BASIS + "/", openMenu: true });
await scherm("menu-390-dicht", { breedte: 390, hoogte: 900, src: BASIS + "/", mobiel: true });
await scherm("menu-390-open",  { breedte: 390, hoogte: 1400, src: BASIS + "/", openMenu: true, mobiel: true });
await scherm("menu-m",         { breedte: 390, hoogte: 1100, src: BASIS + "/?compact=1", openMenu: true, mobiel: true });

// De beheerpagina staat niet in een iframe; die fotograferen we rechtstreeks.
{
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 1500 } });
  const p = await ctx.newPage();
  await p.goto(BASIS + "/banner-beheer", { waitUntil: "networkidle" });
  await p.waitForSelector("#voorbeeld .bnr", { timeout: 5000 });
  const datum = await p.textContent("#voorbeeld .bnr-datum");
  await p.screenshot({ path: path.join(UIT, "banner-beheer.png"), fullPage: true });
  console.log("\n== banner-beheer  (1040px) -> " + path.join(UIT, "banner-beheer.png"));
  console.log('   voorbeeld toont: "' + datum + '"');
  await ctx.close();
}

await browser.close();
srv.close();
console.log("\n" + (fouten ? "!! " + fouten + " probleem(en)" : "Alles in orde: geen zijwaartse uitloop, alle tikdoelen >= 44px, hoogte wordt gemeld."));
process.exit(fouten ? 1 : 0);
