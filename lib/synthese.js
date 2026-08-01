// AI-synthese van een hot cluster via de Anthropic API.
// ---------------------------------------------------------------------------
// Model, max_tokens en effort komen uit AI_CONFIG (lib/config.js) — één
// constante, later bij te stellen. Het resultaat is ALTIJD een concept; het
// publiceren gebeurt pas in de reviewtool.
//
// De bronnenlijst onderaan bouwen we uit de ECHTE clusterdata (titel + URL),
// niet uit de modeltekst — zo staan er nooit verzonnen links onder een
// synthese. Het model schrijft alleen de lopende NL-tekst.

import Anthropic from "@anthropic-ai/sdk";
import { AI_CONFIG, SYNTHESE_WOORDEN_MIN, SYNTHESE_WOORDEN_MAX } from "./config.js";

const SYSTEM = `Je bent eindredacteur van Nederlanders.fr. Je schrijft één korte, feitelijke nieuwssynthese in het Nederlands over een onderwerp dat door meerdere Franse en/of Nederlandse bronnen wordt gemeld.

HARDE REGELS:
- Schrijf in je EIGEN formulering. Vertaal geen zinnen letterlijk uit de bronnen.
- Gebruik GEEN citaten en GEEN aanhalingstekens rond brontekst.
- Synthetiseer over ALLE aangeleverde bronnen samen, niet één bron navertellen.
- Neem een feitelijke claim ALLEEN op als minstens twee onafhankelijke bronnen die melden. Bij twijfel: weglaten of voorzichtig formuleren ("meerdere bronnen melden dat…").
- Lengte van de synthese: ${SYNTHESE_WOORDEN_MIN} tot ${SYNTHESE_WOORDEN_MAX} woorden. Neutrale, nuchtere toon.

UITVOERFORMAAT (exact):
- Eerste regel: een korte Nederlandse kop van maximaal 8 woorden. Geen punt aan het eind, geen aanhalingstekens, geen "Titel:" ervoor.
- Dan één lege regel.
- Dan de lopende synthese. Geen kopjes, geen bronnenlijst, geen links; die worden apart toegevoegd.`;

// Overheidsbronnen (Licence Ouverte): NL-samenvatting van 2-4 zinnen mag direct
// automatisch live. Feitelijk, eigen formulering, geen citaten.
const SYSTEM_OVERHEID = `Je bent redacteur van Nederlanders.fr. Je vat een Frans overheidsbericht samen in vlot, feitelijk Nederlands.

HARDE REGELS:
- Eigen formulering; vertaal geen zinnen letterlijk, gebruik geen citaten.
- De samenvatting is 2 tot 4 zinnen. Alleen de kern: wat verandert er, voor wie, per wanneer.

UITVOERFORMAAT (exact):
- Eerste regel: een korte Nederlandse kop van maximaal 8 woorden. Geen punt aan het eind, geen aanhalingstekens, geen "Titel:" ervoor.
- Dan één lege regel.
- Dan de samenvatting (2-4 zinnen). Geen kopjes, geen bronvermelding, geen links.`;

// Splitst het modelantwoord in { kop, tekst }: eerste regel = kop, de rest =
// lopende tekst. Robuust tegen ontbrekende lege regel of een "Kop:/Titel:"-prefix.
function splitsKop(ruw) {
  const schoon = String(ruw || "").trim();
  if (!schoon) return { kop: "", tekst: "" };
  const regels = schoon.split(/\r?\n/);
  let kop = (regels.shift() || "").trim();
  kop = kop.replace(/^(kop|titel)\s*:\s*/i, "").replace(/^["'«»]+|["'«».]+$/g, "").trim();
  const tekst = regels.join("\n").replace(/^\s+/, "").trim();
  // Geen lege regel gebruikt door het model? Dan staat alles op één regel; val
  // terug op de hele tekst als body en een lege kop (de weergave leidt er dan
  // zelf een kop uit af).
  if (!tekst) return { kop: "", tekst: kop };
  return { kop, tekst };
}

export async function samenvatOverheid(item) {
  const client = new Anthropic();
  const invoer = `Bron: ${item.bron}\nTitel: ${item.titel}${
    item.samenvatting ? `\nTekst: ${item.samenvatting}` : ""
  }\n\nSchrijf een korte NL-kop en vat dit overheidsbericht samen in 2-4 zinnen Nederlands.`;
  const resp = await client.messages.create({
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    output_config: { effort: AI_CONFIG.effort },
    system: SYSTEM_OVERHEID,
    messages: [{ role: "user", content: invoer }],
  });
  if (resp.stop_reason === "refusal") {
    throw new Error("Anthropic weigerde deze samenvatting (refusal).");
  }
  const ruw = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!ruw) throw new Error("Lege overheidssamenvatting ontvangen.");
  const { kop, tekst } = splitsKop(ruw);
  return { kop, samenvatting: tekst, model: AI_CONFIG.model };
}

// Eén item per artikel (ontdubbeld op URL), met publicatietijdstip. De
// weergave groepeert deze per bron en toont per aangehaald artikel de link
// mét tijdstip.
export function bouwBronnen(cluster) {
  const gezien = new Set();
  const uit = [];
  for (const item of cluster.items) {
    if (!item.url || gezien.has(item.url)) continue;
    gezien.add(item.url);
    uit.push({ naam: item.bron, titel: item.titel, url: item.url, datum: item.datum });
  }
  return uit;
}

function bouwGebruikersTekst(cluster) {
  const regels = cluster.items.map((item, i) => {
    const datum = item.datum ? new Date(item.datum).toISOString().slice(0, 16).replace("T", " ") : "?";
    const extra =
      item.regime === "overheid" && item.samenvatting
        ? `\n   samenvatting (overheid): ${item.samenvatting}`
        : "";
    return `${i + 1}. [${item.bron}] ${item.titel} (${datum})${extra}`;
  });
  return `Onderwerp gemeld door ${cluster.aantalBronnen} onafhankelijke bronnen. Hieronder de koppen (en waar beschikbaar de overheidssamenvatting). Persbronnen leveren alleen een kop; leid daar geen details uit af die niet door minstens twee bronnen worden bevestigd.

${regels.join("\n")}

Schrijf nu een korte NL-kop en daaronder de Nederlandse synthese (${SYNTHESE_WOORDEN_MIN}-${SYNTHESE_WOORDEN_MAX} woorden), volgens de harde regels en het uitvoerformaat.`;
}

export async function synthetiseer(cluster) {
  const client = new Anthropic(); // leest ANTHROPIC_API_KEY uit de omgeving
  const resp = await client.messages.create({
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    output_config: { effort: AI_CONFIG.effort },
    system: SYSTEM,
    messages: [{ role: "user", content: bouwGebruikersTekst(cluster) }],
  });

  if (resp.stop_reason === "refusal") {
    throw new Error("Anthropic weigerde deze synthese (stop_reason=refusal).");
  }
  const ruw = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!ruw) throw new Error("Lege synthese ontvangen.");
  const { kop, tekst } = splitsKop(ruw);

  return {
    kop,
    tekst,
    bronnen: bouwBronnen(cluster),
    model: AI_CONFIG.model,
    afgekapt: resp.stop_reason === "max_tokens",
  };
}
