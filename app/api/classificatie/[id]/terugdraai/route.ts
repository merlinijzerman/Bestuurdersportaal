// ============================================================================
//  POST /api/classificatie/[id]/terugdraai — Increment E
//
//  Draait een AUTO toegepaste koppeling (confidence 'hoog') terug: 1-klik-
//  correctie (FO §10, AC 2). Capability-gated (classification.review). Zet de
//  primaire koppeling terug naar leeg (auto-koppeling treedt alleen op bij een
//  nog ongekoppeld document), markeert het voorstel 'teruggedraaid' en legt de
//  handeling append-only vast in document_metadata_log.
//
//  Tenant-isolatie via RLS (anon-key + fonds_id). Geen service-role.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { z } from "zod";
import {
  logClassificatieKoppeling,
  bouwClassificatieReden,
} from "@/core/lib/classificatie-service";

export const dynamic = "force-dynamic";

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "classificatie.terugdraaien" }, capability: "classification.review", schema: z.object({ "opmerking": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    if (!(await requireCapability(ctx.gebruikerId, "classification.review"))) {
      return NextResponse.json(
        { error: "Geen rechten om classificaties terug te draaien (classification.review)" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as { opmerking?: string };

    const { data: voorstel } = await supabase
      .from("classificatie_voorstellen")
      .select(
        "id, document_id, fonds_id, voorgestelde_procesinstantie_id, confidence, bron, status"
      )
      .eq("id", id)
      .maybeSingle();
    if (!voorstel) {
      return NextResponse.json({ error: "Voorstel niet gevonden" }, { status: 404 });
    }
    if (voorstel.status !== "auto_toegepast") {
      return NextResponse.json(
        { error: `Alleen een auto-toegepaste koppeling kan worden teruggedraaid (status: ${voorstel.status}).` },
        { status: 409 }
      );
    }

    const { data: doc } = await supabase
      .from("documenten")
      .select("titel, fonds_id, procesinstantie_id")
      .eq("id", voorstel.document_id)
      .maybeSingle();

    const nu = new Date().toISOString();
    const oudeKoppeling = doc?.procesinstantie_id ?? voorstel.voorgestelde_procesinstantie_id;

    // Koppeling terug naar leeg (auto-koppeling werd alleen op een ongekoppeld
    // document toegepast).
    const { error: koppelErr } = await supabase
      .from("documenten")
      .update({ procesinstantie_id: null })
      .eq("id", voorstel.document_id);
    if (koppelErr) {
      console.error("Terugdraai koppeling fout:", koppelErr);
      return NextResponse.json({ error: "Terugdraaien mislukt" }, { status: 500 });
    }

    const { error: vErr } = await supabase
      .from("classificatie_voorstellen")
      .update({ status: "teruggedraaid", beoordeeld_door: ctx.gebruikerId, teruggedraaid_op: nu })
      .eq("id", id);
    if (vErr) {
      console.error("Voorstel terugdraaien fout:", vErr);
      return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
    }

    const { error: logErr } = await logClassificatieKoppeling(supabase, {
      documentId: voorstel.document_id,
      documentTitel: doc?.titel ?? null,
      fondsId: voorstel.fonds_id,
      gebruikerId: ctx.gebruikerId,
      gebruikerNaam: ctx.naam ?? null,
      veldNaam: "procesinstantie_id",
      oudeWaarde: oudeKoppeling ?? null,
      nieuweWaarde: null,
      reden: bouwClassificatieReden(
        voorstel.confidence,
        voorstel.bron,
        body.opmerking?.trim() || "auto-koppeling teruggedraaid"
      ),
      ragImpact: true,
    });
    if (logErr) {
      return NextResponse.json(
        { error: "Teruggedraaid maar auditlog faalde" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, actie: "terugdraai" });
  } catch (e) {
    console.error("Fout in POST /api/classificatie/[id]/terugdraai:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
