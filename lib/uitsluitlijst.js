// Wie er NIET in de verenigingentegel terechtkomt.
// ---------------------------------------------------------------------------
// DIT BESTAND IS EEN LIJST, GEEN CODE. Wil je een platform toevoegen, zet er
// dan één regel bij in de juiste lijst hieronder en klaar. Er is geen logica die
// je hoeft aan te passen, en er staat verder niets in dit bestand dat je kunt
// slopen door een naam toe te voegen.
//
// HOE EEN REGEL WERKT. Elke regel is een stuk tekst dat ergens in het bericht
// mag voorkomen: in de kop, in de samenvatting of in de link. Komt hij voor, dan
// valt het HELE bericht weg — niet alleen de naam. Dat is de bedoeling: een
// verenigingsbericht dat een concurrerend platform navertelt, is dat platform
// navertellen, ook als je de naam eruit knipt.
//
// Vergelijken gebeurt zonder te letten op hoofdletters of accenten, dus
// "GoedInFrankrijk.fr" en "goedinfrankrijk.fr" zijn hetzelfde. Een domein
// matcht ook als het in een URL staat. Een NAAM met een spatie erin (bv.
// "frankrijk actueel") matcht alleen als die spatie er in de tekst ook staat;
// zet zo nodig beide vormen erin.
//
// WEES PRECIES. "frankrijk" als losse regel zou zowat elk bericht wegvagen.
// Neem de naam zoals hij geschreven wordt, of het domein.

// Concurrerende platforms: sites die hetzelfde publiek bedienen. Eén regel per
// naam of domein; voeg hier gerust aan toe.
export const CONCURRENTEN = [
  "goedinfrankrijk.fr",
  "frankrijkactueel.nl",
];

// Sociale netwerken waar we niet naartoe verwijzen. Een verenigingsbericht dat
// de lezer naar Facebook stuurt, valt weg: daar houdt onze redactie op en begint
// andermans tijdlijn.
export const SOCIALE_NETWERKEN = [
  "facebook.com",
  "facebook",
  "fb.me",
  "fb.com",
  "messenger.com",
];

// Losse hulpfunctie zodat de rest van de code niet hoeft te weten hoe de lijsten
// heten. Geeft de gevonden term met zijn soort terug, of null.
export function zoekUitsluiting(tekst) {
  const n = String(tekst || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  for (const term of CONCURRENTEN) {
    if (n.includes(term.toLowerCase())) return { term, soort: "concurrerend platform" };
  }
  for (const term of SOCIALE_NETWERKEN) {
    if (n.includes(term.toLowerCase())) return { term, soort: "sociaal netwerk" };
  }
  return null;
}
