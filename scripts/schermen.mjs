// De schermen voor /uitleg maken, en meteen nameten of ze op een telefoon
// deugen.
// ---------------------------------------------------------------------------
// De curatie gebeurt op een telefoon. Deze schermen zijn dus gemaakt op
// 390 x 844 (een gangbaar toestel), en bij elk scherm wordt geteld:
//   * loopt de pagina zijwaarts uit? (moet 0 zijn)
//   * is elk tikdoel minstens 44 px hoog? (de maat die de tool aanhoudt)
// Die tweede toets bracht bij het bouwen vier echte fouten aan het licht.
//
// VOORAF:  node scripts/demo-uitleg.mjs      (laat draaien in een ander venster)
// DRAAIEN: node scripts/schermen.mjs
//   DEMO_POORT   poort van de demoserver (standaard 8790)
//   SHOT_DIR     waar de WebP's heen gaan (standaard ./schermen)
//   CHROME_PAD   pad naar een Chromium-binary
//
// Vereist playwright-core; die staat BEWUST NIET in package.json, want hij is
// alleen nodig om deze plaatjes te verversen en zou de installatie voor de
// tests onnodig zwaar maken:
//   npm install --no-save playwright-core
import { writeFileSync } from "node:fs";
import pw from "playwright-core";
const { chromium } = pw;

const BASIS = `http://127.0.0.1:${process.env.DEMO_POORT || 8790}`;
const UIT = process.env.SHOT_DIR || "./schermen";
const BREEDTE = 390, HOOGTE = 844; // iPhone 14/15

const browser = await chromium.launch({ executablePath: process.env.CHROME_PAD || undefined });
const ctx = await browser.newContext({
  viewport: { width: BREEDTE, height: HOOGTE },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
// Blanco tabblad, alleen om de schermafdruk naar WebP om te zetten: in deze
// omgeving is geen beeldgereedschap beschikbaar, maar het canvas van de
// browser kan het prima. Scheelt ruim de helft aan bytes op de uitlegpagina.
const omzetter = await ctx.newPage();
await omzetter.goto("about:blank");
async function naarWebp(png) {
  const uit = await omzetter.evaluate(async (bron) => {
    const img = new Image();
    img.src = bron;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.86);
  }, "data:image/png;base64," + png.toString("base64"));
  return Buffer.from(uit.split(",")[1], "base64");
}

async function meet(naam) {
  return page.evaluate((naam) => {
    const overloop = document.documentElement.scrollWidth - window.innerWidth;
    const klein = [];
    for (const el of document.querySelectorAll("button, a, input, textarea")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // onzichtbaar
      if (r.height < 44 || r.width < 24) {
        klein.push({
          tekst: (el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 40),
          h: Math.round(r.height), b: Math.round(r.width),
          klasse: el.className || "",
        });
      }
    }
    return { naam, overloop, klein };
  }, naam);
}

const bevindingen = [];
async function schot(naam) {
  await page.waitForTimeout(300);
  const png = await page.screenshot({ fullPage: false });
  writeFileSync(`${UIT}/${naam}.webp`, await naarWebp(png));
  bevindingen.push(await meet(naam));
  console.log(`geschoten: ${naam}.webp`);
}

// ---- Reviewtool -----------------------------------------------------------
await page.goto(`${BASIS}/review?token=demo`, { waitUntil: "networkidle" });
await schot("01-review-boven");

// Scroll naar de conceptkaart
await page.evaluate(() => document.querySelectorAll("h2")[2]?.scrollIntoView());
await schot("02-review-concept");

// Naar de overheidskaart met het Infofrankrijk-blok
await page.evaluate(() => {
  const koppen = [...document.querySelectorAll("h2")];
  koppen[koppen.length - 1]?.scrollIntoView();
});
await schot("03-review-overheid-ifblok");

// Kandidatenpaneel openen bij het eerste overheidsbericht
const openKnop = page.locator('button[data-if-open="o1"]');
await openKnop.scrollIntoViewIfNeeded();
await openKnop.click();
await page.waitForTimeout(600);
await page.locator(".ifkandidaten").first().scrollIntoViewIfNeeded();
await schot("04-review-kandidaten");

// Zoeken
await page.fill("#ifZoek", "bank");
await page.click("#ifZoekBtn");
await page.waitForTimeout(600);
await page.locator(".ifzoekrij").first().scrollIntoViewIfNeeded();
await schot("05-review-zoeken");

// ---- Lezerspagina ---------------------------------------------------------
await page.goto(`${BASIS}/actueel`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await schot("06-lezer-dicht");

// Tegel en artikel openklappen
await page.locator("article.tegel .kop").first().waitFor({ timeout: 15000 });
await page.locator("article.tegel .kop").first().click();
await page.waitForTimeout(400);
await page.locator(".artikel .artkop").first().click();
await page.waitForTimeout(600);
await page.locator(".verwijs").first().scrollIntoViewIfNeeded();
await schot("07-lezer-verwijzing");

// Het overheidstabblad, waar de Bercy-verwijzing onder staat
await page.goto(`${BASIS}/actueel`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator('[data-tab="overheid"]').first().click();
await page.waitForTimeout(400);
await page.locator("article.tegel .kop").first().click();
await page.waitForTimeout(400);
await page.locator(".artikel .artkop").first().click();
await page.waitForTimeout(700);
await page.locator(".verwijs").first().scrollIntoViewIfNeeded();
await schot("08-lezer-overheid-verwijzing");

console.log("\n=== METING (390 x 844) ===");
for (const b of bevindingen) {
  console.log(`\n${b.naam}: horizontale overloop ${b.overloop}px`);
  if (!b.klein.length) console.log("  alle tikdoelen >= 44px hoog");
  for (const k of b.klein) console.log(`  KLEIN: ${k.h}x${k.b} — "${k.tekst}" (${k.klasse})`);
}

await browser.close();
