// Meting: welke opgeslagen items en registerrecords hebben een foute bron-URL?
// ---------------------------------------------------------------------------
// Telt en benoemt records waarvan minstens één bron-URL een host heeft die niet
// bij de geconfigureerde bron hoort, of een leeg pad. Verandert NIETS — dit is
// een meetinstrument, geen reparatie.
//
// Draaien met KV-toegang (Vercel → Project → Settings → Environment Variables):
//   KV_REST_API_URL=… KV_REST_API_TOKEN=… node scripts/meet-bronurls.mjs
//
// Zonder die twee variabelen meet het script alleen de LIVE FEEDS — dat werkt
// altijd en laat zien of een bron nú nog foute URL's aanlevert.

import { listJSON, kvBeschikbaar } from "../lib/store.js";
import { laadBronnen, parseerFeed, parseerJsonVerenigingen } from "../lib/feeds.js";
import { bronUrlOordeel, keurBronnen, bronVoorNaam } from "../lib/bronurl.js";
import { SCAN_PUBLICATIE, SCAN_OVERHEID, SCAN_REGISTER, SCAN_CONCEPT } from "../lib/config.js";

const perRegime = new Map();
function tel(regime) {
  perRegime.set(regime, (perRegime.get(regime) || 0) + 1);
}

function regimeVanBronnaam(naam) {
  const b = bronVoorNaam(naam);
  return (b && b.regime) || "onbekend";
}

function datumVan(doc) {
  return doc.gepubliceerdOp || doc.datum || doc.datumBron || doc.datumOpname || null;
}

// ---- 1. Opgeslagen records (KV) --------------------------------------------
async function meetKv() {
  if (!kvBeschikbaar()) {
    console.log("KV niet geconfigureerd (KV_REST_API_URL / KV_REST_API_TOKEN ontbreken).");
    console.log("De KV-meting is overgeslagen; de feedmeting hieronder draait wel.\n");
    return 0;
  }
  const groepen = [
    ["concept", SCAN_CONCEPT],
    ["publicatie", SCAN_PUBLICATIE],
    ["overheid", SCAN_OVERHEID],
    ["register", SCAN_REGISTER],
  ];
  let totaal = 0;
  for (const [soort, patroon] of groepen) {
    const docs = await listJSON(patroon);
    let raak = 0;
    for (const doc of docs) {
      const weigeringen = keurBronnen(doc);
      if (!weigeringen.length) continue;
      raak += 1;
      totaal += 1;
      for (const w of weigeringen) {
        const regime = regimeVanBronnaam(w.naam);
        tel(regime);
        console.log(
          [
            `[${soort}]`,
            `titel="${doc.kop || doc.titel || doc.titelBron || "(geen)"}"`,
            `datum=${datumVan(doc) || "(geen)"}`,
            `regime=${regime}`,
            `url=${w.url || "(leeg)"}`,
            `reden=${w.reden}`,
          ].join(" · ")
        );
      }
    }
    console.log(`-> ${soort}: ${raak} van ${docs.length} records met een foute bron-URL\n`);
  }
  return totaal;
}

// ---- 2. Live feeds ----------------------------------------------------------
async function meetFeeds() {
  let totaal = 0;
  for (const bron of laadBronnen().filter((b) => b.actief && b.feed)) {
    let ruw;
    try {
      const r = await fetch(bron.feed, {
        headers: {
          "User-Agent": "NLFR-Meting/1.0",
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        console.log(`[feed] ${bron.naam}: HTTP ${r.status} — niet gemeten`);
        continue;
      }
      ruw = bron.type === "json-verenigingen"
        ? parseerJsonVerenigingen(await r.json())
        : parseerFeed(await r.text());
    } catch (e) {
      console.log(`[feed] ${bron.naam}: ${e.name || e} — niet gemeten`);
      continue;
    }
    let raak = 0;
    for (const item of ruw) {
      const oordeel = bronUrlOordeel(item.url, bron);
      if (oordeel.ok) continue;
      raak += 1;
      totaal += 1;
      tel(bron.regime);
      console.log(
        `[feed] titel="${item.titel}" · datum=${item.datum || "(geen)"} · regime=${bron.regime} · url=${item.url || "(leeg)"} · reden=${oordeel.reden}`
      );
    }
    console.log(`-> ${bron.naam} (${bron.regime}): ${raak} van ${ruw.length} items met een foute bron-URL`);
  }
  return totaal;
}

console.log("=== 1. Opgeslagen records in KV ===\n");
const kvTotaal = await meetKv();
console.log("=== 2. Live feeds ===\n");
const feedTotaal = await meetFeeds();

console.log("\n=== Samenvatting ===");
console.log(`Foute bron-URL's in KV-records : ${kvTotaal}`);
console.log(`Foute bron-URL's in live feeds : ${feedTotaal}`);
if (perRegime.size) {
  console.log("Per regime:");
  for (const [regime, n] of [...perRegime].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${regime}: ${n}`);
  }
  const regimes = [...perRegime.keys()];
  console.log(
    regimes.length === 1
      ? `\nCONCLUSIE: dit treft ALLEEN het regime "${regimes[0]}".`
      : `\nCONCLUSIE: dit treft MEERDERE regimes: ${regimes.join(", ")}.`
  );
} else {
  console.log("\nCONCLUSIE: geen enkele foute bron-URL aangetroffen.");
}
