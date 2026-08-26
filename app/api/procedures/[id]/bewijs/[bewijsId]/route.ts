import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";
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
// Elke mutatie wordt door de database-trigger atomair en append-only gelogd in
// procedure_log, óók als zij buiten deze route om via PostgREST loopt.

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
  const stapData = bewijs.procedure_stappen as
    | { naam: string; procedure_id: string; volgorde: number }
    | { naam: string; procedure_id: string; volgorde: number }[]
    | null
    | undefined;
  const stap = Array.isArray(stapData) ? stapData[0] : stapData;
  if (!stap || stap.procedure_id !== procedureId) {
    return { fout: "Bewijsstuk hoort niet bij deze procedure", status: 400 } as const;
  }
  return { bewijs, stap } as const;
}

export const PATCH = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.id.bewijs.bewijsId.patch" }, capability: "procedures.manage", schema: z.object({ "document_id": z.unknown().optional(), "documenttype": z.unknown().optional(), "vereiste": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id, bewijsId } = params as { id: string; bewijsId: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      document_id?: string | null;
      documenttype?: string | null;
      // triple = binden/wijzigen, null = losmaken, afwezig = ongemoeid.
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

    const bewijsCtx = await haalContext(supabase, id, bewijsId);
    if ("fout" in bewijsCtx) {
      return NextResponse.json({ error: bewijsCtx.fout }, { status: bewijsCtx.status });
    }

    const updates: Record<string, unknown> = {};
    if (wilKoppelen) {
      // Document moet bestaan én van het eigen fonds zijn (RLS scopet documenten
      // al; deze check geeft een nette 400 i.p.v. een stille mismatch).
      const { data: gevonden } = await supabase
        .from("documenten")
        .select("id, fonds_id, titel")
        .eq("id", body.document_id)
        .single();
      if (!gevonden || gevonden.fonds_id !== ctx.fondsId) {
        return NextResponse.json(
          { error: "Document niet gevonden in dit fonds" },
          { status: 400 }
        );
      }
      updates.document_id = body.document_id;
      if (typeof body.documenttype === "string") {
        updates.documenttype = body.documenttype.trim() || null;
      }
    }

    if (wilBinden) {
      const verwijzing = leesVereisteVerwijzing(body.vereiste);
      if (verwijzing === "ongeldig") {
        return NextResponse.json(
          { error: "Ongeldige vereiste-verwijzing" },
          { status: 400 }
        );
      }
      if (verwijzing === null) {
        updates.requirement_sleutel = null;
      } else {
        const binding = await resolveRequirementBinding(
          supabase,
          id,
          verwijzing,
          bewijsCtx.stap.volgorde
        );
        if (!binding.ok) {
          return NextResponse.json(
            { error: binding.fout },
            { status: binding.serverfout ? 500 : 400 }
          );
        }
        updates.requirement_sleutel = binding.sleutel;
      }
    }

    const { error: updFout } = await supabase
      .from("procedure_bewijs")
      .update(updates)
      .eq("id", bewijsId);
    if (updFout?.code === "23505") {
      return NextResponse.json(
        { error: "Aan dit vereiste is al een bewijsstuk gekoppeld" },
        { status: 409 }
      );
    }
    if (updFout?.code === "23514") {
      return NextResponse.json(
        { error: "Ongeldige of niet-eenduidige vereiste-binding" },
        { status: 400 }
      );
    }
    if (updFout) {
      console.error("Bewijs bijwerken fout:", updFout);
      return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH /api/procedures/[id]/bewijs/[bewijsId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});

export const DELETE = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.id.bewijs.bewijsId.delete" }, capability: "procedures.manage", schema: "geen-body" }, async (ctx, _req: NextRequest, params) => {
  try {
    const { id, bewijsId } = params as { id: string; bewijsId: string };
    const supabase = ctx.supabase;

    const bewijsCtx = await haalContext(supabase, id, bewijsId);
    if ("fout" in bewijsCtx) {
      return NextResponse.json({ error: bewijsCtx.fout }, { status: bewijsCtx.status });
    }

    // Verwijderen mag de indiener zelf (eigen vergissing herstellen) of een
    // voorzitter/beheerder (dossierbeheer). De RLS-policy borgt daarnaast dat
    // het sowieso binnen het eigen fonds blijft.
    const isPrivileged = ["voorzitter", "beheerder"].includes(ctx.rol ?? "");
    const isIndiener = bewijsCtx.bewijs.toegevoegd_door === ctx.gebruikerId;
    if (!isPrivileged && !isIndiener) {
      return NextResponse.json(
        {
          error:
            "Alleen de indiener of een voorzitter/beheerder kan dit bewijsstuk verwijderen",
        },
        { status: 403 }
      );
    }

    const { error: delFout } = await supabase
      .from("procedure_bewijs")
      .delete()
      .eq("id", bewijsId);
    if (delFout) {
      console.error("Bewijs verwijderen fout:", delFout);
      return NextResponse.json({ error: "Verwijderen mislukt" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in DELETE /api/procedures/[id]/bewijs/[bewijsId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
