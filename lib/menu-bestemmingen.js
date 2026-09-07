// Waar het menu naartoe wijst — uit index.html zelf gelezen.
// ---------------------------------------------------------------------------
// Het menu is op desktop de enige navigatie van nederlanders.fr. Sinds de vier
// laden zijn vervangen door links naar categoriepagina's, wijst het naar
// pagina's die BUITEN deze repository staan. Hernoemt of verwijdert iemand daar
// een pagina, dan krijgt elke bezoeker een 404 en merkt niemand het: de sonde
// toetste /api/actueel en niet het menu.
//
// Dit bestand levert de lijst die de sonde daarvoor nodig heeft. Het LEEST die
// uit index.html en houdt geen eigen kopie bij: een tweede lijst gaat vroeg of
// laat afwijken van de eerste, en dan bewaakt de sonde adressen die niemand
// meer gebruikt terwijl de echte onbewaakt blijven.
//
// De datablokken worden uitgevoerd, niet met een regex uitgekamd. Een regex op
// href of op "/page/" vindt ook adressen uit commentaar en mist een adres dat
// via een variabele wordt samengesteld.

// Het blok met alle menudata: van de padhulp U() tot de deurvolgorde. Daar
// zitten DEUREN_LINK (de vier categoriepagina's) en SNELRIJ (de vier links in
// de smalle regel onder de balk) in.
const VAN = "  var U = function(p)";
const TOT = "  var DEUR_VOLGORDE =";

export function bestemmingenUit(html) {
  const a = html.indexOf(VAN);
  const b = html.indexOf(TOT);
  if (a < 0 || b <= a) {
    throw new Error(
      `het datablok van het menu is niet gevonden in index.html (${VAN} … ${TOT}); ` +
      "als de opbouw is gewijzigd, moet lib/menu-bestemmingen.js mee"
    );
  }
  const bron = html.slice(a, b);
  // eslint-disable-next-line no-new-func
  const lees = new Function("NL", `${bron}\nreturn { DEUREN_LINK, SNELRIJ };`);
  const { DEUREN_LINK, SNELRIJ } = lees("https://www.nederlanders.fr");

  const uit = [];
  const gezien = new Set();
  const voegToe = (naam, url) => {
    if (!url || gezien.has(url)) return;
    gezien.add(url);
    uit.push({ naam, url });
  };
  for (const [sleutel, deur] of Object.entries(DEUREN_LINK)) {
    voegToe(`ingang ${sleutel} (${deur.naam})`, deur.url);
  }
  for (const [naam, url] of SNELRIJ) {
    voegToe(`subbalk ${naam.replace(/­/g, "")}`, url);
  }
  if (!uit.length) throw new Error("geen bestemmingen gevonden in index.html");
  return uit;
}

// Wat een statuscode betekent voor de bewaking.
//
// ALLEEN 404 EN 410 ZIJN ROOD. Dat is het geval waar deze invariant voor is:
// de pagina is weg of hernoemd, en het menu wijst in het niets. Een 403, een
// 500 of een timeout zegt iets over de uptime van een andere site op dat
// moment; daar dagelijks rood op gaan maakt de sonde waardeloos en leert
// iedereen hem te negeren. Die gevallen worden wel gemeld, maar als notitie.
export function oordeelOverStatus(status) {
  if (status === 404 || status === 410) {
    return { rood: true, reden: `HTTP ${status} — de pagina bestaat niet (meer)` };
  }
  if (status >= 200 && status < 400) return { rood: false, reden: null };
  return { rood: false, notitie: `HTTP ${status} — niet bereikbaar op dit moment` };
}
