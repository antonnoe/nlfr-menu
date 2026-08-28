// Het antwoord in DRIE leveringen splitsen.
// ---------------------------------------------------------------------------
// WAAROM. Het volledige antwoord was 317.675 bytes (88 kB over de lijn) voor
// 152 artikelen. Daarvan was het veld `tekst` samen 117.303 bytes en waren de
// `bronnen`-arrays 114.154 bytes — samen ruim 70% — terwijl de lezer die pas
// ziet zodra hij een artikel OPENKLAPT. En van die 152 artikelen zitten er 86
// in de tegel "archief", die standaard DICHT staat: goed voor 174.180 van de
// 241.393 bytes van de tekst-levering. Een lezer die het archief niet aanraakt
// betaalde daar dus voor.
//
// Vandaar drie leveringen:
//   COMPACT  (/api/actueel)         alle tegels met hun artikelen, maar zonder
//                                   `tekst` en zonder de `bronnen`-array; in
//                                   plaats daarvan twee expliciete velden (zie
//                                   hieronder). De ARCHIEFTEGEL zit er wel in —
//                                   met kop, accent en het juiste aantal — maar
//                                   zonder zijn artikelenlijst.
//   TEKST    (/api/actueel-tekst)   per NIET-archiefartikel de `tekst` en de
//                                   volledige `bronnen`-array, in één levering.
//   ARCHIEF  (/api/actueel-archief) de compacte artikelen van de archieftegel
//                                   PLUS hun tekst en bronnen, in één levering.
//                                   De pagina haalt die pas op als de lezer de
//                                   archieftegel opent.
//
// DE TWEE VELDEN OP EEN ARTIKEL, en waarom precies deze twee. De dichte staat
// in actueel.html gebruikt van de bronnen exact twee dingen:
//   `bronMeta`   { naam, datum } van de EERSTE bron. Dat is de onderregel onder
//                een overheids-, Infofrankrijk- of verenigingsartikel
//                ("Service-Public · 27 augustus"). Een perssynthese toont daar
//                de NLFR-byline en gebruikt dit veld niet.
//   `bronAantal` het aantal bronnen. Dat is het getal op de knop
//                "Bronnen (n)", die zichtbaar is zodra het artikel openklapt.
//
// DE TWEE VELDEN OP EEN TEGEL:
//   `artikelAantal`   hoeveel artikelen de tegel heeft. Staat op ELKE tegel,
//                     ook als de artikelenlijst wél is meegestuurd, zodat de
//                     kop ("86 artikelen") één bron van waarheid heeft.
//   `artikelenApart`  true op de archieftegel: de artikelen komen uit een
//                     aparte levering. De pagina weet daaraan dat ze nog
//                     opgehaald moeten worden.
//
// DE SLEUTEL waarop de leveringen aan elkaar geknoopt worden is
// `tegelId/artikelId`, niet het kale artikel-id: hetzelfde artikel-id kan in
// twee tegels voorkomen (een perssynthese die van de live-tegel naar het
// archief verhuist). Dat is dezelfde sleutel die de sonde al gebruikt voor zijn
// identiteitstoets (I8), en waarmee scripts/sonde.mjs de drie leveringen weer
// samenvoegt.

// De sleutel waaronder een artikel in de tekst- of archieflevering staat.
export function artikelSleutel(tegelId, artikelId) {
  return `${tegelId}/${artikelId}`;
}

// Is dit de archieftegel? Zelfde toets als in scripts/sonde.mjs (I5) — op id én
// soort, zodat een hernoeming van één van de twee de splitsing niet stilletjes
// uitschakelt.
export function isArchiefTegel(tegel) {
  return Boolean(tegel) && (tegel.soort === "archief" || tegel.id === "archief");
}

// Eén artikel zonder tekst en zonder bronnen-array, mét de twee velden die de
// dichte staat nodig heeft.
function compactArtikel(artikel) {
  const { tekst, bronnen, verwijzingen, ...rest } = artikel;
  const lijst = Array.isArray(bronnen) ? bronnen : [];
  const eerste = lijst[0] || null;
  return {
    ...rest,
    bronMeta: eerste ? { naam: eerste.naam || null, datum: eerste.datum || null } : null,
    bronAantal: lijst.length,
  };
}

// Het tekst-record van één artikel. `verwijzingen` (het blok "Meer hierover op
// Infofrankrijk") hoort hier en niet in de compacte levering: het staat ONDER
// de bronnen en is dus pas zichtbaar als de lezer het artikel openklapt. Het
// veld staat er alleen als er ook echt een verwijzing is — een leeg array in
// 143 records zou de levering laten groeien zonder dat er iets te zien is.
function tekstRecord(artikel) {
  const record = {
    tekst: typeof artikel.tekst === "string" ? artikel.tekst : "",
    bronnen: Array.isArray(artikel.bronnen) ? artikel.bronnen : [],
  };
  if (Array.isArray(artikel.verwijzingen) && artikel.verwijzingen.length) {
    record.verwijzingen = artikel.verwijzingen;
  }
  return record;
}

// Splitst het volledige antwoord in de drie leveringen. Geen mutatie van de
// invoer: alle leveringen zijn nieuwe objecten.
export function splitsAntwoord(vol) {
  const tegels = [];
  const artikelen = {};
  const archiefArtikelen = [];
  const archiefTeksten = {};
  let archiefTegelId = null;

  for (const tegel of vol.tegels || []) {
    if (!Array.isArray(tegel.artikelen)) {
      tegels.push({ ...tegel });
      continue;
    }
    const isArchief = isArchiefTegel(tegel);
    const compacteArtikelen = [];
    for (const artikel of tegel.artikelen) {
      const compact = compactArtikel(artikel);
      const sleutel = artikelSleutel(tegel.id, artikel.id);
      if (isArchief) {
        archiefArtikelen.push(compact);
        archiefTeksten[sleutel] = tekstRecord(artikel);
      } else {
        compacteArtikelen.push(compact);
        artikelen[sleutel] = tekstRecord(artikel);
      }
    }
    if (isArchief) {
      archiefTegelId = tegel.id;
      // De tegel blijft staan — kop, accent, thema, telling — maar zonder zijn
      // artikelenlijst. `artikelAantal` houdt de kop kloppend zonder dat de 86
      // records meegaan.
      const { artikelen: _weg, ...rest } = tegel;
      tegels.push({ ...rest, artikelAantal: tegel.artikelen.length, artikelenApart: true });
    } else {
      tegels.push({ ...tegel, artikelen: compacteArtikelen, artikelAantal: compacteArtikelen.length });
    }
  }

  const stempel = { bijgewerkt: vol.bijgewerkt, gebakkenOp: vol.gebakkenOp };
  return {
    compact: { ...vol, tegels },
    // Hetzelfde bakmoment in alle drie: zo is te zien of ze uit dezelfde ronde
    // komen (de sonde toetst dat, zie I10).
    tekst: { ...stempel, artikelen },
    archief: {
      ...stempel,
      tegelId: archiefTegelId,
      artikelen: archiefArtikelen,
      teksten: archiefTeksten,
    },
  };
}
