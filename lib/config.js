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

// ---- Onafhankelijkheid van bronnen -----------------------------------------
// Twee koppen met deze titeloverlap (Jaccard) of meer zijn vrijwel zeker
// dezelfde wire/persbericht, door meerdere kranten overgenomen -> één bron.
export const WIRE_TITEL_JACCARD = 0.6;
// Losser criterium, ALLEEN tussen twee items die allebei als persbureau-copy
// zijn herkend: agentschapsberichten worden per krant herschreven, dus de
// koppen lopen verder uiteen dan bij letterlijke overname.
export const WIRE_ONDERLING_JACCARD = 0.35;
// Persbureau-markers. Staat zo'n marker in de kop of de bronvermelding, dan is
// het item agentschapscopy: twee zulke items over hetzelfde verhaal zijn géén
// twee onafhankelijke waarnemingen, ongeacht welke kranten ze publiceerden.
// Als losse woorden getoetst (woordgrens), zodat "ap" in "Cap d'Agde" of
// "reuters" binnen een langer woord niet meetelt.
export const PERSBUREAU_MARKERS = [
  "afp", "reuters", "ap", "associated press", "belga", "anp", "dpa", "efe",
  "ansa", "agence france presse", "agence france-presse",
];

// ---- Publicatiepoort (lib/poort.js) ----------------------------------------
// Gelijkeniscontrole concepttekst <-> bronkop: lengte van de woordgroepen en de
// maximaal toegestane overlap. Zie de uitgebreide motivering in lib/poort.js.
// ---- Overheid-dedup (lib/overheid.js) --------------------------------------
// Vangnet voor overheidsberichten ZONDER actualité-nummer: vanaf deze
// titeloverlap gelden twee records als hetzelfde bericht. Bewust strenger dan
// WIRE_TITEL_JACCARD (0.6): daar gaat het om tellen, hier om samenvoegen —
// en dat verwijdert een record, dus liever een tweeling missen dan twee
// verschillende berichten samenvoegen.
export const OVERHEID_TITEL_JACCARD = 0.75;

export const KOP_NGRAM = 3; // woord-drietallen
export const KOP_OVERLAP_MAX = 0.5; // >= 50% van de drietallen letterlijk = weigeren

// Datumvenster per regime. Persbronnen: kort (24 u), zodat een snelle bron de
// pagina niet overspoelt. Overheidsbronnen: ruimer (72 u), want die publiceren
// traag. Een bron kan dit overrulen met "vensterDagen" in bronnen.json.
export const VENSTER_PERS_UREN = 24;
export const VENSTER_OVERHEID_UREN = 72;

// Volume-cap in de themaweergave: hooguit zoveel items per bron (nieuwste
// eerst), zodat geen enkele bron de lijst domineert.
export const MAX_ITEMS_PER_BRON_THEMA = 15;

// Concept-/publicatie-opslag (Vercel KV / Upstash Redis, via REST).
export const CONCEPT_TTL_S = 36 * 60 * 60; // concepten verlopen automatisch na 36 uur (persnieuws is daarna geen nieuws meer)
export const OVERHEID_TTL_S = 28 * 24 * 60 * 60; // overheidsberichten: 14 d live + 14 d archief
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
  "sociale-zekerheid",
  "douane",
  "economie",
  "wetgeving",
];
export const OVERHEID_THEMA_LABEL = {
  "geld-belasting": "Geld & belasting",
  praktisch: "Praktisch",
  ondernemen: "Ondernemen",
  "sociale-zekerheid": "Sociale zekerheid",
  douane: "Douane",
  economie: "Economie",
  wetgeving: "Wetgeving & beleid",
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
  "noyade", "noyee", "noye", "portee disparue", "porte disparu",
  "corps sans vie", "sans vie", "retrouve mort", "retrouvee morte",
];

// Volume-cap op de "Alle Franse koppen"-sectie (per bron).
export const MAX_FRANSE_KOPPEN_PER_BRON = 12;

// Voetbal-zeef voor PERS: voetbal is off-topic voor NL'ers in Frankrijk, TENZIJ
// het om ernstige incidenten in/rond stadions gaat (geweld, drama, instorting).
// Werkt als de faits-divers-zeef: matcht een uitsluitterm -> weg, behalve als de
// kop ook een incidentterm bevat. Accent-ongevoelig, substringmatch.
export const VOETBAL_UIT = [
  "football", "ligue 1", "ligue 2", "ligue des champions", "champions league",
  "europa league", "mercato", "coupe du monde", "ballon d'or", "selectionneur",
  "les bleus", "buteur", "match amical", "olympique de marseille",
  "olympique lyonnais", "paris sg", "psg", "ligue europa", "gardien de but",
];
export const VOETBAL_INCIDENT_IN = [
  "bousculade", "mouvement de foule", "effondrement", "hooligan", "affrontement",
  "affrontements", "violences", "emeute", "emeutes", "envahissement", "blesses",
  "blesse", "mort", "morts", "drame", "tribune", "supporters interpelles",
];

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

// Buitenland-zeef, tweede laag: op de NL-SYNTHESETEKST (concept-kop + -tekst).
// De Franse titelzeef (BUITENLAND_UIT) mist verhalen waarvan de Franse koppen het
// land niet noemen ("le plan de désarmement inquiète l'ONU"), terwijl de NL-
// synthese er wél "Israël/Hamas" van maakt. Deze Nederlandse termen vangen dat af.
// Zelfde rescue-regel: noemt de tekst óók Frankrijk, dan blijft hij (directe
// impact). Accent-ongevoelig; substringmatch, dus termen bewust ≥5 tekens.
export const BUITENLAND_UIT_NL = [
  // Verenigde Staten
  "verenigde staten", "amerika", "amerikaan", "amerikaanse", "florida",
  // Israël / Midden-Oosten
  "israel", "israelisch", "israelische", "westelijke jordaanoever",
  "iraans", "iraanse", "teheran",
  // Oekraïne / Rusland
  "oekraine", "oekraiense", "rusland", "russisch", "russische", "poetin", "moskou",
  // Marokko / Ceuta / Spanje
  "marokko", "marokkaan", "marokkaanse", "spanje", "spaans", "spaanse", "barcelona",
  // overig buitenland
  "italiaan", "italiaanse", "duitsland", "duitse", "berlijn",
  "chinees", "chinese", "japan", "tokio", "brazilie", "londen",
  "engeland", "engelse", "portugal", "portugese", "groot-brittannie",
];

// Domeinen die we nooit tonen (per verzoek uitgesloten bronnen). Vergelijking op
// de host van de artikel-URL (subdomeinen tellen mee).
export const GEBLOKKEERDE_DOMEINEN = ["goedinfrankrijk.com"];

// Doelomvang van de conceptenberg. De cron snoeit elke ronde terug tot dit
// aantal: hij houdt de BESTE concepten (score = onafhankelijke bronnen × recency,
// met voorrang voor prioriteitsonderwerpen) en gooit de rest weg. Handmatig
// bewerkte concepten blijven altijd staan. Zo blijft de reviewlijst behapbaar
// (30-60) zonder belangrijk nieuws te verliezen.
export const MAX_OPENSTAANDE_CONCEPTEN = 50;

// Dedup over cron-rondes heen ("laatste productie wint"): een nieuw cluster dat
// hetzelfde verhaal betreft als een bestaand concept levert GEEN tweede concept
// op. Match op de opgeslagen kern-trefwoorden. Bewust conservatief, zodat twee
// verschillende verhalen niet ten onrechte samensmelten.
export const DEDUP_GEDEELD_MIN = 2; // ≥ zoveel gedeelde betekenisvolle termen
export const DEDUP_JACCARD_MIN = 0.35; // én minstens deze titeloverlap

// Prioriteitsonderwerpen: hoog-impact nieuws voor NL'ers in Frankrijk. Zulke
// clusters krijgen een score-boost (staan bovenaan), zijn beschermd tegen
// wegsnoeien en krijgen de "Actueel"-markering — ook bij precies 2 bronnen. De
// 2-bronnen-ondergrens voor synthese blijft (auteursrecht). Substringmatch op de
// genormaliseerde titel; FR + NL door elkaar. Vrij uit te breiden.
export const PRIORITEIT_WOORDEN = [
  // weer & natuur(ramp)
  "vigilance rouge", "vigilance orange", "canicule", "inondation", "inondations",
  "tempete", "orage", "orages", "evacuation", "evacuations", "secheresse",
  "code oranje", "code rood", "weeralarm", "overstroming",
  // brand
  "incendie", "feu de foret", "feux de foret", "bosbrand", "bosbranden",
  // sociaal & verkeer
  "greve", "sncf", "penurie", "staking", "blocage",
  // politiek, wet, geld
  "gouvernement", "premier ministre", "assemblee", "budget", "loi ", "reforme",
  "impot", "election", "elections", "dissolution", "motion de censure",
  "regering", "verkiezing", "begroting", "belasting", "wetsvoorstel",
  // veiligheid
  "attentat", "aanslag",
];

// Maximale leeftijd van nieuws in de hoofdweergave (syntheses, overheid,
// verenigingsnieuws): niets ouder dan dit. Kortere vensters (pers 24 u) blijven.
export const MAX_NIEUWS_LEEFTIJD_DAGEN = 7;
// Levenscyclus van een gepubliceerde perssynthese: de eerste ARCHIEF_NA_UREN uur
// staat hij "live" in zijn thema-tegel; daarna schuift hij naar de ingeklapte
// "Archief"-tegel (met "blijft nog X dagen"); na PUBLICATIE_TTL_S is hij weg.
export const ARCHIEF_NA_UREN = 36; // 36 u live, daarna archief
export const PUBLICATIE_TTL_S = 14 * 24 * 60 * 60; // definitief weg na 14 dagen

// Overheid heeft een langere levenscyclus dan pers: eerst live in de thema-tegel,
// daarna naar het archief, uiteindelijk weg (samen 28 d, zie OVERHEID_TTL_S).
export const OVERHEID_ARCHIEF_NA_DAGEN = 14; // 14 d live, daarna 14 d archief
// Volumecap per overheidstegel: hooguit zoveel berichten live (nieuwste eerst);
// de rest schuift meteen naar het archief. Voorkomt een tegel met 15+ items.
export const OVERHEID_MAX_LIVE_PER_TEGEL = 8;

// Display-caps per eigen-content-bron (langer dan pers, maar niet oneindig).
export const VENSTER_INFOFRANKRIJK_DAGEN = 14;
export const VENSTER_VERENIGINGEN_DAGEN = 21;

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
