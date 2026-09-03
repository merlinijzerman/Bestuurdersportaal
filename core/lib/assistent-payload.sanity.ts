// ============================================================================
//  CONTRACTTEST op de payload naar /api/chat (P1a C2, besluit 0201).
// ----------------------------------------------------------------------------
//  Dit is het vangnet onder de laagsplitsing, en het dekt twee verschillende
//  risico's die je niet met één test tegelijk afdekt:
//
//  1. VERSCHRALING. De agendapuntchat stuurt 9 van de 24 velden, omdat zij een
//     kopie van een oudere aanroep is die niet is meegegroeid. Niemand heeft dat
//     verschil ontworpen en aan de interface zie je het niet. §"volledigheid"
//     hieronder maakt een weggevallen veld zichtbaar.
//
//  2. TRANSCRIPTIEFOUT BIJ DE VERHUIZING. `bouwChatPayload` is een letterlijke
//     overname van het object-literal dat in `AssistentClient.tsx` stond. Zou
//     deze test alleen golden fixtures bevatten die mét die bouwer zijn
//     opgenomen, dan bakt een fout in de bouwer zichzelf in de fixture: de test
//     bewijst dan alleen dat latere stappen gelijk zijn aan de eerste, niet dat
//     de eerste gelijk is aan de ORIGINELE code.
//
//     Daarom staat hieronder `referentieLiteral()`: een BEVROREN, met de hand
//     overgenomen kopie van het origineel uit `AssistentClient.tsx` op
//     origin/preview (8f74663, r. 1265-1362). Dat is een OPZETTELIJKE duplicatie
//     — niet-DRY, en dat hoort zo: een referentie die uit de implementatie wordt
//     afgeleid bewijst niets. Alleen de closure-variabelen zijn vervangen door
//     velden van de invoer; verder is er geen letter veranderd.
//
//     Te controleren met:
//       git show origin/preview:'app/(dashboard)/ai/_components/AssistentClient.tsx' \
//         | sed -n '1265,1362p'
//
//  ONDERHOUD. Verandert de payload bewust, dan wijzig je ÉÉRST de referentie
//  hieronder en pas daarna de bouwer — nooit andersom, en nooit alleen de
//  fixture. De referentie is de eis; de bouwer is de implementatie.
// ============================================================================

import assert from "node:assert/strict";
import {
  bouwChatPayload,
  CHAT_PAYLOAD_VELDEN,
  type ChatPayloadInvoer,
} from "./assistent-payload";

let n = 0;
const check = (naam: string, fn: () => void) => {
  fn();
  n += 1;
  console.log(`  ✓ ${naam}`);
};

console.log("assistent-payload sanity-tests:");

// ─────────────────────────────────────────────────────────────────────────────
//  De bevroren referentie — letterlijke kopie van het origineel.
//  RAAK DIT NIET AAN om een test groen te krijgen. Zie de kop.
// ─────────────────────────────────────────────────────────────────────────────
function referentieLiteral(invoer: ChatPayloadInvoer): Record<string, unknown> {
  const {
    messages,
    fondsId,
    alleenFondsdocumenten,
    algemeenPerspectief,
    voorbereidingsstand,
    herkomst,
    documentScope: effScope,
    antwoordmodus: effAntwoordmodus,
    agendapuntContext,
    moduleScope,
    gesprekId,
    opties,
  } = invoer;

  return {
    messages,
    fonds_id: fondsId,
    alleen_fondsdocumenten: alleenFondsdocumenten,
    bron_intent_override: opties?.bronIntentOverride ?? herkomst?.intent,
    bron_intent_bron:
      opties?.bronIntentBron ?? (herkomst ? "herkomst" : undefined),
    bron_intent_herkomst: herkomst?.module,
    document_scope: effScope
      ? {
          document_ids: effScope.document_ids,
          algemene_kennis: effScope.algemene_kennis === true,
        }
      : undefined,
    actieve_antwoordmodus: effAntwoordmodus,
    algemeen_perspectief: algemeenPerspectief,
    transformatie: opties?.transformatie === true,
    agendapunt_context: agendapuntContext
      ? { id: agendapuntContext.id, titel: agendapuntContext.titel }
      : undefined,
    module_scope: moduleScope
      ? {
          soort: moduleScope.soort,
          ...(moduleScope.procedure_id
            ? { procedure_id: moduleScope.procedure_id }
            : {}),
          ...(moduleScope.risico_id ? { risico_id: moduleScope.risico_id } : {}),
        }
      : undefined,
    doorgrond: opties?.doorgrond
      ? {
          secties: opties.doorgrond.secties,
          vorige_document_id: opties.doorgrond.vorigeId ?? undefined,
        }
      : undefined,
    stukvoorbereiding: opties?.stukvoorbereiding
      ? { stuksoort: opties.stukvoorbereiding.stuksoort }
      : undefined,
    startvraag_bron: opties?.startvraagBron,
    neem_niet_vastgestelde_mee:
      opties?.neemNietVastgesteldeMee === true || voorbereidingsstand,
    bronkeuze_vorige_log_id: opties?.bronkeuzeVorigeLogId,
    gesprek_id: gesprekId,
    reflectie_antwoord: opties?.reflectieAntwoord === true,
    reflectie_herformuleren: opties?.reflectieHerformuleren === true,
    reflectie_verdiepen: opties?.reflectieVerdiepen === true,
    reflectie_tegenperspectief: opties?.reflectieTegenperspectief === true,
    reflectie_start: opties?.reflectieStart
      ? {
          ingang: opties.reflectieStart.ingang,
          bronset_log_id: opties.reflectieStart.bronsetLogId ?? undefined,
        }
      : undefined,
    volledige_analyse: opties?.volledigeAnalyse
      ? {
          origineel_log_id: opties.volledigeAnalyse.origineelLogId,
          document_id: opties.volledigeAnalyse.documentId,
        }
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Drie representatieve scenario's (DoD: vrije vraag · documentscope ·
//  agendapunt-scope). Ze zijn zo gekozen dat ze samen élke tak in de bouwer
//  raken: beide zijden van elke ternary en van elke ?? -precedentie.
// ─────────────────────────────────────────────────────────────────────────────
const BASIS: ChatPayloadInvoer = {
  messages: [{ role: "user", content: "Wat is onze dekkingsgraad?" }],
  fondsId: "00000000-0000-4000-8000-000000000001",
  alleenFondsdocumenten: false,
  algemeenPerspectief: false,
  voorbereidingsstand: false,
  herkomst: null,
  documentScope: null,
  antwoordmodus: null,
  agendapuntContext: null,
  moduleScope: null,
  gesprekId: "00000000-0000-4000-8000-00000000c501",
};

const SCENARIOS: { naam: string; invoer: ChatPayloadInvoer }[] = [
  {
    naam: "vrije vraag",
    invoer: BASIS,
  },
  {
    naam: "documentscope",
    invoer: {
      ...BASIS,
      messages: [{ role: "user", content: "Vat dit stuk samen" }],
      alleenFondsdocumenten: true,
      algemeenPerspectief: true,
      voorbereidingsstand: true,
      antwoordmodus: "feitelijk",
      documentScope: {
        document_ids: ["00000000-0000-4000-8000-0000000d0c01"],
        titels: ["Verklaring beleggingsbeginselen"],
        algemene_kennis: true,
      },
      moduleScope: {
        soort: "risico",
        risico_id: "00000000-0000-4000-8000-0000000715c1",
        label: "Renterisico",
      },
      opties: {
        doorgrond: { secties: ["samenvatting"], vorigeId: null },
        startvraagBron: "voorbeeldvraag",
        bronIntentOverride: "fonds",
        bronIntentBron: "startvraag",
        transformatie: true,
      },
    },
  },
  {
    naam: "agendapunt-scope",
    invoer: {
      ...BASIS,
      messages: [
        { role: "user", content: "Waar moet ik op letten?" },
        { role: "assistant", content: "Drie punten." },
        { role: "user", content: "En het derde?" },
      ],
      herkomst: { intent: "fonds", module: "vergaderingen" },
      agendapuntContext: {
        id: "00000000-0000-4000-8000-0000000a9001",
        titel: "Vaststellen jaarrekening",
      },
      documentScope: {
        document_ids: ["00000000-0000-4000-8000-0000000d0c01"],
        titels: ["Jaarrekening 2025"],
      },
      moduleScope: {
        soort: "proces",
        procedure_id: "00000000-0000-4000-8000-00000000cd01",
        label: "Invaarprocedure",
      },
      opties: {
        reflectieStart: { ingang: "twijfel", bronsetLogId: null },
        neemNietVastgesteldeMee: true,
        bronkeuzeVorigeLogId: "00000000-0000-4000-8000-00000000109d",
        stukvoorbereiding: { stuksoort: "memo" },
        volledigeAnalyse: {
          origineelLogId: "00000000-0000-4000-8000-00000000109e",
          documentId: "00000000-0000-4000-8000-0000000d0c01",
        },
      },
    },
  },
];

// ── 1. Gelijkheid aan de bevroren referentie ────────────────────────────────
for (const { naam, invoer } of SCENARIOS) {
  check(`bouwer is identiek aan het origineel — ${naam}`, () => {
    assert.deepStrictEqual(bouwChatPayload(invoer), referentieLiteral(invoer));
  });
}

// De precedentieregels apart, want daar zit de subtiliteit: een expliciete
// keuze in DEZE beurt gaat vóór de herkomst-ingang van het gesprek, en de
// werkstand OF de chip zet hetzelfde serverveld.
check("een chipkeuze in deze beurt wint van de herkomst-ingang", () => {
  const invoer: ChatPayloadInvoer = {
    ...BASIS,
    herkomst: { intent: "fonds", module: "risicomatrix" },
    opties: { bronIntentOverride: "algemeen", bronIntentBron: "chip" },
  };
  const p = bouwChatPayload(invoer);
  assert.deepStrictEqual(p, referentieLiteral(invoer));
  assert.equal(p.bron_intent_override, "algemeen");
  assert.equal(p.bron_intent_bron, "chip");
  // De herkomst zelf blijft in het auditspoor staan, ook als hij is overruled.
  assert.equal(p.bron_intent_herkomst, "risicomatrix");
});

check("zonder chipkeuze levert de herkomst-ingang de intentie én de bron", () => {
  const invoer: ChatPayloadInvoer = {
    ...BASIS,
    herkomst: { intent: "fonds", module: "bibliotheek" },
  };
  const p = bouwChatPayload(invoer);
  assert.deepStrictEqual(p, referentieLiteral(invoer));
  assert.equal(p.bron_intent_override, "fonds");
  assert.equal(p.bron_intent_bron, "herkomst");
});

check("werkstand én chip zetten allebei neem_niet_vastgestelde_mee", () => {
  const alleenStand = bouwChatPayload({ ...BASIS, voorbereidingsstand: true });
  const alleenChip = bouwChatPayload({
    ...BASIS,
    opties: { neemNietVastgesteldeMee: true },
  });
  const geen = bouwChatPayload(BASIS);
  assert.equal(alleenStand.neem_niet_vastgestelde_mee, true);
  assert.equal(alleenChip.neem_niet_vastgestelde_mee, true);
  assert.equal(geen.neem_niet_vastgestelde_mee, false);
});

check("module_scope draagt alleen de sleutel die er is, nooit het chip-label", () => {
  const proces = bouwChatPayload({
    ...BASIS,
    moduleScope: { soort: "proces", procedure_id: "p1", label: "Invaren" },
  });
  assert.deepStrictEqual(proces.module_scope, { soort: "proces", procedure_id: "p1" });

  const matrix = bouwChatPayload({
    ...BASIS,
    moduleScope: { soort: "risicomatrix", label: "de risicomatrix" },
  });
  assert.deepStrictEqual(matrix.module_scope, { soort: "risicomatrix" });
});

check("document_scope stuurt de ids, niet de titels", () => {
  const p = bouwChatPayload({
    ...BASIS,
    documentScope: { document_ids: ["d1"], titels: ["Geheime titel"] },
  });
  assert.deepStrictEqual(p.document_scope, {
    document_ids: ["d1"],
    algemene_kennis: false,
  });
  assert.ok(!JSON.stringify(p).includes("Geheime titel"));
});

// ── 2. Volledigheid: het vangnet tegen verschraling ─────────────────────────
check(`elke beurt draagt alle ${CHAT_PAYLOAD_VELDEN.length} velden`, () => {
  for (const { naam, invoer } of SCENARIOS) {
    const sleutels = Object.keys(bouwChatPayload(invoer));
    assert.deepStrictEqual(
      sleutels,
      [...CHAT_PAYLOAD_VELDEN],
      `scenario "${naam}" mist of hernoemt een payloadveld`
    );
  }
});

check("het auditspoor van een beurt is nooit stilzwijgend leeg", () => {
  // gesprek_id koppelt de auditregel aan het gesprek (plateau A) en is de
  // voorwaarde om een interactie later te kunnen verwijderen. Zonder deze
  // assertie zou een refactor hem ongemerkt op undefined kunnen zetten.
  for (const { naam, invoer } of SCENARIOS) {
    const p = bouwChatPayload(invoer);
    assert.equal(typeof p.gesprek_id, "string", `${naam}: gesprek_id ontbreekt`);
    assert.ok((p.gesprek_id as string).length > 0, `${naam}: gesprek_id is leeg`);
    assert.equal(typeof p.fonds_id, "string", `${naam}: fonds_id ontbreekt`);
  }
});

// ── 3. Golden fixtures — het verstuurde lichaam, byte-voor-byte ─────────────
//  Wat hier staat is wat er ECHT over de lijn gaat: `JSON.stringify` laat
//  undefined-velden weg, dus dit is de geserialiseerde vorm. Vastgelegd vóór de
//  verhuizing van de gespreks- en contextlaag; wijzigt hij daarna, dan is dat
//  per definitie een gedragswijziging.
const GOLDEN: Record<string, string> = {
  "vrije vraag":
    '{"messages":[{"role":"user","content":"Wat is onze dekkingsgraad?"}],"fonds_id":"00000000-0000-4000-8000-000000000001","alleen_fondsdocumenten":false,"actieve_antwoordmodus":null,"algemeen_perspectief":false,"transformatie":false,"neem_niet_vastgestelde_mee":false,"gesprek_id":"00000000-0000-4000-8000-00000000c501","reflectie_antwoord":false,"reflectie_herformuleren":false,"reflectie_verdiepen":false,"reflectie_tegenperspectief":false}',
  documentscope:
    '{"messages":[{"role":"user","content":"Vat dit stuk samen"}],"fonds_id":"00000000-0000-4000-8000-000000000001","alleen_fondsdocumenten":true,"bron_intent_override":"fonds","bron_intent_bron":"startvraag","document_scope":{"document_ids":["00000000-0000-4000-8000-0000000d0c01"],"algemene_kennis":true},"actieve_antwoordmodus":"feitelijk","algemeen_perspectief":true,"transformatie":true,"module_scope":{"soort":"risico","risico_id":"00000000-0000-4000-8000-0000000715c1"},"doorgrond":{"secties":["samenvatting"]},"startvraag_bron":"voorbeeldvraag","neem_niet_vastgestelde_mee":true,"gesprek_id":"00000000-0000-4000-8000-00000000c501","reflectie_antwoord":false,"reflectie_herformuleren":false,"reflectie_verdiepen":false,"reflectie_tegenperspectief":false}',
  "agendapunt-scope":
    '{"messages":[{"role":"user","content":"Waar moet ik op letten?"},{"role":"assistant","content":"Drie punten."},{"role":"user","content":"En het derde?"}],"fonds_id":"00000000-0000-4000-8000-000000000001","alleen_fondsdocumenten":false,"bron_intent_override":"fonds","bron_intent_bron":"herkomst","bron_intent_herkomst":"vergaderingen","document_scope":{"document_ids":["00000000-0000-4000-8000-0000000d0c01"],"algemene_kennis":false},"actieve_antwoordmodus":null,"algemeen_perspectief":false,"transformatie":false,"agendapunt_context":{"id":"00000000-0000-4000-8000-0000000a9001","titel":"Vaststellen jaarrekening"},"module_scope":{"soort":"proces","procedure_id":"00000000-0000-4000-8000-00000000cd01"},"stukvoorbereiding":{"stuksoort":"memo"},"neem_niet_vastgestelde_mee":true,"bronkeuze_vorige_log_id":"00000000-0000-4000-8000-00000000109d","gesprek_id":"00000000-0000-4000-8000-00000000c501","reflectie_antwoord":false,"reflectie_herformuleren":false,"reflectie_verdiepen":false,"reflectie_tegenperspectief":false,"reflectie_start":{"ingang":"twijfel"},"volledige_analyse":{"origineel_log_id":"00000000-0000-4000-8000-00000000109e","document_id":"00000000-0000-4000-8000-0000000d0c01"}}',
};

for (const { naam, invoer } of SCENARIOS) {
  check(`golden payload ongewijzigd — ${naam}`, () => {
    assert.equal(JSON.stringify(bouwChatPayload(invoer)), GOLDEN[naam]);
  });
}

console.log(`\n${n} sanity-tests geslaagd.`);
