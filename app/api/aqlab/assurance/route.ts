// GET /api/aqlab/assurance
// -----------------------------------------------------------------------------
// Het ENIGE tenant-facing leespad van het AI Quality Lab (AQL-4, technisch §5.8).
// Gecureerd server-side endpoint (géén tabel-policy op de deny-by-default aqlab_-
// tabellen): authenticeert de fondsgebruiker (anon+RLS), dwingt host↔fonds af, en
// geeft UITSLUITEND de geaggregeerde assurance-view terug voor de features die het
// fonds gebruikt. De service-role wordt hier — buiten de (dashboard)-boom —
// uitsluitend gebruikt om de PRODUCTBREDE aqlab-aggregaten te lezen; die bevatten
// geen fondsdata. Nooit ruwe output/prompt/context/testcase-inhoud.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { createServiceSupabase } from "@/core/lib/supabase-service";
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

  const svc = createServiceSupabase();
  const view = await haalAssuranceVoorFonds(svc, fondsId);
  return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
