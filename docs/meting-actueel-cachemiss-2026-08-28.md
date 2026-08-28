# Meting: de cache-miss van /api/actueel

Datum: 28 augustus 2026. Betreft de ingreep die de cache-miss van `/api/actueel`
wegneemt: voorgebakken antwoord in KV, MGET-batching in `listJSON()`, en een
ruimer cachevenster.

## Hoe er gemeten is

Met een cache-buster in de querystring, want een URL die de CDN nog nooit heeft
gezien is gegarandeerd een edge-miss:

```
curl -s -o /dev/null -w "%{time_starttransfer}s %{size_download}b\n" \
  "https://nlfr-menu.vercel.app/api/actueel?meting=$RANDOM"
```

`scripts/meet-actueel.mjs` doet precies dit — drie miss-metingen, de hit zonder
querystring, en de payload onbewerkt én brotli — en drukt het af als
markdown-tabel. De workflow **Meting** (`.github/workflows/meting.yml`,
handmatig te starten) draait dat script vanaf een GitHub-runner.

> **Waar de metingen vandaan komen.** De ontwikkelomgeving waarin deze ingreep is
> gebouwd, heeft géén uitgaande verbinding naar `nlfr-menu.vercel.app`: de
> egress-proxy beantwoordt elke CONNECT met **HTTP 403 (policy denial)**. Daarom
> is er de workflow Meting: die draait op een runner die er wél bij kan. **Alle
> na-metingen hieronder komen uit die runs** (Actions-runs 33191963604 en
> 33192280977).

## Vóór

| meting | waarde |
| --- | --- |
| cache-miss | **12,0 – 12,5 s** (twee runs) |
| cache-hit | **0,06 s** |

**Niet gemeten in deze taak.** Deze twee getallen komen uit de diagnose die aan
de opdracht voorafging, niet uit een eigen meting: de 403 hierboven gold ook
vóór de codewijziging, dus een voormeting was in deze omgeving nooit mogelijk.
Om dezelfde reden ontbreekt de payloadgrootte van vóór de ingreep — die is
**niet gemeten**.

## Ná — run 1, 16:51:56 UTC (koude snapshot, direct na de deploy)

| meting | tijd tot eerste byte | bytes | herkomst | edge |
| --- | --- | --- | --- | --- |
| miss 1 (cache-buster) | **3,540 s** | 317675 | `vers-ontbrekend` | MISS |
| miss 2 (cache-buster) | **0,461 s** | 317675 | `snapshot` | MISS |
| miss 3 (cache-buster) | **0,451 s** | 317675 | `snapshot` | MISS |
| hit (zonder querystring) | 0,372 s | 317675 | `snapshot` | MISS |
| hit, brotli | 0,189 s | 88181 | `snapshot` | HIT |

Miss 1 is het terugvalpad in actie: er stond nog geen snapshot in KV, dus de
route haalde de 16 feeds live op, stelde het antwoord samen en schreef het weg.
**3,54 s** — dat is het oude pad, maar dan zonder de 145 losse KV-reads. Miss 2
en 3 lezen de snapshot die miss 1 net heeft achtergelaten.

## Ná — run 2, 16:56:02 UTC (warme snapshot)

| meting | tijd tot eerste byte | bytes | herkomst | edge |
| --- | --- | --- | --- | --- |
| miss 1 (cache-buster) | **0,676 s** | 317675 | `snapshot` | MISS |
| miss 2 (cache-buster) | **0,421 s** | 317675 | `snapshot` | MISS |
| miss 3 (cache-buster) | **0,329 s** | 317675 | `snapshot` | MISS |
| hit (zonder querystring) | 0,322 s | 317675 | `snapshot` | MISS |
| hit, brotli | **0,072 s** | 88181 | `snapshot` | HIT |

Mediaan van de missen: **0,421 s**.
Bakmoment van het geserveerde antwoord: `2026-08-28T16:51:51.662Z`.
Inhoud: **13 tegels, 152 artikelen**.

## Samengevat

| | vóór | ná |
| --- | --- | --- |
| cache-miss | 12,0 – 12,5 s | **0,33 – 0,68 s** (mediaan 0,42 s) |
| cache-miss, geen snapshot in KV (terugvalpad) | 12,0 – 12,5 s | **3,54 s** |
| cache-hit | 0,06 s | 0,072 s (brotli, edge-HIT) |
| payload onbewerkt | niet gemeten | **317.675 bytes** |
| payload brotli | niet gemeten | **88.181 bytes** |

De miss is dus ongeveer **een factor 28 sneller** geworden, en zelfs het
terugvalpad — het geval waarin er helemaal geen snapshot ligt — is meer dan
drie keer zo snel als de oude situatie.

## Inhoud onveranderd

De sonde op de live uitvoer, ná de deploy (Actions-run 33192143910):

```
Tegels: 13, artikelen: 152
  pers-bosbranden (pers): 1        overheid-geld-belasting: 8
  pers-verkeer (pers): 3           overheid-praktisch: 8
  pers-landelijk (pers): 4         overheid-douane: 6
  pers-regionaal (pers): 6         overheid-economie: 2
  infofrankrijk: 5                 overheid-wetgeving: 8
  verenigingen: 7                  overheid-natuur-milieu: 8
  archief: 86
VERDICT: groen — alle invarianten gehaald.
```

13 tegels en 152 artikelen: gelijk aan de telling van vóór de ingreep. De
stromen kloppen ook los van elkaar: pers 14 + archief 86 = 100, overheid 40,
verenigingen 7, infofrankrijk 5.

Alle vijf infofrankrijk-items wijzen naar een artikel op `infofrankrijk.com`,
niet naar een asset-host (run 33192078131, met `SONDE_TOON_LINKS=1`), o.a.:

```
[infofrankrijk] Woordenlijst moestuin
    artikel-URL: https://infofrankrijk.com/woordenlijst-moestuin/
    bron:        https://infofrankrijk.com/woordenlijst-moestuin/
```

## KV-round-trips per samenstelling (`listJSON`)

De tweede oorzaak uit de diagnose: een SCAN gevolgd door één losse GET per
sleutel. Gemeten door de oude en de nieuwe `lib/store.js` naast elkaar op een
gemockte Upstash te draaien, met een voorraad ter grootte van de productie-
voorraad (5 publicaties + 140 overheidsdocumenten = 145 documenten):

| implementatie | documenten | round-trips | commando's |
| --- | --- | --- | --- |
| oud (GET per sleutel) | 145 | **147** | 2× SCAN, 145× GET |
| nieuw (MGET, batch 100) | 145 | **5** | 2× SCAN, 3× MGET |

Een factor 29 minder round-trips voor exact dezelfde 145 documenten. Dit is ook
de reden dat het terugvalpad (3,54 s) niet meer bij de oude 12 s in de buurt
komt. De cron profiteert mee: die roept `listJSON` ook aan voor de concepten en
het register.

## Testsuite

| | tests | groen |
| --- | --- | --- |
| vóór de ingreep | 160 | 160 |
| ná de ingreep | 175 | 175 |

## Cachevenster

| | vóór | ná |
| --- | --- | --- |
| `s-maxage` (CDN) | 300 s | 900 s (= croninterval) |
| `stale-while-revalidate` | 300 s | 86400 s |
| `max-age` (browser) | 60 s, maar de pagina vroeg `cache: "no-store"` | 120 s, en de pagina respecteert het |

Bevestigd op productie:
`Cache-Control: public, max-age=120, s-maxage=900, stale-while-revalidate=86400`.

Het oude venster was samen 10 minuten. Daarna was er niets meer om stale uit te
serveren en betaalde de eerstvolgende bezoeker de volle samenstellingstijd. Met
een SWR-venster van 24 uur krijgt een bezoeker altijd direct de laatst bekende
versie, terwijl de verse op de achtergrond gemaakt wordt.
