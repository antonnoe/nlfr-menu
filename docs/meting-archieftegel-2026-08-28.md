# Meting: de archieftegel apart laden

Datum: 28 augustus 2026, na de splitsing in twee leveringen van diezelfde dag
(zie `docs/meting-payload-2026-08-28.md`). Betreft het losmaken van de
archieftegel in een **derde** levering, `/api/actueel-archief`.

## Hoe er gemeten is

`node scripts/meet-actueel.mjs`, per route drie miss-metingen met een
cache-buster in de querystring, plus de hit en de payload onbewerkt én brotli.
Gedraaid via de workflow **Meting** op een GitHub-runner, omdat de
ontwikkelomgeving `nlfr-menu.vercel.app` niet mag bereiken (403 van de
egress-proxy).

| | run | tijdstip |
| --- | --- | --- |
| vóór | Actions 33201939373 | 19:01:02 UTC |
| ná | Actions 33203184771 | 19:17:22 UTC |

## Vóór — twee leveringen

| route | tijd tot eerste byte (mediaan) | onbewerkt | brotli |
| --- | --- | --- | --- |
| `/api/actueel` | 0,273 s | 95.029 | **25.102** |
| `/api/actueel-tekst` | 0,298 s | 241.393 | **80.179** |

## Ná — drie leveringen

| route | tijd tot eerste byte (mediaan) | onbewerkt | brotli |
| --- | --- | --- | --- |
| `/api/actueel` (levering 1) | 0,258 s | 39.064 | **10.801** |
| `/api/actueel-tekst` (levering 2) | 0,283 s | 65.623 | **23.384** |
| `/api/actueel-archief` (levering 3) | 0,308 s | 206.387 | **58.936** |

Alle drie kwamen uit de snapshot, met hetzelfde bakmoment
(`2026-08-28T19:16:37.773Z`) — de cron bakt ze in één ronde voor.

## Wat een lezer binnenhaalt

| scenario | brotli, vóór | brotli, ná | onbewerkt, ná |
| --- | --- | --- | --- |
| vóór de eerste weergave | 25.102 | **10.801** | 39.064 |
| **(a) pagina openen, niets aanraken** | 105.281 | **34.185** | 104.687 |
| **(b) één artikel buiten het archief openklappen** | 105.281 | **34.185** | 104.687 |
| **(c) de archieftegel openen** | 105.281 | **93.121** | 311.074 |

**Scenario (a) — het geval dat verreweg het vaakst voorkomt — ging van 105.281
naar 34.185 bytes: een daling van 68%.** De verwachting in de opdracht was
"ongeveer 33 kB"; het is 34,2 kB geworden. De bytes vóór de eerste weergave
zakten van 25,1 naar 10,8 kB.

(a) en (b) zijn nog steeds gelijk: levering 2 wordt na de eerste weergave op de
achtergrond opgehaald, dus een artikel openklappen kost geen extra verzoek.
Levering 3 komt er alléén bij in geval (c) — die wordt bewust *niet*
voorgeladen, want dat is precies het verbruik dat deze ingreep weghaalt.

Alleen wie het archief opent, haalt met 93,1 kB minder binnen dan de 105,3 kB
van vóór deze ingreep, en dan nog in twee stappen in plaats van één.

## Verdeling van de bytes (onbewerkt)

| | levering 2 (buiten archief) | levering 3 (archief) |
| --- | --- | --- |
| `tekst` | 34.791 | 74.008 |
| `bronnen` | 26.054 | 77.527 |

## Inhoud

Sonde op productie ná de deploy (Actions 33203301129):

```
Tegels: 13, artikelen: 143
Tekst-levering: 66 record(s), archieflevering: 77 artikel(en), bronStatus: 16 bron(nen)
  pers-bosbranden 1    overheid-geld-belasting 8    infofrankrijk 5
  pers-verkeer 3       overheid-praktisch 8         verenigingen 7
  pers-landelijk 4     overheid-douane 6            archief 77 (aparte levering)
  pers-regionaal 6     overheid-economie 2
                       overheid-wetgeving 8
                       overheid-natuur-milieu 8
VERDICT: groen — alle invarianten gehaald.
```

### De telling is 143, niet 152 — en dat komt niet door deze wijziging

De opdracht verwachtte 152 artikelen met 86 in het archief. Gemeten is 143 met
77 in het archief. Uitgezocht, want een afwijking in de telling is een fout tot
het tegendeel blijkt:

| tijdstip | buiten archief | archief | totaal | |
| --- | --- | --- | --- | --- |
| 18:28 | 66 | 86 | 152 | vóór deze wijziging |
| 19:00 | 66 | 83 | 149 | **nog steeds vóór deze wijziging** |
| 19:18 | 66 | 77 | 143 | ná deze wijziging |

De daling was dus al aan de gang vóór de deploy. Verder:

- **Elke tegel buiten het archief is exact gelijk gebleven**, tot op het artikel
  na: pers 1+3+4+6 = 14, overheid 8+8+6+2+8+8 = 40, infofrankrijk 5,
  verenigingen 7. Samen 66, zowel om 18:28 als om 19:18.
- De archieftegel wordt gevuld in `lib/tegels.js`, waar een publicatie afvalt
  zodra `leeftijd >= PUBLICATIE_TTL_S` (14 dagen). Die code is in deze wijziging
  **niet aangeraakt**; de splitsing verplaatst alleen al opgebouwde artikelen
  tussen leveringen.
- De splitsing is aantoonbaar verliesvrij: `test/levering.test.mjs` vouwt de drie
  leveringen weer samen en eist `deepEqual` met het volledige antwoord.
- Op productie dekken de leveringen elkaar exact: 66 + 77 artikelen tegenover
  66 + 77 tekst-records, en I10/I12 zijn groen.

Conclusie: 9 perssyntheses zijn tussen 18:28 en 19:18 hun bewaartermijn van 14
dagen gepasseerd — publicaties die veertien dagen eerder in één zitting zijn
goedgekeurd, verlopen ook weer als groep. Wat **niet** vast te stellen was: de
publicatiedatums van die negen, want daarvoor is toegang tot de KV-voorraad
nodig en die heeft deze omgeving niet.

## Bewaking

De sonde haalt alle drie de leveringen op en voegt ze samen op
`tegelId/artikelId`, zodat de 77 archiefartikelen binnen I3, I4, I5 en I9
blijven vallen. Beproefd tegen een lokaal nagemaakte productie met drie
leveringen:

| storing in de archieflevering | verdict |
| --- | --- |
| HTTP 500 | **rood** — `I10 ... HTTP 500` + `I12 tegel archief verwijst naar een aparte levering, maar die is niet opgehaald` |
| 0 artikelen | **rood** — `I12 kop belooft 2 artikelen, levering bevat er 0` |
| de helft van de artikelen | **rood** — `I12 kop belooft 2, levering bevat er 1` + `I10 wees` |
| alles goed | groen |

**I10 is bijgesteld.** Elke levering heeft een eigen URL en dus een eigen
edge-cache-entry; die kunnen binnen één cronronde uit elkaar lopen zonder dat er
iets stuk is. Dat gebeurde ook echt: in de meting van 19:01 stond het bakmoment
van de compacte levering op 19:00:56 en dat van de tekst-levering op 18:31:52.
Een verschil in bakmoment is daarom pas een bevinding boven de croninterval, en
een wees (tekst-record zonder artikel) telt alleen bij gelijke bakmomenten. Een
**ontbrekend** record telt altijd — dat is de kant die de lezer merkt, want dan
gaat een artikel niet open. Zonder die bijstelling zou de sonde regelmatig rood
worden op gewoon CDN-gedrag, en daarmee waardeloos.

## Schoolvakanties

De zin op productie ná de reparatie (zelfde meetrun, Actions 33203448969):

> Inmiddels zijn de zomervakanties in heel Frankrijk begonnen. De scholen
> beginnen weer op 1 september; in Saint Pierre et Miquelon pas op 2 september,
> in Corse pas op 3 september.

Vóór de reparatie stond er 31 augustus, 1 september en 2 september — allemaal
een dag te vroeg. Zie `README.md` → "Schoolvakanties: tijdzone en vakantienaam".

## Testsuite

| | tests | groen |
| --- | --- | --- |
| vóór | 195 | 195 |
| ná (archieftegel) | 209 | 209 |
| ná (schoolvakanties) | 218 | 218 |

## Niet vastgesteld

- **Of de archieftegel na het openen dezelfde artikelen toont als vóór de
  wijziging**, artikel voor artikel. De inhoud is inmiddels veranderd (9
  publicaties zijn verlopen, zie hierboven), dus een directe vergelijking met de
  situatie van 18:28 kan niet meer. Wat er wél voor staat: de round-triptest, de
  exacte dekking op productie (77 artikelen / 77 tekst-records) en een groene
  I11 (`bronAantal` en `bronMeta` kloppen met de bronnenlijst).
- **De publicatiedatums van de negen verlopen archiefartikelen** — daarvoor is
  toegang tot de KV-voorraad nodig.
- **Of de bronlinks HTTP 200 geven.** De egress-policy van de werkomgeving laat
  die hosts niet door; de sonde toetst wel dat de host bij de geconfigureerde
  bron hoort (I3).
