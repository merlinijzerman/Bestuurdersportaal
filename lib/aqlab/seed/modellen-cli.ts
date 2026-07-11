// lib/aqlab/seed/modellen-cli.ts
// -----------------------------------------------------------------------------
// AQLab — seed de starter-set modelconfiguraties (AQL-5, variantbeheer-light).
// Idempotent (dedup-op-hash): herhaald draaien voegt geen dubbele rijen toe.
//
// Anders dan de golden-set-seed (loader/apply, gate-bewaakt) heeft deze seed
// GEEN inhoudelijke gate nodig: het zijn code-constante modelinstellingen uit
// de allowlist (AQLAB_TOEGESTANE_MODELLEN), geen synthetische fondsdata. Wel:
// service-role UITSLUITEND server-side/CLI (nooit client, CLAUDE.md).
//
// Run:  npm run aqlab:seed:modellen
// Exit: 0 = geslaagd; 1 = fout.
// -----------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";
import { seedStarterModelConfigs } from "../modellen-hash";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL ontbreekt — seed kan niet starten.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt — vereist voor de server-side seed.");

  const svc = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  console.log("AQLAB — seed starter-modelconfiguraties (idempotent, dedup-op-hash)");
  const r = await seedStarterModelConfigs(svc);
  for (const l of r.log) console.log(`  • ${l}`);
  console.log(`Klaar: ${r.toegevoegd} toegevoegd van ${r.totaal} in de allowlist.`);
}

main().catch((e) => {
  console.error(`FOUT: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
