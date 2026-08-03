// ============================================================================
//  §15-matrix — API-body-manipulatie (T5) + server-side auditfonds (T8), app-laag.
// ----------------------------------------------------------------------------
//  T5 (API-body met gemanipuleerd fonds_id → server-side genegeerd) en T8
//  (auditlog bij geldige actie → server-side afgeleid fonds) hebben geen pure
//  functie: de logica zit in de chat-route-handler. De app-laag borgt het
//  invariant via bron-inspectie (gedeelde guard lib/audit-fonds-guard.ts, ook
//  gebruikt door lib/audit-fonds.sanity.ts). De DB-kant van T5/T8 (RLS-weigering
//  + append-only fonds) staat in de SQL-suites (T3 DEEL 2 + t5_export_storage).
//
//  Draaien:  node --import tsx --test tests/cross-tenant/audit-fonds.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { controleerChatAuditFondsbron } from "../../core/lib/audit-fonds-guard";

const hier = dirname(fileURLToPath(import.meta.url));
const routeBron = readFileSync(
  join(hier, "..", "..", "app", "api", "chat", "route.ts"),
  "utf8"
);

test("T5/T8 — chat-route negeert body.fonds_id en leidt het auditfonds server-side af", () => {
  const fouten = controleerChatAuditFondsbron(routeBron);
  assert.equal(fouten.length, 0, fouten.join("\n"));
});

// Meta-controle: bewijst dat de guard een geïntroduceerd lek daadwerkelijk
// rood maakt (negatieve-controle-patroon, besluit 0046 §E) — zonder de
// echte route te muteren. Als deze faalt, is de guard zelf stuk.
//
// Meerdere lekvormen (review T5): niet alleen de directe toewijzing, maar ook
// optional chaining en destructuring — anders is de guard een schijnvangnet dat
// alleen zijn eigen bekende patroon herkent.
const T5_LEKVORMEN: ReadonlyArray<[string, string]> = [
  ["directe toewijzing", 'const fondsId = body.fonds_id;'],
  ["optional chaining", 'const fondsId = body?.fonds_id;'],
  ["bracket-notatie", 'const fondsId = body["fonds_id"];'],
  ["insert-veld direct", '.from("governance_log").insert({ fonds_id: body.fonds_id })'],
  ["destructuring", 'const { fonds_id } = body;'],
  ["destructuring met alias", 'const { fonds_id: fid } = body;'],
];

for (const [naam, lek] of T5_LEKVORMEN) {
  test(`T5/T8 — negatieve controle: guard detecteert body.fonds_id-lek (${naam})`, () => {
    const fouten = controleerChatAuditFondsbron(lek);
    assert.ok(
      fouten.some((f) => f.startsWith("T5-REGRESSIE")),
      `guard zou de lekvorm "${naam}" als T5-lek moeten melden`
    );
  });
}

// ── Plateau A (2026-08-04) — het auditspoor loopt uitsluitend via de RPC ────
// `schrijf_ai_interactie()` leidt fonds_id en gebruiker_naam server-side af uit
// auth.uid(); die zijn er geen parameter meer. Een directe insert zou die
// borging omzeilen, dus de guard moet hem als T8-regressie melden — óók als de
// server-side afleiding verderop netjes op zijn plek staat.
const T8_OMZEILVORMEN: ReadonlyArray<[string, string]> = [
  ["directe insert in governance_log", '.from("governance_log").insert({ vraag })'],
  ["idem met single quotes", ".from('governance_log').insert({ vraag })"],
  ["directe insert in de inhoudstabel", '.from("governance_log_inhoud").insert({ vraag })'],
];

for (const [naam, omzeiling] of T8_OMZEILVORMEN) {
  test(`T8 — negatieve controle: guard detecteert omzeiling van de RPC (${naam})`, () => {
    const bron =
      "const fondsId = profiel?.fonds_id ?? null;\n" +
      'await supabase.rpc("schrijf_ai_interactie", {});\n' +
      `await supabase${omzeiling};\n`;
    const fouten = controleerChatAuditFondsbron(bron);
    assert.ok(
      fouten.some((f) => f.startsWith("T8-REGRESSIE")),
      `guard zou de omzeiling "${naam}" als T8-regressie moeten melden`
    );
  });
}

test("T8 — negatieve controle: guard mist het ontbreken van de RPC niet", () => {
  const bron = "const fondsId = profiel?.fonds_id ?? null;\n";
  const fouten = controleerChatAuditFondsbron(bron);
  assert.ok(
    fouten.some((f) => f.includes("schrijf_ai_interactie")),
    "guard zou moeten melden dat de RPC-aanroep ontbreekt"
  );
});
