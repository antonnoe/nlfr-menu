// Bronnen voor de nieuwsselectie (de vervanger van Feedspot).
// ---------------------------------------------------------------------------
// Feedspot was twaalf jaar lang Antons pinboard: Nederlandstalige pers over
// Frankrijk, met de hand geselecteerd, via FeedWind in de NLFR-sidebar. Deze
// lijst haalt dezelfde stroom binnen, rechtstreeks bij de redacties waar dat
// kan, en via Google News (NL en BE) voor de rest: dat is ook waar Feedspot
// zijn pins vandaan haalde.
//
// Bewust GEEN onderdeel van bronnen.json: die lijst voedt /actueel en de
// persketen met syntheses. Deze stroom loopt daar los van, zodat een
// wijziging hier nooit de actueelpagina of de dagelijkse brief kan raken.
//
// filter: true = alleen items die over Frankrijk gaan (zie gaatOverFrankrijk
// in kern.js). Google News is al op "Frankrijk" gezocht en hoeft dat niet.

// AD, NU.nl, de Volkskrant, RTL, NRC en HLN staan er bewust NIET rechtstreeks
// in: hun servers weigeren (HTTP 403) een lezer die zich eerlijk als bot
// meldt, gemeten op 7 november 2026. We vermommen ons niet; hun berichten
// komen via Google News binnen, met de redactie als bronnaam.
export const SELECTIE_PERS_BRONNEN = [
  { naam: "NOS", land: "NL", feed: "https://feeds.nos.nl/nosnieuwsbuitenland", filter: true },
  { naam: "VRT NWS", land: "BE", feed: "https://www.vrt.be/vrtnws/nl.rss.articles.xml", filter: true },
  {
    naam: "Google News NL",
    land: "NL",
    feed: "https://news.google.com/rss/search?q=Frankrijk&hl=nl&gl=NL&ceid=NL:nl",
    filter: false,
    googleNews: true,
  },
  {
    naam: "Google News BE",
    land: "BE",
    feed: "https://news.google.com/rss/search?q=Frankrijk&hl=nl&gl=BE&ceid=BE:nl",
    filter: false,
    googleNews: true,
  },
];

// Weerwaarschuwingen: MeteoAlarm (EUMETNET) brengt de vigilance van
// Météo-France naar een open Atom-feed. Alleen oranje en rood tellen.
// De lezer gaat naar de officiële vigilancekaart van Météo-France.
export const SELECTIE_METEO_FEED = "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-france";
export const SELECTIE_METEO_LEZER_URL = "https://vigilance.meteofrance.fr/fr";

// PEIL: het parameterregister van Communities Abroad.
export const SELECTIE_PEIL_URL = "https://communitiesabroad.com/manifest/peil-zoek.json";
export const SELECTIE_PEIL_REGISTER_URL = "https://communitiesabroad.com/peil/";
