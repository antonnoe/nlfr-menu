// Kandidaat-bronnen verkennen vóórdat ze in bronnen.json belanden.
// ---------------------------------------------------------------------------
// WAAROM. Een bron toevoegen is drie vragen beantwoorden, en alle drie zijn ze
// met een verzoek te beantwoorden in plaats van met een aanname:
//
//   1. IS ER EEN FEED, en werkt hij? Veel instanties hebben er wel een maar
//      linken hem alleen in de <head>. Deze verkenner leest die <link
//      rel="alternate">-regels uit en probeert ze meteen.
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
// Draaien:  node scripts/verken-bronnen.mjs <url> [<url> ...]
//           BRONNEN="url1,url2" node scripts/verken-bronnen.mjs
// De uitvoer is markdown, klaar om in een bericht of onder docs/ te plakken.

const TIMEOUT_MS = 20000;
const UA = "NLFR-bronverkenner/1.0 (+https://nederlanders.fr)";

// Sporen die iets zeggen over hergebruik. Bewust ook de negatieve: "tous
// droits réservés" op een overheidssite betekent dat er iets uit te zoeken valt,
// niet dat het mag.
const LICENTIESPOREN = [
  { patroon: /licence\s+ouverte/i, oordeel: "Licence Ouverte genoemd", goed: true },
  { patroon: /etalab/i, oordeel: "Etalab genoemd", goed: true },
  { patroon: /creativecommons\.org\/licenses\/by/i, oordeel: "CC BY genoemd", goed: true },
  { patroon: /données?\s+ouvertes?|open\s?data/i, oordeel: "open data genoemd", goed: true },
  { patroon: /tous\s+droits\s+r[ée]serv[ée]s/i, oordeel: "“tous droits réservés”", goed: false },
  { patroon: /reproduction\s+interdite/i, oordeel: "“reproduction interdite”", goed: false },
];

async function haal(url, accept) {
  const ctrl = new AbortController();
  const klok = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: accept },
    });
    const tekst = await r.text();
    return { ok: r.ok, status: r.status, type: r.headers.get("content-type") || "", tekst, url: r.url };
  } catch (e) {
    return { ok: false, status: 0, type: "", tekst: "", url, fout: e.name === "AbortError" ? "tijd verstreken" : e.message };
  } finally {
    clearTimeout(klok);
  }
}

// Lang niet elke site kondigt zijn feed aan in de <head>; overheidssites doen
// dat opvallend vaak niet. "Niet aangekondigd" is dus geen bewijs van "niet
// aanwezig" — daarom probeert de verkenner daarna deze gebruikelijke paden.
//
// EN OOK DAN BLIJFT EEN "NEE" ZWAK. Beproefd op 22 instanties (Frans en
// Nederlands) vond deze methode er geen enkele, terwijl service-public.fr —
// dat in bronnen.json staat en aantoonbaar werkt — er óók als "geen feed" uit
// kwam: zijn feed zit op /abonnements/rss/actu-actualites-particuliers.rss,
// een pad dat niemand raadt. Deze verkenner is dus betrouwbaar om een feed te
// BEVESTIGEN en ongeschikt om er een uit te sluiten. De uitvoer zegt dat er
// met zoveel woorden bij; meer gokpaden stapelen maakt dat niet beter.
const GEBRUIKELIJKE_PADEN = [
  "/rss", "/rss.xml", "/feed", "/feed/", "/flux-rss", "/flux-rss.xml",
  "/atom.xml", "/index.rss", "/actualites/rss", "/actualites.rss",
  "/fr/rss.xml", "/rss/actualites.xml", "/?feed=rss2",
];

const isFeed = (type, tekst) =>
  /xml|rss|atom/i.test(type) || /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(tekst.slice(0, 2000));

// Feeds die in de <head> van een gewone pagina staan aangekondigd.
function feedsUitPagina(html, basis) {
  const uit = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["'][^"']*(rss|atom)[^"']*["']/i.test(tag)) continue;
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    const titel = (tag.match(/title=["']([^"']*)["']/i) || [])[1] || "";
    if (!href) continue;
    try {
      uit.push({ url: new URL(href, basis).href, titel });
    } catch { /* onbruikbare href */ }
  }
  return uit;
}

function feedSamenvatting(tekst) {
  const titel = (tekst.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const items = (tekst.match(/<item[\s>]|<entry[\s>]/gi) || []).length;
  const datums = [...tekst.matchAll(/<(?:pubDate|updated|published|dc:date)>([^<]+)</gi)]
    .map((d) => Date.parse(d[1]))
    .filter((t) => !Number.isNaN(t));
  const nieuwste = datums.length ? new Date(Math.max(...datums)) : null;
  return {
    titel: titel.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/\s+/g, " ").trim().slice(0, 70),
    items,
    nieuwste,
    dagenOud: nieuwste ? Math.round((Date.now() - nieuwste.getTime()) / 86400000) : null,
  };
}

function licentieSporen(html) {
  const gevonden = [];
  for (const s of LICENTIESPOREN) if (s.patroon.test(html)) gevonden.push(s);
  return gevonden;
}

async function verken(ingang) {
  const regels = [];
  const eerste = await haal(ingang, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  if (!eerste.ok && !eerste.tekst) {
    return { ingang, bereikbaar: false, reden: eerste.fout || `HTTP ${eerste.status}`, feeds: [], sporen: [] };
  }

  const feeds = [];
  let geprobeerd = 0;
  if (isFeed(eerste.type, eerste.tekst)) {
    feeds.push({ url: eerste.url, titel: "(opgegeven URL is zelf een feed)", ...feedSamenvatting(eerste.tekst), status: eerste.status });
  } else {
    for (const kandidaat of feedsUitPagina(eerste.tekst, eerste.url).slice(0, 6)) {
      const f = await haal(kandidaat.url, "application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8");
      feeds.push({
        url: kandidaat.url,
        titel: kandidaat.titel,
        status: f.status,
        ...(f.ok && isFeed(f.type, f.tekst) ? feedSamenvatting(f.tekst) : { items: 0, nieuwste: null, dagenOud: null }),
        geldig: f.ok && isFeed(f.type, f.tekst),
      });
    }
    regels.push(`pagina: HTTP ${eerste.status}, ${feeds.length} aangekondigde feed(s)`);

    // Niets aangekondigd? Dan de gebruikelijke paden proberen voordat we
    // "geen feed" durven zeggen.
    if (!feeds.some((f) => f.geldig)) {
      for (const pad of GEBRUIKELIJKE_PADEN) {
        let kandidaat;
        try {
          kandidaat = new URL(pad, eerste.url).href;
        } catch {
          continue;
        }
        if (feeds.some((f) => f.url === kandidaat)) continue;
        const f = await haal(kandidaat, "application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8");
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

  return { ingang, bereikbaar: true, status: eerste.status, feeds, geprobeerd, sporen: licentieSporen(sporenTekst), regels };
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
      `Bereikbaar (HTTP ${r.status}), maar **hier geen feed gevonden**: niets aangekondigd in de pagina` +
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
  if (r.sporen.length) {
    console.log("Licentiesporen op de site: " + r.sporen.map((s) => `${s.goed ? "✓" : "⚠"} ${s.oordeel}`).join(" · "));
  } else {
    console.log("Licentiesporen op de site: **geen gevonden** — zelf nakijken.");
  }
  console.log("\n> Een spoor is een aanwijzing, geen toestemming. De licentie hoort per bron met de hand vastgesteld te worden voordat hij live gaat.\n");
}
