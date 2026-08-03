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
export const HOT_MIN_BRONNEN = 3; // >= 3 bronnen -> "hot" (visuele markering, niet de synthese-drempel)
// Synthese-drempel: vanaf ZOVEEL onafhankelijke bronnen maakt de cron een
// pers-concept (verlaagd van 3 naar 2). De pulserende dot blijft een
// versheids-markering (cluster nog binnen HOT_VENSTER_UREN), niet het bronaantal.
export const SYNTHESE_MIN_BRONNEN = 2;
// Aanscherping clustering (voorkomt losse merges op generieke termen):
export const MIN_SPECIFIEK_GEDEELD = 2; // >= 2 gedeelde BETEKENISVOLLE termen nodig
export const MAX_PER_BRON_CLUSTER = 2; // hooguit 2 items per bron in één cluster

// Datumvenster per regime. Persbronnen: kort (24 u), zodat een snelle bron de
// pagina niet overspoelt. Overheidsbronnen: ruimer (72 u), want die publiceren
// traag. Een bron kan dit overrulen met "vensterDagen" in bronnen.json.
export const VENSTER_PERS_UREN = 24;
export const VENSTER_OVERHEID_UREN = 72;

// Volume-cap in de themaweergave: hooguit zoveel items per bron (nieuwste
// eerst), zodat geen enkele bron de lijst domineert.
export const MAX_ITEMS_PER_BRON_THEMA = 15;

// Concept-/publicatie-opslag (Vercel KV / Upstash Redis, via REST).
export const CONCEPT_TTL_S = 48 * 60 * 60; // concepten verlopen automatisch na 48 uur
export const OVERHEID_TTL_S = 5 * 24 * 60 * 60; // NL-overheidsberichten: 5 dagen zichtbaar
export const KV_PREFIX = "actueel:";
export const KEY_CONCEPT = (id) => `${KV_PREFIX}concept:${id}`;
export const KEY_PUBLICATIE = (id) => `${KV_PREFIX}publicatie:${id}`;
export const KEY_AFGEWEZEN = (id) => `${KV_PREFIX}afgewezen:${id}`;
export const KEY_OVERHEID = (id) => `${KV_PREFIX}overheid:${id}`;
export const SCAN_CONCEPT = `${KV_PREFIX}concept:*`;
export const SCAN_PUBLICATIE = `${KV_PREFIX}publicatie:*`;
export const SCAN_OVERHEID = `${KV_PREFIX}overheid:*`;

// Hooguit zoveel nieuwe items per cron-ronde (kosten/tijd begrenzen).
export const MAX_SYNTHESE_PER_RONDE = 2; // pers-concepten (review)
export const MAX_OVERHEID_PER_RONDE = 5; // NL-overheidssamenvattingen (direct live)

// Overheidsbronnen die onder de Licence Ouverte vallen -> NL-samenvatting mag
// direct automatisch live (geen review). Gedreven op thema: precies de vijf
// bronnen Bercy, Service-Public (2x), Douane, DG Trésor.
export const OVERHEID_THEMAS = [
  "geld-belasting",
  "praktisch",
  "ondernemen",
  "douane",
  "economie",
];
export const OVERHEID_THEMA_LABEL = {
  "geld-belasting": "Geld & belasting",
  praktisch: "Praktisch",
  ondernemen: "Ondernemen",
  douane: "Douane",
  economie: "Economie",
};

// Faits-divers-zeef op de PERS-input vóór clustering/synthese.
// De insluitlijst WINT altijd: matcht een titel een insluitterm, dan gaat hij
// door, ook al matcht hij ook een uitsluitterm. Anders: matcht een uitsluitterm
// -> geweigerd. Accent-ongevoelig (zie normaliseer()).
export const FAITS_DIVERS_IN = [
  "incendie", "feu de foret", "feux de foret", "feu de vegetation",
  "greve", "impot", "impots", "fiscal", "fiscalite", "taxe", "taxes",
  "canicule", "vigilance", "logement", "immobilier", "loyer",
  "sante", "hopital", "retraite", "retraites", "permis",
  "douane", "frontiere", "sncf", "circulation",
  "prefecture", "maprimerenov", "renovation", "energie",
  "secheresse", "inondation", "meteo",
];
// NB: "trafic" staat bewust NIET in de insluitlijst (zou "trafic de drogue"
// binnenhalen); rail/wegverkeer wordt door "sncf"/"circulation" gedekt.
export const FAITS_DIVERS_UIT = [
  "viol", "meurtre", "meurtrier", "cadavre", "tue", "tuee", "poignarde",
  "poignardee", "agression", "agresse", "garde a vue", "drogue", "cocaine",
  "ecstasy", "heroine", "cannabis", "stupefiant", "stupefiants",
  "homicide", "feminicide", "fusillade", "braquage", "overdose",
  "proxenetisme", "pedophilie", "pedophile", "coups de couteau",
  "sequestration", "enlevement", "violee", "viols", "assassinat",
  "par balle", "reglement de compte", "narcotrafic", "rixe",
];

// Volume-cap op de "Alle Franse koppen"-sectie (per bron).
export const MAX_FRANSE_KOPPEN_PER_BRON = 12;

// Buitenland-zeef voor PERS-input: een kop over het buitenland valt weg, TENZIJ
// de kop ook Frankrijk noemt (directe impact op Frankrijk). Zo blijven FIFA, de
// VS, Israël, Ceuta/Marokko e.d. eruit, maar bv. "la France renforce ses
// contrôles à la frontière espagnole" blijft staan. Woord-/deelstringmatch op de
// genormaliseerde kop; termen zijn bewust ≥5 tekens om valse treffers te mijden.
export const BUITENLAND_UIT = [
  // mondiaal sportbestuur
  "fifa", "infantino", "uefa",
  // Verenigde Staten
  "etats-unis", "etats unis", "americain", "washington", "trump", "californie",
  "silicon valley", "wall street", "spacex", "openai", "pentagone", "floride",
  // Israël / Midden-Oosten
  "israel", "israelien", "gaza", "cisjordanie", "netanyahou", "hamas",
  "teheran", "iranien",
  // Oekraïne / Rusland
  "ukraine", "kiev", "kyiv", "poutine", "moscou", "kremlin", "russie",
  // Marokko / Ceuta / Spanje
  "maroc", "marocain", "ceuta", "melilla", "rabat", "casablanca",
  "espagne", "espagnol", "madrid", "barcelone",
  // overig buitenland
  "italie", "italien", "naples", "allemagne", "allemand", "pekin", "chinois",
  "japon", "tokyo", "bresil", "londres", "angleterre", "portugal",
];

// Domeinen die we nooit tonen (per verzoek uitgesloten bronnen). Vergelijking op
// de host van de artikel-URL (subdomeinen tellen mee).
export const GEBLOKKEERDE_DOMEINEN = ["goedinfrankrijk.com"];

// Rem op de conceptenberg: de cron maakt GEEN nieuwe pers-concepten meer zodra er
// al zoveel op review wachten. Voorkomt honderden onbehandelde concepten.
export const MAX_OPENSTAANDE_CONCEPTEN = 40;

// Maximale leeftijd van nieuws in de hoofdweergave (syntheses, overheid,
// verenigingsnieuws): niets ouder dan dit. Kortere vensters (pers 24 u) blijven.
export const MAX_NIEUWS_LEEFTIJD_DAGEN = 7;
export const PUBLICATIE_TTL_S = 7 * 24 * 60 * 60; // perspublicaties verlopen na 7 dagen

// Commerciële/zelfpromotie-zeef voor de verenigingenfeed. Uitbreidbaar hier;
// een verenigingsitem met een van deze termen (in titel of tekst) valt weg,
// zodat dienstverleners-advertenties geen verenigingsnieuws worden.
export const VERENIGING_UIT = [
  "multiservices", "multiservice", "klusje", "klusjes", "klusbedrijf",
  "reparatie", "reparaties", "dienst aangeboden", "diensten aangeboden",
  "te koop", "tarief", "tarieven", "offerte", "aanbieding", "aangeboden",
  "zzp", "factuur", "btw", "prijslijst", "handyman", "aannemer", "klussen",
  "schilder", "loodgieter", "verhuizing", "korting", "actieprijs",
];

// Verenigingen-agenda (komende dagen). Aparte databron in de verenigingen-repo:
// verenigingen[].events[] met {datum, titel, plaats, tijd, type}.
export const AGENDA_URL =
  "https://antonnoe.github.io/verenigingen-kalender/data/verenigingen.json";
export const AGENDA_DAGEN = 14; // alleen activiteiten in de komende twee weken

// Redactielabel dat boven een gepubliceerde synthese komt te staan.
export const REDACTIE_LABEL =
  "Redactie NLFR — automatisch samengesteld, bronnen onderaan";

// Synthese-lengte (woorden). Bewust kort gehouden: hoe korter en meer
// gesynthetiseerd, hoe verder van één bron af — juridisch veiliger én beter
// leesbaar. Wordt in de prompt gebruikt.
export const SYNTHESE_WOORDEN_MIN = 110;
export const SYNTHESE_WOORDEN_MAX = 160;

// ---- Presentatie: tegels op /actueel ---------------------------------------
// Persclusters worden bij weergave tot thema-tegels gegroepeerd. "bosbranden"
// bundelt alle brand-clusters (dé terugkerende zomertopic); de rest valt in
// "landelijk" (landelijk/internationaal) of "regionaal" (Zuid-Frankrijk).
// Specifiek op natuurbranden (geen brede termen als "evacu", die ook bij
// niet-brand-evacuaties matchen).
export const BOSBRAND_WOORDEN = [
  "bosbrand", "bosbranden", "natuurbrand", "natuurbranden", "brandweer",
  "brandhaard", "vlammen", "incendie", "pompier", "feu de foret", "feux de foret",
];
// Verkeer & reizen: eigen tegel (vakantie-uittocht, staking SNCF, snelwegen…).
export const VERKEER_WOORDEN = [
  "verkeer", "vakantieverkeer", "reisverkeer", "chasse-croise", "bison fute",
  "autoroute", "snelweg", "peage", "tolweg", "file", "sncf", "tgv", "trein",
  "treinverkeer", "spoor", "luchthaven", "aeroport", "vlucht", "circulation",
  "wegwerkzaamheden", "omleiding", "chassé-croisé",
];
export const PERS_TEGELS = ["bosbranden", "verkeer", "landelijk", "regionaal"];
export const PERS_TEGEL_LABEL = {
  bosbranden: "Bosbranden",
  verkeer: "Verkeer & reizen",
  landelijk: "Landelijk & internationaal",
  regionaal: "Regionaal nieuws",
};
// Brontthema's (uit bronnen.json) -> pers-tegel bij groeperen (fallback als geen
// brandtrefwoord matcht). Alles wat hier niet in staat, valt onder "landelijk".
export const BRONTHEMA_NAAR_PERSTEGEL = {
  "regionaal-fr": "regionaal",
  "landelijk-fr": "landelijk",
  "nl-nieuws": "landelijk",
};

// Labels voor de overige tegels.
export const INFOFRANKRIJK_LABEL = "Laatste updates op Infofrankrijk";
export const VERENIGINGEN_LABEL = "Nederlandse verenigingen";

// Overzichtspagina met alle NL-verenigingen in Frankrijk (link in de agenda-tegel).
export const VERENIGINGEN_PAGINA =
  "https://www.nederlanders.fr/page/nederlandse-verenigingen-in-frankrijk";
