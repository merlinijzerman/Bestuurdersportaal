// ============================================================================
//  §15-matrix — AI-begrenzing: geen enkel kostendragend pad omzeilt de poort
//  (bron-inspectie, besluit 0180).
// ----------------------------------------------------------------------------
//  Het werkticket is expliciet: "Een gedeeltelijke preflight die één indirect
//  pad openlaat is geen geslaagde DoD." Dat is geen belofte die je kunt
//  opschrijven — het is een invariant die je moet bewaken. Dit bestand doet dat
//  met bron-inspectie (huisidioom, zie fonds-config.test.ts):
//
//    (1) Elke plek die een providerclient BOUWT of een provider-endpoint
//        aanroept, staat op een gepinde allowlist. Verschijnt er ergens een
//        nieuwe `new Anthropic(` of een rauwe `api.mistral.ai`, dan valt deze
//        test om — precies het moment waarop iemand per ongeluk een tweede,
//        ongemeten weg naar de provider opent.
//    (2) Elke module op die allowlist importeert de poort. Een providermodule
//        die de poort niet eens kent, kan hem onmogelijk aanroepen.
//    (3) Elke kostendragende ROUTE importeert de preflight.
//    (4) De poort exporteert geen kale client waarmee je hem kunt omzeilen.
//
//  Wat dit NIET bewijst: dat de poort op de juiste plek in de volgorde staat.
//  Dat komt uit de gedragssuite (supabase/checks/2026_08_16_ai_begrenzing.sql)
//  en de handmatige Previewsmokes.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/ai-poort.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const wortel = join(hier, "..", "..");
const lees = (p: string) => readFileSync(join(wortel, p), "utf8");

/** Alle .ts/.tsx onder de meegegeven mappen, met pad relatief aan de repo-root. */
function bronbestanden(mappen: string[]): string[] {
  const uit: string[] = [];
  const loop = (map: string) => {
    let inhoud: string[];
    try {
      inhoud = readdirSync(join(wortel, map));
    } catch {
      return;
    }
    for (const naam of inhoud) {
      if (naam === "node_modules" || naam === ".next" || naam.startsWith(".")) continue;
      const pad = join(map, naam);
      if (statSync(join(wortel, pad)).isDirectory()) loop(pad);
      else if (/\.tsx?$/.test(naam)) uit.push(pad.split(sep).join("/"));
    }
  };
  mappen.forEach(loop);
  return uit;
}

const SERVERBRONNEN = bronbestanden(["core", "platform", "app"]);

// ── (1) Providertoegangspunten staan op een gepinde allowlist ───────────────

/**
 * Patronen die duiden op een DIRECTE weg naar een betaalde provider.
 * `messages.batches` staat erbij omdat de (nu slapende) Anthropic-batchbaan
 * anders bij activering ongemeten zou draaien.
 */
const PROVIDERPATRONEN: { patroon: RegExp; wat: string }[] = [
  { patroon: /new\s+Anthropic\s*\(/, wat: "Anthropic-client" },
  { patroon: /api\.anthropic\.com/, wat: "Anthropic-endpoint" },
  { patroon: /api\.mistral\.ai/, wat: "Mistral-endpoint" },
  { patroon: /api\.openai\.com/, wat: "OpenAI-endpoint" },
  { patroon: /messages\.batches\./, wat: "Anthropic Message Batches" },
];

/**
 * De ENIGE bestanden die een provider rechtstreeks mogen aanraken. Elke regel
 * is een bewust besluit; uitbreiden mag alleen samen met een poortaanroep in
 * datzelfde bestand.
 */
const PROVIDERALLOWLIST: Record<string, string> = {
  "core/lib/ai-gateway/adapters/anthropic.ts":
    "De Anthropic-adapter van de centrale AI-gateway (#311): de ENIGE `new Anthropic(` en het enige runtime-" +
    "SDK-import. Elke aanroep loopt via gateway.ts (fondsconfiguratie → poort → adapter → auditregel) of, " +
    "in het T3/T4-overgangspad, via bewaakteAnthropic in ai-poort.ts.",
  "core/lib/ai-gateway/adapters/openai.ts":
    "OpenAI-adapter van de gateway (rauwe fetch); credentials komen van de gateway via een profielreferentie.",
  "core/lib/ai-gateway/adapters/mistral.ts":
    "Mistral-chatadapter van de gateway; idem.",
  "core/lib/embeddings.ts":
    "Mistral-embeddings via rauwe fetch; elke aanroep loopt door bewaakteProviderCall.",
  "core/lib/ocr.ts":
    "Mistral-OCR via rauwe fetch; reserveert pagina's per poging en loopt door de poort.",
  "core/lib/chunk-ingest.ts":
    "Anthropic Message Batches voor context-prefixes. De baan slaapt " +
    "(BATCH_BAAN_AAN = false) maar loopt wél door bewaakteAnthropic, zodat activering niet " +
    "stilzwijgend een ongemeten kanaal opent.",
  "platform/lib/monitoring-health.ts":
    "Healthcheck op api.anthropic.com/v1/models — metadata-endpoint, NIET token-gefactureerd. " +
    "Bewust buiten de kill switch: anders verblindt een stop de monitoring die de stop moet bewaken.",
};

test("AI-begrenzing — geen providertoegangspunt buiten de allowlist", () => {
  const overtredingen: string[] = [];
  for (const bestand of SERVERBRONNEN) {
    const inhoud = lees(bestand);
    for (const { patroon, wat } of PROVIDERPATRONEN) {
      if (!patroon.test(inhoud)) continue;
      if (!(bestand in PROVIDERALLOWLIST)) {
        overtredingen.push(`${bestand} — ${wat}`);
      }
    }
  }
  assert.deepEqual(
    overtredingen,
    [],
    "Nieuw, ongemeten pad naar een AI-provider gevonden. Laat de call door core/lib/ai-poort.ts " +
      "lopen en reserveer met core/lib/ai-preflight.ts, of voeg het bestand met motivering toe " +
      "aan PROVIDERALLOWLIST.\n" +
      overtredingen.join("\n")
  );
});

test("AI-begrenzing — elke allowlist-regel wijst naar een bestaand bestand", () => {
  // Een regel die nergens meer op slaat, is een gat dat er geldig uitziet.
  for (const bestand of Object.keys(PROVIDERALLOWLIST)) {
    assert.ok(
      SERVERBRONNEN.includes(bestand),
      `${bestand} staat op de allowlist maar bestaat niet meer — verwijder de regel.`
    );
  }
});

// ── (2) Elke providermodule kent de poort ──────────────────────────────────

/**
 * De healthcheck is de bewuste uitzondering: die mág de poort niet gebruiken,
 * want een gestopte AI moet nog steeds te monitoren zijn.
 */
const POORTVRIJ = new Set([
  "core/lib/ai-poort.ts",
  "platform/lib/monitoring-health.ts",
  // De gateway-adapters zijn technisch: de poort draait in core/lib/ai-gateway/gateway.ts
  // (stap 4, vóór stap 5) en in llm-providers/index.ts voor het AQLab-pad; test (7) bewaakt dat.
  "core/lib/ai-gateway/adapters/anthropic.ts",
  "core/lib/ai-gateway/adapters/openai.ts",
  "core/lib/ai-gateway/adapters/mistral.ts",
]);

test("AI-begrenzing — elke providermodule importeert de poort", () => {
  for (const bestand of Object.keys(PROVIDERALLOWLIST)) {
    if (POORTVRIJ.has(bestand)) continue;
    const inhoud = lees(bestand);
    assert.match(
      inhoud,
      /ai-poort/,
      `${bestand} raakt een provider maar importeert core/lib/ai-poort niet — de poort kan daar ` +
        `dus niet draaien.`
    );
  }
});

// ── (3) Elke kostendragende route reserveert ───────────────────────────────

/**
 * De kostendragende ingangen uit de inventarisatie. Elk van deze bestanden moet
 * de preflight aanroepen; anders draait er een providercall zonder reservering.
 * De twee dry-runpaden (upload, her-extract) staan er ook op: die doen zelf geen
 * providercall, maar moeten de blokkade vooraf tonen (UX-principe "maak
 * vereisten en blokkers expliciet").
 */
const KOSTENDRAGENDE_INGANGEN = [
  "app/api/chat/route.ts",
  "app/api/procedures/[id]/stappen/[stapId]/besluit-concept/route.ts",
  "app/api/procedures/[id]/afschrift/concept/route.ts",
  "app/api/vergelijk/route.ts",
  "app/api/notulen/segmenten/[id]/bevestig/route.ts",
  "app/api/documents/embeddings-backfill/route.ts",
  "app/api/documents/reindex-backfill/route.ts",
  "platform/lib/ingest-orchestrator.ts",
  "platform/lib/generiek-pipeline.ts",
  "platform/lib/aqlab/run-orchestrator.ts",
];

test("AI-begrenzing — elke kostendragende ingang roept de preflight aan", () => {
  const ontbreekt: string[] = [];
  for (const bestand of KOSTENDRAGENDE_INGANGEN) {
    if (!SERVERBRONNEN.includes(bestand)) {
      ontbreekt.push(`${bestand} — bestand niet gevonden (hernoemd? pas de lijst aan)`);
      continue;
    }
    const inhoud = lees(bestand);
    if (!/ai-preflight/.test(inhoud)) {
      ontbreekt.push(`${bestand} — geen import van core/lib/ai-preflight`);
    }
  }
  assert.deepEqual(
    ontbreekt,
    [],
    "Kostendragend pad zonder reservering:\n" + ontbreekt.join("\n")
  );
});

// ── (4) De poort is niet te omzeilen via een geëxporteerde client ──────────

test("AI-begrenzing — de poort exporteert geen kale providerclient", () => {
  const poort = lees("core/lib/ai-poort.ts");
  // De client mag alleen binnen een bewaakte callback beschikbaar zijn. Een
  // `export function client()` of `export const anthropic` zou de hele
  // constructie waardeloos maken.
  assert.ok(
    !/export\s+(async\s+)?function\s+client\s*\(/.test(poort),
    "ai-poort exporteert de clientfabriek — dan is de poort te omzeilen."
  );
  assert.ok(
    !/export\s+(const|let)\s+_?anthropic\b/.test(poort),
    "ai-poort exporteert de Anthropic-instantie — dan is de poort te omzeilen."
  );
});

test("AI-begrenzing — de poort leest live en cachet de schakelaarstand niet", () => {
  const poort = lees("core/lib/ai-poort.ts");
  // Een cache op de schakelaarstand breekt de afspraak dat iedere nog niet
  // gestarte providercall de ACTUELE stand ziet.
  assert.ok(
    /fn_ai_poort_check/.test(poort),
    "ai-poort roept fn_ai_poort_check niet aan."
  );
  const verdachteCache = /(cache|TTL|ttl)\s*[:=]/.test(
    poort.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  );
  assert.ok(
    !verdachteCache,
    "ai-poort lijkt de schakelaarstand te cachen; dat breekt de live-controle-afspraak (besluit 0180)."
  );
});

// ── (5) De offline scripts zijn bewust buiten bereik en zeggen dat ook ─────

test("AI-begrenzing — offline scripts dragen een expliciete waarschuwing", () => {
  // Deze scripts draaien handmatig vanaf een werkplek, zonder servercontext en
  // zonder sessie; server-side afdwinging is er technisch onmogelijk. Ze mogen
  // bestaan, maar niet stilzwijgend: het restrisico staat geregistreerd en het
  // script hoort het zelf te melden.
  for (const script of ["scripts/backfill-embeddings.mjs", "scripts/test-embeddings.mjs"]) {
    let inhoud: string;
    try {
      inhoud = lees(script);
    } catch {
      continue; // script verwijderd = risico weg
    }
    assert.match(
      inhoud,
      /AI_BEGRENZING_BEWUST_OMZEILD/,
      `${script} omzeilt de AI-begrenzing zonder expliciete bevestiging (besluit 0180).`
    );
  }
});

// ── (6) STUK-1 (W5, #101) — geen bestand de deur uit zonder auditregel ───────

test("STUK-1 — ai/stuk-export logt VÓÓR het bouwen en teruggeven van de .docx", () => {
  // B-4/G16: bouw en registratie zitten bewust in één route, zodat er geen
  // bestand naar buiten kan zonder auditregel — eerst loggen, dan pas het
  // bestand. Die volgorde is een ORDENING in de handler en geen aanroep; de
  // andere controles in dit bestand toetsen "roept X aan", en zouden dus groen
  // blijven als iemand de twee blokken omdraait.
  //
  // Waarom bron-inspectie en geen scenario in het karakteriseringsharnas:
  // GEMETEN in W5 dat er geen INVOER bestaat die log_word_export laat falen
  // terwijl de capability-gate ervóór slaagt — `governance_export_log
  // .gesprek_audit_id` heeft geen foreign key en `stuksoort` geen
  // check-constraint. De volgorde is dus niet via een request af te dwingen.
  //
  // Runtime WEL eenmalig tegenbewezen (W5, #101): met `revoke execute on
  // log_word_export from authenticated` gaf de route 500 met content-type
  // application/json in plaats van een .docx, en bleef het aantal regels in
  // governance_export_log gelijk. Deze test bewaakt dat die volgorde blijft
  // staan; de meting bewijst dat de volgorde doet wat ze belooft.
  const bron = lees(join("app", "api", "ai", "stuk-export", "route.ts"));

  const log = bron.indexOf('.rpc("log_word_export"');
  const bouw = bron.indexOf("await bouwDocx(");
  assert.ok(log !== -1, "ai/stuk-export roept log_word_export niet meer aan");
  assert.ok(bouw !== -1, "ai/stuk-export roept bouwDocx niet meer aan");
  assert.ok(
    log < bouw,
    "ai/stuk-export bouwt de .docx vóór de auditregel; dat laat een export zonder spoor toe (B-4/G16)."
  );

  // En de mislukking moet ook echt blokkeren: een gelogde-maar-genegeerde fout
  // zou de volgorde formeel intact laten en de garantie toch weghalen.
  const naLog = bron.slice(log, bouw);
  assert.match(
    naLog,
    /if \(logFout\)[\s\S]*status: 500/,
    "ai/stuk-export gaat door na een mislukte log_word_export; de export hoort dan te stoppen."
  );
});

// ── (7) #311 — de provider-SDK leeft alleen in de adapterlaag ───────────────

/**
 * Runtime-imports van de Anthropic-SDK mogen uitsluitend in de Anthropic-adapter
 * staan. Een `import type` is toegestaan waar alleen typen worden gebruikt
 * (erased bij compilatie, geen runtime-pad naar de provider); die lijst krimpt in
 * T4 tot nul en is daarom apart gepind.
 */
const SDK_RUNTIME_ALLOWLIST = new Set(["core/lib/ai-gateway/adapters/anthropic.ts"]);
const SDK_TYPE_ALLOWLIST = new Set([
  "core/lib/ai-gateway/adapters/anthropic.ts",
  "core/lib/ai-poort.ts",
  "core/lib/generatie-kern.ts",
  "core/lib/rerank.ts",
  "core/lib/chunk-ingest.ts",
  "core/lib/semantische-extractie.ts",
  "platform/lib/aqlab/judge.ts",
  "app/api/chat/route.ts",
]);

test("AI-gateway — runtime-import van @anthropic-ai/sdk alleen in de adapter", () => {
  const runtime: string[] = [];
  const typeOnly: string[] = [];
  for (const bestand of SERVERBRONNEN) {
    const inhoud = lees(bestand);
    for (const regel of inhoud.split("\n")) {
      if (!/from\s+["']@anthropic-ai\/sdk["']/.test(regel)) continue;
      if (/^\s*import\s+type\s/.test(regel)) typeOnly.push(bestand);
      else runtime.push(bestand);
    }
  }
  assert.deepEqual(
    runtime.filter((b) => !SDK_RUNTIME_ALLOWLIST.has(b)),
    [],
    "Runtime-import van de provider-SDK buiten de adapterlaag. Laat de call door core/lib/ai-gateway lopen."
  );
  assert.deepEqual(
    typeOnly.filter((b) => !SDK_TYPE_ALLOWLIST.has(b)),
    [],
    "Nieuw type-import van de provider-SDK; gebruik de neutrale typen uit core/lib/ai-gateway/contract.ts."
  );
});

test("AI-gateway — de gateway toetst de poort vóór de adapter en logt na afloop", () => {
  const bron = lees("core/lib/ai-gateway/gateway.ts");
  const poort = bron.indexOf("await deps.poortCheck(");
  const adapterCall = bron.indexOf("res.adapter.genereer(");
  const adapterStream = bron.indexOf("res.adapter.stream(");
  assert.ok(poort !== -1 && adapterCall !== -1 && adapterStream !== -1, "gateway.ts mist poort- of adapteraanroep");
  assert.ok(poort < adapterCall && poort < adapterStream, "de poort staat niet vóór de adapteraanroep");
  assert.match(bron, /schrijfLog\(ctx, verzoek, res, \{ ok: true, r \}/, "gateway.ts logt geen geslaagde call");
});

test("AI-gateway — geen letterlijke modelstring op fondsgebonden gateway-aanroepen", () => {
  // Provider/model komen uit fonds + taaktype. Een `model: "claude-…"` naast een
  // gateway-aanroep zou die keuze weer naar de call-site verplaatsen.
  const overtredingen: string[] = [];
  for (const bestand of SERVERBRONNEN) {
    if (bestand.startsWith("core/lib/ai-gateway/adapters/")) continue;
    if (/\.(test|sanity)\.ts$/.test(bestand)) continue; // hermetische tests kiezen bewust een model
    const inhoud = lees(bestand);
    if (!/\.(genereer|stream)\(\s*(gatewayCtx|ctx|gw\.ctx|input\.ctx|opties!\.gateway!\.ctx)/.test(inhoud)) continue;
    const re = /\.(genereer|stream)\([\s\S]{0,900}?model:\s*["'`](claude|gpt|mistral)/g;
    if (re.test(inhoud)) overtredingen.push(bestand);
  }
  assert.deepEqual(overtredingen, [], "Letterlijke modelstring naast een gateway-aanroep:\n" + overtredingen.join("\n"));
});

