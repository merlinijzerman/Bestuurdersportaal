import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// De I1b_nn-migratie voegt een tweede FK van document_chunks naar documenten toe.
// Zonder expliciete FK-hint weigert PostgREST beide relaties met PGRST201.
const bestanden = [
  "core/lib/rag.ts",
  "core/lib/retrieval/artikeltoelating.ts",
  "core/lib/retrieval/supabase-evidence.ts",
  "core/lib/retrieval/supabase-parent.ts",
  "core/lib/retrieval/supabase-versie.ts",
] as const;

test("I1b_nn: alle chunk→document-embeds kiezen de bestaande cascade-FK", () => {
  let aantal = 0;
  for (const bestand of bestanden) {
    const bron = readFileSync(bestand, "utf8");
    assert.doesNotMatch(bron, /documenten!inner\(/, `${bestand}: dubbelzinnige PostgREST-join`);
    aantal += bron.match(/documenten!document_chunks_document_id_fkey!inner\(/g)?.length ?? 0;
  }
  assert.equal(aantal, 7, "de zeven bestaande chunk→document-embeds blijven expliciet");
});
