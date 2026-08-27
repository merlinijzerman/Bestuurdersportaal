import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";
import { pasActivatieCascadeToe } from "@/core/lib/procedure-activatie-cascade";

export const PATCH = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.stappen.wijzigen" }, capability: "procedures.manage", schema: z.object({ "status": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id, stapId } = params as { id: string; stapId: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as { status?: "actief" | "afgerond" };
    if (body.status !== "afgerond" && body.status !== "actief") {
      return NextResponse.json(
        { error: "Ongeldige status" },
        { status: 400 }
      );
    }

    // Haal de stap op
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("naam, status, procedure_id, volgorde, vereist_besluit")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json(
        { error: "Stap niet gevonden" },
        { status: 404 }
      );
    }

    if (body.status === "afgerond") {
      // D6: alleen een actieve of heropende stap kan worden afgerond. Een
      // geblokkeerde (of legacy 'open') stap direct afronden zou de
      // afhankelijkheidsgate server-side omzeilen — de CHECK-superset dwingt
      // legale overgangen niet af, dus dat gebeurt hier.
      if (stap.status !== "actief" && stap.status !== "heropend") {
        return NextResponse.json(
          { error: "Alleen een actieve of heropende stap kan worden afgerond" },
          { status: 400 }
        );
      }
      // Voor 'afgerond': controleer dat alle checklist-items voldaan zijn
      // en dat eventueel vereist besluit is vastgelegd
      const { data: checklistRijen } = await supabase
        .from("procedure_checklist")
        .select("voldaan, bewijs_vereist, actief")
        .eq("stap_id", stapId);
      // D7: soft-gedeactiveerde checklist-items tellen niet mee voor afronden.
      const checklist = (checklistRijen || []).filter(
        (c: { actief?: boolean | null }) => c.actief !== false
      );
      const allesVoldaan = checklist.every(
        (c: { voldaan: boolean }) => c.voldaan
      );
      if (!allesVoldaan) {
        return NextResponse.json(
          { error: "Niet alle checklist-items zijn voldaan" },
          { status: 400 }
        );
      }
      const heeftBewijsVereisten = checklist.some(
        (c: { bewijs_vereist: boolean }) => c.bewijs_vereist
      );
      if (heeftBewijsVereisten) {
        const { count } = await supabase
          .from("procedure_bewijs")
          .select("id", { count: "exact", head: true })
          .eq("stap_id", stapId);
        if (!count || count === 0) {
          return NextResponse.json(
            { error: "Bewijsstukken vereist maar niet aanwezig" },
            { status: 400 }
          );
        }
      }
      if (stap.vereist_besluit) {
        const { count } = await supabase
          .from("procedure_besluiten")
          .select("id", { count: "exact", head: true })
          .eq("stap_id", stapId);
        if (!count || count === 0) {
          return NextResponse.json(
            { error: "Stap vereist een formeel besluit dat nog niet is vastgelegd" },
            { status: 400 }
          );
        }
      }

      // Stap zelf op afgerond — via SECURITY DEFINER-RPC (#214-a1 / 0194): sinds de
      // kolom-revoke kan `authenticated` status/voltooid_* niet meer direct schrijven.
      // De RPC zet voltooid_door = auth.uid() (niet vervalsbaar), dwingt status-machine
      // + readiness af en logt 'stap_voltooid' in dezelfde transactie.
      const { error: afrondFout } = await supabase.rpc("fn_stap_afronden", {
        p_stap_id: stapId,
        p_procedure_id: id,
      });
      if (afrondFout) {
        const code = (afrondFout as { code?: string }).code;
        console.error("Stap voltooien fout:", afrondFout);
        if (code === "42501")
          return NextResponse.json({ error: afrondFout.message }, { status: 403 });
        if (code === "PC002")
          return NextResponse.json({ error: afrondFout.message }, { status: 400 });
        return NextResponse.json({ error: "Stap voltooien mislukt" }, { status: 500 });
      }

      // ── D6: activeerbaarheid herberekenen — of procedure afronden ──
      // Gedeelde helper (PR-C, #168): identiek gedrag, nu ook gebruikt door de
      // afronden-met-afwijking-route. Responscontract BEHOUDEN t.o.v. de oude route:
      // happy path {ok:true}; een faal in de cascade gaf voorheen (uncaught) een 500
      // "Serverfout" en doet dat nog steeds — nieuw is alleen de luide
      // `activatie_achterstand`-logregel die de helper additioneel wegschrijft.
      const cascade = await pasActivatieCascadeToe(
        supabase,
        id,
        { volgorde: stap.volgorde, naam: stap.naam },
        { gebruikerId: ctx.gebruikerId, naam: ctx.naam, email: ctx.email }
      );
      if (!cascade.ok) {
        return NextResponse.json({ error: "Serverfout" }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    // status='actief' — handmatig activeren (gebruikt bij latere edits). Via de
    // RPC (#214-a1): `authenticated` mag status niet meer direct schrijven.
    const { error: activeerFout } = await supabase.rpc("fn_stap_activeren", {
      p_stap_id: stapId,
      p_procedure_id: id,
    });
    if (activeerFout) {
      const code = (activeerFout as { code?: string }).code;
      console.error("Stap activeren fout:", activeerFout);
      if (code === "42501")
        return NextResponse.json({ error: activeerFout.message }, { status: 403 });
      if (code === "PC002")
        return NextResponse.json({ error: activeerFout.message }, { status: 400 });
      return NextResponse.json({ error: "Stap activeren mislukt" }, { status: 500 });
    }
    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "stap_gestart",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { stap: stap.naam },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH /api/procedures/[id]/stappen/[stapId]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
