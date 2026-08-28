# Meting: de cache-miss van /api/actueel

Datum: 28 augustus 2026. Betreft de ingreep die de cache-miss van `/api/actueel`
moest wegnemen (voorgebakken antwoord in KV, MGET-batching, ruimer cachevenster).

## Wat er gemeten moest worden

Drie curl-runs met een cache-buster vóór en drie ná de deploy, de hit-tijd zonder
querystring, en de payloadgrootte brotli en onbewerkt:

```
curl -s -o /dev/null -w "%{time_starttransfer}s %{size_download}b\n" \
  "https://nlfr-menu.vercel.app/api/actueel?meting=$RANDOM"
```

`scripts/meet-actueel.mjs` doet precies dit, drie keer, plus de hit en beide
payloadgroottes, en drukt het af als markdown-tabel:

```
node scripts/meet-actueel.mjs                 # productie
MEET_URL=https://voorbeeld.vercel.app node scripts/meet-actueel.mjs
```

## Uitgangswaarden (uit de diagnose die aan deze ingreep voorafging)

| meting | waarde | herkomst |
| --- | --- | --- |
| cache-miss | 12,0–12,5 s | twee runs op productie, vóór deze ingreep |
| cache-hit | 0,06 s | zelfde gelegenheid |

## NIET GEMETEN — en waarom

**De voor- en nametingen op productie zijn in deze taak niet uitgevoerd.** De
omgeving waarin het werk is gedaan heeft geen uitgaande verbinding naar
`nlfr-menu.vercel.app`: de egress-proxy beantwoordt de CONNECT met **HTTP 403
(policy denial)**, voor élke run, ook vóór de codewijziging. Er zijn dus geen
voormetingen van deze sessie en geen nametingen. Wat hierboven onder
"uitgangswaarden" staat, komt uit de diagnose die bij de opdracht zat, niet uit
een meting van deze sessie.

Om dezelfde reden ontbreken:

- de payloadgrootte brotli en onbewerkt (beide vereisen een echt antwoord van
  productie);
- de hit-tijd zonder querystring;
- `node scripts/sonde.mjs` tegen productie (de sonde haalt de live uitvoer op en
  komt niet verder dan diezelfde 403);
- de telling van 13 tegels en 152 artikelen op de live uitvoer.

Dat is geen inschatting die nog verfijnd kan worden: het is een harde blokkade in
de netwerkpolicy van de werkomgeving. Zodra de deploy draait, levert
`node scripts/meet-actueel.mjs` op een machine mét netwerktoegang de volledige
tabel in één run; `node scripts/sonde.mjs` doet hetzelfde voor het verdict.

## WEL GEMETEN

### KV-round-trips per samenstelling (`listJSON`)

De tweede oorzaak uit de diagnose: een SCAN gevolgd door één losse GET per
sleutel. Gemeten door de oude en de nieuwe `lib/store.js` naast elkaar op een
gemockte Upstash te draaien, met een voorraad ter grootte van de productie-
voorraad (5 publicaties + 140 overheidsdocumenten = 145 documenten):

| implementatie | documenten | round-trips | commando's |
| --- | --- | --- | --- |
| oud (GET per sleutel) | 145 | **147** | 2× SCAN, 145× GET |
| nieuw (MGET, batch 100) | 145 | **5** | 2× SCAN, 3× MGET |

Dat is een factor 29 minder round-trips voor exact dezelfde 145 documenten. De
cron profiteert mee: die roept `listJSON` ook aan voor de concepten en het
register.

### Feed-ophalen bij een cache-miss

Vastgelegd in `test/actueel-route.test.mjs`, op een gemockte wereld: bij een
geldige snapshot raakt de route **nul** feeds aan (alleen één KV-GET); zonder
snapshot haalt hij ze wel op, precies zoals vroeger, en schrijft het resultaat
weg. De 16 live feeds — de eerste en grootste oorzaak van de 12 s — zitten dus
alleen nog in het terugvalpad.

### Testsuite

| | tests | groen |
| --- | --- | --- |
| vóór de ingreep | 160 | 160 |
| ná de ingreep | 175 | 175 |

## Wat de ingreep aan de cachekant verandert

| | vóór | ná |
| --- | --- | --- |
| `s-maxage` (CDN) | 300 s | 900 s (= croninterval) |
| `stale-while-revalidate` | 300 s | 86400 s |
| `max-age` (browser) | 60 s, maar de pagina vroeg `cache: "no-store"` | 120 s, en de pagina respecteert het |

Het oude venster was samen 10 minuten. Daarna was er niets meer om stale uit te
serveren en betaalde de eerstvolgende bezoeker de volle samenstellingstijd. Met
een SWR-venster van 24 uur krijgt een bezoeker altijd direct de laatst bekende
versie, terwijl de verse op de achtergrond gemaakt wordt.
