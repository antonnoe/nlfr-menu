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
- Laatste regel exact in dit formaat: "GEBRUIKT: <nummers>" — de nummers van de aangeleverde bronnen die daadwerkelijk over jouw gekozen onderwerp gaan en die je hebt gebruikt (bijvoorbeeld "GEBRUIKT: 1, 3, 4"). Laat bronnen die over een ander onderwerp gaan hier WEG.`;

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
export function bouwBronnen(cluster, gebruikteNummers = null) {
  const gezien = new Set();
  const uit = [];
  cluster.items.forEach((item, i) => {
    // Als het model heeft opgegeven welke bronnen het gebruikte (1-based), houd
    // dan alleen die — zo verdwijnen losse, niet-gebruikte artikelen uit de lijst.
    if (gebruikteNummers && !gebruikteNummers.includes(i + 1)) return;
    if (!item.url || gezien.has(item.url)) return;
    gezien.add(item.url);
    uit.push({ naam: item.bron, titel: item.titel, url: item.url, datum: item.datum });
  });
  return uit;
}

// Haalt de "GEBRUIKT: 1, 3, 4"-regel uit het modelantwoord en geeft de nummers
// terug plus de tekst zonder die regel. Geen regel gevonden -> null (dan vallen
// we terug op alle clusterbronnen).
export function scheidGebruikt(ruw, aantalItems) {
  const re = /^[ \t>*-]*GEBRUIKT\s*:\s*([0-9,\s&en]+?)\s*$/im;
  const m = String(ruw || "").match(re);
  if (!m) return { nummers: null, tekst: String(ruw || "").trim() };
  const nummers = m[1]
    .split(/[^0-9]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= aantalItems);
  const tekst = String(ruw).replace(m[0], "").trim();
  return { nummers: nummers.length ? [...new Set(nummers)] : null, tekst };
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
  const kaal = ruw.replace(/^GEBRUIKT\s*:.*$/gim, "").trim();
  if (/^geen[.!\s]*$/i.test(kaal)) {
    return { geenVerhaal: true, model: AI_CONFIG.model };
  }
  // Eerst de GEBRUIKT-regel afsplitsen, dan pas kop/tekst bepalen.
  const { nummers, tekst: zonderGebruikt } = scheidGebruikt(ruw, cluster.items.length);
  const { kop, tekst } = splitsKop(zonderGebruikt);
  const bronnen = bouwBronnen(cluster, nummers);

  return {
    kop,
    tekst,
    bronnen,
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
