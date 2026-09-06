// Wat er gebeurt als het tokenplafond opgaat aan denkwerk.
// ---------------------------------------------------------------------------
// AANLEIDING. Sinds 4 september 2026 16:12 werd er geen persconcept meer
// aangemaakt. De diagnosestand van 6 september wees uit dat de keten tot en met
// de kandidaten gezond was: vijf clusters boven de tweebronnendrempel, geen
// enkele blokkade, ruimte 50, limiet 2. De keten kwam dus tot de aanroep.
//
// DE AANROEP ZELF. max_tokens is het plafond voor DENKEN ÉN ANTWOORD samen —
// de SDK-typen zeggen het met zoveel woorden: adaptief denken "counts towards
// your max_tokens limit". Op claude-opus-5 staat adaptief denken AAN zodra je
// het veld `thinking` weglaat; op de vorige generatie betekende weglaten juist
// niet denken. Met AI_CONFIG.maxTokens op 2000 kreeg het model dus 2000 tokens
// voor denkwerk plus 150-250 Nederlandse woorden, en op een lastig cluster gaat
// dat plafond volledig op aan denken. Wat er dan terugkomt is een antwoord met
// stop_reason "max_tokens" en NUL tekstblokken.
//
// Dat was één regel: `if (!ruw) throw new Error("Lege synthese ontvangen.")`.
// Die fout werd in api/cron.js opgevangen en belandde in het antwoord dat
// niemand leest. Geen logregel, geen teller, geen zichtbaar verschil met een
// rustige nieuwsdag — veertig uur lang.
//
// Deze toetsen draaien de ECHTE SDK tegen een gemockte fetch, met precies de
// antwoordvorm die de API in dat geval teruggeeft. Wat vastligt: de fout noemt
// de oorzaak en de knop, en een normaal antwoord blijft gewoon werken.

import test from "node:test";
import assert from "node:assert/strict";

process.env.ANTHROPIC_API_KEY = "sk-ant-test";

const { AI_CONFIG } = await import("../lib/config.js");
const { synthetiseer, samenvatOverheid } = await import("../lib/synthese.js");

// Het antwoord van de API, in de vorm die de SDK verwacht.
function antwoord({ content, stop_reason, output_tokens = 0 }) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: AI_CONFIG.model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens },
  };
}

let laatsteBody = null;
function zetApiOp(body) {
  globalThis.fetch = async (url, opties = {}) => {
    laatsteBody = JSON.parse(opties.body);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json", "request-id": "req_test" },
    });
  };
}

const cluster = {
  sleutel: "1mow509",
  items: [
    { bron: "Le Monde — À la une", titel: "Canicule : quinze départements en vigilance rouge", url: "https://www.lemonde.fr/a", datum: "2026-09-06T06:00:00.000Z" },
    // Bewust een ANDERE formulering dan Le Monde: twee kranten die dezelfde kop
    // overnemen tellen samen als één bron (wire-copy), en dan meet deze toets
    // die regel in plaats van het tokenplafond.
    { bron: "Le Figaro — Actualités", titel: "Chaleur extrême : Météo-France alerte sur le Rhône et l'Isère", url: "https://www.lefigaro.fr/b", datum: "2026-09-06T06:30:00.000Z" },
    { bron: "Franceinfo — Titres", titel: "Canicule : quinze départements placés en vigilance rouge", url: "https://www.francetvinfo.fr/c", datum: "2026-09-06T07:00:00.000Z" },
  ],
  onafhankelijkeBronnen: 3,
  aantalBronnen: 3,
  kernTokens: ["canicule", "departements", "vigilance"],
  laatste: "2026-09-06T07:00:00.000Z",
  prioriteit: true,
};

// Het denkblok komt met lege tekst terug: `display` staat op dit model
// standaard op "omitted". Het denkwerk is wél gebeurd en wél betaald.
const ALLEEN_DENKEN = [{ type: "thinking", thinking: "", signature: "sig" }];

test("een plafond dat opgaat aan denkwerk noemt zichzelf, met de knop erbij", async () => {
  zetApiOp(antwoord({ content: ALLEEN_DENKEN, stop_reason: "max_tokens", output_tokens: AI_CONFIG.maxTokens }));
  await assert.rejects(
    () => synthetiseer(cluster),
    (e) => {
      // De vier dingen die een redacteur of beheerder nodig heeft om dit op te
      // lossen zonder de code te lezen.
      assert.match(e.message, /max_tokens/, "de stop_reason hoort erin");
      assert.match(e.message, new RegExp(String(AI_CONFIG.maxTokens)), "het plafond hoort erin");
      assert.match(e.message, /denkwerk/, "waar het plafond aan opging hoort erin");
      assert.match(e.message, /AI_CONFIG\.maxTokens of verlaag AI_CONFIG\.effort/, "wat je eraan doet hoort erin");
      return true;
    }
  );
});

test("dezelfde storing bij de overheidssamenvatting, met haar eigen naam", async () => {
  zetApiOp(antwoord({ content: ALLEEN_DENKEN, stop_reason: "max_tokens", output_tokens: AI_CONFIG.maxTokens }));
  await assert.rejects(
    () => samenvatOverheid({ bron: "Bercy", titel: "Nouveau barème", samenvatting: "Texte." }),
    (e) => {
      assert.match(e.message, /Lege overheidssamenvatting/);
      assert.match(e.message, /max_tokens/);
      return true;
    }
  );
});

test("een leeg antwoord zonder max_tokens noemt de stop_reason die er wél was", async () => {
  zetApiOp(antwoord({ content: [], stop_reason: "end_turn", output_tokens: 0 }));
  await assert.rejects(
    () => synthetiseer(cluster),
    (e) => {
      assert.match(e.message, /stop_reason=end_turn/);
      assert.doesNotMatch(e.message, /Verhoog AI_CONFIG/, "geen advies dat hier niet helpt");
      return true;
    }
  );
});

test("een normaal antwoord levert gewoon een synthese op", async () => {
  zetApiOp(
    antwoord({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        {
          type: "text",
          text:
            "Vijftien departementen in code rood om de hitte\n\n" +
            "Vijftien Franse departementen staan sinds zondagochtend in de hoogste waarschuwingsgraad " +
            "voor hitte. Franse media melden temperaturen boven veertig graden in het Rhônedal.\n\n" +
            "GEBRUIKT: https://www.lemonde.fr/a, https://www.lefigaro.fr/b",
        },
      ],
      stop_reason: "end_turn",
      output_tokens: 420,
    })
  );
  const synth = await synthetiseer(cluster);
  assert.equal(synth.kop, "Vijftien departementen in code rood om de hitte");
  assert.match(synth.tekst, /^Vijftien Franse departementen/);
  assert.equal(synth.bronnen.length, 2, "alleen de bronnen uit de GEBRUIKT-regel");
  assert.equal(synth.onafhankelijkeGebruikt, 2);
  assert.equal(synth.afgekapt, false);
});

test("een afgekapt maar niet leeg antwoord komt door, en meldt dat het afgekapt is", async () => {
  zetApiOp(
    antwoord({
      content: [{ type: "text", text: "Kop over de hitte\n\nDe tekst houdt midden in een" }],
      stop_reason: "max_tokens",
      output_tokens: AI_CONFIG.maxTokens,
    })
  );
  const synth = await synthetiseer(cluster);
  assert.equal(synth.afgekapt, true, "de reviewtool toont hier 'mogelijk afgekapt' bij");
});

test("het verzoek maakt expliciet dat er adaptief gedacht wordt", async () => {
  zetApiOp(antwoord({ content: [{ type: "text", text: "Kop\n\nTekst." }], stop_reason: "end_turn", output_tokens: 40 }));
  await synthetiseer(cluster);
  // Weglaten betekent op claude-opus-5 "denk adaptief" en op de vorige
  // generatie "denk niet". Expliciet zijn houdt een modelwissel eerlijk.
  assert.deepEqual(laatsteBody.thinking, { type: "adaptive" });
  assert.equal(laatsteBody.max_tokens, AI_CONFIG.maxTokens);
  assert.deepEqual(laatsteBody.output_config, { effort: AI_CONFIG.effort });
});

test("het plafond is ruim genoeg voor denkwerk plus een Nederlandse synthese", () => {
  // 250 woorden Nederlands kosten ruwweg 400 tokens; de rest is denkruimte.
  // Deze ondergrens is de reden dat 2000 niet werkte en legt vast dat niemand
  // hem ongemerkt terugzet.
  assert.ok(
    AI_CONFIG.maxTokens >= 4000,
    `max_tokens is het plafond voor denken én antwoord samen; ${AI_CONFIG.maxTokens} is te krap`
  );
});
