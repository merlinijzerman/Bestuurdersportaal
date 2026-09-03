// ============================================================
//  Sanity-tests voor core/lib/vraag-context.ts — Plateau 1.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/vraag-context.sanity.ts
//
//  Dekt de meerbeurten-meetset uit de werkopdracht (§7) op resolverniveau met
//  een gestubde modelcall: scenario 1–6, 8, 10, 11, plus de pure parse-, modus-
//  en transcriptregels. De regressie "welke vraag de classifiers écht ontvangen"
//  wordt in tests/cross-tenant/vraag-context-route.test.ts geborgd.
// ============================================================

import assert from "node:assert/strict";
import {
  resolveChatcontextModus,
  parseModelBeoordeling,
  bouwContextTranscript,
  resolveVraagContext,
  contextTelemetrie,
  type Beurt,
  type ResolverMeting,
  type ModelBeoordeling,
} from "./vraag-context";

let n = 0;
function check(naam: string, fn: () => void | Promise<void>) {
  const r = fn();
  if (r instanceof Promise) throw new Error(`async check '${naam}' niet afgewacht`);
  n++;
  console.log(`  ✓ ${naam}`);
}
const asyncChecks: Array<[string, () => Promise<void>]> = [];
function acheck(naam: string, fn: () => Promise<void>) {
  asyncChecks.push([naam, fn]);
}

// Stub-fabriek: levert een `roepModelAan` die vaste tekst + meting teruggeeft en
// telt hoe vaak hij is aangeroepen.
function stub(tekst: string, meting?: Partial<ResolverMeting>) {
  const state = { calls: 0 };
  const fn = async () => {
    state.calls++;
    return {
      tekst,
      meting: {
        model: "claude-sonnet-4-6",
        duurMs: 120,
        tokensIn: 200,
        tokensOut: 40,
        timeout: false,
        modelAangeroepen: true,
        ...meting,
      } as ResolverMeting,
    };
  };
  return { fn, state };
}
function json(b: ModelBeoordeling): string {
  return JSON.stringify(b);
}

const HIST: Beurt[] = [
  { role: "user", content: "Wat betekent de solidariteitsreserve?" },
  { role: "assistant", content: "De solidariteitsreserve is een collectieve buffer …" },
];

console.log("vraag-context sanity-tests:");

// ── resolveChatcontextModus (puur) ───────────────────────────────────────────
check("modus-resolver: off | observe | enforce, fail-safe naar off", () => {
  assert.equal(resolveChatcontextModus("off"), "off");
  assert.equal(resolveChatcontextModus("observe"), "observe");
  assert.equal(resolveChatcontextModus("enforce"), "enforce");
  assert.equal(resolveChatcontextModus("ENFORCE"), "enforce");
  assert.equal(resolveChatcontextModus("  observe "), "observe");
  assert.equal(resolveChatcontextModus(""), "off");
  assert.equal(resolveChatcontextModus(undefined), "off");
  assert.equal(resolveChatcontextModus(null), "off");
  assert.equal(resolveChatcontextModus("aan"), "off");
});

// ── parseModelBeoordeling (puur) ─────────────────────────────────────────────
check("parse: geldig JSON", () => {
  const b = parseModelBeoordeling(
    '{"relatie":"vervolg","effectieveVraag":"X van Y","onderwerp":"Y","vertrouwen":"hoog"}'
  );
  assert.equal(b?.relatie, "vervolg");
  assert.equal(b?.effectieveVraag, "X van Y");
  assert.equal(b?.onderwerp, "Y");
  assert.equal(b?.vertrouwen, "hoog");
});

check("parse: JSON met omringende tekst / codefence", () => {
  const b = parseModelBeoordeling(
    'Hier is het:\n```json\n{"relatie":"nieuw_onderwerp","effectieveVraag":"Wat doet DNB?","onderwerp":null,"vertrouwen":"middel"}\n```'
  );
  assert.equal(b?.relatie, "nieuw_onderwerp");
  assert.equal(b?.onderwerp, null);
});

check("parse: ongeldige enum → null", () => {
  assert.equal(
    parseModelBeoordeling('{"relatie":"iets","effectieveVraag":"x","vertrouwen":"hoog"}'),
    null
  );
  assert.equal(
    parseModelBeoordeling('{"relatie":"vervolg","effectieveVraag":"x","vertrouwen":"zeker"}'),
    null
  );
});

check("parse: ontbrekend/leeg/te lang veld → null", () => {
  assert.equal(parseModelBeoordeling('{"relatie":"vervolg","vertrouwen":"hoog"}'), null);
  assert.equal(
    parseModelBeoordeling('{"relatie":"vervolg","effectieveVraag":"   ","vertrouwen":"hoog"}'),
    null
  );
  const lang = "a".repeat(400);
  assert.equal(
    parseModelBeoordeling(`{"relatie":"vervolg","effectieveVraag":"${lang}","vertrouwen":"hoog"}`),
    null
  );
});

check("parse: geen JSON → null", () => {
  assert.equal(parseModelBeoordeling("sorry, geen idee"), null);
  assert.equal(parseModelBeoordeling(""), null);
});

// ── bouwContextTranscript (puur) — scenario 7 (lang antwoord) ────────────────
check("transcript houdt de laatste gebruikersvraag als anker, kort lang antwoord in", () => {
  const langAntwoord = "x".repeat(5000);
  const t = bouwContextTranscript([
    { role: "user", content: "Wat betekent de solidariteitsreserve?" },
    { role: "assistant", content: langAntwoord },
  ]);
  assert.equal(t.includes("Wat betekent de solidariteitsreserve?"), true);
  assert.equal(t.includes("…"), true, "lang antwoord moet ingekort zijn");
  assert.equal(t.length < 1200, true, "transcript blijft compact");
});

// ── Resolver: scenario 8 — geen historie, geen modelcall ─────────────────────
acheck("scenario 8: eerste beurt → geen modelcall, effectief == origineel", async () => {
  const s = stub("{}");
  const ctx = await resolveVraagContext({
    origineleVraag: "Wat betekent de solidariteitsreserve?",
    priorBeurten: [],
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(s.state.calls, 0);
  assert.equal(ctx.relatie, "eerste_beurt");
  assert.equal(ctx.effectieveVraag, ctx.origineleVraag);
  assert.equal(ctx.historieGebruikt, false);
  assert.equal(ctx.resolvermethode, "geen_historie");
});

acheck("speciaal pad: magResolveren=false → overgeslagen, geen modelcall", async () => {
  const s = stub("{}");
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: false,
    roepModelAan: s.fn,
  });
  assert.equal(s.state.calls, 0);
  assert.equal(ctx.resolvermethode, "overgeslagen");
  assert.equal(ctx.effectieveVraag, ctx.origineleVraag);
});

// ── Scenario 1 — impliciete vervolgopdracht ──────────────────────────────────
acheck("scenario 1: 'Breng het wettelijke kader in kaart.' → effectief bevat onderwerp", async () => {
  const s = stub(
    json({
      relatie: "vervolg",
      effectieveVraag: "Breng het wettelijke kader van de solidariteitsreserve in kaart",
      onderwerp: "solidariteitsreserve",
      vertrouwen: "hoog",
    })
  );
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.relatie, "vervolg");
  assert.equal(ctx.effectieveVraag.toLowerCase().includes("solidariteitsreserve"), true);
  assert.equal(ctx.afgedwongen, true);
  assert.equal(ctx.historieGebruikt, true);
  assert.equal(ctx.modelAangeroepen, true, "een vervolgresultaat kwam uit een providercall");
  // De originele vraag blijft ongemoeid (zichtbaar/opgeslagen).
  assert.equal(ctx.origineleVraag, "Breng het wettelijke kader in kaart.");
});

// ── Scenario 2 — risico-vervolg gerelateerd aan onderwerp A ──────────────────
acheck("scenario 2: risico's worden aan het onderwerp gerelateerd", async () => {
  const s = stub(
    json({
      relatie: "vervolg",
      effectieveVraag: "Welke risico's ziet het bestuur bij de solidariteitsreserve?",
      onderwerp: "solidariteitsreserve",
      vertrouwen: "hoog",
    })
  );
  const ctx = await resolveVraagContext({
    origineleVraag: "Welke risico's ziet het bestuur?",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.effectieveVraag.toLowerCase().includes("solidariteitsreserve"), true);
});

// ── Scenario 3 — expliciete anafoor 'hiervoor' ───────────────────────────────
acheck("scenario 3: 'hiervoor' wordt opgelost", async () => {
  const s = stub(
    json({
      relatie: "vervolg",
      effectieveVraag: "Welk wettelijk kader geldt voor de solidariteitsreserve?",
      onderwerp: "solidariteitsreserve",
      vertrouwen: "hoog",
    })
  );
  const ctx = await resolveVraagContext({
    origineleVraag: "Welk wettelijk kader geldt hiervoor?",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.effectieveVraag.toLowerCase().includes("solidariteitsreserve"), true);
  assert.equal(ctx.effectieveVraag.toLowerCase().includes("hiervoor"), false);
});

// ── Scenario 4 — expliciete onderwerpwisseling ───────────────────────────────
acheck("scenario 4: onderwerpwisseling → geen oud onderwerp plakken (afgedwongen)", async () => {
  // Zelfs als het model per ongeluk het oude onderwerp aan effectieveVraag plakt,
  // dwingt de resolver bij nieuw_onderwerp effectief = origineel af.
  const s = stub(
    json({
      relatie: "nieuw_onderwerp",
      effectieveVraag: "Wat is de rol van DNB bij de solidariteitsreserve?",
      onderwerp: null,
      vertrouwen: "hoog",
    })
  );
  const ctx = await resolveVraagContext({
    origineleVraag: "Andere vraag: wat is de rol van DNB?",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.relatie, "nieuw_onderwerp");
  assert.equal(ctx.effectieveVraag, "Andere vraag: wat is de rol van DNB?");
  assert.equal(ctx.effectieveVraag.toLowerCase().includes("solidariteitsreserve"), false);
  assert.equal(ctx.afgedwongen, false);
});

// ── Scenario 5 — zelfstandige nieuwe vraag blijft zelfstandig ────────────────
acheck("scenario 5: zelfstandige vraag blijft zelfstandig", async () => {
  const vraag = "Wat is het verschil tussen een APF en een OPF?";
  const s = stub(
    json({ relatie: "nieuw_onderwerp", effectieveVraag: vraag, onderwerp: null, vertrouwen: "hoog" })
  );
  const ctx = await resolveVraagContext({
    origineleVraag: vraag,
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.effectieveVraag, vraag);
  assert.equal(ctx.afgedwongen, false);
});

// ── Scenario 6 — vergelijking bevat beide onderwerpen ────────────────────────
acheck("scenario 6: vergelijking behoudt beide onderwerpen", async () => {
  const s = stub(
    json({
      relatie: "vervolg",
      effectieveVraag: "Vergelijk de solidariteitsreserve met de bestemmingsreserve",
      onderwerp: "solidariteitsreserve",
      vertrouwen: "hoog",
    })
  );
  const ctx = await resolveVraagContext({
    origineleVraag: "Vergelijk dit met de bestemmingsreserve.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.effectieveVraag.toLowerCase().includes("solidariteitsreserve"), true);
  assert.equal(ctx.effectieveVraag.toLowerCase().includes("bestemmingsreserve"), true);
});

// ── Lage zekerheid ───────────────────────────────────────────────────────────
acheck("laag vertrouwen: origineel leidend, methode model_laag_vertrouwen", async () => {
  const s = stub(
    json({
      relatie: "vervolg",
      effectieveVraag: "Iets met de solidariteitsreserve",
      onderwerp: "solidariteitsreserve",
      vertrouwen: "laag",
    })
  );
  const ctx = await resolveVraagContext({
    origineleVraag: "En dan?",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.effectieveVraag, "En dan?");
  assert.equal(ctx.resolvermethode, "model_laag_vertrouwen");
  assert.equal(ctx.afgedwongen, false);
  // De kandidaatvraag blijft wél bewaard voor observe-audit.
  assert.equal(ctx.kandidaatVraag.toLowerCase().includes("solidariteitsreserve"), true);
});

// ── Scenario 10 — timeout / onparseerbaar / fout / leeg → fallback ───────────
acheck("scenario 10a: timeout → fallback, effectief == origineel", async () => {
  const s = stub("", { timeout: true });
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.resolvermethode, "fallback");
  assert.equal(ctx.fallbackReden, "timeout");
  assert.equal(ctx.effectieveVraag, ctx.origineleVraag);
  // Timeout ná callstart = de providercall is wél gestart.
  assert.equal(ctx.modelAangeroepen, true, "timeout na callstart telt als modelcall");
});

acheck("poortweigering vóór de call → geen modelcall, reden poort_geweigerd", async () => {
  // Een lege respons met modelAangeroepen=false modelleert een poortweigering
  // (bewaakteAnthropic weigerde vóór client.messages.create).
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub("", { modelAangeroepen: false }).fn,
  });
  assert.equal(ctx.resolvermethode, "fallback");
  assert.equal(ctx.fallbackReden, "poort_geweigerd");
  assert.equal(ctx.modelAangeroepen, false, "een poortweigering is GEEN modelcall");
  assert.equal(ctx.effectieveVraag, ctx.origineleVraag);
});

acheck("scenario 10b: onparseerbaar → fallback 'onparseerbaar'", async () => {
  const s = stub("volstrekt geen json");
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.fallbackReden, "onparseerbaar");
  assert.equal(ctx.effectieveVraag, ctx.origineleVraag);
});

acheck("scenario 10c: modelfout (throw) → fallback 'modelfout'", async () => {
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: async () => {
      throw new Error("boem");
    },
  });
  assert.equal(ctx.fallbackReden, "modelfout");
  assert.equal(ctx.effectieveVraag, ctx.origineleVraag);
});

acheck("scenario 10d: echte lege succesvolle respons → 'lege_respons', modelcall wél", async () => {
  // Succesvolle call (modelAangeroepen true, geen timeout, geen foutreden) maar
  // lege tekst → lege_respons. Onderscheiden van poort_geweigerd en providerfout.
  const s = stub("   ");
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: s.fn,
  });
  assert.equal(ctx.fallbackReden, "lege_respons");
  assert.equal(ctx.modelAangeroepen, true);
});

// ── Onderscheidbare fallbackredenen (correctieronde) ─────────────────────────
acheck("providerfout ná callstart → reden 'providerfout' (niet uit lege tekst afgeleid)", async () => {
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub("", { modelAangeroepen: true, foutreden: "providerfout" }).fn,
  });
  assert.equal(ctx.resolvermethode, "fallback");
  assert.equal(ctx.fallbackReden, "providerfout");
  assert.equal(ctx.modelAangeroepen, true, "de call was gestart");
  assert.equal(ctx.effectieveVraag, ctx.origineleVraag);
});

acheck("geldige respons draagt de EXPLICIET gemeten modelAangeroepen-waarde", async () => {
  // Bewijs dat de valid-branch de meting gebruikt en niet hardcoded true: een
  // (contrafeitelijke) meting met modelAangeroepen=false komt onverkort door.
  const valid =
    '{"relatie":"vervolg","effectieveVraag":"Breng het wettelijke kader van de solidariteitsreserve in kaart","onderwerp":"solidariteitsreserve","vertrouwen":"hoog"}';
  const waar = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub(valid, { modelAangeroepen: true }).fn,
  });
  assert.equal(waar.relatie, "vervolg");
  assert.equal(waar.modelAangeroepen, true);
  const gemetenFalse = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub(valid, { modelAangeroepen: false }).fn,
  });
  assert.equal(gemetenFalse.relatie, "vervolg");
  assert.equal(gemetenFalse.modelAangeroepen, false, "meting leidt, niet hardcoded true");
});

// ── Scenario 11 — observe vs enforce ─────────────────────────────────────────
acheck("scenario 11: observe berekent dezelfde vraag maar dwingt niet af", async () => {
  const beoordeling = json({
    relatie: "vervolg",
    effectieveVraag: "Breng het wettelijke kader van de solidariteitsreserve in kaart",
    onderwerp: "solidariteitsreserve",
    vertrouwen: "hoog",
  });
  const observe = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "observe",
    magResolveren: true,
    roepModelAan: stub(beoordeling).fn,
  });
  const enforce = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub(beoordeling).fn,
  });
  assert.equal(observe.afgedwongen, false, "observe dwingt nooit af");
  assert.equal(enforce.afgedwongen, true, "enforce dwingt af");
  // Beide leggen dezelfde kandidaatvraag vast (auditbaar).
  assert.equal(observe.kandidaatVraag, enforce.kandidaatVraag);
});

// ── Telemetrie-vorm ──────────────────────────────────────────────────────────
acheck("telemetrie: bevat geen letterlijke vraag, wel meetmetadata", async () => {
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub(
      json({
        relatie: "vervolg",
        effectieveVraag: "Breng het wettelijke kader van de solidariteitsreserve in kaart",
        onderwerp: "solidariteitsreserve",
        vertrouwen: "hoog",
      })
    ).fn,
  });
  const t = contextTelemetrie(ctx, "enforce");
  const jsonStr = JSON.stringify(t);
  assert.equal(jsonStr.includes("wettelijke kader"), false, "geen vraagtekst in telemetrie");
  assert.equal(jsonStr.includes("solidariteitsreserve"), false, "geen onderwerp-tekst als basis");
  assert.equal(t.model, "claude-sonnet-4-6");
  assert.equal(typeof t.duur_ms, "number");
  assert.equal(t.afgedwongen, true);
  assert.equal(t.model_aangeroepen, true, "telemetrie legt de providercall expliciet vast");
});

// ── Uitvoeren ────────────────────────────────────────────────────────────────
(async () => {
  for (const [naam, fn] of asyncChecks) {
    await fn();
    n++;
    console.log(`  ✓ ${naam}`);
  }
  console.log(`\nAlle ${n} vraag-context sanity-checks groen.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
