// ============================================================
//  GET/POST/DELETE /api/documents/[id]/procesinstanties — Increment C
//
//  Secundaire dossierkoppelingen (vereenvoudigd koppelmodel, FO §6). De
//  primaire koppeling blijft documenten.procesinstantie_id (Increment B);
//  secundaire koppelingen lopen via document_procesinstanties met:
//   • secundair ≠ primair (DB-trigger fn_document_procesinstantie_validatie),
//   • fondsconsistentie document = procesinstantie = koppeling (trigger),
//   • uniek (document_id, procesinstantie_id).
//
//  Capability documents.metadata.update; tenant-isolatie via RLS. De DB-
//  triggers zijn de laatste verdedigingslinie; hier vangen we hun excepties
//  netjes af naar leesbare foutmeldingen.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { requireCapability } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

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

    const { data, error } = await supabase
      .from("document_procesinstanties")
      .select("id, procesinstantie_id, aangemaakt, procedures(id, titel, status)")
      .eq("document_id", id)
      .order("aangemaakt", { ascending: true });
    if (error) {
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }
    return NextResponse.json({ koppelingen: data ?? [] });
  } catch (e) {
    console.error("Fout in GET .../procesinstanties:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

export async function POST(
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

    if (!(await requireCapability(user.id, "documents.metadata.update"))) {
      return NextResponse.json(
        { error: "Geen rechten om koppelingen te beheren (documents.metadata.update)" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      procesinstantie_id?: string;
    };
    if (!body.procesinstantie_id) {
      return NextResponse.json({ error: "procesinstantie_id ontbreekt" }, { status: 400 });
    }

    const { data: document } = await supabase
      .from("documenten")
      .select("id, fonds_id")
      .eq("id", id)
      .maybeSingle();
    if (!document) {
      return NextResponse.json({ error: "Document niet gevonden" }, { status: 404 });
    }
    if (!document.fonds_id) {
      return NextResponse.json(
        { error: "Een generiek document kan geen secundaire dossierkoppeling krijgen." },
        { status: 422 }
      );
    }

    const { error } = await supabase.from("document_procesinstanties").insert({
      fonds_id: document.fonds_id,
      document_id: id,
      procesinstantie_id: body.procesinstantie_id,
      aangemaakt_door: user.id,
    });
    if (error) {
      // DB-triggers geven leesbare excepties (secundair = primair, fonds, etc.)
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    // Auditspoor (append-only).
    await supabase.from("document_metadata_log").insert({
      document_id: id,
      fonds_id: document.fonds_id,
      gewijzigd_door: user.id,
      veld_naam: "secundaire_procesinstantie",
      oude_waarde: null,
      nieuwe_waarde: body.procesinstantie_id,
      wijzig_type: "koppeling",
      rag_impact: true,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Fout in POST .../procesinstanties:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

export async function DELETE(
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

    if (!(await requireCapability(user.id, "documents.metadata.update"))) {
      return NextResponse.json(
        { error: "Geen rechten om koppelingen te beheren (documents.metadata.update)" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      procesinstantie_id?: string;
    };
    if (!body.procesinstantie_id) {
      return NextResponse.json({ error: "procesinstantie_id ontbreekt" }, { status: 400 });
    }

    const { data: document } = await supabase
      .from("documenten")
      .select("fonds_id")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase
      .from("document_procesinstanties")
      .delete()
      .eq("document_id", id)
      .eq("procesinstantie_id", body.procesinstantie_id);
    if (error) {
      return NextResponse.json({ error: "Ontkoppelen mislukt" }, { status: 500 });
    }

    await supabase.from("document_metadata_log").insert({
      document_id: id,
      fonds_id: document?.fonds_id ?? null,
      gewijzigd_door: user.id,
      veld_naam: "secundaire_procesinstantie",
      oude_waarde: body.procesinstantie_id,
      nieuwe_waarde: null,
      wijzig_type: "koppeling",
      rag_impact: true,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Fout in DELETE .../procesinstanties:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
