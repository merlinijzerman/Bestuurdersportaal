import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";

// Bewijsstuk-mutaties op een lopende procedure (WO-2-vervolg):
//  • PATCH  — een document koppelen aan een vooraf opgegeven (titel-only)
//             bewijsstuk ("Nog te leveren" → geleverd).
//  • DELETE — een (foutief) bewijsstuk verwijderen.
//
// Beide lopen via de anon-key + RLS: de bestaande FOR ALL-policy
// "fonds proc bewijs" scopet op het eigen fonds (stap → procedure → fonds).
// Elke mutatie wordt append-only gelogd in procedure_log.

async function haalContext(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  procedureId: string,
  bewijsId: string
) {
  const { data: bewijs } = await supabase
    .from("procedure_bewijs")
    .select(
      "id, titel, document_id, toegevoegd_door, stap_id, procedure_stappen(naam, procedure_id)"
    )
    .eq("id", bewijsId)
    .single();
  if (!bewijs) return { fout: "Bewijsstuk niet gevonden", status: 404 } as const;
  const stapData = bewijs.procedure_stappen as
    | { naam: string; procedure_id: string }
    | { naam: string; procedure_id: string }[]
    | null
    | undefined;
  const stap = Array.isArray(stapData) ? stapData[0] : stapData;
  if (!stap || stap.procedure_id !== procedureId) {
    return { fout: "Bewijsstuk hoort niet bij deze procedure", status: 400 } as const;
  }
  return { bewijs, stap } as const;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; bewijsId: string }> }
) {
  try {
    const { id, bewijsId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      document_id?: string | null;
      documenttype?: string | null;
    };
    if (!body.document_id) {
      return NextResponse.json(
        { error: "document_id is verplicht" },
        { status: 400 }
      );
    }

    const ctx = await haalContext(supabase, id, bewijsId);
    if ("fout" in ctx) {
      return NextResponse.json({ error: ctx.fout }, { status: ctx.status });
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, fonds_id")
      .eq("id", user.id)
      .single();

    // Document moet bestaan én van het eigen fonds zijn (RLS scopet documenten
    // al; deze check geeft een nette 400 i.p.v. een stille mismatch).
    const { data: doc } = await supabase
      .from("documenten")
      .select("id, fonds_id, titel")
      .eq("id", body.document_id)
      .single();
    if (!doc || doc.fonds_id !== profiel?.fonds_id) {
      return NextResponse.json(
        { error: "Document niet gevonden in dit fonds" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { document_id: body.document_id };
    if (typeof body.documenttype === "string") {
      updates.documenttype = body.documenttype.trim() || null;
    }

    const { error: updFout } = await supabase
      .from("procedure_bewijs")
      .update(updates)
      .eq("id", bewijsId);
    if (updFout) {
      console.error("Bewijs koppelen fout:", updFout);
      return NextResponse.json({ error: "Koppelen mislukt" }, { status: 500 });
    }

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "bewijs_document_gekoppeld",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: { stap: ctx.stap.naam, titel: ctx.bewijs.titel, document: doc.titel },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH /api/procedures/[id]/bewijs/[bewijsId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; bewijsId: string }> }
) {
  try {
    const { id, bewijsId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const ctx = await haalContext(supabase, id, bewijsId);
    if ("fout" in ctx) {
      return NextResponse.json({ error: ctx.fout }, { status: ctx.status });
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol")
      .eq("id", user.id)
      .single();

    // Verwijderen mag de indiener zelf (eigen vergissing herstellen) of een
    // voorzitter/beheerder (dossierbeheer). De RLS-policy borgt daarnaast dat
    // het sowieso binnen het eigen fonds blijft.
    const isPrivileged = ["voorzitter", "beheerder"].includes(profiel?.rol ?? "");
    const isIndiener = ctx.bewijs.toegevoegd_door === user.id;
    if (!isPrivileged && !isIndiener) {
      return NextResponse.json(
        {
          error:
            "Alleen de indiener of een voorzitter/beheerder kan dit bewijsstuk verwijderen",
        },
        { status: 403 }
      );
    }

    // Snapshot van de te loggen velden vóór de delete (de rij is straks weg).
    const logPayload = {
      stap: ctx.stap.naam,
      titel: ctx.bewijs.titel,
      document_id: ctx.bewijs.document_id ?? null,
    };

    const { error: delFout } = await supabase
      .from("procedure_bewijs")
      .delete()
      .eq("id", bewijsId);
    if (delFout) {
      console.error("Bewijs verwijderen fout:", delFout);
      return NextResponse.json({ error: "Verwijderen mislukt" }, { status: 500 });
    }

    // Auditregel ná de geslaagde delete (CLAUDE.md: log ná de wijziging).
    // document_id in de payload zodat de verwijderde koppeling reconstrueerbaar
    // blijft (het bibliotheekdocument zelf blijft bestaan).
    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "bewijs_verwijderd",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: logPayload,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in DELETE /api/procedures/[id]/bewijs/[bewijsId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
