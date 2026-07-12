// ============================================================
//  GET/POST /api/metadata-review/queue — Increment C
//
//  Generieke "Te beoordelen"-hub. De `stream`-parameter maakt de hub
//  uitbreidbaar: C levert stream=metadata (documenten die nog niet verrijkt
//  zijn / uit backfill); Increment E hangt er stream=classificatie naast
//  (AI-procesclassificatie-review) ZONDER een tweede scherm.
//
//  GET  ?stream=metadata&status=open  — queue van het eigen fonds.
//  POST { document_id, actie: 'in_behandeling'|'gecontroleerd'|'afgewezen', opmerking? }
//       — beoordeel een item. Capability-gated (metadata.review).
//
//  Tenant-isolatie via RLS (anon-key + fonds_id). Geen service-role.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { requireCapability } from "@/core/lib/capabilities";

export const dynamic = "force-dynamic";

const GELDIGE_STREAMS = ["metadata", "classificatie"] as const; // E voegt 'classificatie' toe
const GELDIGE_ACTIES = ["in_behandeling", "gecontroleerd", "afgewezen"] as const;

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const url = new URL(req.url);
    const stream = url.searchParams.get("stream") ?? "metadata";
    const status = url.searchParams.get("status"); // optioneel filter
    if (!GELDIGE_STREAMS.includes(stream as (typeof GELDIGE_STREAMS)[number])) {
      return NextResponse.json(
        { error: `Onbekende stream: ${stream}` },
        { status: 400 }
      );
    }

    // stream=classificatie → AI-procesclassificatievoorstellen (Increment E).
    // Zelfde "Te beoordelen"-hub, ander datamodel + eigen statusovergangen; de
    // schrijfacties lopen via /api/classificatie/[id]/beoordeel|terugdraai.
    if (stream === "classificatie") {
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
      const cTellingen = (cAlle ?? []).reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {});

      return NextResponse.json({ stream, items: cItems ?? [], tellingen: cTellingen });
    }

    // stream=metadata → document_metadata_review_queue join documenten.
    let query = supabase
      .from("document_metadata_review_queue")
      .select(
        "id, document_id, reden, status, aangemaakt, beoordeeld_door, beoordeeld_op, opmerking, " +
          "documenten(id, titel, bibliotheek, bron, context, documenttype, status, bronstatus, documentdatum, metadata_review_status)"
      )
      .order("aangemaakt", { ascending: true });
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      console.error("Review-queue ophalen fout:", error);
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }

    // Aantallen per status voor badges (open = "nog niet verrijkt").
    const { data: alle } = await supabase
      .from("document_metadata_review_queue")
      .select("status");
    const tellingen = (alle ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({ stream, items: data ?? [], tellingen });
  } catch (e) {
    console.error("Fout in GET /api/metadata-review/queue:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    if (!(await requireCapability(user.id, "metadata.review"))) {
      return NextResponse.json(
        { error: "Geen rechten om reviews te beoordelen (metadata.review)" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      document_id?: string;
      actie?: string;
      opmerking?: string;
    };
    if (!body.document_id) {
      return NextResponse.json({ error: "document_id ontbreekt" }, { status: 400 });
    }
    if (!GELDIGE_ACTIES.includes(body.actie as (typeof GELDIGE_ACTIES)[number])) {
      return NextResponse.json(
        { error: `Ongeldige actie: ${body.actie}` },
        { status: 400 }
      );
    }

    // Huidige queue-rij + documentcontext (titel/fonds) ophalen — voor de
    // re-decision-guard en voor een volledig auditrecord.
    const { data: queueRij } = await supabase
      .from("document_metadata_review_queue")
      .select("status")
      .eq("document_id", body.document_id)
      .maybeSingle();
    if (!queueRij) {
      return NextResponse.json(
        { error: "Geen review-item gevonden voor dit document" },
        { status: 404 }
      );
    }
    // Re-decision-guard: een reeds genomen beslissing niet stil overschrijven.
    if (
      (body.actie === "gecontroleerd" || body.actie === "afgewezen") &&
      (queueRij.status === "gecontroleerd" || queueRij.status === "afgewezen")
    ) {
      return NextResponse.json(
        { error: `Dit item is al beoordeeld (${queueRij.status}).` },
        { status: 409 }
      );
    }

    const { data: doc } = await supabase
      .from("documenten")
      .select("titel, fonds_id, metadata_review_status")
      .eq("id", body.document_id)
      .maybeSingle();

    const nu = new Date().toISOString();
    const queueUpdate: Record<string, unknown> = {
      status: body.actie,
      opmerking: body.opmerking?.trim() || null,
    };
    if (body.actie !== "in_behandeling") {
      queueUpdate.beoordeeld_door = user.id;
      queueUpdate.beoordeeld_op = nu;
    }

    const { error: qFout } = await supabase
      .from("document_metadata_review_queue")
      .update(queueUpdate)
      .eq("document_id", body.document_id);
    if (qFout) {
      console.error("Review-queue update fout:", qFout);
      return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
    }

    // Spiegelt de review-status op het document zodat het label "nog niet
    // verrijkt" verdwijnt zodra gecontroleerd/afgewezen, en legt de beoordeling
    // append-only vast in document_metadata_log (auditbare bestuurshandeling).
    if (body.actie === "gecontroleerd" || body.actie === "afgewezen") {
      await supabase
        .from("documenten")
        .update({
          metadata_te_controleren: false,
          metadata_review_status: body.actie,
          metadata_gecontroleerd_door: user.id,
          metadata_gecontroleerd_op: nu,
        })
        .eq("id", body.document_id);

      const { data: profiel } = await supabase
        .from("profielen")
        .select("naam")
        .eq("id", user.id)
        .maybeSingle();

      const { error: logFout } = await supabase
        .from("document_metadata_log")
        .insert({
          document_id: body.document_id,
          document_titel_snapshot: doc?.titel ?? null,
          fonds_id: doc?.fonds_id ?? null,
          gewijzigd_door: user.id,
          gewijzigd_door_naam: profiel?.naam ?? null,
          veld_naam: "metadata_review_status",
          oude_waarde: doc?.metadata_review_status ?? null,
          nieuwe_waarde: body.actie,
          wijzig_reden: body.opmerking?.trim() || null,
          wijzig_type: "metadata",
          rag_impact: false,
        });
      if (logFout) {
        console.error("Review-audit-log fout:", logFout);
        return NextResponse.json(
          { error: "Beoordeling toegepast maar auditlog faalde" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, actie: body.actie });
  } catch (e) {
    console.error("Fout in POST /api/metadata-review/queue:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
