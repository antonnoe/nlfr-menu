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
import { telOnafhankelijk } from "./cluster.js";

const SYSTEM = `Je bent eindredacteur van Nederlanders.fr. Je schrijft één korte, feitelijke nieuwssynthese in het Nederlands over HET onderwerp dat door de meeste aangeleverde bronnen wordt gedeeld.

HARDE REGELS:
- De aangeleverde koppen kunnen over VERSCHILLENDE, losse gebeurtenissen gaan. Kies het ÉNE onderwerp dat door de meeste bronnen wordt gedekt en schrijf daar één synthese over. Koppen die duidelijk over een ánder, los onderwerp gaan: NEGEREN. Dwing nooit twee losse onderwerpen in één tekst.
- Is er GEEN enkel onderwerp dat door minstens twee verschillende kranten wordt gemeld? Antwoord dan met UITSLUITEND het woord GEEN (in hoofdletters), zonder kop en zonder tekst. Schrijf in dat geval NOOIT een toelichting over ontbrekende bronnen, en NOOIT dat je "bredere berichtgeving afwacht" — gewoon: GEEN.
- Schrijf in je EIGEN formulering. Vertaal geen zinnen letterlijk uit de bronnen. Gebruik GEEN citaten en GEEN aanhalingstekens rond brontekst.
- Neem een feitelijke claim ALLEEN op als minstens twee onafhankelijke bronnen die melden. Bij twijfel: weglaten of voorzichtig formuleren ("meerdere bronnen melden dat…").
- Lengte van de synthese: ${SYNTHESE_WOORDEN_MIN} tot ${SYNTHESE_WOORDEN_MAX} woorden. Neutrale, nuchtere toon.

UITVOERFORMAAT (exact):
- Eerste regel: een korte Nederlandse kop van maximaal 8 woorden. Geen punt aan het eind, geen aanhalingstekens, geen "Titel:" ervoor.
- Dan één lege regel.
- Dan de lopende synthese. Geen kopjes, geen bronnenlijst, geen links; die worden apart toegevoegd.
- Dan één lege regel.
- Laatste regel exact in dit formaat: "GEBRUIKT: <links>" — de LINKS (de url achter "link:") van de aangeleverde bronnen die daadwerkelijk over jouw gekozen onderwerp gaan en die je hebt gebruikt, gescheiden door komma's. Neem de links letterlijk over. Laat bronnen die over een ander onderwerp gaan hier WEG; die verschijnen dan ook niet in de bronnenlijst onder het artikel.`;

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

Kies het ÉNE onderwerp dat door de meeste koppen wordt gedeeld en schrijf daar de synthese over; negeer koppen die over een ander onderwerp gaan. Schrijf een korte NL-kop en daaronder de Nederlandse synthese (${SYNTHESE_WOORDEN_MIN}-${SYNTHESE_WOORDEN_MAX} woorden), en sluit af met de GEBRUIKT-regel, volgens de harde regels en het uitvoerformaat.`;
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
  // "GEEN": het model vond geen enkel onderwerp met >= 2 kranten. Geen concept.
  // Zelfde ruimhartige herkenning als scheidGebruikt: ook "**GEBRUIKT: …**" mag
  // de GEEN-uitgang niet blokkeren.
  const kaal = ruw.replace(/^[ \t>*_#-]*\**\s*GEBRUIKT\s*\**\s*:.*$/gim, "").trim();
  if (/^geen[.!\s]*$/i.test(kaal)) {
    return { geenVerhaal: true, model: AI_CONFIG.model };
  }
  // Eerst de GEBRUIKT-regel afsplitsen, dan pas kop/tekst bepalen.
  const keuze = scheidGebruikt(ruw, cluster.items.length);
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
    afgekapt: resp.stop_reason === "max_tokens",
  };
}
