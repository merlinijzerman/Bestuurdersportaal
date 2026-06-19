// ============================================================
//  GET/PATCH /api/documents/[id]/metadata — Increment C
//
//  GET    — huidige metadata + bewerkopties (toegestane vervolgstatussen,
//           contextblokkers) zodat de UI vereisten VOORAF toont.
//  PATCH  — metadata corrigeren/verrijken zonder herupload. Capability-gated
//           (server-side leidend); statusovergangen volgen de transitiespec;
//           reden verplicht waar vereist; RAG-impact vooraf via ?preview /
//           {preview:true}; elke gewijzigde veldwaarde → één append-only
//           record in document_metadata_log.
//
//  Tenant-isolatie via RLS (anon-key + fonds_id). Geen service-role.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { rolHeeftCapability } from "@/lib/capabilities";
import {
  bouwMetadataPlan,
  type HuidigDocument,
  type MetadataVerzoek,
  type GebruikerCapabilities,
} from "@/lib/document-metadata-service";
import { toegestaneVervolgstatussen } from "@/lib/document-status-transities";
import { valideerContext } from "@/lib/document-metadata";

export const dynamic = "force-dynamic";

const METADATA_SELECT =
  "id, titel, fonds_id, actief, opgeslagen_door, context, procesinstantie_id, vergadering_id, agendapunt_id, documenttype, status, bronstatus, documentdatum, geldig_vanaf, geldig_tot, vervangt_document_id, vervangen_door_document_id, metadata_te_controleren, metadata_review_status, metadata_gecontroleerd_door, metadata_gecontroleerd_op";

async function leesCapabilities(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string
): Promise<{ rol: string | null; naam: string | null; caps: GebruikerCapabilities }> {
  const { data: profiel } = await supabase
    .from("profielen")
    .select("rol, naam")
    .eq("id", userId)
    .maybeSingle();
  const rol = profiel?.rol ?? null;
  return {
    rol,
    naam: profiel?.naam ?? null,
    caps: {
      metadataUpdate: rolHeeftCapability(rol, "documents.metadata.update"),
      statusChange: rolHeeftCapability(rol, "documents.status.change"),
      bronstatusChange: rolHeeftCapability(rol, "documents.bronstatus.change"),
    },
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data: document, error } = await supabase
      .from("documenten")
      .select(METADATA_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error || !document) {
      return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
    }

    const { caps } = await leesCapabilities(supabase, user.id);

    return NextResponse.json({
      document,
      bewerkbaar: caps,
      toegestane_vervolgstatussen: document.status
        ? toegestaneVervolgstatussen(document.status)
        : [],
      context_blokkers: valideerContext({
        context: document.context,
        procesinstantie_id: document.procesinstantie_id,
        vergadering_id: document.vergadering_id,
        agendapunt_id: document.agendapunt_id,
      }),
    });
  } catch (e) {
    console.error("Fout in GET /api/documents/[id]/metadata:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as MetadataVerzoek & {
      preview?: boolean;
      markeer_gecontroleerd?: boolean;
    };

    const { data: document, error: leesFout } = await supabase
      .from("documenten")
      .select(METADATA_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (leesFout || !document) {
      return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
    }

    const { rol, naam, caps } = await leesCapabilities(supabase, user.id);

    // Het afronden van een review (markeer_gecontroleerd) is een eigen
    // beheeractie en vereist de capability metadata.review — net als de queue-
    // route. Server-side leidend; voorkomt dat documents.metadata.update alleen
    // al een review kan afsluiten.
    if (
      body.markeer_gecontroleerd &&
      !rolHeeftCapability(rol, "metadata.review")
    ) {
      return NextResponse.json(
        { error: "Geen rechten om een review af te ronden (metadata.review)" },
        { status: 403 }
      );
    }

    const huidig: HuidigDocument = {
      status: document.status,
      bronstatus: document.bronstatus,
      context: document.context,
      procesinstantie_id: document.procesinstantie_id,
      vergadering_id: document.vergadering_id,
      agendapunt_id: document.agendapunt_id,
      documenttype: document.documenttype,
      documentdatum: document.documentdatum,
      geldig_vanaf: document.geldig_vanaf,
      geldig_tot: document.geldig_tot,
      vervangt_document_id: document.vervangt_document_id,
      vervangen_door_document_id: document.vervangen_door_document_id,
    };

    const plan = bouwMetadataPlan(huidig, body, caps);

    // RAG-impact + blokkers VOORAF tonen (UX-principe): preview past niets toe.
    if (body.preview) {
      return NextResponse.json({ preview: true, plan });
    }

    if (plan.blokkers.length > 0) {
      return NextResponse.json(
        { error: "Contextvereisten niet vervuld", blokkers: plan.blokkers },
        { status: 422 }
      );
    }
    if (plan.fouten.length > 0) {
      const isPermissie = plan.fouten.some((f) => f.includes("rechten"));
      return NextResponse.json(
        { error: plan.fouten[0], fouten: plan.fouten },
        { status: isPermissie ? 403 : 400 }
      );
    }
    if (plan.wijzigingen.length === 0 && !body.markeer_gecontroleerd) {
      return NextResponse.json({ error: "Geen wijzigingen meegegeven" }, { status: 400 });
    }

    // ── Toepassen op documenten (alleen gewijzigde velden) ──
    const update: Record<string, unknown> = {};
    for (const w of plan.wijzigingen) {
      update[w.veld] = (body as Record<string, unknown>)[w.veld] ?? null;
    }
    if (body.markeer_gecontroleerd) {
      update.metadata_te_controleren = false;
      update.metadata_review_status = "gecontroleerd";
      update.metadata_gecontroleerd_door = user.id;
      update.metadata_gecontroleerd_op = new Date().toISOString();
    }

    if (Object.keys(update).length > 0) {
      const { error: updFout } = await supabase
        .from("documenten")
        .update(update)
        .eq("id", id);
      if (updFout) {
        console.error("Metadata-update fout:", updFout);
        return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
      }
    }

    // ── Append-only auditlog: één record per gewijzigd veld + review-beoordeling ──
    const reden = body.reden?.trim() || null;
    const basis = {
      document_id: id,
      document_titel_snapshot: document.titel,
      fonds_id: document.fonds_id,
      gewijzigd_door: user.id,
      gewijzigd_door_naam: naam,
    };
    const logRijen: Record<string, unknown>[] = plan.wijzigingen.map((w) => ({
      ...basis,
      veld_naam: w.veld,
      oude_waarde: w.oude_waarde,
      nieuwe_waarde: w.nieuwe_waarde,
      wijzig_reden: reden, // de reden uit het verzoek geldt voor alle wijzigingen erin
      wijzig_type: w.wijzig_type,
      rag_impact: w.rag_impact,
    }));
    // Review-afronding is óók een auditbare bestuurshandeling — log haar als
    // expliciet record, ook als er geen andere veldwijziging is.
    if (body.markeer_gecontroleerd) {
      logRijen.push({
        ...basis,
        veld_naam: "metadata_review_status",
        oude_waarde: document.metadata_review_status,
        nieuwe_waarde: "gecontroleerd",
        wijzig_reden: reden,
        wijzig_type: "metadata",
        rag_impact: false,
      });
    }
    if (logRijen.length > 0) {
      const { error: logFout } = await supabase
        .from("document_metadata_log")
        .insert(logRijen);
      if (logFout) {
        console.error("Metadata-log fout:", logFout);
        return NextResponse.json(
          { error: "Wijziging toegepast maar auditlog faalde" },
          { status: 500 }
        );
      }
    }

    // ── Review-queue bijwerken als het document is gecontroleerd ──
    if (body.markeer_gecontroleerd && document.fonds_id) {
      await supabase
        .from("document_metadata_review_queue")
        .update({
          status: "gecontroleerd",
          beoordeeld_door: user.id,
          beoordeeld_op: new Date().toISOString(),
        })
        .eq("document_id", id)
        .in("status", ["open", "in_behandeling"]);
    }

    return NextResponse.json({
      success: true,
      aantal_wijzigingen: plan.wijzigingen.length,
      rag_impact: plan.ragImpact,
      herindexering: plan.ragImpact,
    });
  } catch (e) {
    console.error("Fout in PATCH /api/documents/[id]/metadata:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
