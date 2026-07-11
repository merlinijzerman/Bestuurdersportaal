// GET /api/aqlab/assurance/audit/[exportId]
// -----------------------------------------------------------------------------
// Read-only fonds-download van het BEVROREN auditrapport (AQL-4, functioneel
// scherm 8/9). Server-gemedieerd: de private 'aqlab-audit'-bucket heeft géén
// storage-policy; deze route authenticeert de fondsgebruiker (anon+RLS), dwingt
// host↔fonds af, controleert via magFondsAuditExportZien dat de export bij een
// door dit fonds gebruikte feature én bij een vrijgavebesluit hoort, en streamt
// dan de HTML via de service-role. Elke download wordt append-only gelogd.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { beoordeelRouteHostToegang } from "@/lib/tenant-route-guard";
import { magFondsAuditExportZien } from "@/lib/aqlab/assurance";

const BUCKET = "aqlab-audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ exportId: string }> }
) {
  const { exportId } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { data: profiel } = await supabase
    .from("profielen").select("fonds_id").eq("id", user.id).maybeSingle();
  const fondsId = profiel?.fonds_id ?? null;
  if (!fondsId) return NextResponse.json({ error: "Geen fonds-profiel" }, { status: 403 });

  const hostOordeel = await beoordeelRouteHostToegang({
    sessieFondsId: fondsId, gebruikerId: user.id, label: "aqlab.assurance.audit.GET",
  });
  if (!hostOordeel.toegestaan) {
    return NextResponse.json({ error: "Dit webadres hoort niet bij uw fonds." }, { status: 403 });
  }

  const svc = createServiceSupabase();
  const toegang = await magFondsAuditExportZien(svc, fondsId, exportId);
  if (!toegang.ok || !toegang.opslag_ref) {
    return NextResponse.json({ error: toegang.reden ?? "Geen toegang tot dit auditrapport." }, { status: 403 });
  }

  const { data: blob, error } = await svc.storage.from(BUCKET).download(toegang.opslag_ref);
  if (error || !blob) {
    return NextResponse.json({ error: "Auditrapport niet beschikbaar." }, { status: 404 });
  }
  const html = await blob.text();

  // Append-only downloadspoor (herleidbaar wie/wanneer welk rapport ophaalde).
  await svc.from("aqlab_log").insert({
    gebruiker_id: user.id,
    actie: "audit_export_gedownload_fonds",
    object_type: "aqlab_audit_exports",
    object_id: exportId,
    nieuwe_waarde: { fonds_id: fondsId },
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="aqlab-auditrapport-${exportId}.html"`,
      "Cache-Control": "private, no-store",
    },
  });
}
