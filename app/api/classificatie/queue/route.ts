// ============================================================
//  GET /api/classificatie/queue — Increment E
//
//  Listing van de AI-procesclassificatievoorstellen voor het eigen fonds.
//  Losgemaakt uit de gedeelde "Te beoordelen"-hub toen de METADATA-
//  reviewworkflow werd verwijderd (besluit 0152). De classificatie-stream is
//  een ánder mechanisme (Increment E, decision 0010) en blijft; hij krijgt
//  hier zijn eigen route naast de bestaande schrijf-routes
//  /api/classificatie/[id]/beoordeel|terugdraai en /api/classificatie/backfill.
//
//  GET ?status=open  — optioneel statusfilter. Tenant-isolatie via RLS
//  (anon-key + fonds_id). Geen service-role.
//
//  W2: auth-preamble via withFondsRoute v1 (de naad). Gedrag ongewijzigd — de
//  wrapper doet de auth + profielresolutie; de query en respons zijn identiek.
// ============================================================

import { NextResponse, type NextRequest } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";

export const dynamic = "force-dynamic";

export const GET = withFondsRoute({ capability: "classification.queue.view" }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    const url = new URL(req.url);
    const status = url.searchParams.get("status"); // optioneel filter

    let cq = supabase
      .from("classificatie_voorstellen")
      .select(
        "id, document_id, voorgestelde_procesinstantie_id, voorgesteld_documenttype, " +
          "confidence, bron, status, toelichting, toegepast_op, teruggedraaid_op, aangemaakt, " +
          "documenten(id, titel, bibliotheek, bron, context, documenttype, status, bronstatus, documentdatum, procesinstantie_id)"
      )
      .order("aangemaakt", { ascending: true });
    if (status) cq = cq.eq("status", status);

    const { data: cItems, error: cErr } = await cq;
    if (cErr) {
      console.error("Classificatie-queue ophalen fout:", cErr);
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }

    const { data: cAlle } = await supabase
      .from("classificatie_voorstellen")
      .select("status");
    const tellingen = (cAlle ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({ items: cItems ?? [], tellingen });
  } catch (e) {
    console.error("Fout in GET /api/classificatie/queue:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
