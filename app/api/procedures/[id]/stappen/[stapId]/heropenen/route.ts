import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";
import { z } from "zod";

// POST /api/procedures/[id]/stappen/[stapId]/heropenen
//
// Heropent een AFGERONDE stap (D6, iteratie/rework). Voorbehouden aan
// voorzitter/beheerder en alleen met verplichte motivering. Append-only
// gelogd als governance_event; de eerdere afronding blijft in het spoor
// (nieuwe versie van het oordeel, geen overschrijving). Afhankelijke,
// reeds afgeronde stappen worden NIET teruggezet maar gemarkeerd met
// `herbevestiging_nodig = true` (zichtbaar, niet-blokkerend signaal).
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.stappen.heropenen" }, capability: "procedures.manage", schema: z.object({ "motivering": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id, stapId } = params as { id: string; stapId: string };
    const supabase = ctx.supabase;

    const body = (await req.json().catch(() => ({}))) as { motivering?: string };
    const motivering = body.motivering?.trim();
    if (!motivering) {
      return NextResponse.json(
        { error: "Heropenen vereist een motivering" },
        { status: 400 }
      );
    }

    // Capability: alleen voorzitter/beheerder mogen heropenen (vrijheidsniveau 2/3).
    // BESLUIT (W4): `!profiel ||` valt weg en `ctx.rol` krijgt `?? ""`.
    // Uitkomst-identiek: geen profielrij -> haalProfiel geeft null -> ctx.rol is
    // null -> "" -> 403; profielrij met rol null idem; rol gezet ongewijzigd.
    // Zelfde afweging als bij de twee documents-backfills.
    if (!["voorzitter", "beheerder"].includes(ctx.rol ?? "")) {
      return NextResponse.json(
        { error: "Alleen voorzitter of beheerder kan een stap heropenen" },
        { status: 403 }
      );
    }

    // Stap laden (RLS begrenst tot het eigen fonds).
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("id, naam, status, procedure_id, volgorde")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json({ error: "Stap niet gevonden" }, { status: 404 });
    }
    if (stap.status !== "afgerond") {
      return NextResponse.json(
        { error: "Alleen een afgeronde stap kan worden heropend" },
        { status: 400 }
      );
    }

    // #214-a1 (0194): status + herbevestiging + governance_event + procedure-status
    // + log lopen nu ATOMAIR in fn_stap_heropenen (SECURITY DEFINER). Sinds de
    // kolom-revoke mag `authenticated` procedure_stappen.status niet meer direct
    // schrijven; en de atomariteit vervangt de oude best-effort compensatie: faalt
    // de audit-insert, dan rolt de statuswijziging vanzelf terug. ensureDecisionForProcedure
    // blijft vóór de RPC zodat er een primair Decision Object bestaat (de RPC zoekt
    // het op, fail-closed).
    await ensureDecisionForProcedure(supabase, id);
    const { data: heropend, error: heropenFout } = await supabase.rpc("fn_stap_heropenen", {
      p_stap_id: stapId,
      p_procedure_id: id,
      p_motivering: motivering,
    });
    if (heropenFout) {
      const code = (heropenFout as { code?: string }).code;
      console.error("Stap heropenen fout:", heropenFout);
      if (code === "42501")
        return NextResponse.json({ error: heropenFout.message }, { status: 403 });
      if (code === "PC002")
        return NextResponse.json({ error: heropenFout.message }, { status: 400 });
      return NextResponse.json({ error: "Heropenen mislukt" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      herbevestiging_nodig:
        (heropend as { herbevestiging_nodig?: number[] } | null)?.herbevestiging_nodig ?? [],
    });
  } catch (e) {
    console.error("Fout in POST …/stappen/[stapId]/heropenen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
