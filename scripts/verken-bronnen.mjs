// Kandidaat-bronnen verkennen vóórdat ze in bronnen.json belanden.
// ---------------------------------------------------------------------------
// WAAROM. Een bron toevoegen is drie vragen beantwoorden, en alle drie zijn ze
// met een verzoek te beantwoorden in plaats van met een aanname:
//
//   1. IS ER EEN FEED, en werkt hij? Veel instanties hebben er wel een maar
//      kondigen hem niet aan. De verkenner kijkt daarom op drie plaatsen, in
//      afnemende zekerheid: de <link rel="alternate">-regels in de <head>, de
//      feedlinks die de PAGINA zelf aanbiedt (een "RSS-feeds"- of
//      "nieuwsbrieven"-pagina, zoals rijksoverheid.nl er een heeft), en pas
//      daarna een handvol gebruikelijke paden.
//   2. LEEFT HIJ NOG? Een feed met een nieuwste item van 2019 is dood gewicht:
//      hij kost elk kwartier een verzoek en levert nooit iets.
//   3. MAG HET? Franse overheidsteksten vallen NIET automatisch onder de
//      Licence Ouverte. De verkenner zoekt op de site naar de sporen die
//      daarover iets zeggen — en dat is een AANWIJZING, geen oordeel. De
//      uiteindelijke toets blijft mensenwerk; dit bespaart alleen het zoeken.
//
// Deze omgeving mag zelf vrijwel niets bereiken (de egress-policy weigert
// .gouv.fr en .nl met een 403), dus dit script hoort thuis op een
// GitHub-runner: workflow "Bronnen verkennen", of lokaal waar het wel mag.
//
// De toetsen zelf (ophalen, herkennen, samenvatten) staan in feedtoets.mjs,
// gedeeld met verken-render.mjs.
//
// Draaien:  node scripts/verken-bronnen.mjs <url> [<url> ...]
//           BRONNEN="url1,url2" node scripts/verken-bronnen.mjs
// De uitvoer is markdown, klaar om in een bericht of onder docs/ te plakken.

import {
  ACCEPT_FEED, GEBRUIKELIJKE_PADEN, MAX_GELINKT,
  feedLinksUitTekst, feedSamenvatting, feedsUitPagina, haal, isFeed, licentieSporen,
} from "./feedtoets.mjs";

function toonRuw(r) {
  const links = (r.tekst.match(/<a\b/gi) || []).length;
  console.log("```");
  console.log(`HTTP ${r.status} · ${r.type || "geen content-type"} · ${r.tekst.length} tekens · ${links} <a>-tags`);
  console.log(r.tekst.slice(0, 1200).replace(/\s+/g, " "));
  console.log("```\n");
}

async function verken(ingang) {
  const regels = [];
  const eerste = await haal(ingang, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  if (!eerste.ok && !eerste.tekst) {
    return { ingang, bereikbaar: false, reden: eerste.fout || `HTTP ${eerste.status}`, feeds: [], sporen: [] };
  }

  if (process.env.BRON_DUMP) toonRuw(eerste);

  const feeds = [];
  let geprobeerd = 0;
  let gelinkt = 0;
  if (isFeed(eerste.type, eerste.tekst)) {
    feeds.push({ url: eerste.url, titel: "(opgegeven URL is zelf een feed)", geldig: true, ...feedSamenvatting(eerste.tekst), status: eerste.status });
  } else {
    for (const kandidaat of feedsUitPagina(eerste.tekst, eerste.url).slice(0, 6)) {
      const f = await haal(kandidaat.url, ACCEPT_FEED);
      feeds.push({
        url: kandidaat.url,
        titel: kandidaat.titel,
        status: f.status,
        ...(f.ok && isFeed(f.type, f.tekst) ? feedSamenvatting(f.tekst) : { items: 0, nieuwste: null, dagenOud: null }),
        geldig: f.ok && isFeed(f.type, f.tekst),
      });
    }
    regels.push(`pagina: HTTP ${eerste.status}, ${feeds.length} aangekondigde feed(s)`);

    // Niets in de <head>? Dan de links die de pagina zelf aanbiedt. Dit vóór de
    // gokpaden, want een gepubliceerde link is een feit en een gokpad niet.
    if (!feeds.some((f) => f.geldig)) {
      const gelinkte = feedLinksUitTekst(eerste.tekst, eerste.url).slice(0, MAX_GELINKT);
      gelinkt = gelinkte.length;
      for (const kandidaat of gelinkte) {
        if (feeds.some((f) => f.url === kandidaat.url)) continue;
        const f = await haal(kandidaat.url, ACCEPT_FEED);
        if (!f.ok || !isFeed(f.type, f.tekst)) continue;
        feeds.push({ url: kandidaat.url, titel: kandidaat.titel || "(link op de pagina)", status: f.status, geldig: true, ...feedSamenvatting(f.tekst) });
      }
    }

    // Nog steeds niets? Dan pas de gebruikelijke paden.
    if (!feeds.some((f) => f.geldig)) {
      for (const pad of GEBRUIKELIJKE_PADEN) {
        let kandidaat;
        try {
          kandidaat = new URL(pad, eerste.url).href;
        } catch {
          continue;
        }
        if (feeds.some((f) => f.url === kandidaat)) continue;
        const f = await haal(kandidaat, ACCEPT_FEED);
        if (!f.ok || !isFeed(f.type, f.tekst)) continue;
        feeds.push({ url: kandidaat, titel: "(gevonden op een gebruikelijk pad)", status: f.status, geldig: true, ...feedSamenvatting(f.tekst) });
      }
      geprobeerd = GEBRUIKELIJKE_PADEN.length;
    }
  }

  // Licentiesporen: op de pagina zelf plus, als die er is, de juridische pagina.
  let sporenTekst = eerste.tekst;
  for (const pad of ["/mentions-legales", "/mentions-legales/", "/donnees-personnelles"]) {
    const m = eerste.tekst.match(new RegExp(`href=["']([^"']*${pad.replace(/[/-]/g, "\\$&")}[^"']*)["']`, "i"));
    if (!m) continue;
    try {
      const juridisch = await haal(new URL(m[1], eerste.url).href, "text/html");
      if (juridisch.ok) sporenTekst += juridisch.tekst;
    } catch { /* niet erg */ }
    break;
  }

  return { ingang, bereikbaar: true, status: eerste.status, browserNodig: !!eerste.browserNodig, feeds, geprobeerd, gelinkt, sporen: licentieSporen(sporenTekst), regels };
}

// ---- uitvoer ---------------------------------------------------------------

const ingangen = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : String(process.env.BRONNEN || "").split(/[\s,]+/)
).map((s) => s.trim()).filter(Boolean);

if (!ingangen.length) {
  console.error("Geef een of meer URL's op, of zet BRONNEN=\"url1,url2\".");
  process.exit(2);
}

console.log(`# Bronverkenning — ${new Date().toISOString()}\n`);
for (const ingang of ingangen) {
  console.log(`## ${ingang}\n`);
  const r = await verken(ingang);
  if (!r.bereikbaar) {
    console.log(`**Niet bereikbaar** — ${r.reden}\n`);
    continue;
  }
  if (!r.feeds.length) {
    console.log(
      `Bereikbaar (HTTP ${r.status}), maar **hier geen feed gevonden**: niets aangekondigd in de <head>` +
        (r.gelinkt ? `, ${r.gelinkt} op de pagina gelinkte kandidaten waren geen feed` : ", en geen enkele link op de pagina zag eruit als een feed") +
        (r.geprobeerd ? `, en ${r.geprobeerd} gebruikelijke paden leverden ook niets op` : "") +
        ".\n\n> Let op: dit betekent NIET dat er geen feed is. Dezelfde toets mist de " +
        "feed van service-public.fr, die we aantoonbaar gebruiken. Zoek de URL op de " +
        "site zelf (\"RSS\", \"flux RSS\", \"abonnementen\") en laat die hier nalopen.\n"
    );
  } else {
    console.log("| feed | http | items | nieuwste | titel |");
    console.log("| --- | --- | --- | --- | --- |");
    for (const f of r.feeds) {
      const versheid = f.dagenOud == null ? "—" : `${f.dagenOud} d oud`;
      console.log(`| ${f.url} | ${f.status}${f.geldig === false ? " (geen feed)" : ""} | ${f.items} | ${versheid} | ${f.titel || ""} |`);
    }
    console.log("");
  }
  if (r.browserNodig) {
    console.log("Let op: deze site weigert een onbekende User-Agent met een 403; gemeten met een browser-User-Agent.\n");
  }
  if (r.sporen.length) {
    console.log("Licentiesporen op de site: " + r.sporen.map((s) => `${s.goed ? "✓" : "⚠"} ${s.oordeel}`).join(" · "));
  } else {
    console.log("Licentiesporen op de site: **geen gevonden** — zelf nakijken.");
  }
  console.log("\n> Een spoor is een aanwijzing, geen toestemming. De licentie hoort per bron met de hand vastgesteld te worden voordat hij live gaat.\n");
}
