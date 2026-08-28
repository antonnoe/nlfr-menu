// De schoolvakantiezin: tijdzone en de koppeling tussen naam en datum.
// ---------------------------------------------------------------------------
// TWEE FOUTEN die live hebben gestaan, en die deze tests moeten tegenhouden.
//
// (a) TIJDZONE. fmtDag() formatteerde zonder tijdzone terwijl de runtime op UTC
//     staat. De dataset zet de dagen op middernacht Parijse tijd (22:00Z in de
//     zomertijd, 23:00Z in de wintertijd), dus elke datum viel een dag te vroeg uit. Live stond: "De scholen beginnen
//     weer op 31 augustus; in Saint Pierre et Miquelon pas op 1 september, in
//     Corse pas op 2 september." Juist is 1, 2 en 3 september.
//
// (b) VERKEERDE VAKANTIENAAM. De naam kwam uit het eerste komende record van de
//     hele lijst — en dat was de septembervakantie van Polynésie — terwijl de
//     afgedrukte datums die van la Toussaint waren. Naam en datum hoorden bij
//     verschillende vakanties.
//
// DEZE TESTS DRAAIEN BEWUST OP TZ=UTC. Dat is de tijdzone van de productie-
// runtime, en het is de tijdzone waarin fout (a) zichtbaar wordt: vergeet de
// code de expliciete tijdzone weer, dan schuiven alle datums hier een dag terug
// en vallen deze tests om. Zou de test op Europe/Paris draaien, dan zou hij ook
// groen blijven mét de fout — precies wat we niet willen.

process.env.TZ = "UTC";

import test from "node:test";
import assert from "node:assert/strict";

const { bouwSchoolvakantieZin } = await import("../api/schoolvakanties.js");

// Vast recordfixture in de vorm van fr-en-calendrier-scolaire. De dataset zet
// elke dag op MIDDERNACHT PARIJSE TIJD, en die valt niet het hele jaar op
// dezelfde UTC-tijd: in de zomertijd (CEST, UTC+2) is dat 22:00Z, in de
// wintertijd (CET, UTC+1) 23:00Z. De zomerklok gaat in 2026 uit op 25 oktober,
// dus de Toussaint BEGINT op 22:00Z (16 okt -> 17 okt) en EINDIGT op 23:00Z
// (1 nov -> 2 nov). Precies dat verschil is de reden dat de code de tijdzone
// expliciet moet noemen in plaats van een vaste verschuiving aan te nemen.
const RECORDS = [
  zomer("Zone A", "Besançon", "2026-08-31T22:00:00+00:00"),
  zomer("Zone B", "Aix-Marseille", "2026-08-31T22:00:00+00:00"),
  zomer("Zone C", "Paris", "2026-08-31T22:00:00+00:00"),
  zomer("Corse", "Corse", "2026-09-02T22:00:00+00:00"),
  zomer("", "Saint Pierre et Miquelon", "2026-09-01T22:00:00+00:00"),
  // De valstrik van fout (b): een OVERZEESE vakantie die eerder begint dan de
  // metropolitane, en die dus vooraan in de lijst staat.
  {
    description: "Vacances de Septembre",
    start_date: "2026-09-11T22:00:00+00:00",
    end_date: "2026-09-27T22:00:00+00:00",
    zones: "",
    location: "Polynésie",
    population: "-",
  },
  toussaint("Zone A", "Besançon"),
  toussaint("Zone B", "Aix-Marseille"),
  toussaint("Zone C", "Paris"),
  toussaint("Corse", "Corse"),
];

function zomer(zones, location, end_date) {
  return {
    description: "Vacances d'Été",
    start_date: "2026-07-03T22:00:00+00:00",
    end_date,
    zones,
    location,
    population: "-",
  };
}
function toussaint(zones, location) {
  return {
    description: "Vacances de la Toussaint",
    start_date: "2026-10-16T22:00:00+00:00", // = 17 oktober, Parijse tijd
    end_date: "2026-11-01T23:00:00+00:00", // = 2 november, Parijse tijd (wintertijd)
    zones,
    location,
    population: "-",
  };
}

// De route haalt de dataset op met `where: end_date >= now()`; die filtering
// hoort dus ook in de test te zitten, anders toetsen we een lijst die de
// productiecode nooit te zien krijgt.
function zinOp(datumIso) {
  const nu = Date.parse(datumIso);
  assert.ok(!Number.isNaN(nu), `onbruikbare testdatum ${datumIso}`);
  return bouwSchoolvakantieZin(
    RECORDS.filter((r) => Date.parse(r.end_date) >= nu),
    nu
  );
}

// ---- (a) Tijdzone ---------------------------------------------------------

test("28 augustus: de reprise-datums staan in Parijse tijd, niet in UTC", () => {
  const zin = zinOp("2026-08-28T10:00:00+02:00");
  // Dit is de regel die live fout stond. 22:00Z op 31 augustus is middernacht
  // 1 september in Parijs.
  assert.match(zin, /De scholen beginnen weer op 1 september/);
  assert.match(zin, /in Saint Pierre et Miquelon pas op 2 september/);
  assert.match(zin, /in Corse pas op 3 september/);
  // En expliciet: de oude, een dag te vroege uitkomst mag niet meer voorkomen.
  assert.ok(!zin.includes("31 augustus"), "31 augustus is de UTC-fout");
  assert.ok(!zin.includes("op 1 september, in Corse pas op 2 september"), "de oude zin");
});

test("1 september: de metropool is weer begonnen, de rest nog niet", () => {
  // De metropoolrecords zijn dan uit de dataset gefilterd (end_date < now),
  // dus wat overblijft zijn Corse en Saint Pierre et Miquelon.
  const zin = zinOp("2026-09-01T10:00:00+02:00");
  assert.match(zin, /De scholen beginnen weer op 3 september/);
  assert.match(zin, /in Saint Pierre et Miquelon al op 2 september/);
  assert.ok(!zin.includes("2 september;"), "de gangbare datum is die van Corse, niet die van SPM");
});

// ---- (b) Naam en datum horen bij elkaar -----------------------------------

test("5 september: de genoemde vakantie is die van de genoemde zones", () => {
  const zin = zinOp("2026-09-05T10:00:00+02:00");
  // Dit is de zin die live zou hebben gestaan: de datums zijn die van la
  // Toussaint, dus de naam moet dat ook zijn — niet de septembervakantie van
  // Polynésie, die alleen maar eerder in de lijst stond.
  assert.match(zin, /^De eerstvolgende schoolvakantie \(Vacances de la Toussaint\) begint in /);
  assert.ok(!zin.includes("Vacances de Septembre"), "geen overzeese vakantie bij metropolitane datums");
  assert.ok(!zin.includes("Polynésie"), "en al helemaal geen overzeese regio");
  // Alle vier de metropoolzones, met de Parijse datum.
  assert.match(zin, /Zone A vanaf 17 oktober/);
  assert.match(zin, /Zone B vanaf 17 oktober/);
  assert.match(zin, /Zone C vanaf 17 oktober/);
  assert.match(zin, /Corse vanaf 17 oktober/);
  assert.ok(!zin.includes("16 oktober"), "16 oktober is opnieuw de UTC-fout");
});

test("5 september: zonder metropoolzones valt hij terug op één record, mét zijn eigen datum", () => {
  // Alleen de overzeese vakantie in de lijst: dan mag hij die wel noemen, maar
  // dan hoort er ook de datum van datzelfde record bij.
  const nu = Date.parse("2026-09-05T10:00:00+02:00");
  const alleen = RECORDS.filter((r) => r.location === "Polynésie");
  const zin = bouwSchoolvakantieZin(alleen, nu);
  assert.equal(zin, "De eerstvolgende schoolvakantie is Vacances de Septembre, vanaf 12 september.");
});

test("een zone waarvan de eerstvolgende vakantie een andere is, wordt niet meegenomen", () => {
  // Zone C krijgt hier eerst een eigen extra vakantie. Die zone hoort dan niet
  // onder de naam van la Toussaint te worden geschaard.
  const nu = Date.parse("2026-09-05T10:00:00+02:00");
  const extra = {
    description: "Vacances régionales",
    start_date: "2026-09-25T22:00:00+00:00",
    end_date: "2026-10-04T22:00:00+00:00",
    zones: "Zone C",
    location: "Paris",
    population: "-",
  };
  const zin = bouwSchoolvakantieZin(
    [...RECORDS.filter((r) => Date.parse(r.end_date) >= nu), extra],
    nu
  );
  assert.match(zin, /\(Vacances régionales\) begint in Zone C vanaf 26 september/);
  assert.ok(!zin.includes("Zone A"), "de zones met een andere eerstvolgende vakantie vallen weg");
});

// ---- Lopende, niet-zomerse vakantie ---------------------------------------

test("20 oktober: de lopende vakantie, met de einddatum in Parijse tijd", () => {
  const zin = zinOp("2026-10-20T10:00:00+02:00");
  assert.match(zin, /^Op dit moment heeft een deel van Frankrijk vakantie \(Vacances de la Toussaint\)/);
  assert.match(zin, /beginnen daar weer op 2 november\.$/);
  assert.ok(!zin.includes("1 november"), "1 november is opnieuw de UTC-fout");
  // In de WINTERTIJD is middernacht Parijs 23:00Z; een code die een vaste
  // verschuiving van twee uur zou aannemen valt hier alsnog om.
});

test("naam, regio's en einddatum van een lopende vakantie horen bij elkaar", () => {
  // Twee regio's met dezelfde vakantie maar een andere einddatum: de zin mag
  // alleen de regio's noemen waarvoor de genoemde datum ook echt klopt.
  const nu = Date.parse("2026-10-20T10:00:00+02:00");
  const laat = {
    description: "Vacances de la Toussaint",
    start_date: "2026-10-16T22:00:00+00:00",
    end_date: "2026-11-08T23:00:00+00:00", // een week langer (wintertijd)
    zones: "",
    location: "Mayotte",
    population: "-",
  };
  const zin = bouwSchoolvakantieZin([toussaint("Zone A", "Besançon"), laat], nu);
  assert.match(zin, /^Op dit moment heeft Zone A vakantie \(Vacances de la Toussaint\)/);
  assert.match(zin, /op 2 november\.$/);
  assert.ok(!zin.includes("Mayotte"), "Mayotte begint pas op 9 november en hoort hier niet bij");
});

// ---- Randgevallen ---------------------------------------------------------

test("een lege lijst levert een lege zin, geen fout", () => {
  assert.equal(bouwSchoolvakantieZin([], Date.now()), "");
});

test("docentenrecords tellen niet mee", () => {
  const nu = Date.parse("2026-09-05T10:00:00+02:00");
  const docent = { ...toussaint("Zone A", "Besançon"), population: "Enseignants" };
  assert.equal(bouwSchoolvakantieZin([docent], nu), "");
});
