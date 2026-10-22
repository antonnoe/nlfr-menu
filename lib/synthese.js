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
import {
  AI_CONFIG,
  SYNTHESE_WOORDEN_MIN,
  SYNTHESE_WOORDEN_MAX,
  PERS_TEGELS,
  PERS_TEGEL_LABEL,
  PERS_THEMA_UITLEG,
  OVERHEID_THEMA_LABEL,
  OVERHEID_THEMA_UITLEG,
} from "./config.js";
import { ontHtml } from "./ifindex.js";
import { telOnafhankelijk } from "./cluster.js";

// ---- Thema door het model ---------------------------------------------------
// Het model kiest het thema in DEZELFDE aanroep als de synthese: één extra
// veldregel "THEMA: <code>" in het bestaande uitvoerformaat (geen extra verzoek
// per bericht). De lijst en de uitleg per thema komen uit lib/config.js, zodat
// prompt en validatie nooit uit elkaar lopen.
export function themaRegels(codes, uitleg) {
  return codes.map((c) => `  - ${c}: ${uitleg[c]}`).join("\n");
}

// Normaliseert wat het model na "THEMA:" schrijft ("**Zorg**", "`zorg`",
// "Zorg en gezondheid.", "nl nieuws") en zoekt het in de toegestane lijst, op
// code óf op label. Alles wat daar niet in staat (onbekend, "geen", leeg,
// rommel) geeft null: geen thema, en de aanroeper valt terug op de regels.
export function valideerThema(waarde, toegestaan, labels = {}) {
  if (typeof waarde !== "string") return null;
  const kaal = waarde
    .replace(/[*_`"'«»<>[\]().,;:!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!kaal || kaal.length > 40) return null;
  const alsCode = kaal.replace(/ /g, "-");
  for (const code of toegestaan) {
    if (alsCode === code) return code;
    const label = (labels[code] || "").toLowerCase();
    if (label && kaal === label) return code;
  }
  return null;
}

// Haalt de THEMA-regel uit het modelantwoord. Geeft { thema, tekst }: het
// gevalideerde thema (of null) en de tekst zónder die regel. De laatste
// THEMA-regel telt. Ontbreekt de regel, of is het antwoord onleesbaar, dan is
// thema null en blijft de tekst ongemoeid.
export function scheidThema(ruw, toegestaan, labels = {}) {
  const bron = String(ruw || "");
  const re = /^[ \t>*_#-]*\**\s*THEMA\s*\**\s*:\s*(.*)$/gim;
  const alle = [...bron.matchAll(re)];
  if (!alle.length) return { thema: null, tekst: bron.trim() };
  const laatste = alle[alle.length - 1];
  const thema = valideerThema(laatste[1], toegestaan, labels);
  const tekst = bron.replace(laatste[0], "").trim();
  return { thema, tekst };
}

const SYSTEM = `Je bent eindredacteur van Nederlanders.fr. Je schrijft één korte, feitelijke nieuwssynthese in het Nederlands over HET onderwerp dat door de meeste aangeleverde bronnen wordt gedeeld.

HARDE REGELS:
- De aangeleverde koppen kunnen over VERSCHILLENDE, losse gebeurtenissen gaan. Kies het ÉNE onderwerp dat door de meeste bronnen wordt gedekt en schrijf daar één synthese over. Koppen die duidelijk over een ánder, los onderwerp gaan: NEGEREN. Dwing nooit twee losse onderwerpen in één tekst.
- Is er GEEN enkel onderwerp dat door minstens twee verschillende kranten wordt gemeld? Antwoord dan met UITSLUITEND het woord GEEN (in hoofdletters), zonder kop en zonder tekst. Schrijf in dat geval NOOIT een toelichting over ontbrekende bronnen, en NOOIT dat je "bredere berichtgeving afwacht" — gewoon: GEEN.
- Schrijf in je EIGEN formulering. Vertaal geen zinnen letterlijk uit de bronnen. Gebruik GEEN citaten en GEEN aanhalingstekens rond brontekst.
- Noem in de lopende tekst NOOIT een medium bij naam. Dus niet "volgens Le Monde", niet "Sud Ouest meldt", niet "zoals Franceinfo schrijft" — ook niet tussen haakjes. De bronnenlijst onder het artikel is de attributie; die wordt automatisch toegevoegd.
- Voorbehoud maak je WEL, maar generiek: "volgens meerdere Franse media", "Franse media melden", "vooralsnog door één bron gemeld", "de autoriteiten laten weten". Gebruik zulke formuleringen actief als de zekerheid beperkt is.
- Neem een feitelijke claim ALLEEN op als minstens twee onafhankelijke bronnen die melden. Bij twijfel: weglaten of voorzichtig formuleren ("meerdere bronnen melden dat…").
- Lengte van de synthese: ${SYNTHESE_WOORDEN_MIN} tot ${SYNTHESE_WOORDEN_MAX} woorden. Neutrale, nuchtere toon.

UITVOERFORMAAT (exact):
- Eerste regel: een korte Nederlandse kop van maximaal 8 woorden. Geen punt aan het eind, geen aanhalingstekens, geen "Titel:" ervoor.
- Dan één lege regel.
- Dan de lopende synthese. Geen kopjes, geen bronnenlijst, geen links; die worden apart toegevoegd.
- Dan één lege regel.
- Dan één regel exact in dit formaat: "THEMA: <code>" — het ÉNE thema uit de vaste lijst hieronder dat het best bij jouw synthese past. Gebruik uitsluitend een code uit de lijst, letterlijk. Past geen enkel thema duidelijk, schrijf dan "THEMA: geen".
- Dan één lege regel.
- Laatste regel exact in dit formaat: "GEBRUIKT: <links>" — de LINKS (de url achter "link:") van de aangeleverde bronnen die daadwerkelijk over jouw gekozen onderwerp gaan en die je hebt gebruikt, gescheiden door komma's. Neem de links letterlijk over. Laat bronnen die over een ander onderwerp gaan hier WEG; die verschijnen dan ook niet in de bronnenlijst onder het artikel.

VASTE THEMALIJST (kies precies één code, kies naar de inhoud van JOUW synthese):
${themaRegels(PERS_TEGELS, PERS_THEMA_UITLEG)}`;

// Overheidsbronnen (Licence Ouverte): NL-samenvatting van 2-4 zinnen mag direct
// automatisch live. Feitelijk, eigen formulering, geen citaten.
// Het thema van het bericht staat al vast (de feed waaruit het komt). Het model
// mag dat ALLEEN wijzigen als de tekst DUIDELIJK over een ander thema gaat;
// twijfel = hetzelfde thema teruggeven. Nederlandstalige overheidsbronnen gaan
// niet door deze aanroep (overheidUitFeed, geen model) en houden hun thema.
const OVERHEID_KEUZE = Object.keys(OVERHEID_THEMA_UITLEG);
const SYSTEM_OVERHEID = `Je bent redacteur van Nederlanders.fr. Je vat een Frans overheidsbericht samen in vlot, feitelijk Nederlands.

HARDE REGELS:
- Eigen formulering; vertaal geen zinnen letterlijk, gebruik geen citaten.
- De samenvatting is 2 tot 4 zinnen. Alleen de kern: wat verandert er, voor wie, per wanneer.

UITVOERFORMAAT (exact):
- Eerste regel: een korte Nederlandse kop van maximaal 8 woorden. Geen punt aan het eind, geen aanhalingstekens, geen "Titel:" ervoor.
- Dan één lege regel.
- Dan de samenvatting (2-4 zinnen). Geen kopjes, geen bronvermelding, geen links.
- Dan één lege regel.
- Laatste regel exact in dit formaat: "THEMA: <code>". Het bericht komt binnen met een voorlopig thema. Geef DAT thema terug, tenzij de tekst DUIDELIJK over een ander thema uit de lijst gaat; bij twijfel blijft het voorlopige thema staan. Gebruik uitsluitend een code uit de lijst, letterlijk.

VASTE THEMALIJST:
${themaRegels(OVERHEID_KEUZE, OVERHEID_THEMA_UITLEG)}`;

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

// ---- Wat er terugkomt als het plafond opgaat aan denkwerk ------------------
// OP CLAUDE-OPUS-5 STAAT ADAPTIEF DENKEN AAN zodra `thinking` wordt weggelaten,
// en dat denkwerk telt mee in max_tokens (zie AI_CONFIG in lib/config.js). Gaat
// het hele plafond op aan denken, dan komt er een antwoord terug met
// stop_reason "max_tokens" en NUL tekstblokken.
//
// Dat was tot nu toe één regel: `if (!ruw) throw new Error("Lege synthese
// ontvangen.")`. Die fout werd in api/cron.js opgevangen en belandde in het
// antwoord dat niemand leest — geen logregel, geen teller, geen zichtbaar
// verschil met een rustige nieuwsdag. Een storing die per aanroep terugkomt
// zag er zo veertig uur lang uit als "geen nieuws".
//
// Daarom noemt de fout nu de oorzaak én de knop: welke stop_reason, hoeveel
// tokens eraan opgingen, en wat je eraan doet. Een foutmelding die niet zegt
// wat je moet veranderen, kost dezelfde tijd als geen foutmelding.
function tekstUitAntwoord(resp, wat) {
  const ruw = (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (ruw) return ruw;

  const uit = (resp.usage && resp.usage.output_tokens) || 0;
  const denk = (resp.content || []).some((b) => b.type === "thinking");
  if (resp.stop_reason === "max_tokens") {
    throw new Error(
      `Lege ${wat}: het plafond van max_tokens (${AI_CONFIG.maxTokens}) ging volledig op ` +
        `aan ${denk ? "denkwerk" : "tokens"} — ${uit} outputtokens, stop_reason=max_tokens, ` +
        `geen enkel tekstblok. Verhoog AI_CONFIG.maxTokens of verlaag AI_CONFIG.effort ` +
        `(nu "${AI_CONFIG.effort}"); adaptief denken telt mee in max_tokens.`
    );
  }
  throw new Error(
    `Lege ${wat}: geen tekstblok in het antwoord (stop_reason=${resp.stop_reason || "onbekend"}, ` +
      `${uit} outputtokens${denk ? ", wel een denkblok" : ""}).`
  );
}

// Een overheidsbericht dat AL Nederlands is, zonder model.
//
// WAAROM ZONDER MODEL. samenvatOverheid() bestaat om een Franse tekst in het
// Nederlands samen te vatten. Bij rijksoverheid.nl is er niets te vertalen: de
// kop en de samenvatting staan al in het Nederlands in de feed. Een model
// erlangs sturen zou betalen om Nederlands in Nederlands om te zetten — en het
// zou bovendien het enige punt in die keten zijn waar iets verzonnen KAN
// worden. Overnemen is hier dus goedkoper én veiliger dan samenvatten.
//
// Mag dat? Ja, en dat is precies de reden dat het alleen voor deze bronnen
// geldt: rijksoverheid.nl staat onder CC0, dat woordelijk hergebruik zonder
// naamsvermelding toestaat. De licentie staat per bron in bronnen.json; zonder
// zo'n vermelding hoort een bron hier niet thuis. Bronvermelding met link
// blijft staan — niet omdat het moet, maar omdat de lezer moet kunnen zien
// waar iets vandaan komt.
export function overheidUitFeed(item) {
  const kop = ontHtml(item.titel);
  const tekst = ontHtml(item.samenvatting || "");
  // Geen samenvatting in de feed? Dan is de kop alles wat we hebben. Dat is
  // mager maar eerlijk; er wordt niets bij verzonnen.
  return { kop, samenvatting: tekst || kop, model: null };
}

export async function samenvatOverheid(item) {
  const client = new Anthropic();
  const invoer = `Bron: ${item.bron}\nTitel: ${item.titel}${
    item.samenvatting ? `\nTekst: ${item.samenvatting}` : ""
  }\nVoorlopig thema: ${item.thema || "onbekend"}\n\nSchrijf een korte NL-kop en vat dit overheidsbericht samen in 2-4 zinnen Nederlands, en sluit af met de THEMA-regel.`;
  const resp = await client.messages.create({
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    output_config: { effort: AI_CONFIG.effort },
    // EXPLICIET, ook al is dit op claude-opus-5 de standaard. Weglaten betekent
    // op dit model "denk adaptief" en op de vorige generatie "denk niet"; wie
    // later `model` wijzigt, verandert dan ongemerkt ook het gedrag én het deel
    // van max_tokens dat aan denkwerk opgaat. Zie AI_CONFIG in lib/config.js.
    thinking: { type: "adaptive" },
    system: SYSTEM_OVERHEID,
    messages: [{ role: "user", content: invoer }],
  });
  if (resp.stop_reason === "refusal") {
    throw new Error("Anthropic weigerde deze samenvatting (refusal).");
  }
  const ruw = tekstUitAntwoord(resp, "overheidssamenvatting");
  const gekozen = scheidThema(ruw, OVERHEID_KEUZE, OVERHEID_THEMA_LABEL);
  const { kop, tekst } = splitsKop(gekozen.tekst);
  return {
    kop,
    samenvatting: tekst,
    model: AI_CONFIG.model,
    // null = geen (geldig) oordeel van het model: het thema van de feed blijft.
    thema: gekozen.thema,
  };
}

// URL-sleutel voor het matchen van modelopgave tegen clusteritems: host + pad,
// zonder querystring, fragment, trailing slash of hoofdletters. Zo matcht een
// link met tracking-parameters (…?xtor=RSS-111) nog steeds op het clusteritem.
// Leestekens en markdown die aan het EIND van een geplakte URL kunnen kleven:
// "…/evacues**", "…/evacues)," , "…/evacues.". Nooit onderdeel van de link.
const URL_STAART = /[)\].,;:'"»*_>]+$/;

export function urlSleutel(u) {
  const s = String(u || "").trim().replace(URL_STAART, "");
  if (!s) return "";
  try {
    const x = new URL(s);
    return (x.host + x.pathname).toLowerCase().replace(/^www\./, "").replace(/\/+$/, "");
  } catch {
    return s.toLowerCase().replace(/\/+$/, "");
  }
}

// Eén item per artikel (ontdubbeld op URL), met publicatietijdstip. De
// weergave groepeert deze per bron en toont per aangehaald artikel de link
// mét tijdstip.
//
// `keuze` is de uitslag van scheidGebruikt(): { urls, nummers }. Primair matchen
// we op URL — die is uniek en overleeft het hernummeren of herordenen van de
// lijst, anders dan een volgnummer. Levert dat niets op, dan vallen we terug op
// de opgegeven volgnummers (1-based, zoals in de prompt genummerd). Levert ook
// dát niets op, dan blijft de volledige clusterlijst staan; de aanroeper
// markeert dat als terugval.
export function bouwBronnen(cluster, keuze = null) {
  const items = (cluster && cluster.items) || [];
  const urls = (keuze && keuze.urls) || null;
  const nummers = (keuze && keuze.nummers) || null;

  let houd = null; // Set van indices die we bewaren; null = alles
  if (urls && urls.length) {
    const gevraagd = new Set(urls.map(urlSleutel).filter(Boolean));
    const treffers = new Set();
    items.forEach((item, i) => {
      if (item && item.url && gevraagd.has(urlSleutel(item.url))) treffers.add(i);
    });
    if (treffers.size) houd = treffers;
  }
  if (!houd && nummers && nummers.length) {
    const treffers = new Set(
      nummers.filter((n) => n >= 1 && n <= items.length).map((n) => n - 1)
    );
    if (treffers.size) houd = treffers;
  }

  const gezien = new Set();
  const uit = [];
  items.forEach((item, i) => {
    if (houd && !houd.has(i)) return;
    if (!item || !item.url || gezien.has(item.url)) return;
    gezien.add(item.url);
    uit.push({ naam: item.bron, titel: item.titel, url: item.url, datum: item.datum });
  });
  return { bronnen: uit, gefilterd: !!houd };
}

// Haalt de GEBRUIKT-regel uit het modelantwoord: de bronnen die het model
// daadwerkelijk heeft gebruikt, als URL's en/of volgnummers, plus de tekst
// zonder die regel.
//
// Bewust ruimhartig in wat we accepteren. De vorige versie eiste een hele regel
// die op niets anders eindigde dan cijfers en komma's; in de praktijk schrijft
// een model er net zo goed "**GEBRUIKT: 1, 3**", "GEBRUIKT: 1, 3 (Le Monde)" of
// een afsluitende punt achter. Elke afwijking liet de match falen, en dan viel
// de bronnenlijst stilzwijgend terug op ALLE clusteritems — precies de
// bijvangst die onder gepubliceerde artikelen opdook. Nu pakken we alles ná het
// woord GEBRUIKT tot het einde van die regel en vissen daar URL's en getallen
// uit; markdown, haakjes en leestekens eromheen maken niet meer uit.
export function scheidGebruikt(ruw, aantalItems) {
  const bron = String(ruw || "");
  const re = /^[ \t>*_#-]*\**\s*GEBRUIKT\s*\**\s*:\s*(.*)$/im;
  const m = bron.match(re);
  if (!m) return { urls: null, nummers: null, tekst: bron.trim() };

  const rest = m[1];
  const urls = (rest.match(/https?:\/\/[^\s,;»"'<>[\]]+/gi) || []).map((u) =>
    u.replace(URL_STAART, "")
  );
  // Getallen buiten de URL's om (een URL kan zelf cijfers bevatten).
  const zonderUrls = rest.replace(/https?:\/\/\S+/gi, " ");
  const nummers = [
    ...new Set(
      (zonderUrls.match(/\d+/g) || [])
        .map((n) => parseInt(n, 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= aantalItems)
    ),
  ];

  const tekst = bron.replace(m[0], "").trim();
  return {
    urls: urls.length ? urls : null,
    nummers: nummers.length ? nummers : null,
    tekst,
  };
}

function bouwGebruikersTekst(cluster) {
  const regels = cluster.items.map((item, i) => {
    const datum = item.datum ? new Date(item.datum).toISOString().slice(0, 16).replace("T", " ") : "?";
    const extra =
      item.regime === "overheid" && item.samenvatting
        ? `\n   samenvatting (overheid): ${item.samenvatting}`
        : "";
    return `${i + 1}. [${item.bron}] ${item.titel} (${datum})\n   link: ${item.url || "-"}${extra}`;
  });
  return `Hieronder staan genummerde koppen (en waar beschikbaar de overheidssamenvatting). LET OP: deze koppen kunnen over verschillende, losse gebeurtenissen gaan — ze zijn machinaal geclusterd en niet per se hetzelfde verhaal. Persbronnen leveren alleen een kop; leid daar geen details uit af die niet door minstens twee bronnen worden bevestigd.

${regels.join("\n")}

Kies het ÉNE onderwerp dat door de meeste koppen wordt gedeeld en schrijf daar de synthese over; negeer koppen die over een ander onderwerp gaan. Schrijf een korte NL-kop en daaronder de Nederlandse synthese (${SYNTHESE_WOORDEN_MIN}-${SYNTHESE_WOORDEN_MAX} woorden), kies daarna het THEMA uit de vaste lijst en sluit af met de GEBRUIKT-regel, volgens de harde regels en het uitvoerformaat.`;
}

export async function synthetiseer(cluster) {
  const client = new Anthropic(); // leest ANTHROPIC_API_KEY uit de omgeving
  const resp = await client.messages.create({
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    output_config: { effort: AI_CONFIG.effort },
    // EXPLICIET, ook al is dit op claude-opus-5 de standaard. Weglaten betekent
    // op dit model "denk adaptief" en op de vorige generatie "denk niet"; wie
    // later `model` wijzigt, verandert dan ongemerkt ook het gedrag én het deel
    // van max_tokens dat aan denkwerk opgaat. Zie AI_CONFIG in lib/config.js.
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: bouwGebruikersTekst(cluster) }],
  });

  if (resp.stop_reason === "refusal") {
    throw new Error("Anthropic weigerde deze synthese (stop_reason=refusal).");
  }
  const ruw = tekstUitAntwoord(resp, "synthese");
  // "GEEN": het model vond geen enkel onderwerp met >= 2 kranten. Geen concept.
  // Zelfde ruimhartige herkenning als scheidGebruikt: ook "**GEBRUIKT: …**" mag
  // de GEEN-uitgang niet blokkeren.
  const kaal = ruw
    .replace(/^[ \t>*_#-]*\**\s*(?:GEBRUIKT|THEMA)\s*\**\s*:.*$/gim, "")
    .trim();
  if (/^geen[.!\s]*$/i.test(kaal)) {
    return { geenVerhaal: true, model: AI_CONFIG.model };
  }
  // Eerst de GEBRUIKT-regel afsplitsen, dan pas kop/tekst bepalen.
  // De THEMA-regel gaat er het eerst af (en wordt gevalideerd tegen PERS_TEGELS).
  const gekozen = scheidThema(ruw, PERS_TEGELS, PERS_TEGEL_LABEL);
  const keuze = scheidGebruikt(gekozen.tekst, cluster.items.length);
  const { kop, tekst } = splitsKop(keuze.tekst);
  const { bronnen, gefilterd } = bouwBronnen(cluster, keuze);

  return {
    kop,
    tekst,
    bronnen,
    // Kon de opgave van het model niet worden gematcht, dan staat de VOLLEDIGE
    // clusterlijst onder het artikel (oud gedrag) — inclusief mogelijke
    // bijvangst. Dat moet in de reviewtool zichtbaar zijn.
    bronnenTerugval: !gefilterd,
    // Distincte, ONAFHANKELIJKE outlets ná filtering. Bewust niet
    // `new Set(bronnen.map(b => b.naam)).size`: dat telde twee artikelen van
    // dezelfde krant met verschillende koppen als twee bevestigingen — precies
    // hoe een tweekoppen-synthese uit één krant door de drempel kon glippen.
    onafhankelijkeGebruikt: telOnafhankelijk(
      bronnen.map((b) => ({ titel: b.titel, bron: b.naam }))
    ),
    model: AI_CONFIG.model,
    // Thema door het model gekozen (of null: ontbrekend/onbekend -> de regels
    // in persTegelVoor beslissen), met de herkomst erbij.
    thema: gekozen.thema,
    themaBron: gekozen.thema ? "model" : null,
    afgekapt: resp.stop_reason === "max_tokens",
  };
}
