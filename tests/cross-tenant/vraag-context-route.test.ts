// ============================================================================
//  §15-matrix — Plateau 1: contextvaste vervolgvragen. De chatroute, retrieval
//  en webprivacy zijn een tenantpad, dus deze suite hoort in de cross-tenant-
//  gate (auto-aangesloten via de glob in scripts/cross-tenant-ci.sh).
//
//  Twee lagen:
//   (A) BRON-INSPECTIE op app/api/chat/route.ts — borgt dat de effectieve vraag
//       de contextgevoelige classifiers/retrieval bereikt (en dat de skip-paden
//       de ruwe vraag houden), zónder de hele streaming-route te draaien.
//   (B) FLOW — met een gestubde modelcall: dezelfde effectieve vraag stuurt de
//       pure classifiers; PII wordt fail-closed op beide vraagvormen gecontroleerd.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/vraag-context-route.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveVraagContext, type Beurt } from "../../core/lib/vraag-context";
import { bepaalBronsoortprofiel } from "../../core/lib/weeg-bronsoort";
import { bepaalBronIntent } from "../../core/lib/vraagtype";
import { bevatPersoonsgegevens } from "../../core/lib/pii-gate";
import { beoordeelWebGate } from "../../core/lib/web-retrieval";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");
const ROUTE = lees("app", "api", "chat", "route.ts");

// ── (A) BRON-INSPECTIE ──────────────────────────────────────────────────────

test("A1 — de contextgevoelige classifiers krijgen de EFFECTIEVE vraag", () => {
  // Elk van deze callsites moet de effectieve vraag consumeren (matrix §4.2).
  const moet = [
    "bepaalBronIntent(effectieveVraag)",
    "routeerVraag(effectieveVraag",
    "vraag: effectieveVraag,", // verfijnVraagrouteMetModel
    "bepaalVergelijkIntent(effectieveVraag)",
    "bepaalVraagtype(effectieveVraag)",
    "bouwAnalyseplan(vraagRoute, effectieveVraag)",
    "bepaalAntwoordmodus(effectieveVraag)",
    "retrievalModusVoorVraag(antwoordmodus, effectieveVraag)",
    "bepaalBronsoortprofiel(effectieveVraag)",
    "heeftPortaalstandNodig(effectieveVraag)",
    "telNietActueleFondstreffers(effectieveVraag",
    "resolveerGenoemdDocument(\n        effectieveVraag",
  ];
  for (const frag of moet) {
    assert.ok(
      ROUTE.includes(frag),
      `route.ts moet de effectieve vraag doorgeven: \`${frag}\``
    );
  }
});

test("A2 — de ruwe `vraag` stuurt GEEN classifier meer (regressiewacht)", () => {
  // Deze exacte aanroepen mochten ná plateau 1 niet blijven staan.
  const magNiet = [
    "bepaalBronIntent(vraag)",
    "routeerVraag(vraag,",
    "bepaalVergelijkIntent(vraag)",
    "bepaalAntwoordmodus(vraag)",
    "retrievalModusVoorVraag(antwoordmodus, vraag)",
    "bepaalBronsoortprofiel(vraag)",
    "heeftPortaalstandNodig(vraag)",
    "telNietActueleFondstreffers(vraag",
  ];
  for (const frag of magNiet) {
    assert.ok(
      !ROUTE.includes(frag),
      `route.ts stuurt nog steeds de ruwe vraag: \`${frag}\``
    );
  }
});

test("A3 — de resolver draait VÓÓR de eerste contextgevoelige routering", () => {
  const iResolver = ROUTE.indexOf("await resolveVraagContext(");
  const iBronIntent = ROUTE.indexOf("bepaalBronIntent(effectieveVraag)");
  const iDoc = ROUTE.indexOf("resolveerGenoemdDocument(");
  assert.ok(iResolver > 0, "resolveVraagContext moet aangeroepen worden");
  assert.ok(iResolver < iBronIntent, "resolver vóór bronintentie");
  assert.ok(iResolver < iDoc, "resolver vóór documentnaam-detectie");
});

test("A4 — effectieve vraag stuurt alleen in enforce (off/observe = ruwe vraag)", () => {
  assert.ok(
    /const effectieveVraag\s*=\s*[\s\S]*contextModus === "enforce"[\s\S]*vraagContext[\s\S]*\?\s*vraagContext\.effectieveVraag\s*:\s*vraag;/.test(
      ROUTE
    ),
    "effectieveVraag mag alleen in enforce de effectieve waarde krijgen"
  );
});

test("A5 — PII wordt fail-closed op BEIDE vraagvormen gecontroleerd", () => {
  assert.ok(ROUTE.includes("bevatPersoonsgegevens(vraag, [fondsnaam])"), "origineel gecontroleerd");
  assert.ok(
    ROUTE.includes("bevatPersoonsgegevens(effectieveVraag, [fondsnaam])"),
    "effectieve vraag gecontroleerd"
  );
  assert.ok(
    ROUTE.includes("piiOrigineel.bevatPii || piiEffectief.bevatPii"),
    "de gate blokkeert zodra één van beide PII bevat"
  );
});

test("A6 — de speciale paden houden de ruwe `vraag` (reflectie/transformatie)", () => {
  assert.ok(
    ROUTE.includes("INBRENG VAN DE BESTUURDER: ${vraag}"),
    "reflectie/concept gebruikt de ruwe vraag"
  );
  assert.ok(
    ROUTE.includes("bewerk uw vorige antwoord hierboven in de berichtgeschiedenis): ${vraag}"),
    "transformatie gebruikt de ruwe vraag"
  );
});

test("A7 — origineel blijft leidend voor opslag/toon/zegel", () => {
  assert.ok(ROUTE.includes("p_vraag: vraag"), "opgeslagen uiting = origineel");
  assert.ok(ROUTE.includes("bouwInhoudZegel(vraag,"), "inhoudszegel = origineel");
  assert.ok(ROUTE.includes("isOpsteltaak(vraag)"), "toonregister = origineel");
});

// ── (B) FLOW met gestubde modelcall ─────────────────────────────────────────

const HIST: Beurt[] = [
  { role: "user", content: "Wat betekent de solidariteitsreserve?" },
  { role: "assistant", content: "De solidariteitsreserve is een collectieve buffer …" },
];
function stub(tekst: string) {
  return async () => ({
    tekst,
    meting: {
      model: "claude-sonnet-4-6",
      duurMs: 100,
      tokensIn: 150,
      tokensOut: 30,
      timeout: false,
      modelAangeroepen: true,
    },
  });
}

test("B1 — impliciete vervolgvraag: de classifiers zien het onderwerp", async () => {
  const ctx = await resolveVraagContext({
    origineleVraag: "Breng het wettelijke kader in kaart.",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub(
      '{"relatie":"vervolg","effectieveVraag":"Breng het wettelijke kader van de solidariteitsreserve in kaart","onderwerp":"solidariteitsreserve","vertrouwen":"hoog"}'
    ),
  });
  // De juiste eis (reviewcorrectie): de EFFECTIEVE vraag draagt het onderwerp, dus
  // de retrieval zoekt naar wetgeving OVER dat onderwerp. Dat de bronintentie
  // 'algemeen' is, is correct voor een wettelijke-kadervraag — geen contextfout.
  assert.ok(ctx.effectieveVraag.toLowerCase().includes("solidariteitsreserve"));
  const intent = bepaalBronIntent(ctx.effectieveVraag);
  assert.ok(["algemeen", "gecombineerd", "fonds"].includes(intent.intent));
  // Zonder contextresolutie zou de losse vraag geen onderwerp dragen:
  assert.ok(!"Breng het wettelijke kader in kaart.".toLowerCase().includes("solidariteitsreserve"));
  // En het bronsoortprofiel wordt over de onderwerpdragende vraag bepaald.
  assert.equal(typeof bepaalBronsoortprofiel(ctx.effectieveVraag), "string");
});

test("B2 — expliciet nieuw onderwerp wordt niet aan het oude geplakt", async () => {
  const ctx = await resolveVraagContext({
    origineleVraag: "Andere vraag: wat is de rol van DNB?",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub(
      '{"relatie":"nieuw_onderwerp","effectieveVraag":"Wat is de rol van DNB?","onderwerp":null,"vertrouwen":"hoog"}'
    ),
  });
  assert.equal(ctx.effectieveVraag.toLowerCase().includes("solidariteitsreserve"), false);
});

// ── (C) MODELCALL-SEMANTIEK + VROEGE-RETURN-LIFECYCLE (correcties A & B) ─────

test("C1 — geen_modelcall wordt niet hardgecodeerd op true", () => {
  // Correctie A: `geen_modelcall: true` mag niet meer als vaste waarde in de route
  // staan; hij wordt afgeleid uit de daadwerkelijke providercall.
  assert.ok(
    !ROUTE.includes("geen_modelcall: true"),
    "geen_modelcall mag niet hardgecodeerd true zijn"
  );
  assert.ok(
    ROUTE.includes("const resolverModelGebruikt = vraagContext?.modelAangeroepen ?? false;"),
    "verduidelijkingstak leidt de modelcall af uit modelAangeroepen"
  );
  assert.ok(
    ROUTE.includes("geen_modelcall: !resolverModelGebruikt"),
    "geen_modelcall volgt de resolver-providercall"
  );
});

test("C2 — een resolver-providercall registreert REWRITE_MODEL, niet null", () => {
  assert.ok(
    ROUTE.includes("p_model: resolverModelGebruikt ? REWRITE_MODEL : null"),
    "verduidelijking legt REWRITE_MODEL vast zodra de resolver een call deed"
  );
});

test("C3 — geen_generatiecall staat onder invoer (migratievrij), niet top-level", () => {
  // Twee deterministische returns: bronintentie-verduidelijking en
  // vergelijking_verduidelijking. Beide markeren 'geen ANTWOORD-generatie' —
  // als subsleutel van `invoer`, zodat de bestaande SQL-projectie het op
  // basisniveau toont zonder migratie.
  const totaal = ROUTE.split("geen_generatiecall: true").length - 1;
  assert.ok(totaal >= 2, `verwacht ≥2 geen_generatiecall-markeringen, vond ${totaal}`);
  const onderInvoer = (ROUTE.match(/invoer:\s*\{\s*geen_generatiecall: true/g) ?? []).length;
  assert.equal(
    onderInvoer,
    totaal,
    "elke geen_generatiecall moet direct onder een invoer-object staan"
  );
});

test("C4 — alle drie de vroege returns sluiten de AI-actie af met hun log-id", () => {
  for (const anker of [
    "verduidelijkingLogId ? `governance_log:${verduidelijkingLogId}`",
    "vergelijkLogId ? `governance_log:${vergelijkLogId}`",
    "vvLogId ? `governance_log:${vvLogId}`",
  ]) {
    assert.ok(ROUTE.includes(anker), `AI-actie afronden ontbreekt: ${anker}`);
  }
  // Bij een logfout mag geen AI-actie in pending blijven: expliciet 'mislukt'.
  const mislukt = ROUTE.split('rondAf(supabase, aiActieId, "mislukt", null)').length - 1;
  assert.ok(mislukt >= 3, `verwacht ≥3 fail-safe rondAf('mislukt'), vond ${mislukt}`);
});

test("C5 — vergelijking_verduidelijking heeft nu een governance-logregel", () => {
  // Deze tak had vóór de correctie geen log en liet de AI-actie pending.
  assert.ok(
    ROUTE.includes("Governance-log voor vergelijking_verduidelijking mislukt:"),
    "vergelijking_verduidelijking schrijft en logt de AI-interactie"
  );
});

test("C6 — roepModelAan onderscheidt poortweigering, providerfout en timeout expliciet", () => {
  // De runtime-vlag providercallGestart onderscheidt poortweigering van callstart.
  assert.ok(ROUTE.includes("let providercallGestart = false;"));
  assert.ok(ROUTE.includes("providercallGestart = true;"));
  assert.ok(
    ROUTE.includes("modelAangeroepen: providercallGestart"),
    "de meetmetadata registreert of de providercall echt startte"
  );
  // Timeout uit de echte abort-status (geen Promise.race), providerfout expliciet.
  assert.ok(ROUTE.includes("const aborted = ctrl.signal.aborted;"));
  assert.ok(ROUTE.includes("timeout: aborted"));
  assert.ok(
    ROUTE.includes('foutreden: "providerfout" as const'),
    "een providerfout wordt expliciet gemarkeerd, niet uit lege tekst afgeleid"
  );
});

test("C9 — geen race tussen twee timeouts: SDK-timeout ruimer dan het abort-budget", () => {
  assert.ok(
    ROUTE.includes("CONTEXTRESOLVER_SDK_TIMEOUT_MS = CONTEXTRESOLVER_TIMEOUT_MS + 2000"),
    "de SDK-timeout staat ruimer dan het harde AbortController-budget"
  );
  assert.ok(
    ROUTE.includes("timeout: CONTEXTRESOLVER_SDK_TIMEOUT_MS, signal: ctrl.signal"),
    "de resolvercall gebruikt de ruimere SDK-timeout + de leidende abort-signal"
  );
  // De harde deadline (setTimeout→abort) blijft op het 3500 ms-budget.
  assert.ok(ROUTE.includes("setTimeout(() => ctrl.abort(), CONTEXTRESOLVER_TIMEOUT_MS)"));
});

test("C7 — off-context (vraagContext null) behoudt het bestaande gedrag", () => {
  // Pure afleiding, exact de route-expressie: zonder resolver is
  // resolverModelGebruikt false ⇒ geen_modelcall true en p_model null —
  // byte-identiek aan het gedrag vóór plateau 1.
  const geenModelcall = (ctx: { modelAangeroepen: boolean } | null) =>
    !(ctx?.modelAangeroepen ?? false);
  assert.equal(geenModelcall(null), true, "off/observe: geen_modelcall blijft true");
  assert.equal(geenModelcall({ modelAangeroepen: false }), true, "poortweigering: true");
  assert.equal(geenModelcall({ modelAangeroepen: true }), false, "resolvercall: false");
});

test("C8 — de Preview withFondsRoute schema/rateLimit/audit blijven behouden", () => {
  assert.ok(ROUTE.includes('import { z } from "zod";'), "zod-import behouden");
  assert.ok(ROUTE.includes('rateLimit: "route-eigen"'), "rateLimit behouden");
  assert.ok(ROUTE.includes('audit: { handeling: "chat.gebruiken" }'), "audit-handeling behouden");
  assert.ok(ROUTE.includes("schema: z.object("), "request-body schema behouden");
});

test("B3 — scenario 9: PII in één van beide vraagvormen blokkeert de web-gate", () => {
  // Simuleert de route-unie in beide richtingen.
  const gevallen: Array<[string, string]> = [
    ["Zoek iets op voor deelnemer 123456782", "Zoek algemene info over de solidariteitsreserve"], // PII in origineel
    ["Breng het wettelijke kader in kaart.", "Wettelijk kader voor deelnemer 123456782"], // PII in effectief
  ];
  for (const [orig, eff] of gevallen) {
    const piiOrig = bevatPersoonsgegevens(orig);
    const piiEff = bevatPersoonsgegevens(eff);
    const bevatPii = piiOrig.bevatPii || piiEff.bevatPii;
    const gate = beoordeelWebGate({
      vlagAan: true,
      aantalActieveEntries: 5,
      scopeActief: false,
      bronsoortprofiel: "generiek",
      bevatPii,
    });
    assert.equal(gate.mag, false, `web-gate moet blokkeren voor [${orig} | ${eff}]`);
    assert.equal(gate.reden, "pii_geblokkeerd");
  }
});
