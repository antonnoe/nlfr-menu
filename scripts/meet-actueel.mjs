// Meet de responstijd en de payloadgrootte van de nieuwspagina.
// ---------------------------------------------------------------------------
// WAAROM. De cache-miss van /api/actueel was ooit 12 s (opgelost met een
// voorgebakken snapshot), en daarna was de payload zelf aan de beurt: 318 kB
// onbewerkt voor 152 artikelen. Sinds de splitsing zijn er TWEE leveringen
// (zie lib/levering.js), en dan is één getal niet meer genoeg — je wilt weten
// wat de lezer binnenhaalt vóór de eerste weergave, en wat in totaal.
//
// EEN MISS FORCEREN. De edge-cache is per URL. Een willekeurige querystring
// (?meting=12345) is dus een URL die de CDN nog nooit heeft gezien: die
// betekent altijd een miss. Zonder querystring meet je de hit.
//
// Draaien:  node scripts/meet-actueel.mjs
//   MEET_URL     overschrijft de basis-URL (standaard nlfr-menu.vercel.app)
//   MEET_RONDES  aantal miss-metingen per route (standaard 3)
//
// De uitvoer is markdown, klaar om onder docs/ te plakken.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const uitvoeren = promisify(execFile);

const BASIS = (process.env.MEET_URL || "https://nlfr-menu.vercel.app").replace(/\/+$/, "");
const RONDES = Number(process.env.MEET_RONDES || 3);

const ROUTES = [
  { naam: "compact", pad: "/api/actueel", uitleg: "levering 1 — wat de dichte staat toont" },
  { naam: "tekst", pad: "/api/actueel-tekst", uitleg: "levering 2 — tekst + bronnen" },
];

// Eén curl-meting. `-w` levert de cijfers die ertoe doen: time_starttransfer is
// de tijd tot de eerste byte (dus inclusief het samenstellen aan de serverkant),
// size_download de payload zoals hij over de lijn ging.
async function meet(url, { brotli }) {
  const args = [
    "-s", "-o", "/dev/null",
    "-D", "-", // headers naar stdout, zodat X-Actueel-Herkomst en x-vercel-cache mee komen
    "-w", "\\nMETING %{time_starttransfer} %{size_download} %{http_code}\\n",
    ...(brotli ? ["-H", "Accept-Encoding: br"] : ["-H", "Accept-Encoding: identity"]),
    url,
  ];
  let stdout;
  try {
    ({ stdout } = await uitvoeren("curl", args, { maxBuffer: 32 * 1024 * 1024 }));
  } catch (e) {
    // curl-exitcode 56/7/28: het antwoord kwam niet binnen. Meestal een proxy of
    // firewall tussen deze machine en productie. Dat is GEEN meting van 0 s —
    // dus melden en stoppen, niet stilletjes een nul rapporteren.
    const kop = String(e.stdout || "").split("\n")[0].trim();
    throw new Error(
      `curl kon ${url} niet bereiken (exitcode ${e.code})` + (kop ? ` — eerste antwoordregel: ${kop}` : "")
    );
  }
  const regel = stdout.split("\n").find((r) => r.startsWith("METING")) || "";
  const [, tijd, grootte, code] = regel.split(/\s+/);
  const kop = (naam) => {
    const m = stdout.match(new RegExp(`^${naam}:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : "";
  };
  return {
    seconden: Number(tijd),
    bytes: Number(grootte),
    http: Number(code),
    herkomst: kop("x-actueel-herkomst") || "(geen header)",
    edge: kop("x-vercel-cache") || "(geen header)",
    cacheControl: kop("cache-control") || "(geen header)",
  };
}

function regel(label, m) {
  return `| ${label} | ${m.seconden.toFixed(3)} s | ${m.bytes} | ${m.http} | ${m.herkomst} | ${m.edge} |`;
}
const mediaanVan = (lijst) => {
  const g = [...lijst].sort((a, b) => a - b);
  return g[Math.floor(g.length / 2)];
};

console.log(`Meting nieuwspagina — ${new Date().toISOString()} — doel ${BASIS}\n`);

const samenvatting = [];
for (const route of ROUTES) {
  const url = `${BASIS}${route.pad}`;
  const missen = [];
  for (let i = 1; i <= RONDES; i += 1) {
    // Cache-buster: nieuwe URL = gegarandeerde edge-miss.
    missen.push(await meet(`${url}?meting=${Math.floor(Math.random() * 1e6)}`, { brotli: false }));
  }
  const hit = await meet(url, { brotli: false });
  const hitBrotli = await meet(url, { brotli: true });

  console.log(`## ${route.pad} — ${route.uitleg}\n`);
  console.log("| meting | tijd tot eerste byte | bytes | http | herkomst | edge |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  missen.forEach((m, i) => console.log(regel(`miss ${i + 1} (cache-buster)`, m)));
  console.log(regel("hit (zonder querystring)", hit));
  console.log(regel("hit, brotli", hitBrotli));
  console.log(
    `\nMediaan van de missen: ${mediaanVan(missen.map((m) => m.seconden)).toFixed(3)} s` +
      `  ·  onbewerkt ${hit.bytes} bytes  ·  brotli ${hitBrotli.bytes} bytes`
  );
  console.log(`Cache-Control: ${hit.cacheControl}\n`);
  samenvatting.push({ ...route, onbewerkt: hit.bytes, brotli: hitBrotli.bytes });
}

// ---- Wat een lezer werkelijk binnenhaalt ----------------------------------
// De pagina rendert op levering 1 en haalt levering 2 daarna op de ACHTERGROND
// op. Openklappen kost dus geen extra verzoek: scenario (a) en (b) halen
// dezelfde bytes binnen. Wat wél verschilt is het moment — en dat is precies
// waar de splitsing voor is.
const compact = samenvatting.find((r) => r.naam === "compact");
const tekst = samenvatting.find((r) => r.naam === "tekst");
if (compact && tekst) {
  console.log("## Wat een lezer binnenhaalt\n");
  console.log("| scenario | over de lijn (brotli) | onbewerkt |");
  console.log("| --- | --- | --- |");
  console.log(`| vóór de eerste weergave | ${compact.brotli} | ${compact.onbewerkt} |`);
  console.log(
    `| (a) pagina openen, niets openklappen | ${compact.brotli + tekst.brotli} | ${compact.onbewerkt + tekst.onbewerkt} |`
  );
  console.log(
    `| (b) pagina openen, één artikel openklappen | ${compact.brotli + tekst.brotli} | ${compact.onbewerkt + tekst.onbewerkt} |`
  );
  console.log(
    "\n(a) en (b) zijn gelijk: levering 2 wordt na de eerste weergave op de " +
      "achtergrond opgehaald, dus openklappen kost geen extra verzoek."
  );
}

// ---- Bakmoment en inhoudstelling uit de antwoorden zelf --------------------
try {
  const [c, t] = await Promise.all([
    fetch(`${BASIS}/api/actueel`, { headers: { Accept: "application/json" } }).then((r) => r.json()),
    fetch(`${BASIS}/api/actueel-tekst`, { headers: { Accept: "application/json" } }).then((r) => r.json()),
  ]);
  const artikelen = (c.tegels || []).reduce((n, x) => n + (x.artikelen || []).length, 0);
  console.log(
    `\nBakmoment compact: ${c.bijgewerkt || "(ontbreekt)"}  ·  tekst: ${t.bijgewerkt || "(ontbreekt)"}`
  );
  console.log(
    `Inhoud: ${(c.tegels || []).length} tegels, ${artikelen} artikelen, ` +
      `${Object.keys(t.artikelen || {}).length} tekst-records, ` +
      `${(c.bronStatus || []).length} bronnen in bronStatus`
  );
  // Hoe de bytes verdeeld zijn — het cijfer waar de splitsing op gebaseerd is.
  const veldBytes = (kies) =>
    Object.values(t.artikelen || {}).reduce((n, a) => n + JSON.stringify(kies(a) ?? "").length, 0);
  console.log(
    `Waarvan in levering 2: tekst ${veldBytes((a) => a.tekst)} bytes, ` +
      `bronnen ${veldBytes((a) => a.bronnen)} bytes (onbewerkt)`
  );
} catch (e) {
  console.log(`\nBakmoment/inhoud niet op te halen: ${e.message}`);
}
