// Centrale configuratie voor de route /actueel.
// ---------------------------------------------------------------------------
// AI_CONFIG is bewust ÉÉN constante: model, max_tokens en effort van de
// Anthropic-synthese staan hier bij elkaar, zodat ze later op één plek zijn bij
// te stellen zonder de synthesecode aan te raken. Kies eventueel een goedkoper
// model (bv. "claude-sonnet-5") door alleen `model` te wijzigen.
export const AI_CONFIG = {
  model: "claude-opus-5",
  // MAX_TOKENS IS HET PLAFOND VOOR DENKEN ÉN ANTWOORD SAMEN. Dat staat met
  // zoveel woorden in de SDK-typen: adaptief denken "counts towards your
  // max_tokens limit". Op claude-opus-5 staat adaptief denken AAN zodra je het
  // veld `thinking` weglaat — anders dan op de vorige generatie, waar weglaten
  // betekende: niet denken. Wie 2000 meegeeft, geeft het model dus 2000 tokens
  // voor denkwerk plus 150-250 Nederlandse woorden, en op een lastig cluster
  // gaat dat plafond volledig op aan denkwerk. Wat er dan terugkomt is een
  // antwoord met stop_reason "max_tokens" en GEEN ENKEL tekstblok, en dat is
  // in lib/synthese.js een harde fout.
  //
  // 8000 is ruim boven wat denkwerk op effort medium nodig heeft plus de ~400
  // tokens die 250 Nederlandse woorden kosten, en blijft laag genoeg om binnen
  // de maxDuration van 60 s twee syntheses te halen. Het is een PLAFOND: wat
  // niet gebruikt wordt, kost niets.
  maxTokens: 8000,
  effort: "medium", // low | medium | high | xhigh | max
};

// Versheid & cache. De feed is stale-while-revalidate; de CDN serveert een
// (iets) oude versie direct en ververst op de achtergrond.
// FEED_MAX_AGE_S volgt de croninterval (15 min): binnen dat venster is er per
// definitie geen versere versie te halen. FEED_SWR_S is ruim (24 uur) zodat een
// bezoeker NA dat venster nog steeds direct de laatst bekende versie krijgt en
// de verversing op de achtergrond gebeurt — nooit meer een bezoeker die op een
// koude cache staat te wachten.
export const FEED_MAX_AGE_S = 900; // 15 min verse cache (= croninterval)
export const FEED_SWR_S = 86400; // 24 uur stale-while-revalidate
// Wat de BROWSER zelf mag bewaren. Kort genoeg om binnen een sessie actueel te
// blijven, lang genoeg om herbezoek en terugnavigatie gratis te maken.
export const BROWSER_MAX_AGE_S = 120;

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

// ---- Overheid-dedup (lib/overheid.js) --------------------------------------
// Vangnet voor overheidsberichten ZONDER actualité-nummer: vanaf deze
// titeloverlap gelden twee records als hetzelfde bericht. Bewust strenger dan
// WIRE_TITEL_JACCARD (0.6): daar gaat het om tellen, hier om samenvoegen —
// en dat verwijdert een record, dus liever een tweeling missen dan twee
// verschillende berichten samenvoegen.
export const OVERHEID_TITEL_JACCARD = 0.75;

// ---- Cross-taal-clustering via eigennamen (lib/cluster.js) -----------------
// Een verhaal dat zowel in NL- als in FR-media speelt, clustert niet: de
// titeltokens overlappen over de taalgrens nauwelijks. Wat wél overleeft, zijn
// EIGENNAMEN — personen, plaatsen, organisaties. Die vormen de brug.
//
// AFSTELPUNT, bewust CONSERVATIEF gezet: liever twee clusters die apart blijven
// dan twee verschillende verhalen die samensmelten (een verkeerde merge levert
// een synthese over twee onderwerpen op — precies wat de huisregels verbieden).
// Eén gedeelde MEERWOORDIGE naam ("Jean Imbert") volstaat: die is zeldzaam
// genoeg om op zichzelf te staan. Losse namen ("Imbert", "Marseille") zijn dat
// niet — twee verschillende verhalen delen zo "Marseille" — dus daar zijn er
// minstens twee van nodig. Loopt het aantal gemiste bruggen op, verlaag dan
// EIGENNAAM_BRUG_ENKEL_MIN naar 1; komen er verkeerde merges, zet dan
// EIGENNAAM_BRUG_MEERWOORDIG_MIN op 2.
export const EIGENNAAM_BRUG_MEERWOORDIG_MIN = 1;
export const EIGENNAAM_BRUG_ENKEL_MIN = 2;
// Hoofdletterwoorden die géén onderscheidende eigennaam zijn: lidwoorden en
// zinsopeners (koppen beginnen met een hoofdletter), plus namen die zó vaak
// voorkomen dat ze geen brug vormen (Frankrijk, Parijs, Europa staan in vrijwel
// elke kop van deze feed).
export const EIGENNAAM_STOP = new Set([
  // te algemeen voor deze feed
  "france", "frankrijk", "franse", "francais", "francaise", "paris", "parijs",
  "europe", "europa", "europese", "nederland", "nederlandse", "union",
  // Franse lidwoorden/zinsopeners
  "les", "des", "une", "aux", "cette", "leur", "leurs", "dans", "pour", "avec",
  "selon", "apres", "avant", "sous", "entre", "plus", "tout", "tous", "cet",
  // Nederlandse lidwoorden/zinsopeners
  "het", "een", "van", "der", "den", "met", "voor", "naar", "over", "deze",
  "dit", "die", "meer", "nieuwe", "ook", "weer", "niet", "maar", "waarom",
  "hoe", "wat", "bij", "als", "nog", "toch", "zijn", "wordt", "worden",
  // tijdsaanduidingen
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
  "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag",
  "zondag", "januari", "februari", "maart", "april", "juni", "juli",
  "augustus", "september", "oktober", "november", "december", "janvier",
  "fevrier", "mars", "avril", "juin", "juillet", "aout", "septembre",
  "octobre", "novembre", "decembre",
]);

// NL-media die aantoonbaar Franse berichtgeving navertellen zijn géén tweede,
// onafhankelijke waarneming: ze citeren dezelfde Franse bron. Herkenbaar aan
// deze frasen in de kop of de meegeleverde tekst.
export const NAVERTELLING_FRASEN = [
  "op basis van franse berichtgeving", "volgens franse berichtgeving",
  "volgens franse media", "franse media melden", "franse media schrijven",
  "meldt de franse", "melden franse", "schrijft de franse",
  "volgens franse kranten", "volgens de franse pers", "franse pers meldt",
  "d apres la presse francaise", "selon la presse francaise",
  "volgens het franse", "aldus franse media",
];

// ---- Gelijkeniswaarschuwing in de reviewtool (lib/gelijkenis.js) ------------
// AFSTELPUNT. Deze drempels staan BEWUST RUIMER dan de cron-dedup
// (DEDUP_JACCARD_MIN 0.35 / DEDUP_GEDEELD_MIN 2). Reden: de cron-dedup BESLIST
// (geen tweede concept), deze waarschuwing SIGNALEERT alleen — de redacteur
// beslist. Een gemiste waarschuwing kost een dubbele publicatie op de site; een
// overbodige waarschuwing kost één blik. Vandaar de asymmetrie: liever te vaak
// dan te laat. Loopt het aantal valse meldingen op, zet LIJKT_OP_JACCARD dan
// stapsgewijs richting 0.35 (dan gedraagt hij zich als de cron-dedup).
export const LIJKT_OP_JACCARD = 0.25;
export const LIJKT_OP_GEDEELD_MIN = 2; // minstens zoveel gedeelde BETEKENISVOLLE termen
// Bron-URL's zijn een onafhankelijk en veel harder signaal dan woordoverlap:
// twee syntheses die naar dezelfde twee artikelen linken, gaan over hetzelfde
// verhaal — ongeacht hoe verschillend ze geformuleerd zijn.
export const LIJKT_OP_URLS_MIN = 2;

// ---- Primaire-bron-signalering (lib/gelijkenis.js) --------------------------
// De pers schrijft geregeld een overheidscommuniqué na: een synthese over de
// allocation de rentrée scolaire terwijl het Service-Public-bericht daarover al
// live staat. Dan is het overheidsbericht de primaire bron en voegt de synthese
// vaak niets toe. Dit signaleert dat; het blokkeert niets.
//
// AFSTELPUNT. Bewust dezelfde ruime drempel als de gelijkeniswaarschuwing
// hierboven: signaleren is goedkoop (één regel in de reviewkaart), een gemist
// dwarsverband kost een overbodige publicatie naast de primaire bron. Te veel
// valse meldingen? Zet PRIMAIRE_BRON_JACCARD richting 0.35.
export const PRIMAIRE_BRON_JACCARD = 0.25;
export const PRIMAIRE_BRON_GEDEELD_MIN = 2;
// Hoe ver terug in het register kijken we? Het register is permanent, maar een
// bulletin van twee jaar geleden is geen "staat al live". Dit venster dekt de
// live periode (14 d) plus een ruime staart aan recent gearchiveerd materiaal.
export const PRIMAIRE_BRON_VENSTER_DAGEN = 60;

// ---- Publicatiepoort (lib/poort.js) ----------------------------------------
// Gelijkeniscontrole concepttekst <-> bronkop: lengte van de woordgroepen en de
// maximaal toegestane overlap. Zie de uitgebreide motivering in lib/poort.js.
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
// Regelgevingsregister: duurzaam, ZONDER TTL. Overheidsberichten verhuizen hier
// na hun live periode naartoe in plaats van te verdwijnen. Zie lib/register.js.
export const KEY_REGISTER = (id) => `${KV_PREFIX}register:${id}`;
export const SCAN_REGISTER = `${KV_PREFIX}register:*`;

// ---- Voorgebakken antwoord van /api/actueel --------------------------------
// De cron stelt aan het eind van elke ronde het complete antwoordobject samen
// en zet het onder deze sleutel. /api/actueel leest hem en antwoordt ermee; dat
// scheelt bij een cache-miss het live ophalen van alle feeds.
// De TTL (6 uur) is ruim langer dan de croninterval, zodat een paar gemiste
// cronrondes nog geen lege pagina geven. SNAPSHOT_MAX_LEEFTIJD_S is de grens
// waarboven /api/actueel de snapshot niet meer vertrouwt en zelf verse data
// samenstelt (en die als nieuwe snapshot wegschrijft).
// TWEE leveringen, twee sleutels (zie lib/levering.js): de compacte levering
// voor /api/actueel en de tekst-levering voor /api/actueel-tekst. De compacte
// sleutel staat op v2 omdat v1 het VOLLEDIGE antwoord bevatte; met een nieuwe
// naam serveert de route na de deploy nooit per ongeluk nog de oude, dikke
// vorm uit een snapshot die nog niet verlopen is.
// v3/v2: de vorm van beide leveringen is veranderd toen de archieftegel een
// eigen levering kreeg (compact verloor de archiefartikelen, tekst verloor hun
// tekst-records). Met nieuwe namen serveert geen enkele route na de deploy nog
// de oude vorm uit een snapshot die nog niet verlopen was.
export const KEY_ACTUEEL_SNAPSHOT = `${KV_PREFIX}snapshot:v3`;
export const KEY_ACTUEEL_TEKST_SNAPSHOT = `${KV_PREFIX}snapshot-tekst:v2`;
export const KEY_ACTUEEL_ARCHIEF_SNAPSHOT = `${KV_PREFIX}snapshot-archief:v1`;
export const SNAPSHOT_TTL_S = 6 * 60 * 60; // 6 uur bewaren
export const SNAPSHOT_MAX_LEEFTIJD_S = 60 * 60; // ouder dan 1 uur -> zelf bakken

// ---- Journaal van de cronronde ----------------------------------------------
// WAAROM DIT IN KV STAAT EN NIET ALLEEN IN HET LOG. De cron drukte zijn
// tellingen alleen af in het HTTP-antwoord, en dat antwoord leest niemand:
// Vercel Cron gooit de body weg. Wat overbleef was het draailog, en daarin
// stond na de `[feeds]`-regels niets meer. Een keten die veertig uur lang geen
// concept meer maakte was daardoor pas te zien aan het gevolg — lege
// perstegels — en niet aan de oorzaak.
//
// Het journaal is één klein document met de tellingen van de laatste ronde plus
// het moment waarop er voor het laatst een concept is weggeschreven. Het is de
// enige plek waar dat laatste moment blijft staan: concepten zelf verlopen na
// CONCEPT_TTL_S en kunnen die vraag dus niet beantwoorden.
//
// GEEN TTL. Een journaal dat verloopt maakt precies dan een gat in de bewaking
// wanneer de cron stilvalt — dan is er niets meer dat het ververst, en zou de
// stilte zichzelf uitwissen. Het document is klein en wordt elke ronde
// overschreven.
export const KEY_CRON_RONDE = `${KV_PREFIX}cron:ronde`;

// ---- Meldingen over de browseropslag van de reviewtool ----------------------
// De diagnose op /review stond alleen op het scherm van de telefoon, en daar was
// hij onleesbaar: op Android verscheen en verdween hij binnen een fractie van
// een seconde. Elke melding gaat daarom ook naar KV, mét het beheertoken dat de
// redacteur tóch al intikt — geen ongeauthenticeerde schrijfroute, die zou een
// vreemde in staat stellen de ring vol te duwen.
//
// Een RING van een handvol meldingen, geen groeiende lijst: het gaat om de
// laatste paar bezoeken van hetzelfde toestel, en meer heeft niemand nodig om
// "schrijven mislukt" van "achteraf opgeruimd" te scheiden. Met TTL, want een
// diagnose die maanden blijft staan is geen diagnose meer maar een archief.
export const KEY_OPSLAGMELDING = `${KV_PREFIX}opslagmelding`;
export const OPSLAGMELDING_MAX = 12;
export const OPSLAGMELDING_TTL_S = 30 * 24 * 60 * 60; // dertig dagen

// Hoelang de persketen zonder nieuw concept mag staan voordat dat een storing
// is. Bewust een etmaal en niet een paar rondes: een rustige avond of een
// nieuwsdag zonder verhaal dat twee kranten halen levert legitiem nul op. Meer
// dan vierentwintig uur nul, terwijl er wél persartikelen binnenkomen, is dat
// niet meer.
export const CONCEPT_STILTE_MAX_UREN = 24;

// Een tegel die de laatste zoveel dagen artikelen had, hoort ze nu ook te
// hebben. Zeven dagen is ruim genoeg om een tegel die nu eenmaal weinig vulling
// heeft (bosbranden buiten het seizoen) niet elke week rood te laten worden, en
// kort genoeg om een tegel die wegvalt binnen een week te melden.
export const TEGEL_VULLING_VENSTER_DAGEN = 7;

// ---- Regelgevingsregister ---------------------------------------------------
// Rubrieken = de bestaande overheidsthema's (OVERHEID_THEMAS hieronder).
// Statussen van een registerrecord:
//   actueel    — geldend, publiek zichtbaar
//   aangevuld  — geldend én onderdeel van een keten, publiek zichtbaar
//   vervangen  — achterhaald: publiek ONZICHTBAAR, maar NOOIT verwijderd
export const REGISTER_STATUS = ["actueel", "aangevuld", "vervangen"];
export const REGISTER_ZICHTBAAR = ["actueel", "aangevuld"];
// Abonnee-muur op /archief: publiek zijn alleen titels zichtbaar.
export const REGISTER_MUURTEKST =
  "Toegang tot dit archief is uitsluitend voorbehouden aan abonnees.";
export const REGISTER_ABONNEE_URL = "https://infofrankrijk.com/abonnement/";

// AFSTELPUNT — keten-detectie bij instroom van een nieuw overheidsbericht.
// Twee signalen, met verschillende zekerheid:
//   1. gelijk actualité-nummer (A18905): dezelfde bron-actualité, opnieuw
//      uitgegeven. Sterk signaal -> voorstel "vervangen".
//   2. kern-tokenoverlap boven REGISTER_KETEN_JACCARD: mogelijk hetzelfde
//      onderwerp, maar het kan net zo goed een naastliggende regeling zijn
//      -> voorstel "aanvulling".
// De drempel staat BEWUST HOOG (hoger dan DEDUP_JACCARD_MIN 0.35 en dan
// LIJKT_OP_JACCARD 0.25): een onterechte ketenvraag kost de redactie een klik,
// maar een gemiste vraag kost niets — het bericht gaat gewoon live en kan later
// alsnog worden gekoppeld. Bovendien blokkeert een match de livegang niet.
// Loopt het aantal gemiste ketens op, verlaag dan richting 0.40.
export const REGISTER_KETEN_JACCARD = 0.55;
export const REGISTER_KETEN_GEDEELD_MIN = 3; // én zoveel gedeelde betekenisvolle termen

// Hooguit zoveel nieuwe items per cron-ronde (kosten/tijd begrenzen).
export const MAX_SYNTHESE_PER_RONDE = 2; // pers-concepten (review)
export const MAX_OVERHEID_PER_RONDE = 5; // NL-overheidssamenvattingen (direct live)
// Nederlandstalige overheidsbronnen gaan buiten het model om (zie
// overheidUitFeed in lib/synthese.js): geen AI-kosten, alleen een KV-schrijf.
// Ze krijgen daarom een eigen, ruimere teller. Zonder die scheiding zou een
// drukke Rijksoverheid-dag de vijf plekken opsouperen die bedoeld zijn voor de
// Franse berichten die de vertaalslag wél nodig hebben.
export const MAX_OVERHEID_NL_PER_RONDE = 10;

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
  "natuur-milieu",
  "nl-overheid",
];
export const OVERHEID_THEMA_LABEL = {
  "geld-belasting": "Geld & belasting",
  praktisch: "Praktisch",
  ondernemen: "Ondernemen",
  "sociale-zekerheid": "Sociale zekerheid",
  douane: "Douane",
  economie: "Economie",
  wetgeving: "Wetgeving & beleid",
  "natuur-milieu": "Natuur & milieu",
  "nl-overheid": "Nederlandse overheid",
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
// Nederlandstalige spiegel van de faits-divers-zeef. De Franse lijsten raken
// koppen van NOS en NU.nl niet, waardoor Nederlandse misdaadkoppen ongezien
// passeerden (de aanhouding van chef Jean Imbert wegens huiselijk geweld).
// Deze termen worden op WOORDGRENS getoetst (zie bevatWoord in lib/feeds.js),
// niet als losse substring: "dood" zit in "doodgewoon" en "doodlopende weg",
// vandaar dat hier alleen ondubbelzinnige stammen en woordgroepen staan.
export const FAITS_DIVERS_UIT_NL = [
  // aanhouding & justitie
  // "verdachte" staat hier bewust NIET: dat is in het Nederlands ook een
  // doodgewoon bijvoeglijk naamwoord ("verdachte stilte", "verdachte
  // omstandigheden"). De aanhoudingstermen hieronder dekken de misdaadkoppen af.
  "aangehouden", "aanhouding", "opgepakt", "gearresteerd", "arrestatie",
  "celstraf", "voorarrest", "aanklacht",
  // geweld met dodelijke afloop
  "moord", "doodslag", "gedood", "omgebracht", "doodgestoken", "doodgeschoten",
  "neergestoken", "neergeschoten", "steekpartij", "schietpartij",
  "dood aangetroffen", "levenloos aangetroffen", "dood gevonden",
  // vermissing & verdrinking
  "vermist", "vermissing", "verdronken", "verdrinking", "drenkeling",
  // geweld & zeden
  "huiselijk geweld", "mishandeld", "mishandeling", "misbruik", "aanranding",
  "verkracht", "verkrachting", "zedenzaak", "ontvoerd", "ontvoering",
  // drugs
  "drugs", "cocaine", "wietplantage", "witwassen",
];
// Nederlandse insluitlijst: zelfde uitzonderingslogica als de Franse (IN wint).
// Een misdaadterm in een kop over een bosbrand of een staking mag het bericht
// niet alsnog wegfilteren.
export const FAITS_DIVERS_IN_NL = [
  "bosbrand", "natuurbrand", "brandweer", "staking", "belasting", "fiscaal",
  "pensioen", "zorgverzekering", "ziekenhuis", "huurwoning", "hypotheek",
  "rijbewijs", "douane", "verblijfsvergunning", "hittegolf", "code oranje",
  "code rood", "droogte", "overstroming", "weeralarm", "energie", "treinverkeer",
];

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

// Sport-zeef voor PERS: sportuitslagen zijn off-topic voor NL'ers in Frankrijk,
// TENZIJ er praktische gevolgen zijn — ernstige incidenten in/rond stadions
// (geweld, drama, instorting) of impact op de openbare ruimte (afgesloten wegen,
// gewijzigde circulatie rond een etappe of marathon).
// Werkt als de faits-divers-zeef: matcht een uitsluitterm -> weg, behalve als de
// kop ook een uitzonderingsterm bevat. Accent-ongevoelig, SUBSTRINGmatch — houd
// termen daarom lang genoeg ("formule 1", niet "f1"; "circuit atp", niet "atp"),
// anders matcht een fragment binnen een gewoon woord.
export const SPORT_UIT = [
  // voetbal
  "football", "ligue 1", "ligue 2", "ligue des champions", "champions league",
  "europa league", "mercato", "coupe du monde", "ballon d'or", "selectionneur",
  "les bleus", "buteur", "match amical", "olympique de marseille",
  "olympique lyonnais", "paris sg", "psg", "ligue europa", "gardien de but",
  // wielrennen
  "tour de france", "etappe", "etape du tour", "maillot jaune", "peloton",
  "cyclisme", "wielren", "paris-roubaix", "vuelta", "giro", "contre-la-montre",
  // tennis
  "roland-garros", "roland garros", "wimbledon", "open d'australie",
  "tournoi atp", "circuit atp", "tournoi wta",
  // rugby
  "rugby", "top 14", "xv de france", "six nations", "tournoi des six nations",
  // atletiek
  "athletisme", "atletiek", "semi-marathon", "championnats du monde d athletisme",
  // formule 1 / motorsport
  "formule 1", "formula 1", "grand prix", "motogp", "24 heures du mans",
  // olympisch
  "jeux olympiques", "olympische spelen", "paralympiques", "paralympische",
  "olympique",
];
// Uitzonderingen: hier komt de kop tóch door, want dit raakt de lezer praktisch.
export const SPORT_INCIDENT_IN = [
  // incidenten in/rond het stadion
  "bousculade", "mouvement de foule", "effondrement", "hooligan", "affrontement",
  "affrontements", "violences", "emeute", "emeutes", "envahissement", "blesses",
  "blesse", "mort", "morts", "drame", "tribune", "supporters interpelles",
  // praktische impact op de openbare ruimte
  // "barree" als stam dekt rue/rues/route/routes/voie barrée(s) in één term —
  // losse enkelvoudsvormen missen anders de meervouden ("rues barrées").
  "circulation", "barree", "barrees", "deviation",
  "deviations", "stationnement", "fermeture", "fermetures", "perturbations",
  "wegafsluiting", "wegafsluitingen", "afgesloten", "greve", "vigilance",
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
// ---- Landenlijst als DERDE buitenlandlaag ----------------------------------
// De twee lijsten hierboven zijn met de hand samengestelde denylists: wat er
// niet in staat, passeert. Daardoor kwamen de vulkaanuitbarsting in Guatemala
// en de burgeroorlogwaarschuwing van de Colombiaanse president Petro er zonder
// slag of stoot doorheen — Guatemala en Colombia stonden er simpelweg niet in.
// Deze lijst dekt de wereld breder af (landen, inwonersnamen, hoofdsteden), in
// het Frans én het Nederlands, en werkt met dezelfde Frankrijk-redding: noemt de
// kop óók Frankrijk (of Nederland, of een EU-instelling), dan blijft hij staan.
//
// Op WOORDGRENS getoetst, niet als substring: "chine" zit in "machine", "inde"
// in "industrie", "oman" in "roman" en "cuba" in "incubateur".
//
// Bewust NIET in deze lijst: België, Zwitserland en Luxemburg (buurlanden waar
// nieuws vaak direct over de grens met Frankrijk gaat) en alles wat naar de EU
// verwijst — die staan hieronder juist in de reddingslijst.
export const BUITENLAND_LANDEN = [
  // Latijns-Amerika
  "guatemala", "guatemalteque", "colombie", "colombien", "colombienne",
  "colombia", "colombiaans", "colombiaanse", "venezuela", "venezuelien",
  "perou", "peru", "chili", "bolivie", "bolivia", "equateur", "ecuador",
  "mexique", "mexico", "mexicain", "mexicaans", "argentine", "argentinie",
  "argentijnse", "bresil", "brazilie", "braziliaans", "cuba", "haiti",
  "honduras", "nicaragua", "panama", "bogota", "caracas",
  // Afrika
  "nigeria", "kenya", "kenia", "ethiopie", "ethiopia", "soudan", "sudan",
  "somalie", "somalia", "mali", "niger", "tchad", "tsjaad", "burkina",
  "senegal", "cameroun", "kameroen", "congo", "rwanda", "ouganda", "oeganda",
  "tanzanie", "tanzania", "zimbabwe", "afrique du sud", "zuid-afrika",
  "egypte", "egyptisch", "libye", "libie", "tunisie", "tunesie", "algerie",
  "algerije", "algerien", "le caire", "caïro", "cairo",
  // Azië
  "chine", "china", "inde", "india", "indiase", "pakistan", "bangladesh",
  "afghanistan", "indonesie", "indonesia", "philippines", "filipijnen",
  "vietnam", "thailande", "thailand", "birmanie", "myanmar", "coree",
  "korea", "nepal", "sri lanka", "kazakhstan", "kazachstan", "new delhi",
  "shanghai", "seoul", "manille", "manila", "jakarta",
  // Midden-Oosten
  "syrie", "syrie", "syrisch", "irak", "iraq", "liban", "libanon", "yemen",
  "jemen", "arabie saoudite", "saoedi-arabie", "qatar", "emirats", "dubai",
  "turquie", "turkije", "ankara", "istanbul", "bagdad", "damas", "beyrouth",
  // Oceanië & Noord-Amerika (VS staat al in BUITENLAND_UIT)
  "australie", "australia", "nouvelle-zelande", "nieuw-zeeland", "canada",
  "canadien", "canadese", "ottawa", "sydney",
  // Europa buiten Frankrijk (buurlanden bewust weggelaten, zie boven)
  "pologne", "polen", "hongrie", "hongarije", "roumanie", "roemenie",
  "bulgarie", "bulgarije", "grece", "griekenland", "athenes", "athene",
  "suede", "zweden", "norvege", "noorwegen", "finlande", "finland",
  "danemark", "denemarken", "irlande", "ierland", "autriche", "oostenrijk",
  "vienne", "wenen", "varsovie", "warschau", "prague", "praag",
  "serbie", "servie", "croatie", "kroatie", "albanie", "albanie",
];

// Redding: hoort dit buitenlandbericht tóch bij de lezer? Naast de bestaande
// Frankrijk-trefwoorden gelden Nederland (het thuisland van de lezer) en de
// EU-instellingen (een Europees besluit raakt Frankrijk vrijwel altijd direct).
export const RELEVANT_NL = [
  "nederland", "nederlandse", "nederlanders", "pays-bas", "neerlandais",
  "neerlandaise", "amsterdam", "den haag", "la haye", "rotterdam", "utrecht",
  "haagse", "nederlandstalige",
];
export const RELEVANT_EU = [
  "union europeenne", "commission europeenne", "parlement europeen",
  "conseil europeen", "bruxelles", "brussel", "europese unie",
  "europese commissie", "europees parlement", "europese raad", "eurozone",
  "banque centrale europeenne", "europese centrale bank", "schengen",
];

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
export const PERS_TEGELS = ["bosbranden", "verkeer", "landelijk", "nl-nieuws", "regionaal"];
export const PERS_TEGEL_LABEL = {
  bosbranden: "Bosbranden",
  verkeer: "Verkeer & reizen",
  landelijk: "Landelijk & internationaal",
  "nl-nieuws": "Nederlands nieuws",
  regionaal: "Regionaal nieuws",
};
// Brontthema's (uit bronnen.json) -> pers-tegel bij groeperen (fallback als geen
// brandtrefwoord matcht). Alles wat hier niet in staat, valt onder "landelijk".
//
// nl-nieuws had een eigen tegel nodig. NOS en NU.nl staan al sinds jaar en dag
// actief in bronnen.json en stroomden gewoon binnen, maar werden hier op
// "landelijk" gezet — waar ze tussen Le Monde en Le Figaro verdwenen. Voor een
// Nederlander in Frankrijk is "wat meldt Nederland" een andere vraag dan "wat
// meldt Frankrijk", en die twee horen dus niet in één tegel.
//
// Let op de stemming in persTegelVoor(): een cluster kiest de tegel waar de
// MEESTE van zijn bronnen naar wijzen. Een verhaal dat NOS én Le Monde haalt,
// blijft dus bij landelijk staan zolang er meer Franse bronnen in zitten. Dat
// is bedoeld: dan is het Frans nieuws waar Nederland ook over schrijft.
export const BRONTHEMA_NAAR_PERSTEGEL = {
  "regionaal-fr": "regionaal",
  "landelijk-fr": "landelijk",
  "nl-nieuws": "nl-nieuws",
};

// Labels voor de overige tegels.
export const INFOFRANKRIJK_LABEL = "Laatste updates op Infofrankrijk";
export const VERENIGINGEN_LABEL = "Nederlandse verenigingen";

// Overzichtspagina met alle NL-verenigingen in Frankrijk (link in de agenda-tegel).
export const VERENIGINGEN_PAGINA =
  "https://www.nederlanders.fr/page/nederlandse-verenigingen-in-frankrijk";

// ---- Redactionele verwijzingen naar Infofrankrijk ---------------------------
// Onder een bericht op /actueel kan een verwijzing komen te staan naar een
// achtergrondartikel op infofrankrijk.com ("Meer hierover op Infofrankrijk").
// Twee dingen die dit NIET is:
//   1. Het is GEEN bron. De bronnenlijst is attributie — de Franse originelen
//      waar de synthese op steunt. Een eigen achtergrondartikel is "verder
//      lezen" en staat daarom in een eigen blok onder de bronnen.
//   2. Het gebeurt NIET automatisch. De redactie kiest per bericht uit een
//      voorgestelde lijst; klikt zij niets aan, dan komt er geen verwijzing.
//      Dat is een harde regel en staat zo in api/review.js: de cron schrijft
//      nooit een verwijzing.
//
// Dezelfde koppeling werkt de andere kant op: een nieuwe aankondiging van
// Bercy kan betekenen dat fiscale artikelen op Infofrankrijk een controle
// nodig hebben. Die kant is de knop "Nakijken" — die zet het IF-artikel op een
// takenlijst in de reviewtool en is voor de lezer onzichtbaar.

// De index van infofrankrijk.com komt uit de openbare WordPress-REST-API. Geen
// inloggen, geen sleutel: per artikel id, link, titel, laatste wijziging en
// categorie-id's. Bij ~350 artikelen zijn dat vier verzoeken.
export const IF_API_BASIS = "https://infofrankrijk.com/wp-json/wp/v2";
export const IF_PER_PAGINA = 100;
export const IF_MAX_PAGINAS = 12; // vangnet tegen een eindeloze pagineerlus
export const IF_TIMEOUT_MS = 8000;
export const KEY_IF_INDEX = `${KV_PREFIX}if-index:v1`;
// Ruim bewaren, vaak genoeg verversen. De TTL is bewust veel langer dan het
// ververs-interval: valt infofrankrijk.com een dag uit, dan blijft de laatste
// index gewoon staan in plaats van dat de keuzelijst leeg raakt.
export const IF_INDEX_TTL_S = 30 * 24 * 60 * 60;
export const IF_INDEX_VERVERS_NA_S = 6 * 60 * 60; // ouder dan 6 uur -> opnieuw ophalen

// FILTER 1 — DE DATUM. Nooit verwijzen naar iets dat langer dan twaalf maanden
// niet is bijgewerkt. Getoetst op `modified` (niet op `date`): dat is de datum
// die zegt "sinds wanneer heb ik hier niet meer naar gekeken", en precies die
// vraag stelt de auditkant ook.
export const IF_MAX_LEEFTIJD_MAANDEN = 12;
// De 12-maandengrens is stil: een artikel dat je een jaar niet aanraakt
// verdwijnt vanzelf uit de keuzelijst zonder dat je het merkt. De reviewtool
// toont daarom wat er BÍJNA uit valt.
export const IF_BIJNA_VERLOPEN_MAANDEN = 2;

// FILTER 2 — DE CATEGORIELIJST. Per thema van een bericht op /actueel de
// Infofrankrijk-categorieën waaruit kandidaten mogen komen.
//
// DIT IS EEN EERSTE VOORZET EN HANDWERK, met opzet. De categorisering op
// infofrankrijk.com is niet strak genoeg om automatisch af te leiden: onder de
// fiscale categorieën valt ook "Kinderbijslag" en "Juridische bijstand". Een
// automatische afleiding zou die ruis structureel maken. Bijschaven doe je
// hier, op één plek; de rest van de code kent alleen deze tabel.
// De getallen zijn de category-id's van infofrankrijk.com (het aantal artikelen
// van augustus 2026 staat erbij, als maat voor hoe breed een keuze is).
export const IF_CATEGORIE_PER_THEMA = {
  // --- overheidsthema's (OVERHEID_THEMAS) ---
  "geld-belasting": [18, 12, 362], // Belastingen 24 · Geldzaken 29 · Bankieren 4
  praktisch: [26, 68, 20], // Overheden 35 · Gemeente 19 · Leven 37
  ondernemen: [22, 4, 369, 370], // Ondernemen 15 · MKB 16 · Bedrijfsvormen 6 · Eigen baas 10
  "sociale-zekerheid": [49, 360, 74, 42], // Zorg en welzijn 34 · Zorgverzekering 8 · Ouderenzorg 11 · Verzekeringen 16
  douane: [376, 563], // Vervoer & Import 23 · Emigratie 17
  economie: [12, 22], // Geldzaken 29 · Ondernemen 15
  wetgeving: [73, 364, 66, 379], // Juridisch 25 · Juridisch & Familie 7 · Erfrecht 7 · Regelgeving & subsidies 22
  "natuur-milieu": [48, 41, 379, 79], // Zonnepanelen 9 · Verwarming 11 · Regelgeving & subsidies 22 · Tuinieren 6
  "nl-overheid": [26, 21, 68], // Overheden 35 · Nieuws 14 · Gemeente 19
  // --- persthema's (PERS_TEGELS) ---
  bosbranden: [17, 30, 387], // Hulpverlening 8 · Politie en veiligheid 10 · Hulplijnen 7
  verkeer: [376], // Vervoer & Import 23
  landelijk: [26, 21], // Overheden 35 · Nieuws 14
  "nl-nieuws": [26, 21], // Overheden 35 · Nieuws 14
  regionaal: [58, 68], // Regio's & steden 4 · Gemeente 19
};

// Hoeveel kandidaten de reviewtool standaard toont (oudste `modified` eerst —
// dat zijn tegelijk de beste auditkandidaten en de zwakste verwijzingen). De
// rest komt achter "toon alle …".
export const IF_KANDIDATEN_STANDAARD = 10;
// Hooguit zoveel verwijzingen onder één bericht. Meer is geen verwijzing meer
// maar een tweede bronnenlijst.
export const IF_VERWIJZING_MAX = 3;
// De kop boven het blok op /actueel. Eén plek, zodat pagina en tests dezelfde
// tekst gebruiken.
export const IF_VERWIJZING_KOP = "Meer hierover op Infofrankrijk";

// Opslag. Verwijzingen hangen aan het ARTIKEL-id (dat is het id van de
// publicatie of van het overheidsrecord, hetzelfde id dat de tegel gebruikt) en
// staan bewust NIET in het record zelf: dan zou een cron-ronde die het record
// herschrijft de keuze van de redactie kunnen overschrijven.
// De TTL loopt gelijk met de langstlevende records (overheid, 28 dagen); een
// verwijzing bij een verlopen artikel is vanzelf onvindbaar.
export const KEY_VERWIJZING = (id) => `${KV_PREFIX}verwijzing:${id}`;
export const SCAN_VERWIJZING = `${KV_PREFIX}verwijzing:*`;
export const VERWIJZING_TTL_S = OVERHEID_TTL_S;
// De auditlijst ("nakijken") is een takenlijst van de redactie en verloopt
// NIET: hij blijft staan tot hij is afgevinkt. Sleutel op het IF-artikel, zodat
// hetzelfde artikel niet twee keer op de lijst komt; een tweede aanleiding
// wordt aan het bestaande record toegevoegd.
export const KEY_NAKIJKEN = (ifId) => `${KV_PREFIX}nakijken:${ifId}`;
export const SCAN_NAKIJKEN = `${KV_PREFIX}nakijken:*`;
