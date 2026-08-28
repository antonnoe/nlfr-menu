// Meet de responstijd en de payloadgrootte van /api/actueel.
// ---------------------------------------------------------------------------
// WAAROM. De cache-miss van deze route was 12 s (twee metingen op productie),
// de hit 0,06 s. Om vast te stellen of een ingreep daar iets aan doet, moet je
// die twee gevallen apart kunnen meten — en reproduceerbaar, niet met de hand.
//
// EEN MISS FORCEREN. De edge-cache is per URL. Een willekeurige querystring
// (?meting=12345) is dus een URL die de CDN nog nooit heeft gezien: die
// beslist altijd een miss. Zonder querystring meet je de hit.
//
// Draaien:  node scripts/meet-actueel.mjs
//   MEET_URL     overschrijft de basis-URL (standaard nlfr-menu.vercel.app)
//   MEET_RONDES  aantal miss-metingen (standaard 3)
//
// De uitvoer is een markdown-tabel, klaar om onder docs/ te plakken.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const uitvoeren = promisify(execFile);

const BASIS = (process.env.MEET_URL || "https://nlfr-menu.vercel.app").replace(/\/+$/, "");
const RONDES = Number(process.env.MEET_RONDES || 3);
const API = `${BASIS}/api/actueel`;

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

const missen = [];
for (let i = 1; i <= RONDES; i += 1) {
  // Cache-buster: nieuwe URL = gegarandeerde edge-miss.
  missen.push(await meet(`${API}?meting=${Math.floor(Math.random() * 1e6)}`, { brotli: false }));
}
const hit = await meet(API, { brotli: false });
const hitBrotli = await meet(API, { brotli: true });

console.log(`Meting /api/actueel — ${new Date().toISOString()} — doel ${API}\n`);
console.log("| meting | tijd tot eerste byte | bytes | http | herkomst | edge |");
console.log("| --- | --- | --- | --- | --- | --- |");
missen.forEach((m, i) => console.log(regel(`miss ${i + 1} (cache-buster)`, m)));
console.log(regel("hit (zonder querystring)", hit));
console.log(regel("hit, brotli", hitBrotli));

const tijden = missen.map((m) => m.seconden).sort((a, b) => a - b);
const mediaan = tijden[Math.floor(tijden.length / 2)];
console.log(`\nMediaan van de missen: ${mediaan.toFixed(3)} s`);
console.log(`Payload onbewerkt: ${hit.bytes} bytes; brotli: ${hitBrotli.bytes} bytes`);
console.log(`Cache-Control: ${hit.cacheControl}`);
