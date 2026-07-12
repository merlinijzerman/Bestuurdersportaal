// GET /api/aqlab/audit/[exportId]  — PLATFORM-console auditrapport-stream (AQL-4).
// -----------------------------------------------------------------------------
// De platform-operator opent hier het bevroren auditrapport (elke export, óók
// niet-vrijgegeven / standalone gegenereerd). Bewust GESCHEIDEN van het fonds-
// pad /api/aqlab/assurance/audit/[exportId] (dat een profielen.fonds_id + een
// vrijgegeven-besluit eist). Platform-autorisatie inline: platform-identiteit +
// live MFA + capability platform.aqlab.operate; daarna service-role stream.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { huidigePlatformIdentiteit, heeftActueleMFA } from "@/platform/lib/platform-auth";
import { heeftCapability } from "@/platform/lib/platform-capabilities";
import { createServiceSupabase } from "@/platform/lib/supabase-service";

const BUCKET = "aqlab-audit";
const CAP = "platform.aqlab.operate" as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ exportId: string }> }
) {
  const { exportId } = await params;

  const identiteit = await huidigePlatformIdentiteit();
  if (!identiteit || !identiteit.actief) return NextResponse.json({ error: "Geen platform-toegang" }, { status: 403 });
  if (!(await heeftActueleMFA())) return NextResponse.json({ error: "MFA vereist" }, { status: 403 });
  if (!heeftCapability(identiteit.capabilities, CAP)) return NextResponse.json({ error: "capability_denied" }, { status: 403 });

  const svc = createServiceSupabase();
  const { data: row } = await svc
    .from("aqlab_audit_exports").select("opslag_ref, run_id").eq("id", exportId).maybeSingle();
  const r = row as { opslag_ref: string | null; run_id: string | null } | null;
  if (!r) return NextResponse.json({ error: "Auditrapport niet gevonden" }, { status: 404 });
  const pad = r.opslag_ref ?? (r.run_id ? `${r.run_id}/${exportId}.html` : null);
  if (!pad) return NextResponse.json({ error: "Geen opslag-referentie" }, { status: 404 });

  const { data: blob, error } = await svc.storage.from(BUCKET).download(pad);
  if (error || !blob) return NextResponse.json({ error: "Auditrapport niet beschikbaar" }, { status: 404 });
  const html = await blob.text();

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="aqlab-auditrapport-${exportId}.html"`,
      "Cache-Control": "private, no-store",
    },
  });
}
