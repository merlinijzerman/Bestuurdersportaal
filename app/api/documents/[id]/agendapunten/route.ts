// ============================================================
//  GET/POST/DELETE /api/documents/[id]/agendapunten
//
//  Non-destructieve vergaderkoppelingen (spiegelt de procesinstanties-route,
//  Increment C). De PRIMAIRE vergaderkoppeling blijft documenten.agendapunt_id /
//  vergadering_id (+ context='vergadering'); die verhuist het document naar de
//  vergadercontext. Deze n-op-n koppeling laat een bibliotheekdocument aan
//  meerdere agendapunten hangen ZONDER zijn context/classificatie te wijzigen,
//  via document_agendapunten met:
//   * document niet-generiek (DB-trigger fn_document_agendapunt_validatie),
//   * vergadering_id afgeleid uit + horend bij het agendapunt,
//   * fondsconsistentie document = vergadering = koppeling,
//   * secundair <> primair (documenten.agendapunt_id),
//   * uniek (document_id, agendapunt_id).
//
//  Capability documents.metadata.update; tenant-isolatie via RLS. De DB-
//  triggers zijn de laatste verdedigingslinie; hier vangen we hun excepties
//  netjes af naar leesbare foutmeldingen.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { z } from "zod";

export const dynamic = "force-dynamic";

export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "documents.view", schema: "geen-body" }, async (ctx, _req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const { data, error } = await supabase
      .from("document_agendapunten")
      .select(
        "id, agendapunt_id, vergadering_id, aangemaakt, agendapunten(id, titel), vergaderingen(id, titel, datum)"
      )
      .eq("document_id", id)
      .order("aangemaakt", { ascending: true });
    if (error) {
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }
    return NextResponse.json({ koppelingen: data ?? [] });
  } catch (e) {
    console.error("Fout in GET .../agendapunten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "documents.agendapunt-koppelen" }, capability: "documents.metadata.update", schema: z.object({ "agendapunt_id": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    if (!(await requireCapability(ctx.gebruikerId, "documents.metadata.update"))) {
      return NextResponse.json(
        { error: "Geen rechten om koppelingen te beheren (documents.metadata.update)" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      agendapunt_id?: string;
    };
    if (!body.agendapunt_id) {
      return NextResponse.json({ error: "agendapunt_id ontbreekt" }, { status: 400 });
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
        { error: "Een generiek document kan geen vergaderkoppeling krijgen." },
        { status: 422 }
      );
    }

    // vergadering_id afgeleid uit het agendapunt (gedenormaliseerd opgeslagen;
    // de DB-trigger dwingt de consistentie nogmaals af).
    const { data: agendapunt } = await supabase
      .from("agendapunten")
      .select("id, vergadering_id")
      .eq("id", body.agendapunt_id)
      .maybeSingle();
    if (!agendapunt || !agendapunt.vergadering_id) {
      return NextResponse.json(
        { error: "Agendapunt niet gevonden of niet aan een vergadering gekoppeld." },
        { status: 404 }
      );
    }

    const { error } = await supabase.from("document_agendapunten").insert({
      fonds_id: document.fonds_id,
      document_id: id,
      agendapunt_id: body.agendapunt_id,
      vergadering_id: agendapunt.vergadering_id,
      aangemaakt_door: ctx.gebruikerId,
    });
    if (error) {
      console.error("Koppeling-insert fout:", error);
      // 23505 = uniek-schending; P0001 = bewuste, leesbare plpgsql-trigger-
      // melding (generiek, fondsconsistentie, verkeerde vergadering, secundair =
      // primair). Andere codes: generieke melding, geen interne DB-details lekken.
      const melding =
        error.code === "23505"
          ? "Dit document is al aan dit agendapunt gekoppeld."
          : error.code === "P0001"
          ? error.message
          : "Koppelen mislukt — controleer of de koppeling geldig is (zelfde fonds, niet gelijk aan de primaire koppeling).";
      return NextResponse.json({ error: melding }, { status: 422 });
    }

    // Auditspoor (append-only).
    await supabase.from("document_metadata_log").insert({
      document_id: id,
      document_titel_snapshot: document.titel,
      fonds_id: document.fonds_id,
      gewijzigd_door: ctx.gebruikerId,
      gewijzigd_door_naam: ctx.naam ?? null,
      veld_naam: "gekoppeld_agendapunt",
      oude_waarde: null,
      nieuwe_waarde: body.agendapunt_id,
      wijzig_type: "koppeling",
      rag_impact: true,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Fout in POST .../agendapunten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});

export const DELETE = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "documents.agendapunt-ontkoppelen" }, capability: "documents.metadata.update", schema: z.object({ "agendapunt_id": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    if (!(await requireCapability(ctx.gebruikerId, "documents.metadata.update"))) {
      return NextResponse.json(
        { error: "Geen rechten om koppelingen te beheren (documents.metadata.update)" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      agendapunt_id?: string;
    };
    if (!body.agendapunt_id) {
      return NextResponse.json({ error: "agendapunt_id ontbreekt" }, { status: 400 });
    }

    const { data: document } = await supabase
      .from("documenten")
      .select("fonds_id, titel")
      .eq("id", id)
      .maybeSingle();

    // .select() geeft de daadwerkelijk verwijderde rijen terug -> log alleen
    // bij een echte ontkoppeling (geen spook-auditrecords bij 0 matches).
    const { data: verwijderd, error } = await supabase
      .from("document_agendapunten")
      .delete()
      .eq("document_id", id)
      .eq("agendapunt_id", body.agendapunt_id)
      .select("id");
    if (error) {
      console.error("Ontkoppelen fout:", error);
      return NextResponse.json({ error: "Ontkoppelen mislukt" }, { status: 500 });
    }
    if (!verwijderd || verwijderd.length === 0) {
      return NextResponse.json(
        { error: "Geen bestaande vergaderkoppeling gevonden om te verwijderen." },
        { status: 404 }
      );
    }

    await supabase.from("document_metadata_log").insert({
      document_id: id,
      document_titel_snapshot: document?.titel ?? null,
      fonds_id: document?.fonds_id ?? null,
      gewijzigd_door: ctx.gebruikerId,
      gewijzigd_door_naam: ctx.naam ?? null,
      veld_naam: "gekoppeld_agendapunt",
      oude_waarde: body.agendapunt_id,
      nieuwe_waarde: null,
      wijzig_type: "koppeling",
      rag_impact: true,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Fout in DELETE .../agendapunten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
