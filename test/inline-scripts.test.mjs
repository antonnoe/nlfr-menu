// Elke inline <script> in de HTML-pagina's moet geldige JavaScript zijn.
// Aanleiding (20-11-2026): een aanhalingsteken in selectie.html maakte het hele
// script ongeldig; /selectie bleef sinds de livegang op "Laden…" staan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const paginas = readdirSync(new URL("..", import.meta.url)).filter((f) => f.endsWith(".html"));

for (const p of paginas) {
  test(`inline scripts in ${p} zijn geldige JavaScript`, () => {
    const html = readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, n = 0;
    while ((m = re.exec(html))) {
      if (/type=["'](?!text\/javascript|module)/i.test(m[1])) continue;
      n++;
      if (/type=["']module/i.test(m[1])) continue; // modules: import/export, apart
      assert.doesNotThrow(() => new vm.Script(m[2], { filename: `${p}#script${n}` }), `${p}, script ${n}`);
    }
  });
}
