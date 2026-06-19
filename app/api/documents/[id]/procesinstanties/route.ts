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
      .select("id, fonds_id, titel")
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
      console.error("Koppeling-insert fout:", error);
      // P0001 = bewuste, leesbare plpgsql-trigger-melding (secundair = primair,
      // fondsconsistentie, generiek). Andere codes: generieke melding, geen
      // interne DB-details lekken.
      const melding =
        error.code === "23505"
          ? "Deze secundaire koppeling bestaat al."
          : error.code === "P0001"
          ? error.message
          : "Koppelen mislukt — controleer of de koppeling geldig is (zelfde fonds, niet gelijk aan de primaire procesinstantie).";
      return NextResponse.json({ error: melding }, { status: 422 });
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();

    // Auditspoor (append-only).
    await supabase.from("document_metadata_log").insert({
      document_id: id,
      document_titel_snapshot: document.titel,
      fonds_id: document.fonds_id,
      gewijzigd_door: user.id,
      gewijzigd_door_naam: profiel?.naam ?? null,
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
      .select("fonds_id, titel")
      .eq("id", id)
      .maybeSingle();

    // .select() geeft de daadwerkelijk verwijderde rijen terug → log alleen
    // bij een echte ontkoppeling (geen spook-auditrecords bij 0 matches).
    const { data: verwijderd, error } = await supabase
      .from("document_procesinstanties")
      .delete()
      .eq("document_id", id)
      .eq("procesinstantie_id", body.procesinstantie_id)
      .select("id");
    if (error) {
      console.error("Ontkoppelen fout:", error);
      return NextResponse.json({ error: "Ontkoppelen mislukt" }, { status: 500 });
    }
    if (!verwijderd || verwijderd.length === 0) {
      return NextResponse.json(
        { error: "Geen bestaande secundaire koppeling gevonden om te verwijderen." },
        { status: 404 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();

    await supabase.from("document_metadata_log").insert({
      document_id: id,
      document_titel_snapshot: document?.titel ?? null,
      fonds_id: document?.fonds_id ?? null,
      gewijzigd_door: user.id,
      gewijzigd_door_naam: profiel?.naam ?? null,
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
