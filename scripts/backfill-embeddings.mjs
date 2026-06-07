// ============================================================
//  scripts/backfill-embeddings.mjs — eenmalige embedding-backfill (Fase C).
//
//  Draait LOKAAL met de Supabase service-role-sleutel, zodat RLS geen
//  schrijfacties blokkeert (de gedeployde app blijft gewoon RLS gebruiken;
//  deze sleutel zit alleen lokaal in .env.local, niet in de app). Geen
//  Vercel-timeout. Zelfhelend: lege/probleemchunks worden overgeslagen.
//
//  Vereist in mvp/.env.local:
//    NEXT_PUBLIC_SUPABASE_URL=...
//    SUPABASE_SERVICE_ROLE_KEY=...   (Supabase → Project Settings → API → service_role)
//    MISTRAL_API_KEY=...
//
//  Gebruik (vanuit map mvp/):
//    node scripts/backfill-embeddings.mjs
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function laadEnvLocal() {
  try {
    const hier = dirname(fileURLToPath(import.meta.url));
    const inhoud = readFileSync(join(hier, "..", ".env.local"), "utf8");
    for (const regel of inhoud.split("\n")) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* geen .env.local — dan uit de omgeving */
  }
}
laadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
const EMBED_MODEL = "mistral-embed";

if (!SUPABASE_URL || !SERVICE_KEY || !MISTRAL_KEY) {
  console.error(
    "✗ Ontbrekend in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY en/of MISTRAL_API_KEY"
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const MAX_ITEMS = 64;
const MAX_CHARS = 24000;

async function embedRaw(teksten) {
  const res = await fetch("https://api.mistral.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: teksten }),
  });
  if (!res.ok) throw new Error(`Mistral ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

// Token-veilig batchen (max items én max tekens per verzoek).
async function embed(teksten) {
  const uit = [];
  let i = 0;
  while (i < teksten.length) {
    const batch = [];
    let chars = 0;
    while (
      i < teksten.length &&
      batch.length < MAX_ITEMS &&
      (batch.length === 0 || chars + teksten[i].length <= MAX_CHARS)
    ) {
      chars += teksten[i].length;
      batch.push(teksten[i]);
      i++;
    }
    uit.push(...(await embedRaw(batch)));
  }
  return uit;
}

async function markeerOvergeslagen(id) {
  await sb.from("document_chunks").update({ embedding_model: "overgeslagen" }).eq("id", id);
}

async function bewaar(id, vector) {
  const { error } = await sb
    .from("document_chunks")
    .update({ embedding: JSON.stringify(vector), embedding_model: EMBED_MODEL })
    .eq("id", id);
  if (error) throw error;
}

async function main() {
  let verwerkt = 0;
  let overgeslagen = 0;

  // Begintotaal (service role → echte aantallen, geen RLS).
  const { count: totaal } = await sb
    .from("document_chunks")
    .select("id", { count: "exact", head: true });
  console.log(`Start backfill. Totaal chunks: ${totaal ?? "?"}`);

  for (;;) {
    const { data: chunks, error } = await sb
      .from("document_chunks")
      .select("id, tekst")
      .is("embedding", null)
      .is("embedding_model", null)
      .limit(100);
    if (error) {
      console.error("✗ Ophalen mislukt:", error.message);
      process.exit(1);
    }
    if (!chunks || chunks.length === 0) break;

    const leeg = chunks.filter((c) => !c.tekst || !c.tekst.trim());
    const te = chunks.filter((c) => c.tekst && c.tekst.trim());

    for (const c of leeg) {
      await markeerOvergeslagen(c.id);
      overgeslagen++;
    }

    try {
      const vectoren = await embed(te.map((c) => c.tekst));
      for (let i = 0; i < te.length; i++) {
        await bewaar(te[i].id, vectoren[i]);
        verwerkt++;
      }
    } catch (e) {
      // Eén dwarsliggende chunk laat de batch falen → per chunk proberen.
      console.warn("  batch mislukt, val terug op per chunk:", e.message);
      for (const c of te) {
        try {
          const [v] = await embed([c.tekst]);
          await bewaar(c.id, v);
          verwerkt++;
        } catch (e2) {
          console.warn(`  chunk ${c.id} overgeslagen: ${e2.message}`);
          await markeerOvergeslagen(c.id);
          overgeslagen++;
        }
      }
    }

    console.log(`… verwerkt ${verwerkt}, overgeslagen ${overgeslagen}`);
  }

  const { count: rest } = await sb
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .is("embedding", null)
    .is("embedding_model", null);

  console.log(`✓ Klaar. Verwerkt: ${verwerkt}, overgeslagen: ${overgeslagen}, resterend: ${rest ?? 0}`);
}

main().catch((e) => {
  console.error("✗ Onverwachte fout:", e.message);
  process.exit(1);
});
