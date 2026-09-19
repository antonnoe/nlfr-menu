// Bundelt src/inlog.js tot assets/inlog.js.
// ---------------------------------------------------------------------------
//     npm run bouw:inlog
//
// Zie de kop van src/inlog.js voor waarom het resultaat in de repo staat en
// niet tijdens de deploy wordt gemaakt. Draai dit opnieuw na elke update van
// @supabase/ssr of @supabase/supabase-js.

import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFileSync, readFileSync } from "node:fs";

const eis = createRequire(import.meta.url);
const ssr = eis("@supabase/ssr/package.json").version;
const js = eis("@supabase/supabase-js/package.json").version;

// IIFE met een globale naam, geen ESM-module: de pagina's van dit project
// draaien klassieke scripts, en een <script type="module"> zou de volgorde
// waarin ze laden veranderen.
await build({
  entryPoints: ["src/inlog.js"],
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

// De versies ook machineleesbaar, zodat de test kan vaststellen dat de bundel
// bij de geïnstalleerde pakketten hoort.
writeFileSync(
  "assets/inlog.versies.json",
  JSON.stringify({ ssr, supabaseJs: js }, null, 2) + "\n"
);

const groot = readFileSync("assets/inlog.js").length;
console.log(`assets/inlog.js gemaakt — ${(groot / 1024).toFixed(0)} kB · ssr ${ssr} · supabase-js ${js}`);
