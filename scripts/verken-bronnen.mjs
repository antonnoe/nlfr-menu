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
// Draaien:  node scripts/verken-bronnen.mjs <url> [<url> ...]
//           BRONNEN="url1,url2" node scripts/verken-bronnen.mjs
// De uitvoer is markdown, klaar om in een bericht of onder docs/ te plakken.

const TIMEOUT_MS = 20000;
const UA = "NLFR-bronverkenner/1.0 (+https://nederlanders.fr)";
// Sommige sites (svb.nl, dutchculture.nl) beantwoorden een onbekende agent met
// een 403. Dat zegt niets over de feed en alles over de User-Agent, dus krijgt
// zo'n weigering nog één poging als gewone browser.
const UA_BROWSER =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const ACCEPT_FEED =
  "application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8";

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

async function eenmaalHalen(url, accept, agent) {
  const ctrl = new AbortController();
  const klok = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": agent, Accept: accept },
    });
    const tekst = await r.text();
    return { ok: r.ok, status: r.status, type: r.headers.get("content-type") || "", tekst, url: r.url };
  } catch (e) {
    return { ok: false, status: 0, type: "", tekst: "", url, fout: e.name === "AbortError" ? "tijd verstreken" : e.message };
  } finally {
    clearTimeout(klok);
  }
}

async function haal(url, accept) {
  const eerste = await eenmaalHalen(url, accept, UA);
  if (eerste.status !== 403) return eerste;
  const tweede = await eenmaalHalen(url, accept, UA_BROWSER);
  return tweede.ok ? { ...tweede, browserNodig: true } : eerste;
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
// Hoeveel op de pagina gelinkte feedkandidaten we hooguit natrekken.
const MAX_GELINKT = 25;

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

// Feeds die de site in de PAGINA zelf aanbiedt in plaats van in de <head>.
// Rijksoverheid, RVO en KVK hebben een pagina "RSS-feeds" of "nieuwsbrieven"
// waar de feeds als doodgewone links staan. Wie alleen de <head> leest ziet
// daar niets en concludeert ten onrechte "geen feed". Dit is nadrukkelijk geen
// gokken: het volgt uitsluitend links die de site zelf publiceert.
function feedLinksUitTekst(html, basis) {
  const uit = new Map();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const tekst = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const lijktUrl = /\.rss(\?|$)|\.atom(\?|$)|\.xml(\?|$)|(^|[/.?=&-])rss([/.?&=-]|$)|(^|[/?=&-])feed([/.?&=-]|$)/i.test(href);
    const lijktTekst = /\brss\b|\batom[\s-]?feed\b/i.test(tekst);
    if (!lijktUrl && !lijktTekst) continue;
    try {
      const url = new URL(href, basis).href;
      if (!/^https?:/i.test(url)) continue;
      if (!uit.has(url)) uit.set(url, tekst.slice(0, 60));
    } catch { /* onbruikbare href */ }
  }
  return [...uit].map(([url, titel]) => ({ url, titel }));
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

// Diagnose. Als een verkenning een uitkomst geeft die niet kan kloppen — "geen
// feedlink" op een pagina die de feedlijst van de Rijksoverheid is — dan is de
// vraag niet welke regexp beter moet, maar WAT de runner eigenlijk binnenkrijgt.
// Met BRON_DUMP=1 toont hij dat: de lengte, het aantal links, de content-type
// en het begin van de HTML. Een JS-schil of een WAF-uitdaging zie je zo meteen.
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
