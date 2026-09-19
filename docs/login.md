# Inloggen op /review — Supabase Auth met magic link en passkeys

Dit document beschrijft eerst **hoe het was** (de analyse waarmee dit werk
begon), daarna **hoe het is gebouwd**, en tenslotte het **beheer**: welke
variabelen, welke Supabase-instellingen, en wat te doen bij een verloren
apparaat.

De loginlaag is opgezet als proef voor andere tools van het netwerk van
platforms. Wat hier staat is daarom bewust uitgeschreven, ook waar de code
zichzelf zou kunnen verklaren.

---

## 1. Analyse van de stand van zaken (vóór deze wijziging)

### 1.1 Framework en versie

**Er is geen framework.** Dat is de belangrijkste uitkomst van de analyse, want
de opdracht ging uit van Next.js en dat verandert de vorm van vrijwel elke stap.

`package.json` beschrijft het project als *"statische site met Vercel serverless
functions"*. Er staat geen framework in de afhankelijkheden, geen `build`-script,
geen `next.config.*`, geen `app/`- of `pages/`-map. Wat er wél is:

| Onderdeel | Vorm |
| --- | --- |
| Pagina's | Losse `.html`-bestanden in de repo-wortel (`index.html`, `review.html`, `actueel.html`, `banner-beheer.html`, `archief.html`) |
| API | Vercel serverless functions, ESM, Node 22, in `api/*.js` |
| Gedeelde code | `lib/*.js`, geïmporteerd door de functions |
| Configuratie | `vercel.json` — `cleanUrls: true`, `maxDuration: 60` voor `api/*.js`, één cron |
| Tests | `node --test test/*.test.mjs`, geen testframework |
| Buildstap | **Geen.** Vercel zet de repo neer zoals hij is |

Gevolgen die de opdracht raken:

* **Geen middleware uit Next.js.** Wel Vercel Routing Middleware: een
  `middleware.js` in de wortel, die Vercel voor élk framework draait (ook voor
  "Other"). Die weg is hier gebruikt.
* **`NEXT_PUBLIC_`-variabelen doen niets.** Dat voorvoegsel wordt door de
  Next.js-buildstap in de code gezet. Zonder buildstap is er niets dat het doet,
  en een statisch `.html`-bestand kan `process.env` niet lezen. De browser moet
  URL en publishable key dus **ophalen** — zie `api/auth-config.js` in §2.3.
  De naamgeving van de variabelen in Vercel blijft ongemoeid.
* **Geen bundelaar voor browsercode.** `@supabase/supabase-js` en
  `@supabase/ssr` zijn npm-pakketten; een statische pagina kan ze niet
  `import`en. Zie §2.4 voor de gekozen oplossing.
* **`/auth/callback` kan geen server-route zijn in de zin van een app-router.**
  Het is hier een gewone serverless function achter een rewrite.

### 1.2 Hoe /review was beveiligd

Eén gedeeld geheim, `REVIEW_TOKEN`, als env-var in Vercel. Geen gebruikers, geen
sessies, geen verloop.

**Waar het werd gecontroleerd — precies één plek op de server:**

`api/review.js`, functies `leesToken()` en `tokenGeldig()`:

* **Header** — uitsluitend `X-Review-Token`. Witruimte werd getrimd.
  Vergelijking met `crypto.timingSafeEqual()`, met een lengtecontrole ervoor.
* **Querystring** — `?token=` werd door de server **niet** meer gelezen. Die
  terugval was er wel geweest en is eerder verwijderd.
* **Cookie** — werd nooit gebruikt.

Bij een mismatch: `401 {ok:false, fout:"Ongeldig of ontbrekend token."}`, vóór
elke andere controle in de handler.

**Waar het in de browser vandaan kwam** (`review.html`):

* `?token=…` uit de adresbalk werd één keer ingelezen, opgeslagen en daarna
  meteen met `history.replaceState` uit de URL gewist (zodat het niet in de
  geschiedenis of als `Referer` naar externe links zou lekken).
* Daarna: `localStorage` onder de sleutel `nlfr_review_token`, met
  `sessionStorage` als terugval en het paginageheugen als laatste redmiddel.
* Daaromheen was een flinke diagnoselaag gegroeid — `nlfr_review_baken`,
  `nlfr_review_tokenvorm`, een vingerafdruk van het token, en een
  meldingenring op de server (`lib/opslagmelding.js`, POST-actie
  `opslagmelding`) — omdat op mobiel niet te zien was waarom een bewaard token
  verdween. Die hele laag bestond uitsluitend om tokenopslag te diagnosticeren.

### 1.3 Welke routes onder /review vallen

De reviewtool is één pagina met één API-route:

| Route | Rol |
| --- | --- |
| `/review` (`review.html`) | De pagina zelf. Statisch bestand; bevat geen redactionele gegevens |
| `/api/review` | **Alle** gegevens en **alle** handelingen. `GET` = concepten, publicaties, overheidsberichten, verwijzingen, register. `GET ?deel=if` = Infofrankrijk-kandidaten. `POST` = publiceer, weg, bewerk, depubliceer, verwijs, verwijs-weg, nakijken, nakijken-klaar |

De muur zat dus in `/api/review`, niet in de pagina. Wie `review.html` zonder
token opvroeg kreeg een lege schil. Dat blijft de opzet: de middleware stuurt nu
weg vóór die schil geladen wordt, maar de gegevens zitten nog altijd achter de
servercontrole in de route zelf.

`/actueel` wordt door de reviewtool gebruikt voor het tabblad Overheid, maar dat
is de **publieke** route (`/api/actueel`) — geen inlog, en dat blijft zo.

### 1.4 Wat bewust buiten de login blijft

| Route | Beveiliging | Waarom buiten de login |
| --- | --- | --- |
| `/api/cron` | `Authorization: Bearer <CRON_SECRET>` | Vercel Cron is geen mens en heeft geen browser. **Ongemoeid gelaten** |
| `/api/banner` (POST) | `Authorization: Bearer <BANNER_TOKEN>` | Eigen token, bewust los van de redactietool. Buiten de opdracht; kan later dezelfde loginlaag krijgen |
| `/api/banner` (GET) | publiek | Het menu leest de banner |
| `/api/actueel` | publiek | De nieuwspagina |
| `/api/actueel-tekst` | publiek | Uitklaptekst van de nieuwspagina |
| `/api/actueel-archief` | publiek | Archieftegel |
| `/api/register` | publiek | Alleen titels; de muur zit in de route zelf |
| `/api/schoolvakanties` | publiek | Open data |
| `index.html`, `actueel.html`, `archief.html` | publiek | Publieke pagina's |
| `banner-beheer.html` | eigen token in de pagina | Zie `/api/banner` |

---

## 2. Hoe het nu werkt

### 2.1 De twee deuren

| Deur | Waarvoor | Wat de gebruiker doet |
| --- | --- | --- |
| **Magic link** | Eerste keer, nieuw apparaat, apparaat kwijt | Adres invullen op `/login`, link in de mail aanklikken |
| **Passkey** | Elke dag daarna | Knop "Inloggen met dit apparaat" op `/login` |

De passkey vervangt de magic link niet; hij maakt hem zeldzaam. De mail blijft
de weg terug wanneer er geen passkey is, of geen apparaat.

### 2.2 De bestanden

| Bestand | Rol |
| --- | --- |
| `lib/auth.js` | De enige plek die bepaalt wie er binnen mag: de lijst, de omgeving, het oordeel, de cookienaam en twee kleine cookie-vertalers. Bevat geen Node-API's, zodat ook de edge-runtime hem kan gebruiken |
| `lib/auth-node.js` | Vertaalt `req`/`res` van een serverless function naar de cookie-API van `@supabase/ssr`, en levert `toegangVanVerzoek()` — de poort die `/api/review` gebruikt |
| `middleware.js` | Vercel Routing Middleware op `/review` en `/review.html`. Geen sessie → 302 naar `/login` |
| `login.html` | `/login`. De twee knoppen, de foutmeldingen, de terugkeer naar `/review` |
| `api/auth-config.js` | `GET /api/auth-config` — publiek. Levert de Supabase-URL en de publishable key aan de browser |
| `api/inloglink.js` | `POST /api/inloglink` — controleert de allowlist en stuurt daarna pas `signInWithOtp` |
| `api/auth-callback.js` | `GET /auth/callback` (rewrite in `vercel.json`) — wisselt de code in voor een sessie en stuurt door naar `/review` |
| `src/inlog.js` | Bron van de browser-client |
| `assets/inlog.js` | De gebundelde browser-client, **gegenereerd**. Opnieuw maken: `npm run bouw:inlog` |
| `api/review.js` | Controleert de sessie zelf, in de route. 401 zonder geldige sessie |
| `review.html` | Het apparaatblok: passkey instellen, de lijst met apparaten, uitloggen |

### 2.3 Waarom de browser de sleutel ophaalt

In een Next.js-project zet de buildstap een `NEXT_PUBLIC_`-variabele in de
uitgeleverde code. Dit project heeft geen buildstap, en een statisch
`.html`-bestand kan `process.env` niet lezen. Daarom haalt de browser de twee
publieke waarden op bij `GET /api/auth-config`.

Dat is veilig. De publishable key (voorheen "anon key") is ontworpen om in de
browser te staan; hij staat in elke Supabase-webapp in de paginabron. Wat een
bezoeker mag, hangt aan zijn sessie, niet aan deze sleutel. De **secret key van
Supabase komt in dit project niet voor** en is er ook niet voor nodig.

### 2.4 Waarom `assets/inlog.js` in de repo staat

`@supabase/supabase-js` en `@supabase/ssr` zijn npm-pakketten; een statische
pagina kan ze niet importeren. Er waren drie wegen:

1. **Een CDN** (esm.sh, jsdelivr). Dan hangt de deur van deze tool aan een
   partij die wij niet beheren: ligt hun CDN eruit, dan kun je niet inloggen.
   Afgewezen.
2. **Een buildstap toevoegen aan Vercel.** Dan verandert de manier waarop deze
   site wordt uitgeleverd (build command, output directory) en dat raakt élke
   pagina, niet alleen de login. Te veel risico voor te weinig winst.
3. **Eén keer bundelen en het resultaat meecommitten.** Gekozen. De deploy
   blijft precies zo simpel als hij was, er is geen derde partij bij betrokken,
   en de versie ligt vast in `package-lock.json`.

Na een update van `@supabase/ssr` of `@supabase/supabase-js`:

```
npm run bouw:inlog
```

`test/inlog-schermen.test.mjs` slaat alarm als dat is vergeten: de bundel legt
zijn versies vast in `assets/inlog.versies.json` en die worden vergeleken met de
geïnstalleerde pakketten.

### 2.5 De twee eisen, en waarom het er twee zijn

Toegang vereist **allebei**:

1. een geldige Supabase-sessie, en
2. een e-mailadres dat in `ALLOWED_LOGIN_EMAILS` staat.

Een Supabase-project kan meer gebruikers hebben dan dit gereedschap toegang moet
geven, en de projectinstellingen staan los van deze repo. De lijst in Vercel is
de deur van deze tool, en die deur hoort in de code te staan die hem bewaakt.

**Een lege lijst laat niemand binnen.** Dat is met opzet de tegenovergestelde
keuze van wat een weggelaten filter normaal doet: een variabele die per ongeluk
niet is gezet, mag de deur niet openzetten.

### 2.6 Twee sloten, twee plekken

* De **middleware** bewaakt de pagina. Wie zonder sessie `/review` opvraagt,
  gaat naar `/login` in plaats van een lege schil te krijgen. Hij *schrijft* ook:
  is het access token verlopen terwijl het refresh token nog geldig is, dan
  ververst `getUser()` de sessie en gaan de nieuwe cookies mee op het antwoord —
  via `next()` van `@vercel/functions` op de doorlaat, en op de redirect naar
  `/login`. Zie §4.1.
* `/api/review` bewaakt de **gegevens**, in zijn eigen runtime.

Dat is geen dubbel werk. De gegevens horen beschermd te zijn op de plek waar ze
worden uitgegeven, zodat een fout in de routering ze niet blootlegt; en die
controle is te toetsen met de testsuite van dit project, terwijl middleware dat
niet is.

### 2.7 Waarom `getUser()` en niet `getSession()`

`getSession()` leest alleen wat er in de cookie staat en gelooft dat op zijn
woord. Een cookie is door de bezoeker te bewerken. `getUser()` laat Supabase het
token controleren. Dat kost één netwerkaanroep per verzoek; voor een
redactiegereedschap met één gebruiker is dat de juiste ruil.
`test/inlog-poort.test.mjs` legt dat verschil vast met een zelf in elkaar gezette
cookie die er van buiten perfect uitziet.

### 2.8 De cookie

Eén vaste naam, `nlfr-auth`, op alle drie de plekken waar een client wordt
gemaakt (browser, serverless function, middleware). `@supabase/ssr` leidt die
naam standaard af uit de project-URL; hier staat hij vast, zodat hij niet
meebeweegt met een URL en herkenbaar is voor de tests.

`Path=/`, `Secure` (behalve op localhost), `SameSite=Lax`. Lax en niet Strict:
de magic link komt uit een mailprogramma, dus de terugkomst op `/auth/callback`
is een navigatie van buitenaf; met Strict stuurt de browser de PKCE-cookie niet
mee en mislukt de uitwisseling.

**Geen `HttpOnly`.** De browser-client van Supabase leest en vernieuwt de sessie
zelf uit deze cookies; met `HttpOnly` kan hij dat niet en verloopt de sessie
stil. Dat is de afweging die `@supabase/ssr` ook maakt. De bescherming zit in het
korte verloop van het access token en in de allowlist, niet in het verbergen van
de cookie.

### 2.9 Wat de allowlist níét verraadt

`POST /api/inloglink` antwoordt **altijd hetzelfde**, of een adres nu op de lijst
staat of niet:

> Als dit adres toegang heeft, staat er nu een inloglink in de mailbox.

Zonder die eigenschap is de route een middel om uit te vinden wie er binnen mag:
adressen intikken tot er één "verstuurd" zegt. Een adres dat geen geldig adres
ís, krijgt wél een eigen melding — dat verraadt niets, en zonder die melding
staat iemand met een typefout naar een lege mailbox te kijken.

### 2.10 Wat buiten de login is gebleven

Ongemoeid, met opzet:

* **`/api/cron` met `CRON_SECRET`.** Vercel Cron is geen mens en heeft geen
  browser.
* **`/api/banner` (POST) met `BANNER_TOKEN`.** Eigen token, bewust los van de
  redactietool. Deze route is de logische volgende kandidaat voor dezelfde
  loginlaag, maar viel buiten deze opdracht.
* **Alle publieke routes en pagina's**: `/api/actueel`, `/api/actueel-tekst`,
  `/api/actueel-archief`, `/api/register`, `/api/schoolvakanties`, `index.html`,
  `actueel.html`, `archief.html`.

### 2.11 Wat er is weggehaald

Naast de tokencontrole zelf is de **opslagdiagnostiek** verdwenen:
`lib/opslagmelding.js`, de POST-actie `opslagmelding` in `/api/review`, de
KV-sleutels `KEY_OPSLAGMELDING` / `OPSLAGMELDING_TTL_S`, en het meldingenblok in
`review.html`. Die hele laag — een baken, een vingerafdruk van het token, een
meldingenring per toestel — bestond om één vraag te beantwoorden: *heeft deze
browser mijn token nog?* Die vraag bestaat niet meer. Wat overblijft is een
sessie in een cookie die de server zelf kan zien.

---

## 3. Beheer

### 3.1 Variabelen in Vercel (production én preview)

| Variabele | Waarde | Openbaar? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | De project-URL van Supabase | Ja, staat in de browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | De publishable key | Ja, ontworpen om publiek te zijn |
| `ALLOWED_LOGIN_EMAILS` | Kommagescheiden e-mailadressen | Nee |

Het voorvoegsel `NEXT_PUBLIC_` is hier **alleen een naam**. Dit project is geen
Next.js; er is geen buildstap die er iets mee doet. De namen zijn aangehouden
zoals ze in Vercel al stonden.

Ongewijzigd: `ANTHROPIC_API_KEY`, `CRON_SECRET`, `BANNER_TOKEN`,
`KV_REST_API_URL`, `KV_REST_API_TOKEN`. **Verwijderd:** `REVIEW_TOKEN` — die kan
uit Vercel weg, de code leest hem niet meer.

### 3.2 Instellingen in Supabase (project `communities-tools`)

**Authentication → Passkeys** — *Enable Passkey authentication* aan:

| Veld | Waarde |
| --- | --- |
| Relying Party ID | `nlfr-menu.vercel.app` |
| Relying Party Origins | `https://nlfr-menu.vercel.app` |

> Een passkey is cryptografisch gebonden aan de Relying Party ID waarmee hij is
> aangemaakt. Verander je die ID, dan werkt géén enkele bestaande passkey meer en
> moet iedereen opnieuw instellen. Laat hem staan.

**Authentication → URL Configuration → Redirect URLs** — hier moet staan:

```
https://nlfr-menu.vercel.app/auth/callback
```

Wil je ook op preview-deploys kunnen inloggen, voeg dan het wildcardpatroon van
je previews toe, bijvoorbeeld `https://nlfr-menu-*.vercel.app/auth/callback`.
`/api/inloglink` leidt de bestemming af uit de host van het verzoek, zodat een
link die op een preview is aangevraagd ook daar terugkomt — maar Supabase
weigert een redirect-URL die niet in deze lijst staat.

> Let op: passkeys werken **niet** op preview-URL's, want de Relying Party ID
> staat vast op `nlfr-menu.vercel.app`. Op een preview blijft de magic link de
> enige weg naar binnen. Dat is een eigenschap van WebAuthn, geen instelling.

**Authentication → Email templates** — de standaard-magic-link-template volstaat.

Passkeys zijn bij Supabase **experimenteel**. Dat betekent: `@supabase/supabase-js`
2.105.0 of hoger, en een expliciete opt-in bij `createClient`
(`auth.experimental.passkey = true`, zie `src/inlog.js`). De API kan zonder
aankondiging veranderen; dat is de prijs van deze functie op dit moment.
Documentatie: <https://supabase.com/docs/guides/auth/passkeys>

### 3.3 Een nieuwe redacteur toelaten

1. Adres toevoegen aan `ALLOWED_LOGIN_EMAILS` in Vercel (production én preview).
2. Opnieuw deployen — env-vars worden bij de build meegegeven.
3. De nieuwe redacteur gaat naar `/login`, vult zijn adres in en klikt de link in
   de mail aan. Supabase maakt het account bij die eerste inlog aan.
4. Op `/review` klapt hij het blok **Apparaat** open en kiest *Vingerafdruk
   instellen op dit apparaat*.

Iemand de toegang ontnemen gaat in omgekeerde volgorde: adres uit
`ALLOWED_LOGIN_EMAILS`, opnieuw deployen. De sessie die hij heeft, is bij het
eerstvolgende verzoek waardeloos — de lijst wordt bij élk verzoek gecontroleerd,
niet alleen bij het inloggen.

### 3.4 Apparaat kwijt

Dit is de belangrijkste procedure in dit document.

1. **Kom binnen op een ander apparaat.** Ga naar `/login`, vul je adres in, klik
   *Stuur inloglink*, open de mail. De magic link werkt altijd — daar is hij voor.
2. **Gooi de oude passkey weg.** Op `/review`: klap **Apparaat** open. Onder
   *Ingesteld* staat elk apparaat met zijn naam (afgeleid van de authenticator:
   "iCloud Keychain", "Google Password Manager", …) en de datum waarop het is
   ingesteld. Klik *Verwijderen* bij het apparaat dat je kwijt bent.
3. **Stel het nieuwe apparaat in.** In hetzelfde blok: *Dit apparaat instellen*.

Wat een vinder van het oude apparaat kan: niets, zolang hij het apparaat niet kan
ontgrendelen — de passkey zit achter de vingerafdruk, de gezichtsscan of de
pincode van dat apparaat. Verwijder hem toch, meteen. Twijfel je of je bij alle
apparaten kunt: haal je adres tijdelijk uit `ALLOWED_LOGIN_EMAILS`. Dan is élke
sessie en élke passkey waardeloos, ook die van jezelf, tot je hem terugzet.

Er is geen weg terug via een wachtwoord, want er ís geen wachtwoord. Raak je de
mailbox kwijt waarmee je inlogt, dan is de enige weg het adres in
`ALLOWED_LOGIN_EMAILS` te wijzigen.

### 3.5 Wat er misgaat en wat het betekent

| Melding op `/login` | Wat er aan de hand is |
| --- | --- |
| *De link is verlopen of al gebruikt* | Een magic link werkt één keer en verloopt. Ook: de link geopend in een **andere browser** dan waar je hem aanvroeg — de PKCE-cookie staat er dan niet. Vraag een nieuwe aan, in dezelfde browser |
| *Deze inloglink klopt niet* | Geen code in de URL. Meestal een half gekopieerde link |
| *Dit account heeft geen toegang tot de redactie* | Geldige sessie, maar het adres staat niet in `ALLOWED_LOGIN_EMAILS` |
| *Inloggen is op deze omgeving niet ingesteld* | `NEXT_PUBLIC_SUPABASE_URL` of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ontbreekt in deze deploy |
| *De inlogdienst is even niet bereikbaar* | Supabase antwoordde niet. De deur gaat dan dicht, niet open |
| *Geannuleerd* | De passkey-prompt is weggeklikt of liep af |
| *Deze browser ondersteunt geen passkeys* | Geen WebAuthn, of geen veilige context (HTTPS). Gebruik de magic link |

### 3.6 Deze laag elders gebruiken

Wat overdraagbaar is naar een andere tool van het netwerk van platforms:

* `lib/auth.js` en `lib/auth-node.js` — vrijwel ongewijzigd, op `COOKIE_NAAM` na.
  Geef elke tool een **eigen** cookienaam, anders delen twee tools op hetzelfde
  domein onbedoeld één sessie.
* `middleware.js` — alleen de `matcher` verschilt.
* `api/auth-config.js`, `api/inloglink.js`, `api/auth-callback.js` — ongewijzigd.
* `src/inlog.js` en het bouwscript — alleen nodig zonder buildstap. Heeft de
  andere tool wél een bundelaar, dan importeer je `@supabase/ssr` rechtstreeks en
  vervalt `assets/`.
* `login.html` — vorm overnemen, huisstijl aanpassen.

De allowlist per tool in zijn eigen `ALLOWED_LOGIN_EMAILS` houden. Eén
Supabase-project kan alle tools bedienen; wie waar binnen mag, blijft dan een
kwestie van de omgeving van die tool.

Twee dingen die je bij overname niet moet overslaan: de controle in de route
zelf (niet alleen in de middleware), en `getUser()` in plaats van
`getSession()`.

### 3.7 De handmatige test van de passkey

**De WebAuthn-ceremonie zelf is niet geautomatiseerd te testen.** De
vingerafdruk of gezichtsscan komt van de authenticator van het apparaat
(Touch ID, Windows Hello, de telefoon). Die is niet na te doen in Node en niet
aan te sturen in een headless browser: het hele punt van WebAuthn is dat alleen
een echte gebruiker op echte hardware de ceremonie kan voltooien.

Wat de tests wél vastleggen: dat de knoppen bestaan, dat ze de juiste
Supabase-aanroep doen, dat de passkey-knop wegblijft in een browser zonder
WebAuthn, en dat de foutmeldingen Nederlands en kort zijn. De ceremonie zelf toets
je met de hand, in drie stappen:

1. **Instellen.** Log in met een magic link, ga naar `/review`, klap **Apparaat**
   open en klik *Dit apparaat instellen*. Verwacht: de prompt van
   het besturingssysteem, daarna de melding "Ingesteld" en een nieuwe regel onder
   *Ingesteld* met de naam van je authenticator en de datum van vandaag.
2. **Inloggen.** Klik *Uitloggen op dit apparaat*, en klik op `/login` op
   *Inloggen met dit apparaat*. Verwacht: de prompt, daarna direct `/review` met
   je concepten — zonder mail en zonder adres in te tikken.
3. **Intrekken.** Klap **Apparaat** open, klik *Verwijderen* bij de zojuist
   ingestelde regel en bevestig. Verwacht: de regel verdwijnt. Log uit en klik
   opnieuw op *Inloggen met dit apparaat*: dat hoort nu te mislukken met "Deze
   vingerafdruk is hier niet bekend" of het uitblijven van een keuze in de
   prompt. De magic link werkt onveranderd.

Stap 3 is de belangrijkste van de drie: dat is de procedure bij een verloren
apparaat (§3.4), en die wil je een keer geoefend hebben voordat je hem nodig hebt.

---

## 4. Reviewronde 19-09-2026

Codex en Copilot hebben PR #51 nagekeken. Elf opmerkingen, hieronder per punt het
oordeel: heeft de reviewer gelijk, en waarom. Daarna is elk punt met een "ja"
gerepareerd.

### 4.1 Ververste cookies gaan verloren in de middleware — Codex, terecht

`getUser()` ververst een verlopen access token zelf en roept dan `setAll` aan;
dat was hier een lege functie, dus de nieuwe cookies verdwenen terwijl de pagina
wél doorging. Nagemeten met een verlopen access token en een geldig refresh
token: de middleware liet door, en er stond geen enkele cookie op het antwoord —
de browser hield een refresh token dat Supabase al had verbruikt.

### 4.2 `/login` stuurt door op `getSession()` — Codex en Copilot, terecht

`getSession()` leest alleen de cookie en gelooft die; bij een vervalste of
ingetrokken sessie stuurde `/login` door naar `/review`, waar de middleware hem
afwees en zonder `reden` terugstuurde — een lus die alleen met de hand te
doorbreken was. De `reden`-vangregel uit PR #51 dekte alleen het geval
*account zonder recht*, niet het geval *cookie die de server niet accepteert*.

### 4.3 Backslash omzeilt de bestemmingscontrole — Copilot, terecht

`/^\/[^\/]/` liet `/\evil.example` door, want het tweede teken is geen schuine
streep. De URL-parser van de browser behandelt `\` in een absoluut pad als `/`,
dus `location.replace()` maakte daar `//evil.example` van: een open redirect op
de loginpagina, de ene plek waar die het meest schaadt.

### 4.4 `/api/inloglink` verraadt de lijst bij storing — Copilot, terecht

Een adres buiten de lijst kreeg 200, een adres erop kreeg 502 bij een storing van
Supabase en 503 bij ontbrekende configuratie. Daarmee is het endpoint alsnog een
orakel op precies de momenten dat het dat niet mag zijn, in strijd met de regel
die er in PR #51 zelf boven stond.

### 4.5 `signOut()` logt op álle apparaten uit — Codex, terecht

De standaardscope van `signOut()` is in supabase-js 2.116.0 `global`; dat
herroept de sessie op elk apparaat. Nagekeken in de geïnstalleerde bron
(`GoTrueClient.js`: `async signOut(options = { scope: 'global' })`) — in een
scherm dat juist meerdere apparaten beheert is dat het verkeerde gedrag.

### 4.6 Het meldingenblok op `/login` is geen live region — Copilot, terecht

De meldingen ("inloglink verstuurd", "geannuleerd", "link verlopen") worden met
JavaScript in een gewone `<div>` gezet. Zonder `role="status"` krijgt een
schermlezer niets te horen: de gebruiker drukt op een knop en er gebeurt, voor
zover hij kan waarnemen, niets.

### 4.7 `uitleg.html` wijst nog naar `/review?token=…` — Codex, terecht

De publieke uitlegpagina is juist de handleiding voor wie de redactie overneemt,
en die stuurde de invaller naar een authenticatieweg die niet meer bestaat. De
ernst zit niet in de regel zelf maar in de plek: dit is de eerste pagina die
iemand leest die nog niets weet.

### 4.8 README beschrijft nog de verwijderde opslagdiagnostiek — Copilot, terecht

Het hoofdstuk "Het beheertoken bewaren, en wat er op mobiel misging" (ruim honderd
regels) legde `KEY_OPSLAGMELDING` en `lib/opslagmelding.js` uit, allebei in PR #51
verwijderd. Een handleiding die naar weggehaalde code verwijst is erger dan geen
handleiding: je gaat zoeken naar iets dat er niet is.

### 4.9 Commentaar in `src/inlog.js` noemt een testbestand dat niet bestaat — Copilot, terecht

Er stond `test/inlog-bundel.test.mjs`; de controle zit in
`test/inlog-schermen.test.mjs`. Klein, maar het is precies de verwijzing die je
volgt als je je afvraagt waarom de bundel in de repo staat.

### 4.10 De bundelcontrole keek alleen naar versienummers — Copilot, terecht

De toets vergeleek `assets/inlog.versies.json` met de geïnstalleerde pakketten.
Wijzigde `src/inlog.js` zonder `npm run bouw:inlog`, dan bleef de bundel oud
terwijl de toets groen bleef — en dan draait de browser andere code dan de repo
laat zien.

### 4.11 Copilots overzichtsregels zonder eigen bevinding — geen actie

Copilot herhaalt in zijn samenvatting zeven vindingen die hierboven al staan; de
samenvatting zelf bevat geen achtste punt. Codex' vierde opmerking (over
`README.md:619`) gaat over dezelfde `uitleg.html`-passage als §4.7 en is daar
afgehandeld.

### 4.12 Wat er per punt is veranderd

| § | Bestand | Verandering | Toets |
| --- | --- | --- | --- |
| 4.1 | `middleware.js` | `setAll` verzamelt de ververste cookies; `next()` van `@vercel/functions` draagt ze op de doorlaat mee, `naarLogin()` op de redirect | `test/inlog-middleware.test.mjs` — verlopen access token met geldig refresh token |
| 4.2 | `login.html` | Doorsturen pas na `getUser()`; wordt de sessie afgewezen, dan `signOut({scope:"local"})` en het inlogscherm blijft staan | `test/inlog-loginscherm.test.mjs` |
| 4.3 | `login.html` | `bestemming()` weigert backslashes en controleert de origin van de opgeloste URL | `test/inlog-bestemming.test.mjs` |
| 4.4 | `api/inloglink.js` | Storing en ontbrekende configuratie geven dezelfde neutrale 200; de reden gaat naar `console.error` | `test/inlog-routes.test.mjs` |
| 4.5 | `review.html` | `signOut({ scope: "local" })`, label "Uitloggen op dit apparaat" | `test/inlog-schermen.test.mjs` |
| 4.6 | `login.html`, `review.html` | `role="status" aria-live="polite"` op beide meldingenblokken | `test/inlog-schermen.test.mjs` |
| 4.7 | `uitleg.html` | De passage over `/review?token=…` vervangen door inloglink + apparaat instellen | grep op `?token=` |
| 4.8 | `README.md` | Het hoofdstuk over tokenopslag vervangen door een verwijzing naar dit document | grep op `KEY_OPSLAGMELDING` |
| 4.9 | `src/inlog.js` | Verwijst nu naar `test/inlog-schermen.test.mjs` | — |
| 4.10 | `scripts/bouw-inlog.mjs` | Legt een hash vast van elk eigen bronbestand uit de bundel (uit de esbuild-metafile) én van de bundel zelf | `test/inlog-schermen.test.mjs` |

Daarnaast, niet uit de review maar uit dezelfde ronde:

* **De knoppen heten naar het apparaat, niet naar een vingerafdruk.** "Inloggen
  met dit apparaat", "Dit apparaat instellen". Het woord *vingerafdruk* staat
  alleen nog in de uitlegregel eronder — "Vingerafdruk, gezicht of pincode van je
  telefoon of computer" — want op een computer is het net zo vaak een pincode, en
  wie geen vingerafdruklezer heeft leest zo'n knoplabel als "niet voor mij".
* **De twee deuren zijn even prominent.** Beide knoppen dragen dezelfde opmaak.
  De inloglink is geen noodoplossing die je erbij zoekt: hij is de enige weg op
  een nieuw apparaat, op een preview-omgeving en wanneer je je telefoon kwijt
  bent. Een tweede optie die stiller is opgemaakt, wordt op het moment dat je hem
  nodig hebt niet gevonden.
* **`scripts/schermen.mjs`** kan niet meer met `?token=demo` naar binnen en
  vraagt nu om een sessiecookie in `NLFR_REVIEW_COOKIE`; zonder die variabele
  stopt het script in plaats van lege afdrukken te maken.
* **`SameSite` wordt genormaliseerd** naar één schrijfwijze. `@supabase/ssr`
  levert `lax` aan en `lib/auth.js` schreef `Lax`; twee schrijfwijzen door elkaar
  maakt elke controle op die regel een gok.
