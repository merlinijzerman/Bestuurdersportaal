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
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { haalAssuranceVoorFonds } from "@/core/lib/aqlab/assurance";

export const GET = withFondsRoute({ capability: "TE_BEPALEN", hostGuard: true, label: "aqlab.assurance.GET" }, async (ctx) => {
  const supabase = ctx.supabase;
  const fondsId = ctx.fondsId;
  if (!fondsId) return NextResponse.json({ error: "Geen fonds-profiel" }, { status: 403 });

  // D1b: sessie-client (RLS + SECURITY DEFINER-RPC's), geen service-role meer.
  const view = await haalAssuranceVoorFonds(supabase, fondsId);
  return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
});
