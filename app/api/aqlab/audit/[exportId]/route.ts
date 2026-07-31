// GET /api/aqlab/audit/[exportId]  — PLATFORM-console auditrapport-stream (AQL-4).
// -----------------------------------------------------------------------------
// De platform-operator opent hier het bevroren auditrapport (elke export, óók
// niet-vrijgegeven / standalone gegenereerd). Bewust GESCHEIDEN van het fonds-
// pad /api/aqlab/assurance/audit/[exportId] (dat een profielen.fonds_id + een
// vrijgegeven-besluit eist). Platform-autorisatie inline: platform-identiteit +
// live MFA + capability platform.aqlab.operate; daarna service-role stream.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { withPlatformRead, PlatformError } from "@/platform/lib/platform-wrapper";

const BUCKET = "aqlab-audit";
const CAP = "platform.aqlab.operate" as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ exportId: string }> }
) {
  const { exportId } = await params;

  // H-15 (review 2026-07-30): de identiteits-, MFA- en capabilitychecks stonden
  // hier al correct, maar de service-role-download zelf liep buiten de
  // auditwrapper om — er bleef dus geen spoor van wie welk auditrapport
  // opvroeg. withPlatformRead doet dezelfde drie poorten én schrijft een
  // result-event. Het fonds-pad (aqlab/assurance/audit/[exportId]) logde de
  // download al wél; dit trekt het platform-pad gelijk.
  let html: string;
  try {
    html = await withPlatformRead(
      { capability: CAP, handeling: "aqlab.auditrapport.downloaden", doelObject: exportId },
      async (svc) => {
        const { data: row } = await svc
          .from("aqlab_audit_exports").select("opslag_ref, run_id").eq("id", exportId).maybeSingle();
        const r = row as { opslag_ref: string | null; run_id: string | null } | null;
        if (!r) throw new PlatformError(500, "export_niet_gevonden");
        const pad = r.opslag_ref ?? (r.run_id ? `${r.run_id}/${exportId}.html` : null);
        if (!pad) throw new PlatformError(500, "geen_opslag_referentie");

        const { data: blob, error } = await svc.storage.from(BUCKET).download(pad);
        if (error || !blob) throw new PlatformError(500, "rapport_niet_beschikbaar");
        const tekst = await blob.text();
        return { resultaat: tekst, effect: { bytes: tekst.length, pad_bekend: true } };
      }
    );
  } catch (e) {
    if (e instanceof PlatformError) {
      const status = e.status === 403 ? 403 : 404;
      const melding =
        e.foutcode === "export_niet_gevonden" || e.foutcode === "geen_opslag_referentie"
          ? "Auditrapport niet gevonden"
          : e.foutcode === "rapport_niet_beschikbaar"
            ? "Auditrapport niet beschikbaar"
            : e.foutcode;
      return NextResponse.json({ error: melding }, { status });
    }
    throw e;
  }

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="aqlab-auditrapport-${exportId}.html"`,
      "Cache-Control": "private, no-store",
    },
  });
}
