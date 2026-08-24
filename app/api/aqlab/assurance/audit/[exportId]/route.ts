// GET /api/aqlab/assurance/audit/[exportId]
// -----------------------------------------------------------------------------
// Read-only fonds-download van het BEVROREN auditrapport (AQL-4, functioneel
// scherm 8/9). Deze route authenticeert de fondsgebruiker (anon+RLS), dwingt
// host↔fonds af, controleert via magFondsAuditExportZien (RPC) dat de export bij
// een door dit fonds gebruikte feature én bij een vrijgavebesluit hoort, en streamt
// dan de HTML met de SESSIE-client (D1b: storage-policy op vrijgegeven exports —
// geen service-role meer). Elke download wordt append-only gelogd (RPC).
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { beoordeelNavigatieHerkomst, crossSiteGeweigerd } from "@/core/lib/navigatie-herkomst";
import { magFondsAuditExportZien } from "@/core/lib/aqlab/assurance";

const BUCKET = "aqlab-audit";

// LET OP: deze route heeft GEEN eigen try/catch, en dat verandert met de
// migratie iets aan het foutpad. Vóór W5 kwam een onafgevangen fout bij Next
// terecht; nu vangt het laatste vangnet van de wrapper hem en wordt het
// 500 {"error":"Serverfout"}. Dat is een uniformering, geen verlies — maar het
// is een verschil, en het staat daarom hier en als BESLUIT in #101 in plaats van
// dat het stilzwijgend meelift.
export const GET = withFondsRoute({ capability: "assurance.view", hostGuard: true, label: "aqlab.assurance.audit.GET", schema: "geen-body" }, async (ctx, req, params) => {
  // H-04: een top-level navigatie vanaf een vreemde site stuurt onder een
  // Lax-cookie de sessie mee. Deze route schrijft een auditrecord, dus zo'n
  // aanroep zou een gebeurtenis in het dossier van het slachtoffer zetten.
  // Weigeren vóór er werk gebeurt; de uitkomst gaat mee in het record.
  const oordeel = beoordeelNavigatieHerkomst(req);
  if (!oordeel.toegestaan) return crossSiteGeweigerd("aqlab.assurance.audit.GET");

  const { exportId } = params as { exportId: string };
  const supabase = ctx.supabase;

  // BLIJFT in de handler (W3 §4, dezelfde vorm als /api/aqlab/assurance): de
  // wrapper trekt de host-guard vóór de handler, terwijl deze eigen 403 vroeger
  // ervóór stond. Onder TENANT_ENFORCE≠on is de guard transparant en dus
  // byte-identiek; onder enforce=on kan een gebruiker zónder fonds voortaan de
  // host-guard-403 krijgen in plaats van deze. Zelfde status, andere body.
  const fondsId = ctx.fondsId;
  if (!fondsId) return NextResponse.json({ error: "Geen fonds-profiel" }, { status: 403 });

  // D1b: sessie-client + SECURITY DEFINER-RPC's (autorisatie + log) en een
  // storage-policy op vrijgegeven exports — geen service-role meer.
  const toegang = await magFondsAuditExportZien(supabase, fondsId, exportId);
  if (!toegang.ok || !toegang.opslag_ref) {
    return NextResponse.json({ error: toegang.reden ?? "Geen toegang tot dit auditrapport." }, { status: 403 });
  }

  const { data: blob, error } = await supabase.storage.from(BUCKET).download(toegang.opslag_ref);
  if (error || !blob) {
    return NextResponse.json({ error: "Auditrapport niet beschikbaar." }, { status: 404 });
  }
  const html = await blob.text();

  // Append-only downloadspoor (herleidbaar wie/wanneer welk rapport ophaalde).
  await supabase.rpc("aqlab_log_download", { p_export_id: exportId, p_herkomst: oordeel.herkomst });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="aqlab-auditrapport-${exportId}.html"`,
      "Cache-Control": "private, no-store",
    },
  });
});
