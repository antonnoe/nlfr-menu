// Het antwoord in TWEE leveringen splitsen.
// ---------------------------------------------------------------------------
// WAAROM. Het volledige antwoord was 317.675 bytes (88 kB over de lijn) voor
// 152 artikelen. Daarvan was het veld `tekst` samen 117.303 bytes en waren de
// `bronnen`-arrays 114.154 bytes — samen ruim 70% — terwijl de lezer die pas
// ziet zodra hij een artikel OPENKLAPT. In de dichte staat toont de pagina per
// artikel alleen titel, summary en de onderregel.
//
// Vandaar de splitsing:
//   COMPACT (/api/actueel)       alles zoals voorheen, maar zonder `tekst` en
//                                zonder de `bronnen`-array. In plaats daarvan
//                                twee expliciete velden (zie hieronder).
//   TEKST   (/api/actueel-tekst) per artikel de `tekst` en de volledige
//                                `bronnen`-array, in één levering — geen route
//                                per artikel.
//
// DE TWEE NIEUWE VELDEN, en waarom precies deze twee. De dichte staat in
// actueel.html gebruikt van de bronnen exact twee dingen:
//   `bronMeta`   { naam, datum } van de EERSTE bron. Dat is de onderregel onder
//                een overheids-, Infofrankrijk- of verenigingsartikel
//                ("Service-Public · 27 augustus"). Een perssynthese toont daar
//                de NLFR-byline en gebruikt dit veld niet.
//   `bronAantal` het aantal bronnen. Dat is het getal op de knop
//                "Bronnen (n)", die zichtbaar is zodra het artikel openklapt.
// Beide zijn een paar bytes per artikel; de volledige arrays waren dat niet.
//
// DE SLEUTEL waarop de twee leveringen aan elkaar geknoopt worden is
// `tegelId/artikelId`, niet het kale artikel-id: hetzelfde artikel-id kan in
// twee tegels voorkomen (een perssynthese die van de live-tegel naar het
// archief verhuist). Dat is dezelfde sleutel die de sonde al gebruikt voor zijn
// identiteitstoets (I8), en die scripts/sonde.mjs gebruikt om de twee
// leveringen weer samen te voegen.

// De sleutel waaronder een artikel in de tekst-levering staat.
export function artikelSleutel(tegelId, artikelId) {
  return `${tegelId}/${artikelId}`;
}

// Eén artikel zonder tekst en zonder bronnen-array, mét de twee velden die de
// dichte staat nodig heeft.
function compactArtikel(artikel) {
  const { tekst, bronnen, ...rest } = artikel;
  const lijst = Array.isArray(bronnen) ? bronnen : [];
  const eerste = lijst[0] || null;
  return {
    ...rest,
    bronMeta: eerste ? { naam: eerste.naam || null, datum: eerste.datum || null } : null,
    bronAantal: lijst.length,
  };
}

// Splitst het volledige antwoord in de twee leveringen. Geen mutatie van de
// invoer: beide leveringen zijn nieuwe objecten.
export function splitsAntwoord(vol) {
  const tegels = [];
  const artikelen = {};
  for (const tegel of vol.tegels || []) {
    if (!Array.isArray(tegel.artikelen)) {
      tegels.push({ ...tegel });
      continue;
    }
    const compacteArtikelen = [];
    for (const artikel of tegel.artikelen) {
      compacteArtikelen.push(compactArtikel(artikel));
      artikelen[artikelSleutel(tegel.id, artikel.id)] = {
        tekst: typeof artikel.tekst === "string" ? artikel.tekst : "",
        bronnen: Array.isArray(artikel.bronnen) ? artikel.bronnen : [],
      };
    }
    tegels.push({ ...tegel, artikelen: compacteArtikelen });
  }
  return {
    compact: { ...vol, tegels },
    tekst: {
      // Hetzelfde bakmoment als de compacte levering: zo is te zien of de twee
      // uit dezelfde ronde komen.
      bijgewerkt: vol.bijgewerkt,
      gebakkenOp: vol.gebakkenOp,
      artikelen,
    },
  };
}
