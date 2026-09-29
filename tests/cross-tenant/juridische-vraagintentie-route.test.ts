// ============================================================================
//  §15-matrix — Wetsgeschiedenis A-light R-2 (#491): juridische vraagintentie,
//  OBSERVE-ONLY. De chatroute en het auditspoor zijn een tenantpad, dus deze
//  suite hoort in de cross-tenant-gate (auto-aangesloten via de glob in
//  scripts/cross-tenant-ci.sh).
//
//  Drie lagen:
//   (A) BRON-INSPECTIE op app/api/chat/route.ts — de classifier draait exact
//       één keer, op de EFFECTIEVE vraag, ná de contextresolver, en de uitkomst
//       wordt uitsluitend als auditmetadata gebruikt (negatieve observe-only-
//       test: geen selectie-, ranking-, prompt- of bronkaartgebruik).
//   (B) FLOW — een via de (gestubde) contextresolver opgeloste vervolgvraag
//       krijgt dezelfde intentie als de direct gestelde vraag.
//   (C) AUDIT — `invoer.juridische_intentie` belandt inhoudsarm in het spoor
//       (basisniveau), overleeft beide TS-leesniveaus én de SQL-projectie
//       zonder migratie.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/juridische-vraagintentie-route.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveVraagContext, type Beurt } from "../../core/lib/vraag-context";
import { bepaalJuridischeVraagintentie } from "../../core/lib/vraagtype";
import { splitsRetrievalMeta, projecteerSpoorMeta } from "../../core/lib/audit-meta";

const hier = dirname(fileURLToPath(import.meta.url));
const root = join(hier, "..", "..");
const lees = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const ROUTE = lees("app", "api", "chat", "route.ts");

const aantal = (tekst: string, frag: string) => tekst.split(frag).length - 1;

// ── (A) BRON-INSPECTIE ──────────────────────────────────────────────────────

test("R2-A1 — de classifier wordt exact één keer aangeroepen, op de effectieve vraag", () => {
  assert.equal(
    aantal(ROUTE, "bepaalJuridischeVraagintentie("),
    1,
    "exact één aanroep per beurt (geen tweede berekening op een ander pad)"
  );
  assert.ok(
    ROUTE.includes("const juridischeIntentie = bepaalJuridischeVraagintentie(effectieveVraag);"),
    "de classifier krijgt de EFFECTIEVE vraag"
  );
  assert.ok(
    !ROUTE.includes("bepaalJuridischeVraagintentie(vraag)"),
    "de ruwe vraag is geen parallelle waarheid"
  );
});

test("R2-A2 — de classificatie draait ná de contextresolver en vóór elk auditspoor", () => {
  const iResolver = ROUTE.indexOf("await resolveVraagContext(");
  const iEffectief = ROUTE.indexOf("const effectieveVraag =");
  const iIntentie = ROUTE.indexOf("bepaalJuridischeVraagintentie(effectieveVraag)");
  const iEersteLog = ROUTE.indexOf('supabase.rpc("schrijf_ai_interactie"');
  assert.ok(iResolver > 0 && iEffectief > iResolver, "resolver vóór effectieveVraag");
  assert.ok(iIntentie > iEffectief, "intentie ná de afleiding van effectieveVraag");
  assert.ok(iEersteLog > iIntentie, "intentie vóór de eerste governance-logregel");
});

test("R2-A3 — OBSERVE-ONLY: de intentie wordt uitsluitend als auditmetadata gebruikt", () => {
  // Negatieve test: `juridischeIntentie` mag nergens anders voorkomen dan in de
  // eigen declaratie en als waarde van `juridische_intentie` in de vier
  // governance-logregels (antwoord, vergelijking, vergelijkingsverduidelijking,
  // bronintentie-verduidelijking). Elk ander gebruik — filter, ranking,
  // selectie, promptblok, bronkaart, antwoordtekst — maakt deze test rood.
  const gebruik = aantal(ROUTE, "juridischeIntentie");
  const alsAuditwaarde = aantal(ROUTE, "juridische_intentie: juridischeIntentie,");
  assert.equal(alsAuditwaarde, 4, "vastgelegd in alle vier de governance-logregels");
  assert.equal(gebruik, 1 + alsAuditwaarde, "geen ander gebruik dan declaratie + audit");
  assert.equal(
    aantal(ROUTE, 'supabase.rpc("schrijf_ai_interactie"'),
    alsAuditwaarde,
    "elke governance-logregel draagt de intentie"
  );
});

test("R2-A4 — OBSERVE-ONLY: geen retrieval-, prompt- of bronkaartmodule kent de classifier", () => {
  // Alleen de chatroute roept de classifier aan; de retrievalkern kent hooguit
  // het TYPE (RetrievalMeta.invoer). Selectie, ranking, promptopbouw en
  // bronweergave kunnen er daardoor niet op sturen.
  const nietAanroepen = [
    ["core", "lib", "rag.ts"],
    ["core", "lib", "generatie-kern.ts"],
    ["core", "lib", "weeg-bronsoort.ts"],
    ["core", "lib", "assistent-stream.ts"],
    ["core", "lib", "assistent-payload.ts"],
  ];
  for (const pad of nietAanroepen) {
    assert.ok(
      !lees(...pad).includes("bepaalJuridischeVraagintentie"),
      `${pad.join("/")} mag de classifier niet aanroepen`
    );
  }
  const retrievalDir = join(root, "core", "lib", "retrieval");
  for (const f of readdirSync(retrievalDir).filter((x) => x.endsWith(".ts"))) {
    const t = readFileSync(join(retrievalDir, f), "utf8");
    assert.ok(!t.includes("bepaalJuridischeVraagintentie"), `retrieval/${f}`);
    assert.ok(!t.includes("juridische_intentie"), `retrieval/${f}`);
  }
  // De toon-systeemprompt en de promptassemblage noemen de intentie niet.
  assert.ok(!lees("core", "lib", "generatie-kern.ts").includes("juridische_intentie"));
});

// ── (B) FLOW met gestubde contextresolver ───────────────────────────────────

const HIST: Beurt[] = [
  { role: "user", content: "Wat bepaalt artikel 150d Pensioenwet?" },
  { role: "assistant", content: "Artikel 150d Pensioenwet regelt …" },
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

test("R2-B1 — een opgeloste vervolgvraag krijgt dezelfde intentie als de directe vraag", async () => {
  const direct = "Waarom heeft de wetgever artikel 150d Pensioenwet zo vormgegeven?";
  const ctx = await resolveVraagContext({
    origineleVraag: "En waarom is daarvoor gekozen?",
    priorBeurten: HIST,
    modus: "enforce",
    magResolveren: true,
    roepModelAan: stub(
      JSON.stringify({
        relatie: "vervolg",
        effectieveVraag: direct,
        onderwerp: "artikel 150d Pensioenwet",
        vertrouwen: "hoog",
      })
    ),
  });
  assert.equal(ctx.effectieveVraag, direct);
  // Dezelfde afleiding als de route (enforce ⇒ effectieve vraag).
  const effectieveVraag = ctx.effectieveVraag;
  assert.deepEqual(
    bepaalJuridischeVraagintentie(effectieveVraag),
    bepaalJuridischeVraagintentie(direct)
  );
  assert.equal(bepaalJuridischeVraagintentie(effectieveVraag).intentie, "bedoeling_totstandkoming");
  // De losse vervolgvraag zonder resolutie draagt die intentie niet.
  assert.equal(bepaalJuridischeVraagintentie("En waarom is daarvoor gekozen?").intentie, "onbekend");
});

// ── (C) AUDIT: inhoudsarm, basisniveau, migratievrij ────────────────────────

test("R2-C1 — `invoer.juridische_intentie` blijft in het spoor en overleeft beide leesniveaus", () => {
  const vraag = "Wat zegt de memorie van toelichting over artikel 150d Pensioenwet?";
  const juridische_intentie = bepaalJuridischeVraagintentie(vraag);
  const { spoor, inhoud, onbekend } = splitsRetrievalMeta({
    methode: "geen",
    opgehaald: 0,
    geselecteerd: 0,
    invoer: { beurten: 1, tekens: vraag.length, historie_hash: "abc", juridische_intentie },
  });
  assert.deepEqual(onbekend, []);
  assert.deepEqual((spoor.invoer as Record<string, unknown>).juridische_intentie, juridische_intentie);
  assert.equal(
    (inhoud.invoer as Record<string, unknown> | undefined)?.juridische_intentie,
    undefined,
    "geen inhoud: niet in het verwijderbare deel"
  );
  for (const metBron of [false, true]) {
    const gelezen = projecteerSpoorMeta(spoor, metBron) as { invoer?: Record<string, unknown> };
    assert.deepEqual(gelezen.invoer?.juridische_intentie, juridische_intentie);
  }
  // Inhoudsarm: de vastgelegde waarde bevat geen vraagtekst.
  const json = JSON.stringify(juridische_intentie).toLowerCase();
  for (const woord of ["memorie", "150d", "pensioenwet"]) assert.ok(!json.includes(woord), woord);
});

test("R2-C2 — de SQL-leesprojectie laat `invoer.*` door op basisniveau (geen migratie nodig)", () => {
  const dir = join(root, "supabase", "migrations");
  const laatste = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      /create or replace function public\.meta_projectie\(/.test(readFileSync(join(dir, f), "utf8"))
    )
    .pop();
  assert.ok(laatste, "er hoort een definitie van meta_projectie te zijn");
  const sql = readFileSync(join(dir, laatste!), "utf8");
  const basis = sql.match(/c_basis constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(basis && /'invoer'/.test(basis[1]), "`invoer` staat op basisniveau in meta_projectie()");
  // Binnen `invoer` wordt uitsluitend `historie_hash` weggefilterd; een nieuwe
  // subsleutel overleeft dus beide leesniveaus.
  assert.ok(
    sql.includes("v_uit := jsonb_set(v_uit, '{invoer}', (v_uit->'invoer') - 'historie_hash');"),
    "de invoer-projectie filtert alleen historie_hash"
  );
});
