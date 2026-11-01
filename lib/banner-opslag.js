// Het KV-record "banner" lezen, met banner.json als startwaarde. Gedeeld door
// api/banner.js (lezen en schrijven met token) en api/review.js (de actie
// "cafejeudi"), zodat beide hetzelfde record op dezelfde manier lezen.

import fs from "node:fs";
import path from "node:path";
import { getJSON, getJSONStrikt } from "./store.js";
import { normaliseer, STANDAARD } from "./banner.js";

export const KV_SLEUTEL_BANNER = "banner";

// De startwaarde uit de repo. Eén keer lezen en onthouden: het bestand
// verandert niet tijdens de looptijd van een functie-instantie.
let startwaardeCache = null;
export function startwaarde() {
  if (startwaardeCache) return startwaardeCache;
  try {
    const bestand = path.join(process.cwd(), "banner.json");
    startwaardeCache = normaliseer(JSON.parse(fs.readFileSync(bestand, "utf8")));
  } catch {
    // Ook zonder het bestand een werkend antwoord: het schema staat in lib/.
    startwaardeCache = normaliseer(STANDAARD);
  }
  return startwaardeCache;
}

// { record, bron } — record is altijd volledig genormaliseerd.
export async function leesBanner() {
  let record = null;
  try {
    record = await getJSON(KV_SLEUTEL_BANNER);
  } catch {
    record = null;
  }
  return record
    ? { record: normaliseer(record), bron: "kv" }
    : { record: startwaarde(), bron: "banner.json" };
}

// Voor lezen-wijzigen-schrijven: een ONTBREKEND record geeft de startwaarde
// (bron "banner.json"), maar een MISLUKTE lezing (KV onbereikbaar, foutstatus,
// onleesbare JSON) gooit. Zo schrijft niemand de startwaarde over een bestaand
// record heen alleen omdat KV even niet antwoordde.
export async function leesBannerStrikt() {
  const record = await getJSONStrikt(KV_SLEUTEL_BANNER);
  return record
    ? { record: normaliseer(record), bron: "kv" }
    : { record: startwaarde(), bron: "banner.json" };
}
