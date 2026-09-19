// Bundelt src/inlog.js tot assets/inlog.js.
// ---------------------------------------------------------------------------
//     npm run bouw:inlog
//
// Zie de kop van src/inlog.js voor waarom het resultaat in de repo staat en
// niet tijdens de deploy wordt gemaakt. Draai dit opnieuw na elke update van
// @supabase/ssr of @supabase/supabase-js.

import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";

const eis = createRequire(import.meta.url);
const ssr = eis("@supabase/ssr/package.json").version;
const js = eis("@supabase/supabase-js/package.json").version;

// IIFE met een globale naam, geen ESM-module: de pagina's van dit project
// draaien klassieke scripts, en een <script type="module"> zou de volgorde
// waarin ze laden veranderen.
const uitslag = await build({
  entryPoints: ["src/inlog.js"],
  // De metafile vertelt welke bestanden er werkelijk in de bundel zijn beland.
  // Daaruit komt de vingerafdruk hieronder — niet uit een met de hand
  // bijgehouden lijst, want die raakt achter zodra er een import bij komt.
  metafile: true,
  outfile: "assets/inlog.js",
  bundle: true,
  format: "iife",
  globalName: "NLFRAuth",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
  banner: {
    js:
      "/* NLFR inlogbundel — GEGENEREERD BESTAND, niet met de hand bewerken.\n" +
      `   Bron: src/inlog.js · @supabase/ssr ${ssr} · @supabase/supabase-js ${js}\n` +
      "   Opnieuw maken: npm run bouw:inlog */",
  },
});

// ---- De vingerafdruk van de bouw -------------------------------------------
// WAAROM VERSIENUMMERS NIET GENOEG ZIJN (Copilot op PR #51, zie docs/login.md
// §4.10). De eerste versie schreef alleen de pakketversies weg. Wijzigde
// src/inlog.js zonder een nieuwe bouw, dan bleef assets/inlog.js oud terwijl de
// toets groen bleef — en draaide de browser andere code dan de repo liet zien.
//
// Nu wordt van ELK eigen bronbestand dat in de bundel is beland een hash
// vastgelegd, plus een hash van het resultaat zelf. Bestanden uit node_modules
// blijven erbuiten: die worden al door de pakketversies en package-lock.json
// afgedekt, en het zijn er honderden.
function hash(pad) {
  return createHash("sha256").update(readFileSync(pad)).digest("hex").slice(0, 16);
}

const bronnen = {};
for (const pad of Object.keys(uitslag.metafile.inputs)) {
  if (pad.includes("node_modules")) continue;
  bronnen[pad] = hash(pad);
}

writeFileSync(
  "assets/inlog.versies.json",
  JSON.stringify(
    { ssr, supabaseJs: js, bronnen, bundel: hash("assets/inlog.js") },
    null,
    2
  ) + "\n"
);

const groot = readFileSync("assets/inlog.js").length;
console.log(`assets/inlog.js gemaakt — ${(groot / 1024).toFixed(0)} kB · ssr ${ssr} · supabase-js ${js}`);
