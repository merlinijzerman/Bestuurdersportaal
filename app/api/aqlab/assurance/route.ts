// GET /api/aqlab/assurance
// -----------------------------------------------------------------------------
// Het ENIGE tenant-facing leespad van het AI Quality Lab (AQL-4, technisch §5.8).
// Gecureerd server-side endpoint: authenticeert de fondsgebruiker (anon+RLS),
// dwingt host↔fonds af, en geeft UITSLUITEND de geaggregeerde assurance-view terug
// voor de features die het fonds gebruikt. D1b: de deny-by-default aqlab_-tabellen
// worden gelezen via de SESSIE-client + SECURITY DEFINER-RPC's (curatie in SQL),
// NIET meer via de service-role. Nooit ruwe output/prompt/context/testcase-inhoud.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import { haalAssuranceVoorFonds } from "@/core/lib/aqlab/assurance";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { data: profiel } = await supabase
    .from("profielen").select("fonds_id").eq("id", user.id).maybeSingle();
  const fondsId = profiel?.fonds_id ?? null;
  if (!fondsId) return NextResponse.json({ error: "Geen fonds-profiel" }, { status: 403 });

  // Host↔fonds-enforce (defense-in-depth náást RLS), zoals de auditdossier-route.
  const hostOordeel = await beoordeelRouteHostToegang({
    sessieFondsId: fondsId, gebruikerId: user.id, label: "aqlab.assurance.GET",
  });
  if (!hostOordeel.toegestaan) {
    return NextResponse.json({ error: "Dit webadres hoort niet bij uw fonds." }, { status: 403 });
  }

  // D1b: sessie-client (RLS + SECURITY DEFINER-RPC's), geen service-role meer.
  const view = await haalAssuranceVoorFonds(supabase, fondsId);
  return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
