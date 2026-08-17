// ============================================================
//  scripts/test-embeddings.mjs — snelle verbindingstest met Mistral.
//
//  Doel: controleren dat MISTRAL_API_KEY werkt en dat `mistral-embed`
//  1024-dimensionale vectoren teruggeeft. Wijzigt niets aan de app.
//
//  Gebruik (vanuit de map mvp/):
//    node scripts/test-embeddings.mjs
//  De sleutel wordt gelezen uit .env.local (of uit de omgeving). Alternatief:
//    MISTRAL_API_KEY=xxx node scripts/test-embeddings.mjs
// ============================================================

// ⚠ AI-BEGRENZING (besluit 0180) — DIT SCRIPT VALT BUITEN DE BEGRENZING.
//  Het draait handmatig vanaf een werkplek, zonder servercontext en zonder
//  sessie: de maandquota, de kill switch en de modelallowlist kunnen hier
//  technisch niet worden afgedwongen. Het verbruik telt NIET mee in
//  ai_verbruik_log en een gestopte Mistral houdt dit script niet tegen; de
//  enige rem is de financiële providerlimiet.
//
//  Draai het daarom alleen bewust, met:
//      AI_BEGRENZING_BEWUST_OMZEILD=1 node scripts/<naam>.mjs
//  Geregistreerd restrisico; eigenaar Merlin.
if (process.env.AI_BEGRENZING_BEWUST_OMZEILD !== "1") {
  console.error(
    "✗ Geweigerd: dit script omzeilt de AI-begrenzing (besluit 0180).\n" +
      "  Zet AI_BEGRENZING_BEWUST_OMZEILD=1 om te bevestigen dat dit bewust is."
  );
  process.exit(1);
}


import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Lees MISTRAL_API_KEY uit .env.local als die niet al in de omgeving staat.
function laadEnvLocal() {
  if (process.env.MISTRAL_API_KEY) return;
  try {
    const hier = dirname(fileURLToPath(import.meta.url));
    const pad = join(hier, "..", ".env.local");
    const inhoud = readFileSync(pad, "utf8");
    for (const regel of inhoud.split("\n")) {
      const m = regel.match(/^\s*MISTRAL_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) {
        process.env.MISTRAL_API_KEY = m[1].replace(/^["']|["']$/g, "");
        break;
      }
    }
  } catch {
    // geen .env.local — dan moet de sleutel via de omgeving komen
  }
}

async function main() {
  laadEnvLocal();
  const key = process.env.MISTRAL_API_KEY;
  if (!key) {
    console.error("✗ Geen MISTRAL_API_KEY gevonden (.env.local of omgeving).");
    process.exit(1);
  }

  console.log("→ Test embedding-call naar Mistral (mistral-embed)…");
  const res = await fetch("https://api.mistral.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "mistral-embed",
      input: ["Wat zijn de deskundigheidseisen voor pensioenfondsbestuurders?"],
    }),
  });

  if (!res.ok) {
    const tekst = await res.text();
    console.error(`✗ Mislukt — HTTP ${res.status}`);
    console.error(tekst.slice(0, 500));
    if (res.status === 401) console.error("  → Sleutel ongeldig of plan niet geactiveerd.");
    if (res.status === 429) console.error("  → Rate limit; probeer later of activeer het Scale-plan.");
    process.exit(1);
  }

  const data = await res.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    console.error("✗ Onverwachte respons:", JSON.stringify(data).slice(0, 300));
    process.exit(1);
  }

  console.log(`✓ Verbinding werkt. Dimensies: ${vector.length} (verwacht 1024).`);
  console.log(`  Eerste waarden: [${vector.slice(0, 5).map((n) => n.toFixed(4)).join(", ")}, …]`);
  if (data.usage) console.log(`  Tokens verbruikt: ${JSON.stringify(data.usage)}`);
  if (vector.length !== 1024) {
    console.warn("⚠ Dimensie wijkt af van 1024 — controleer model/kolomdefinitie.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("✗ Onverwachte fout:", e.message);
  process.exit(1);
});
