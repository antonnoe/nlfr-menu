// De modelaanroep van de nieuwsselectie.
// ---------------------------------------------------------------------------
// Sonnet, met een eigen modelconstante: de selectie is uitvoerend werk en moet
// goedkoop blijven, ook als iemand MENU_AI_MODEL voor de syntheses op een
// zwaarder model zet. Te wisselen met SELECTIE_AI_MODEL in Vercel.
//
// Eén aanroep beoordeelt een hele batch berichten tegelijk (hooguit
// SEL_MAX_PER_AANROEP). Het model denkt kort (effort "low"): het gaat om een
// oordeel per bericht, niet om tekst schrijven.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_SELECTIE, bouwInvoer, leesModelAntwoord } from "./kern.js";

const STANDAARD = "claude-sonnet-5-5";
const gekozen = String((typeof process !== "undefined" && process.env && process.env.SELECTIE_AI_MODEL) || "").trim();
export const SELECTIE_MODEL = /^[A-Za-z0-9._:-]{3,80}$/.test(gekozen) ? gekozen : STANDAARD;
export const SELECTIE_MAX_TOKENS = 8000;

// Eigen tijdslimiet: de functie heeft 60 s, en een hangende aanroep mag de
// ronde niet laten afbreken voordat de kandidaten zijn opgeslagen.
export async function beoordeel(items, voorbeelden, maakClient = () => new Anthropic({ timeout: 40000, maxRetries: 0 })) {
  if (!items.length) return new Map();
  const client = maakClient();
  const resp = await client.messages.create({
    model: SELECTIE_MODEL,
    max_tokens: SELECTIE_MAX_TOKENS,
    output_config: { effort: "low" },
    thinking: { type: "adaptive" },
    system: SYSTEM_SELECTIE,
    messages: [{ role: "user", content: bouwInvoer(items, voorbeelden) }],
  });
  if (resp.stop_reason === "refusal") throw new Error("Het model weigerde deze batch (refusal).");
  const tekst = (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!tekst) {
    throw new Error(`Leeg modelantwoord (stop_reason=${resp.stop_reason}, outputtokens=${resp.usage && resp.usage.output_tokens}).`);
  }
  return leesModelAntwoord(tekst, items);
}
