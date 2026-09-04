// lib/banner.js — de Café Jeudi-banner: standaardwaarden, validatie, datumtekst
// en de opmaak. Eén bestand, drie afnemers:
//
//   1. api/banner.js   — leest en schrijft het KV-record "banner"
//   2. index.html      — het menu toont de banner bovenaan het iframe
//   3. banner-beheer.html — het live voorbeeld naast het formulier
//
// Dat het voorbeeld in de beheerpagina PRECIES toont wat het menu rendert, is
// de reden dat de opmaak hier staat en niet in de twee HTML-bestanden. Wijzig
// je bannerHTML(), dan verandert het voorbeeld mee — er is geen tweede kopie
// die kan gaan afwijken.
//
// Dit is een ES-module die ook in de browser draait: onderaan zet hij zichzelf
// op globalThis.NLFR_BANNER, zodat de twee HTML-bestanden hem met
// <script type="module" src="/lib/banner.js"> kunnen laden en daarna gewoon
// window.NLFR_BANNER.* aanroepen.

// --- standaardwaarden -------------------------------------------------------

export const KLEUREN = ["#2f6b3a", "#6b3a8f", "#a97a1f", "#1f6b7a"];

export const ONDERSCHRIFTEN = {
  open: "Iedereen is van harte welkom | Soyez les bienvenus",
  leden: "Alleen voor geregistreerde leden",
};

export const STANDAARD = {
  aan: true,
  soort: "cafe",
  titel: "Café Jeudi",
  wekelijks: { weekdag: 4, begin: "18:00", eind: "19:30" },
  overslaan: [],
  datumtekst: null,
  kleur: "#2f6b3a",
  onderschrift: "open",
  knop: { tekst: "ENTREZ", url: "https://meet.google.com/gea-tjsy-gwk" },
  uitleg:
    "Café Jeudi is een wekelijkse, ongedwongen bijeenkomst via Google Meet. " +
    "Al meer dan 5 jaar delen we verhalen en tips over wonen in Frankrijk.",
  boek: { titel: "", auteur: "" },
  afbeelding: null,
};

const SOORTEN = ["cafe", "boek", "vrij"];

const DAGEN = ["", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
const MAANDEN = ["", "januari", "februari", "maart", "april", "mei", "juni",
                 "juli", "augustus", "september", "oktober", "november", "december"];

// --- kleine helpers ---------------------------------------------------------

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function isTijd(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function isDatum(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [j, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(j, m - 1, d));
  return t.getUTCFullYear() === j && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function minutenUit(hhmm) {
  const [u, m] = String(hhmm).split(":").map(Number);
  return u * 60 + m;
}

// Alleen kalenderrekenen: UTC-middernacht als anker, zodat zomertijd geen dag
// kan verschuiven. De tijdzone doet er hieronder alleen toe bij "welke dag en
// hoe laat is het NU in Parijs" — dat is inParijs().
function plusDagen(iso, n) {
  const [j, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(j, m - 1, d + n));
  const p = (x) => String(x).padStart(2, "0");
  return t.getUTCFullYear() + "-" + p(t.getUTCMonth() + 1) + "-" + p(t.getUTCDate());
}

const WEEKDAG = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Datum, tijd en weekdag zoals ze OP DIT MOMENT IN PARIJS zijn. De server draait
// in UTC en de bezoeker kan overal zitten; de bijeenkomst is Frans, dus Parijs
// is de enige klok die telt.
export function inParijs(nu) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = {};
  for (const deel of f.formatToParts(nu instanceof Date ? nu : new Date(nu))) p[deel.type] = deel.value;
  return {
    iso: p.year + "-" + p.month + "-" + p.day,
    minuten: Number(p.hour) * 60 + Number(p.minute),
    weekdag: WEEKDAG[p.weekday] || 0,
  };
}

// --- datumlogica ------------------------------------------------------------

// De eerstvolgende bijeenkomst als "JJJJ-MM-DD", of null zonder weekschema.
//
// Op de dag zelf telt hij tot "eind" nog als vandaag — wie om 18:30 kijkt moet
// zien dat het NU is, niet pas volgende week. Na "eind" schuift hij een week op.
// Staat de gevonden datum in `overslaan`, dan telkens een week verder.
export function volgendeDatum(rec, nu) {
  const w = rec && rec.wekelijks;
  if (!w || !w.weekdag || !isTijd(w.eind)) return null;
  const over = Array.isArray(rec.overslaan) ? rec.overslaan : [];
  const hier = inParijs(nu || new Date());

  let delta = (w.weekdag - hier.weekdag + 7) % 7;
  if (delta === 0 && hier.minuten >= minutenUit(w.eind)) delta = 7;

  let datum = plusDagen(hier.iso, delta);
  for (let i = 0; i < 60 && over.indexOf(datum) !== -1; i++) datum = plusDagen(datum, 7);
  return datum;
}

// De regel zoals hij in de banner staat:
//   "Donderdag 10 september van 18:00 tot +/- 19:30"
// Een ingevulde datumtekst wint altijd van de berekende regel — dat is de
// ontsnapping voor een eenmalige afwijking ("Kerstborrel, zaterdag 20 dec").
export function datumRegel(rec, nu) {
  if (!rec) return "";
  if (rec.datumtekst != null && String(rec.datumtekst).trim() !== "") {
    return String(rec.datumtekst).trim();
  }
  const datum = volgendeDatum(rec, nu);
  if (!datum) return "";
  const w = rec.wekelijks;
  const [, m, d] = datum.split("-").map(Number);
  return DAGEN[w.weekdag] + " " + d + " " + MAANDEN[m] +
         " van " + w.begin + " tot +/- " + w.eind;
}

// De eerstvolgende datum die "Deze week overslaan" toevoegt — dezelfde datum
// die de banner nu toont, zodat de knop doet wat hij zegt.
export function eerstvolgende(rec, nu) {
  return volgendeDatum(rec, nu);
}

export function onderschriftTekst(rec) {
  const o = rec && rec.onderschrift;
  if (o == null || o === "") return "";
  return ONDERSCHRIFTEN[o] || String(o);
}

// --- validatie (POST /api/banner) ------------------------------------------

// Geeft { ok:true, record } of { ok:false, fout }. Onbekende velden vallen weg:
// wat hier uit komt is precies het schema, nooit meer.
export function valideer(ruw) {
  if (!ruw || typeof ruw !== "object" || Array.isArray(ruw)) {
    return { ok: false, fout: "Geen object ontvangen." };
  }
  const uit = {};

  if (typeof ruw.aan !== "boolean") return { ok: false, fout: "Veld 'aan' moet true of false zijn." };
  uit.aan = ruw.aan;

  const soort = ruw.soort == null ? STANDAARD.soort : String(ruw.soort);
  if (SOORTEN.indexOf(soort) === -1) {
    return { ok: false, fout: "Veld 'soort' moet cafe, boek of vrij zijn." };
  }
  uit.soort = soort;

  uit.titel = String(ruw.titel == null || ruw.titel === "" ? STANDAARD.titel : ruw.titel).slice(0, 120);

  if (ruw.wekelijks == null) {
    uit.wekelijks = null;
  } else {
    const w = ruw.wekelijks;
    if (typeof w !== "object" || Array.isArray(w)) return { ok: false, fout: "Veld 'wekelijks' moet een object of null zijn." };
    const dag = Number(w.weekdag);
    if (!Number.isInteger(dag) || dag < 1 || dag > 7) {
      return { ok: false, fout: "Veld 'wekelijks.weekdag' moet 1 (maandag) tot en met 7 (zondag) zijn." };
    }
    if (!isTijd(w.begin) || !isTijd(w.eind)) {
      return { ok: false, fout: "Veld 'wekelijks.begin' en 'wekelijks.eind' moeten als UU:MM." };
    }
    if (minutenUit(w.eind) <= minutenUit(w.begin)) {
      return { ok: false, fout: "De eindtijd moet na de begintijd liggen." };
    }
    uit.wekelijks = { weekdag: dag, begin: w.begin, eind: w.eind };
  }

  const over = ruw.overslaan == null ? [] : ruw.overslaan;
  if (!Array.isArray(over)) return { ok: false, fout: "Veld 'overslaan' moet een lijst datums zijn." };
  for (const d of over) {
    if (!isDatum(d)) return { ok: false, fout: "Ongeldige datum in 'overslaan': " + String(d) + " (verwacht JJJJ-MM-DD)." };
  }
  uit.overslaan = over.slice(0, 200).sort();

  uit.datumtekst = ruw.datumtekst == null || String(ruw.datumtekst).trim() === ""
    ? null : String(ruw.datumtekst).trim().slice(0, 160);

  const kleur = String(ruw.kleur == null || ruw.kleur === "" ? STANDAARD.kleur : ruw.kleur);
  if (!/^#[0-9a-fA-F]{6}$/.test(kleur)) return { ok: false, fout: "Veld 'kleur' moet een hexkleur zijn, bijvoorbeeld #2f6b3a." };
  uit.kleur = kleur.toLowerCase();

  uit.onderschrift = ruw.onderschrift == null ? "" : String(ruw.onderschrift).slice(0, 200);

  const knop = ruw.knop == null ? {} : ruw.knop;
  if (typeof knop !== "object" || Array.isArray(knop)) return { ok: false, fout: "Veld 'knop' moet een object zijn." };
  const knopUrl = String(knop.url == null ? "" : knop.url).trim();
  if (knopUrl && !/^https?:\/\//i.test(knopUrl)) {
    return { ok: false, fout: "De knop-URL moet met http:// of https:// beginnen." };
  }
  uit.knop = {
    tekst: String(knop.tekst == null || knop.tekst === "" ? STANDAARD.knop.tekst : knop.tekst).slice(0, 40),
    url: knopUrl,
  };

  uit.uitleg = String(ruw.uitleg == null ? "" : ruw.uitleg).slice(0, 2000);

  const boek = ruw.boek == null ? {} : ruw.boek;
  if (typeof boek !== "object" || Array.isArray(boek)) return { ok: false, fout: "Veld 'boek' moet een object zijn." };
  uit.boek = {
    titel: String(boek.titel == null ? "" : boek.titel).slice(0, 160),
    auteur: String(boek.auteur == null ? "" : boek.auteur).slice(0, 120),
  };

  const afb = ruw.afbeelding == null || String(ruw.afbeelding).trim() === "" ? null : String(ruw.afbeelding).trim();
  if (afb && !/^https?:\/\//i.test(afb)) {
    return { ok: false, fout: "De afbeeldings-URL moet met http:// of https:// beginnen." };
  }
  uit.afbeelding = afb;

  return { ok: true, record: uit };
}

// Een record uit KV of banner.json aanvullen tot het volledige schema, zodat de
// opmaak nooit op een ontbrekend veld stuit.
export function normaliseer(ruw) {
  const basis = JSON.parse(JSON.stringify(STANDAARD));
  if (!ruw || typeof ruw !== "object") return basis;
  const uit = Object.assign(basis, ruw);
  uit.knop = Object.assign({}, STANDAARD.knop, ruw.knop || {});
  uit.boek = Object.assign({}, STANDAARD.boek, ruw.boek || {});
  if (ruw.wekelijks === null) uit.wekelijks = null;
  if (!Array.isArray(uit.overslaan)) uit.overslaan = [];
  return uit;
}

// --- opmaak (ontwerp 2a) ----------------------------------------------------

// De banner als HTML-string. `nu` is alleen voor de tests en het voorbeeld;
// laat hem weg en hij rekent met de echte klok.
//
// Staat de banner uit, dan komt hier "" uit — de aanroeper hoeft niets te
// weten van de reden, en het menu blijft ongestoord.
export function bannerHTML(rec, nu) {
  const b = normaliseer(rec);
  if (!b.aan) return "";

  const kleur = b.kleur || STANDAARD.kleur;
  const regel = datumRegel(b, nu);
  const onder = onderschriftTekst(b);
  const heeftUitleg = String(b.uitleg || "").trim() !== "";

  // Zonder datumregel is er niets aan te kondigen; de knop wordt dan de weg
  // naar de uitleg in plaats van naar de bijeenkomst.
  const naarUitleg = !regel && heeftUitleg;
  const knopTekst = naarUitleg ? "Lees meer…" : (b.knop.tekst || STANDAARD.knop.tekst);

  let h = '<div class="bnr" style="border-left-color:' + esc(kleur) + '">';

  if (heeftUitleg) {
    h += '<button type="button" class="bnr-vraag" id="bnrvraag" aria-expanded="false" ' +
         'aria-controls="bnruitleg" aria-label="Wat is dit?" title="Wat is dit?">?</button>';
  }

  h += '<div class="bnr-tekst">';
  h += '<div class="bnr-kop">';
  if (b.afbeelding) {
    h += '<img class="bnr-afb" src="' + esc(b.afbeelding) + '" alt="" width="34" height="34" loading="lazy">';
  }
  h += '<span class="bnr-titel">' + esc(b.titel) + '</span>';
  h += '</div>';

  if (b.soort === "boek" && (b.boek.titel || b.boek.auteur)) {
    h += '<div class="bnr-boek">' + esc(b.boek.titel) +
         (b.boek.titel && b.boek.auteur ? " — " : "") + esc(b.boek.auteur) + '</div>';
  }
  if (regel) h += '<div class="bnr-datum">' + esc(regel) + '</div>';
  if (onder) h += '<div class="bnr-onder">' + esc(onder) + '</div>';
  h += '</div>';

  if (naarUitleg) {
    h += '<button type="button" class="bnr-knop" id="bnrknop" style="background:' + esc(kleur) + '">' +
         esc(knopTekst) + '</button>';
  } else if (b.knop.url) {
    h += '<a class="bnr-knop" href="' + esc(b.knop.url) + '" target="_blank" rel="noopener" ' +
         'style="background:' + esc(kleur) + '">' + esc(knopTekst) + '</a>';
  }

  h += '</div>';

  if (heeftUitleg) {
    h += '<div class="bnr-uitleg" id="bnruitleg" hidden>' + esc(b.uitleg) + '</div>';
  }
  return h;
}

// De CSS die bij bannerHTML() hoort. Ook gedeeld, zodat het voorbeeld in de
// beheerpagina niet alleen dezelfde HTML maar ook dezelfde opmaak krijgt.
export const BANNER_CSS = `
.bnr { display:flex; align-items:center; gap:12px; flex-wrap:wrap;
       background:rgba(128,0,0,.05); border:1px solid rgba(128,0,0,.14);
       border-left:4px solid #2f6b3a; border-radius:6px; padding:12px 14px; }
.bnr-vraag { position:relative; flex:none; width:30px; height:30px; border-radius:999px; border:0; cursor:pointer;
             background:#800000; color:#fff; font-family:'Poppins',sans-serif; font-weight:700;
             font-size:16px; line-height:1; display:grid; place-items:center;
             animation:bnrpuls 2.4s ease-out infinite; }
/* De cirkel blijft 30px zoals ontworpen, maar het RAAKVLAK is 44px: een
   onzichtbare uitbreiding rond de knop. Op een telefoon mik je anders mis. */
.bnr-vraag::after { content:""; position:absolute; left:50%; top:50%; width:44px; height:44px;
                    transform:translate(-50%,-50%); border-radius:999px; }
.bnr-vraag:focus-visible { outline:2px solid #800000; outline-offset:2px; }
@keyframes bnrpuls {
  0%   { box-shadow:0 0 0 0 rgba(128,0,0,.32); }
  70%  { box-shadow:0 0 0 9px rgba(128,0,0,0); }
  100% { box-shadow:0 0 0 0 rgba(128,0,0,0); }
}
.bnr-tekst { flex:1 1 220px; min-width:0; }
.bnr-kop { display:flex; align-items:center; gap:9px; }
.bnr-afb { flex:none; width:34px; height:34px; border-radius:6px; object-fit:cover; }
.bnr-titel { font-family:Georgia,'Times New Roman',serif; font-size:24px; line-height:1.15; color:#800000; }
.bnr-boek { font-family:'Mulish',sans-serif; font-size:13px; font-style:italic; color:rgba(128,0,0,.8); margin-top:2px; }
.bnr-datum { font-family:'Mulish',sans-serif; font-size:13px; font-weight:700; color:#800000; margin-top:3px; }
.bnr-onder { font-family:'Mulish',sans-serif; font-size:12px; color:rgba(128,0,0,.8); margin-top:2px; }
.bnr-knop { flex:none; display:inline-flex; align-items:center; justify-content:center;
            min-height:44px; padding:0 20px; border:0; border-radius:6px; cursor:pointer;
            background:#2f6b3a; color:#fff; text-decoration:none;
            font-family:'Poppins',sans-serif; font-weight:700; font-size:14px; letter-spacing:.02em; }
.bnr-knop:hover { filter:brightness(1.08); }
.bnr-knop:focus-visible { outline:2px solid #800000; outline-offset:2px; }
.bnr-uitleg { margin-top:8px; padding:12px 14px; border:1px solid rgba(128,0,0,.14);
              border-radius:6px; background:#fff; font-family:'Mulish',sans-serif;
              font-size:13.5px; line-height:1.6; color:#5b524f; }
.bnr-uitleg[hidden] { display:none !important; }
@media (max-width:700px) {
  /* Op een telefoon staat de knop onder de tekst, over de volle breedte. De
     [?] gaat naar de linkerbovenhoek; position:relative op de kaart houdt hem
     daar, want zonder dat zoekt hij een willekeurige voorouder. flex op de
     tekst uitzetten, anders rekt die uit en valt er een gat boven de knop. */
  .bnr { position:relative; flex-direction:column; align-items:stretch; text-align:left; }
  .bnr-vraag { position:absolute; left:12px; top:12px; }
  .bnr-tekst { flex:0 0 auto; padding-left:40px; }
  .bnr-knop { width:100%; }
}
@media (prefers-reduced-motion:reduce) { .bnr-vraag { animation:none; } }
`;

// Zodat index.html en banner-beheer.html dit bestand als <script type="module">
// kunnen laden en daarna window.NLFR_BANNER gebruiken.
if (typeof globalThis !== "undefined") {
  globalThis.NLFR_BANNER = {
    KLEUREN, ONDERSCHRIFTEN, STANDAARD, BANNER_CSS,
    esc, inParijs, volgendeDatum, datumRegel, eerstvolgende,
    onderschriftTekst, valideer, normaliseer, bannerHTML,
  };
}
