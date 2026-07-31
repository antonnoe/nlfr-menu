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
import { AI_CONFIG } from "./config.js";

const SYSTEM = `Je bent eindredacteur van Nederlanders.fr. Je schrijft één korte, feitelijke nieuwssynthese in het Nederlands over een onderwerp dat door meerdere Franse en/of Nederlandse bronnen wordt gemeld.

HARDE REGELS:
- Schrijf in je EIGEN formulering. Vertaal geen zinnen letterlijk uit de bronnen.
- Gebruik GEEN citaten en GEEN aanhalingstekens rond brontekst.
- Synthetiseer over ALLE aangeleverde bronnen samen, niet één bron navertellen.
- Neem een feitelijke claim ALLEEN op als minstens twee onafhankelijke bronnen die melden. Bij twijfel: weglaten of voorzichtig formuleren ("meerdere bronnen melden dat…").
- Lengte: 100 tot 250 woorden. Neutrale, nuchtere toon.
- Schrijf UITSLUITEND de lopende tekst. Voeg GEEN titel, GEEN kopjes, GEEN bronnenlijst en GEEN links toe; die worden apart toegevoegd.`;

// Overheidsbronnen (Licence Ouverte): NL-samenvatting van 2-4 zinnen mag direct
// automatisch live. Feitelijk, eigen formulering, geen citaten.
const SYSTEM_OVERHEID = `Je bent redacteur van Nederlanders.fr. Je vat een Frans overheidsbericht samen in vlot, feitelijk Nederlands.

HARDE REGELS:
- 2 tot 4 zinnen. Alleen de kern: wat verandert er, voor wie, per wanneer.
- Eigen formulering; vertaal geen zinnen letterlijk, gebruik geen citaten.
- Geen titel, geen kopjes, geen bronvermelding, geen links — alleen de samenvatting.`;

export async function samenvatOverheid(item) {
  const client = new Anthropic();
  const invoer = `Bron: ${item.bron}\nTitel: ${item.titel}${
    item.samenvatting ? `\nTekst: ${item.samenvatting}` : ""
  }\n\nVat dit overheidsbericht samen in 2-4 zinnen Nederlands.`;
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
  const samenvatting = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!samenvatting) throw new Error("Lege overheidssamenvatting ontvangen.");
  return { samenvatting, model: AI_CONFIG.model };
}

export function bouwBronnen(cluster) {
  const gezien = new Set();
  const uit = [];
  for (const item of cluster.items) {
    if (!item.url || gezien.has(item.url)) continue;
    gezien.add(item.url);
    uit.push({ naam: item.bron, titel: item.titel, url: item.url });
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

Schrijf nu de Nederlandse synthese (150-250 woorden), volgens de harde regels.`;
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
  const tekst = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!tekst) throw new Error("Lege synthese ontvangen.");

  return {
    tekst,
    bronnen: bouwBronnen(cluster),
    model: AI_CONFIG.model,
    afgekapt: resp.stop_reason === "max_tokens",
  };
}
