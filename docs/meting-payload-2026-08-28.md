# Meting: de payload van de nieuwspagina in twee leveringen

Datum: 28 augustus 2026, kort na de cache-miss-ingreep van diezelfde dag (zie
`docs/meting-actueel-cachemiss-2026-08-28.md`). Betreft het splitsen van het
antwoord in een **compacte levering** (`/api/actueel`) en een **tekst-levering**
(`/api/actueel-tekst`) — zie `lib/levering.js`.

## Hoe er gemeten is

`node scripts/meet-actueel.mjs`, per route drie miss-metingen met een
cache-buster in de querystring (een URL die de CDN nog nooit zag = gegarandeerde
edge-miss), plus de hit en de payload onbewerkt én brotli. Gedraaid via de
workflow **Meting** op een GitHub-runner, omdat de ontwikkelomgeving
`nlfr-menu.vercel.app` niet mag bereiken (403 van de egress-proxy).

| | run | tijdstip |
| --- | --- | --- |
| vóór | Actions 33198392307 | 18:14:41 UTC |
| ná | Actions 33199319821 | 18:26:59 UTC |

## Vóór — één levering

| meting | tijd tot eerste byte | bytes |
| --- | --- | --- |
| miss 1 (cache-buster) | 0,440 s | 317675 |
| miss 2 (cache-buster) | 0,429 s | 317675 |
| miss 3 (cache-buster) | 0,247 s | 317675 |
| hit (zonder querystring) | 0,070 s | 317675 |
| hit, brotli | 0,075 s | **88183** |

13 tegels, 152 artikelen.

## Ná — `/api/actueel` (levering 1, compact)

| meting | tijd tot eerste byte | bytes | herkomst |
| --- | --- | --- | --- |
| miss 1 (cache-buster) | 4,188 s | 95029 | `vers-ontbrekend` |
| miss 2 (cache-buster) | 0,273 s | 95029 | `snapshot` |
| miss 3 (cache-buster) | 0,256 s | 95029 | `snapshot` |
| hit (zonder querystring) | 0,292 s | 95029 | `snapshot` |
| hit, brotli | 0,101 s | **25101** | `snapshot` |

Mediaan van de missen: 0,273 s. Miss 1 is het terugvalpad: de snapshotsleutel is
naar `v2` gegaan, dus er lag na de deploy nog niets — de route stelde het
antwoord zelf samen, splitste het en schreef beide leveringen weg.

## Ná — `/api/actueel-tekst` (levering 2)

| meting | tijd tot eerste byte | bytes | herkomst |
| --- | --- | --- | --- |
| miss 1 (cache-buster) | 0,316 s | 241393 | `snapshot` |
| miss 2 (cache-buster) | 0,425 s | 241393 | `snapshot` |
| miss 3 (cache-buster) | 0,395 s | 241393 | `snapshot` |
| hit (zonder querystring) | 0,352 s | 241393 | `snapshot` |
| hit, brotli | 0,133 s | **80180** | `snapshot` |

Deze route was meteen warm: de miss op `/api/actueel` hierboven had haar
levering al weggeschreven. Waarvan in deze levering: `tekst` 117.303 bytes en
`bronnen` 114.154 bytes onbewerkt — exact de twee getallen uit de diagnose.

## Wat een lezer binnenhaalt

| scenario | over de lijn (brotli) | onbewerkt |
| --- | --- | --- |
| **vóór de eerste weergave** | **25.101** | 95.029 |
| (a) pagina openen, niets openklappen | 105.281 | 336.422 |
| (b) pagina openen, één artikel openklappen | 105.281 | 336.422 |
| *ter vergelijking: vóór de splitsing (alles ineens)* | *88.183* | *317.675* |

### Wat dit zegt, en wat niet

**De winst zit vóór de eerste weergave: 88.183 → 25.101 bytes, een daling van
72%.** Dat is wat een lezer met een trage verbinding moet binnenhalen voordat er
iets op zijn scherm staat.

**(a) en (b) zijn gelijk, en samen 17 kB hoger dan vóór de splitsing.** Dat is
geen meetfout maar een gevolg van de opzet zoals gevraagd: de pagina haalt
levering 2 direct ná de eerste weergave op de achtergrond op, dus openklappen
kost geen extra verzoek — en wie niets openklapt, haalt hem tóch binnen. De 17 kB
extra komt doordat twee losse documenten minder goed comprimeren dan één (de
bronnenlijsten kunnen niet meer meeliften op de titels elders in hetzelfde
document), plus `bronMeta`/`bronAantal` in levering 1.

Wie (a) écht wil verlagen, moet levering 2 pas ophalen bij de eerste
openklap-actie in plaats van meteen erna. Dan wordt (a) 25 kB en (b) 105 kB, ten
koste van een korte laadstaat bij die eerste openklap. Dat is één regel in
`actueel.html` (`haalTeksten()` verplaatsen van na `render()` naar de
klikafhandeling) en bewust **niet** gedaan: de opdracht schreef de
achtergrond-ophaling expliciet voor.

## Inhoud onveranderd

Sonde op productie ná de deploy (Actions 33199455802):

```
Tegels: 13, artikelen: 152
Tekst-levering: 152 artikel(en), bronStatus: 16 bron(nen)
  pers-bosbranden 1    overheid-geld-belasting 8    infofrankrijk 5
  pers-verkeer 3       overheid-praktisch 8         verenigingen 7
  pers-landelijk 4     overheid-douane 6            archief 86
  pers-regionaal 6     overheid-economie 2
                       overheid-wetgeving 8
                       overheid-natuur-milieu 8
VERDICT: groen — alle invarianten gehaald.
```

13 tegels, 152 artikelen, 152 tekst-records, 16 bronnen in `bronStatus` — alle
vier gelijk aan de eis. Per stroom: pers 14 + archief 86 = 100, overheid 40,
verenigingen 7, infofrankrijk 5.

Een overheidsartikel uit de samengevoegde vorm (Actions 33199568639, met
`SONDE_TOON_LINKS=1`):

```
[overheid-praktisch] Onroerendezaakbelasting: vrijstelling of korting mogelijk
    artikel-URL: https://www.service-public.gouv.fr/particuliers/actualites/A19047?xtor=RSS-111
    bron:        https://www.service-public.gouv.fr/particuliers/actualites/A19047?xtor=RSS-111
```

De bronregel en de bronlink staan er dus nog, en wijzen naar de geconfigureerde
host van Service-Public — I3 toetst dat, I11 toetst dat `bronMeta` en
`bronAantal` kloppen met die lijst.

## De bewaking

`scripts/sonde.mjs` haalt beide leveringen op en voegt ze per
`tegelId/artikelId` samen, zodat I3, I4, I5 en I9 op dezelfde artikelvorm blijven
toetsen als vóór de splitsing. Beproefd tegen een lokaal nagemaakte productie:

| storing | verdict |
| --- | --- |
| tweede levering geeft HTTP 500 | **rood** — `I10 tekstlevering: HTTP 500` + `I4 bron-aanwezig` |
| tweede levering geeft 0 records | **rood** — `I10 geen tekst-record voor overheid-douane/a1` + `I4` |
| beide leveringen goed | groen |

Nieuw zijn **I10** (de leveringen dekken elkaar exact en dragen hetzelfde
bakmoment) en **I11** (`bronAantal` en `bronMeta` kloppen met de volledige
bronnenlijst).

## Testsuite

| | tests | groen |
| --- | --- | --- |
| vóór | 175 | 175 |
| ná | 195 | 195 |

## Niet vastgesteld

- **Een byte-voor-byte vergelijking van de artikeltekst met de payload van vóór
  de deploy.** Die payload is niet gearchiveerd voordat de nieuwe versie live
  ging, en het oude antwoord is nu niet meer op te halen. Wat er wél voor staat:
  `test/levering.test.mjs` toetst dat de twee leveringen samen weer *exact* het
  volledige antwoord vormen (`assert.deepEqual` op het hele object), de sonde
  telt 152 artikelen tegen 152 tekst-records, en `bouwAntwoord()` — dat de tekst
  produceert — is niet aangeraakt.
- **Of de bronlink hierboven HTTP 200 geeft.** De egress-policy van de
  werkomgeving laat alleen een handvol hosts door; `service-public.gouv.fr` is
  daar niet bij. De sonde toetst wel dat de host bij de geconfigureerde bron
  hoort (I3).
