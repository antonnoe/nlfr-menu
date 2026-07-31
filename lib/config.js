// Centrale configuratie voor de route /actueel.
// ---------------------------------------------------------------------------
// AI_CONFIG is bewust ÉÉN constante: model, max_tokens en effort van de
// Anthropic-synthese staan hier bij elkaar, zodat ze later op één plek zijn bij
// te stellen zonder de synthesecode aan te raken. Kies eventueel een goedkoper
// model (bv. "claude-sonnet-5") door alleen `model` te wijzigen.
export const AI_CONFIG = {
  model: "claude-opus-5",
  maxTokens: 2000, // ruimte voor (adaptief) denken + ~150-250 woorden NL
  effort: "medium", // low | medium | high | xhigh | max
};

// Versheid & cache. De feed is stale-while-revalidate; de CDN serveert een
// (iets) oude versie direct en ververst op de achtergrond. ~5 min target.
export const FEED_MAX_AGE_S = 300; // 5 min verse cache
export const FEED_SWR_S = 300; // extra 5 min stale-while-revalidate

// Feed-ophalen: per bron een korte timeout; een trage of kapotte bron mag de
// hele route niet ophouden (resilience zoals in de bosbrandentool).
export const FEED_TIMEOUT_MS = 8000;

// Hot-clustering.
export const HOT_VENSTER_UREN = 12; // items van de afgelopen 12 uur clusteren
export const HOT_MIN_BRONNEN = 3; // >= 3 onafhankelijke bronnen -> "hot"
export const DATUMPOORT_UREN = 48; // items ouder dan dit tonen we niet in de feed

// Concept-/publicatie-opslag (Vercel KV / Upstash Redis, via REST).
export const CONCEPT_TTL_S = 48 * 60 * 60; // concepten verlopen automatisch na 48 uur
export const KV_PREFIX = "actueel:";
export const KEY_CONCEPT = (id) => `${KV_PREFIX}concept:${id}`;
export const KEY_PUBLICATIE = (id) => `${KV_PREFIX}publicatie:${id}`;
export const KEY_AFGEWEZEN = (id) => `${KV_PREFIX}afgewezen:${id}`;
export const SCAN_CONCEPT = `${KV_PREFIX}concept:*`;
export const SCAN_PUBLICATIE = `${KV_PREFIX}publicatie:*`;

// Hooguit zoveel nieuwe syntheses per cron-ronde (kosten/tijd begrenzen).
export const MAX_SYNTHESE_PER_RONDE = 2;

// Redactielabel dat boven een gepubliceerde synthese komt te staan.
export const REDACTIE_LABEL =
  "Redactie NLFR — automatisch samengesteld, bronnen onderaan";
