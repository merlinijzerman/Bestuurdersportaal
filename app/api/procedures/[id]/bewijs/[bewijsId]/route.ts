import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import {
  leesVereisteVerwijzing,
  resolveRequirementBinding,
} from "@/core/lib/bewijs-binding";

// Bewijsstuk-mutaties op een lopende procedure (WO-2-vervolg):
//  • PATCH  — een document koppelen aan een vooraf opgegeven (titel-only)
//             bewijsstuk ("Nog te leveren" → geleverd), en/of de
//             bewijs↔vereiste-binding zetten, wijzigen of losmaken.
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
      "id, titel, document_id, requirement_sleutel, toegevoegd_door, stap_id, procedure_stappen(naam, procedure_id, volgorde)"
    )
    .eq("id", bewijsId)
    .single();
  if (!bewijs) return { fout: "Bewijsstuk niet gevonden", status: 404 } as const;
  type StapRef = { naam: string; procedure_id: string; volgorde: number };
  const stapData = bewijs.procedure_stappen as
    | StapRef
    | StapRef[]
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
      // Bewijsbinding: triple = binden/wijzigen, null = losmaken,
      // afwezig = binding ongemoeid laten.
      vereiste?: unknown;
    };
    const wilKoppelen = typeof body.document_id === "string" && !!body.document_id;
    const wilBinden = body.vereiste !== undefined;
    if (!wilKoppelen && !wilBinden) {
      return NextResponse.json(
        { error: "document_id of vereiste is verplicht" },
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

    const updates: Record<string, unknown> = {};

    let doc: { id: string; fonds_id: string; titel: string } | null = null;
    if (wilKoppelen) {
      // Document moet bestaan én van het eigen fonds zijn (RLS scopet documenten
      // al; deze check geeft een nette 400 i.p.v. een stille mismatch).
      const { data: gevonden } = await supabase
        .from("documenten")
        .select("id, fonds_id, titel")
        .eq("id", body.document_id)
        .single();
      if (!gevonden || gevonden.fonds_id !== profiel?.fonds_id) {
        return NextResponse.json(
          { error: "Document niet gevonden in dit fonds" },
          { status: 400 }
        );
      }
      doc = gevonden;
      updates.document_id = body.document_id;
      if (typeof body.documenttype === "string") {
        updates.documenttype = body.documenttype.trim() || null;
      }
    }

    const oudeSleutel = ctx.bewijs.requirement_sleutel ?? null;
    let nieuweSleutel: string | null = oudeSleutel;
    if (wilBinden) {
      const verwijzing = leesVereisteVerwijzing(body.vereiste);
      if (verwijzing === "ongeldig") {
        return NextResponse.json(
          { error: "Ongeldige vereiste-verwijzing" },
          { status: 400 }
        );
      }
      if (verwijzing === null) {
        nieuweSleutel = null;
      } else {
        const binding = await resolveRequirementBinding(
          supabase,
          id,
          verwijzing,
          ctx.stap.volgorde
        );
        if (!binding.ok) {
          return NextResponse.json(
          { error: binding.fout },
          { status: binding.serverfout ? 500 : 400 }
        );
        }
        nieuweSleutel = binding.sleutel;
      }
      updates.requirement_sleutel = nieuweSleutel;
    }

    const { error: updFout } = await supabase
      .from("procedure_bewijs")
      .update(updates)
      .eq("id", bewijsId);
    if (updFout) {
      console.error("Bewijs bijwerken fout:", updFout);
      return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
    }

    if (doc) {
      await supabase.from("procedure_log").insert({
        procedure_id: id,
        event_type: "bewijs_document_gekoppeld",
        actor_id: user.id,
        actor_naam: profiel?.naam || null,
        payload: {
          bewijs_id: bewijsId,
          stap: ctx.stap.naam,
          titel: ctx.bewijs.titel,
          document: doc.titel,
          document_id_oud: ctx.bewijs.document_id ?? null,
          document_id_nieuw: body.document_id ?? null,
        },
      });
    }
    // Een binding bepaalt of een (blokkerend) vereiste als vervuld geldt.
    // Daarom een eigen append-only event, met de oude én nieuwe waarde.
    if (wilBinden && nieuweSleutel !== oudeSleutel) {
      await supabase.from("procedure_log").insert({
        procedure_id: id,
        event_type: "bewijs_binding_gewijzigd",
        actor_id: user.id,
        actor_naam: profiel?.naam || null,
        payload: {
          bewijs_id: bewijsId,
          stap: ctx.stap.naam,
          titel: ctx.bewijs.titel,
          oud: oudeSleutel,
          nieuw: nieuweSleutel,
        },
      });
    }

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
    // `requirement_sleutel` hoort hier expliciet bij: door dit stuk te
    // verwijderen valt de vereiste die het vervulde weer open, en zonder de
    // sleutel is uit de log niet te zien wélke dat was.
    const logPayload = {
      bewijs_id: bewijsId,
      stap: ctx.stap.naam,
      titel: ctx.bewijs.titel,
      document_id: ctx.bewijs.document_id ?? null,
      requirement_sleutel: ctx.bewijs.requirement_sleutel ?? null,
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
