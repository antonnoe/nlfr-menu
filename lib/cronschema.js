// Rondes per etmaal uit een Vercel-cronschema.
// ---------------------------------------------------------------------------
// Pure functie, geen Date en geen fetch. Leest een standaard vijfvelds
// cronexpressie (minuut uur dag-van-maand maand dag-van-week) en telt op een
// gewone dag hoeveel keer hij afgaat. Ondersteund: *, lijsten, bereiken en
// stappen (*/15, 1-5, 0-23/2). Namen als MON of JAN worden niet ondersteund en
// geven een fout: een schema dat we niet kunnen lezen mogen we niet goedkeuren.
//
// Dag, maand en weekdag tellen hier als "elke dag": de invariant bewaakt de
// dichtheid van de ronde, niet een kalender. Een schema met een beperking op die
// velden geeft een fout, zodat niemand ongemerkt een weekendstop inbouwt.

function veld(tekst, min, max) {
  const uit = new Set();
  for (const deel of String(tekst).split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(deel);
    if (!m) throw new Error(`cronveld "${tekst}" is niet te lezen`);
    const stap = m[2] === undefined ? 1 : Number(m[2]);
    if (stap < 1) throw new Error(`cronveld "${tekst}": stap moet minstens 1 zijn`);
    let van = min;
    let tot = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      van = a;
      tot = b === undefined ? (m[2] === undefined ? a : max) : b;
    }
    if (van < min || tot > max || van > tot) {
      throw new Error(`cronveld "${tekst}" valt buiten ${min}-${max}`);
    }
    for (let i = van; i <= tot; i += stap) uit.add(i);
  }
  return [...uit].sort((x, y) => x - y);
}

// Geeft de minuten-van-de-dag waarop de cron afgaat, gesorteerd.
export function rondeMomenten(schema) {
  const velden = String(schema).trim().split(/\s+/);
  if (velden.length !== 5) throw new Error(`cronschema "${schema}" heeft geen vijf velden`);
  const [min, uur, dag, maand, week] = velden;
  if (dag !== "*" || maand !== "*" || week !== "*") {
    throw new Error(`cronschema "${schema}" beperkt dag, maand of weekdag; dat leest deze toets niet`);
  }
  const minuten = veld(min, 0, 59);
  const uren = veld(uur, 0, 23);
  const uit = [];
  for (const u of uren) for (const m of minuten) uit.push(u * 60 + m);
  return uit;
}

export function rondesPerEtmaal(schema) {
  return rondeMomenten(schema).length;
}

// Langste tussenpoos in minuten tussen twee opeenvolgende rondes, inclusief de
// sprong over middernacht. Een schema met één ronde per etmaal geeft 1440.
export function langsteTussenpoosMin(schema) {
  const t = rondeMomenten(schema);
  if (!t.length) return Infinity;
  let max = t[0] + 1440 - t[t.length - 1];
  for (let i = 1; i < t.length; i += 1) max = Math.max(max, t[i] - t[i - 1]);
  return max;
}
