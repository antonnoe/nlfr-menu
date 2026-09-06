// Welke Infofrankrijk-artikelen liggen het dichtst bij dít bericht?
// ---------------------------------------------------------------------------
// WAAROM. Het IF-blok in /review toonde bij openen de vijftig artikelen van het
// thema, op oudste wijziging, zonder enige relatie tot het onderwerp. De
// redactie moest bij elk bericht zelf een zoekterm verzinnen, en dat is de reden
// dat er twee verwijzingen per dag werden gemaakt in plaats van twintig.
//
// GEEN AI. Woordoverlap volstaat en is uitlegbaar: bij een suggestie staat welke
// woorden hem opleverden, en die verantwoording is met een model niet te geven.
//
// WAT DE METING LEERDE, en dit is de kern van dit bestand. Gemeten over de 349
// echte IF-artikelen en de 75 echte artikelen in test/fixtures/actueel-
// levering.json:
//
//   1. IDF LOST HET NIET OP. In een corpus van 349 korte samenvattingen komt 70%
//      van alle termen in precies één artikel voor. "keert" (df=3) is daarmee
//      statistisch even zeldzaam als "energielabel" (df=1), en zeldzaamheid
//      scheidt onderwerp dus niet van toeval. De idf-weging staat er nog wel,
//      want ze duwt corpusbrede woorden ("huis", "kosten", "regels") omlaag,
//      maar ze is niet de zeef.
//   2. ÉÉN GEDEELD WOORD IS ALTIJD TOEVAL. Bij de eerste meting haalde
//      "december" de moestuinkalender op en "vijf" het lycée professionnel.
//      Vandaar MIN_GEDEELD. Dezelfde discipline die lib/cluster.js aanhoudt.
//   3. DE SCORE IS WEL DE ZEEF. Elke bruikbare suggestie in de meting zat boven
//      de 6, elke functiewoordtreffer ("laat, zien", "keert, terug",
//      "gepubliceerd, overzicht") onder de 4,5. Met MIN_SCORE op 5 bleven zeven
//      van de 75 artikelen over, alle zeven plausibel.
//
// LIEVER NIETS DAN IETS. Negen procent van de artikelen krijgt een suggestie; de
// rest valt terug op de themalijst zoals voorheen. Dat is met opzet: een
// suggestielijst die er wel uitziet maar niets voorstelt is erger dan de oude
// situatie, want dan klikt de redactie hem aan.

// Woorden die geen onderwerp dragen. Handwerk, want de statistiek kan het hier
// niet (zie punt 1 hierboven). NL en FR door elkaar: de perskoppen zijn vertaald
// maar de bronnen niet.
export const STOPWOORDEN = new Set([
  "de","het","een","en","van","in","op","te","dat","die","voor","met","als","zijn","er","maar",
  "om","door","over","ze","bij","ook","tot","je","mij","uit","aan","naar","dan","of","wat","hoe",
  "wie","waar","waarom","niet","geen","wel","nog","al","meer","veel","weinig","zeer","heel","zo",
  "toch","dus","want","omdat","terwijl","hun","haar","hem","hij","zij","wij","jullie","u","uw",
  "deze","dit","daar","hier","worden","wordt","werd","werden","word","heeft","hebben","had",
  "hadden","heb","kan","kunnen","kon","konden","moet","moeten","moest","mag","mogen","zal","zullen",
  "zou","zouden","is","was","waren","ben","bent","geweest","doen","doet","deed","gaan","gaat","ging",
  "komt","komen","kwam","staat","staan","stond","maakt","maken","maakte","krijgt","krijgen","kreeg",
  "per","tegen","onder","tussen","zonder","binnen","buiten","sinds","vanaf","tijdens","volgens",
  "andere","anders","eigen","zelf","zelfde","alle","alles","elk","elke","iedere","iets","niets",
  "jaar","jaren","dag","dagen","week","weken","maand","maanden","tijd","keer","aantal","procent",
  "nieuw","nieuwe","oud","oude","groot","grote","klein","kleine","goed","goede","beter","beste",
  "le","la","les","un","une","des","du","au","aux","est","sont","dans","pour","sur","par",
  "avec","que","qui","ce","cette","ces","son","sa","ses","leur","leurs","plus","pas","ne","se","il",
  "elle","ils","elles","nous","vous","on","mais","ou","donc","car","apres","avant","entre","sous",
  "the","and","for","with","from","this","are","has","have","had","not","you",
  // Land en merk: staan in vrijwel elk artikel aan beide kanten.
  "frankrijk","frans","franse","fransen","france","nederland","nederlandse","nederlanders",
  "artikel","artikelen","bericht","berichten","nieuws","update","updates","informatie",
  "infofrankrijk","lees","bekijk","zie","onze","ons","jouw",
  // Telwoorden, maanden en dagen: dragen geen onderwerp, wel veel overlap.
  "twee","drie","vier","vijf","zes","zeven","acht","negen","tien","elf","twaalf",
  "honderd","duizend","miljoen","miljard","eerste","tweede","derde","laatste","volgende",
  "januari","februari","maart","april","juni","juli","augustus","september","oktober",
  "november","december","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag","zondag",
  // Werkwoorden en verbindingswoorden die in de meting als valse treffer opdoken.
  "vindt","vinden","vond","geldt","gelden","gold","blijft","blijven","bleef","stelt","stellen",
  "houdt","houden","hield","neemt","nemen","nam","geeft","geven","gaf","zegt","keert","keren",
  "zeggen","zei","meldt","melden","meldde","betreft","betekent","betekenen","volgt","volgen",
  "waarin","waarbij","waarop","waarvan","waaronder","daarbij","daarna","daarom","hierbij",
  "eens","zowel","extra","druk","gang","wereld","soort","deel","delen","geval","gevallen",
  "manier","reden","redenen","vraag","vragen","antwoord","kans","kansen","plek","plaats",
  "mensen","persoon","personen","iemand","iedereen","niemand","land","landen","stad","steden",
  "gepubliceerd","publiceren","overzicht","mogelijk","onmogelijk","rond","brengt","brengen",
  "zich","laat","laten","zien","terug","doel","doelen","vooral","bijvoorbeeld",
]);

// Woorden van minder dan vier letters dragen in deze twee corpora geen
// onderwerp (wel "dpe" en "cak", maar die kosten meer valse treffers dan ze
// opleveren; het zoekveld blijft ervoor). Getallen vallen af: jaartallen en
// bedragen matchen tussen onderwerpen die niets met elkaar te maken hebben.
export function tokens(tekst) {
  return String(tekst || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && w.length <= 30 && !STOPWOORDEN.has(w) && !/^\d+$/.test(w));
}

// Documentfrequentie over de hele index -> idf. Eén keer per index berekend,
// niet per bericht: bij 349 artikelen is dat het verschil tussen één keer
// rekenen en vijftig keer.
export function bouwIdf(artikelen) {
  const df = new Map();
  const lijst = Array.isArray(artikelen) ? artikelen : [];
  for (const a of lijst) {
    for (const w of new Set([...tokens(a.titel), ...tokens(a.samenvatting)])) {
      df.set(w, (df.get(w) || 0) + 1);
    }
  }
  const n = Math.max(1, lijst.length);
  const idf = new Map();
  for (const [w, aantal] of df) idf.set(w, Math.log(n / (1 + aantal)));
  // Een woord dat in de index niet voorkomt is per definitie het zeldzaamst.
  return { idf, n, standaard: Math.log(n) };
}

// De kop weegt zwaarder dan de lopende tekst: daar staat het onderwerp.
export const KOP_GEWICHT = 3;
export const MIN_GEDEELD = 2;
export const MIN_SCORE = 5;
export const SUGGESTIES_STANDAARD = 5;

function weeg(kop, tekst) {
  const uit = new Map();
  for (const t of tokens(kop)) uit.set(t, (uit.get(t) || 0) + KOP_GEWICHT);
  for (const t of tokens(tekst)) uit.set(t, (uit.get(t) || 0) + 1);
  return uit;
}

// De suggesties bij één bericht, beste eerst. Geeft een lege lijst terug als
// niets de drempels haalt — de aanroeper valt dan terug op de themalijst.
export function suggesties({
  bericht,
  artikelen,
  idfTabel = null,
  max = SUGGESTIES_STANDAARD,
} = {}) {
  const lijst = Array.isArray(artikelen) ? artikelen : [];
  if (!bericht || !lijst.length) return [];
  const vraag = weeg(bericht.kop, bericht.samenvatting);
  if (!vraag.size) return [];
  const tabel = idfTabel || bouwIdf(lijst);
  const uit = [];
  for (const a of lijst) {
    // Niet aan zichzelf voorstellen: de tegel "Laatste updates op Infofrankrijk"
    // bevat IF-artikelen, en die haalden zichzelf op als beste treffer.
    if (bericht.url && a.url && a.url === bericht.url) continue;
    const doc = weeg(a.titel, a.samenvatting);
    let score = 0;
    const gedeeld = [];
    for (const [w, vraagGewicht] of vraag) {
      const docGewicht = doc.get(w);
      if (!docGewicht) continue;
      const idf = tabel.idf.has(w) ? tabel.idf.get(w) : tabel.standaard;
      if (idf <= 0) continue; // komt in vrijwel elk artikel voor
      const bijdrage = idf * Math.min(vraagGewicht, KOP_GEWICHT) * Math.min(docGewicht, KOP_GEWICHT);
      score += bijdrage;
      gedeeld.push({ woord: w, bijdrage });
    }
    if (gedeeld.length < MIN_GEDEELD) continue;
    // Lengtenormalisatie: een lang artikel deelt vanzelf meer woorden met alles.
    const eind = score / Math.sqrt(Math.max(1, doc.size));
    if (eind < MIN_SCORE) continue;
    uit.push({
      ...a,
      score: Number(eind.toFixed(2)),
      // De verantwoording: hierdoor staat deze suggestie er. Zonder die woorden
      // is een rare treffer niet te beoordelen zonder in de code te kijken.
      gedeeld: gedeeld.sort((x, y) => y.bijdrage - x.bijdrage).slice(0, 4).map((g) => g.woord),
    });
  }
  return uit.sort((a, b) => b.score - a.score).slice(0, max > 0 ? max : SUGGESTIES_STANDAARD);
}
