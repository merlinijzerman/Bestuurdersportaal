import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute, type FondsContext } from "@/core/lib/route-wrapper";
import { ensureDecisionForProcedure } from "@/core/lib/decision";
import { pasActivatieCascadeToe } from "@/core/lib/procedure-activatie-cascade";

// POST /api/procedures/[id]/stappen/[stapId]/afwijking
//
// P3 (#168, §5.1): een stap kan ALTIJD worden afgerond; staat er iets open boven
// `optioneel`, dan legt een bevoegde rol (voorzitter/bestuurder) een gemotiveerde
// AFWIJKING vast — bij een openstaande `kritiek`-vereiste met expliciete
// bevestiging. "Overrulen is niet vervullen": de ontbrekende vereiste blijft open.
//
// De atomaire kern (status + vier kolommen + snapshot + procedure_log +
// governance-event) draait in één DB-transactie (fn_stap_afronden_met_afwijking);
// de activatie-cascade is afgeleide toestand en volgt erbuiten (besluit 0192).

// De inner handler wordt apart geëxporteerd zodat de rolgate in beide richtingen
// met een gewone gedragstest getoetst kan worden (afwijking-rolgate.test.ts) —
// zónder de karakteriseringsstack, die uit blijft tot P6.
export async function afrondenMetAfwijkingHandler(
  ctx: FondsContext,
  req: NextRequest,
  params: unknown
) {
    try {
      const { id, stapId } = params as { id: string; stapId: string };
      const supabase = ctx.supabase;

      // Inner rolgate: nette 403 + de deterministische bron voor het latere
      // AZ-3-scenario. De DB-functie draagt een EIGEN SLOT als tweede laag, zodat
      // een directe RPC-aanroep de poort niet omzeilt.
      if (!["voorzitter", "bestuurder"].includes(ctx.rol ?? "")) {
        return NextResponse.json(
          { error: "Alleen voorzitter of bestuurder kan een afwijking vastleggen" },
          { status: 403 }
        );
      }

      const body = (await req.json()) as { motivering?: string; bevestigd?: boolean };
      const motivering = body.motivering?.trim();
      if (!motivering) {
        return NextResponse.json({ error: "Een motivering is verplicht" }, { status: 400 });
      }

      // Stap server-side ophalen (RLS begrenst tot het eigen fonds): 404 + de
      // volgorde/naam die de cascade nodig heeft.
      const { data: stap } = await supabase
        .from("procedure_stappen")
        .select("naam, volgorde, procedure_id")
        .eq("id", stapId)
        .eq("procedure_id", id)
        .single();
      if (!stap) {
        return NextResponse.json({ error: "Stap niet gevonden" }, { status: 404 });
      }

      // De DB-functie schrijft een governance-event op het primaire Decision Object;
      // zorg dat het bestaat (idempotent, zoals de andere procedure-routes).
      await ensureDecisionForProcedure(supabase, id);

      const { error: rpcFout } = await supabase.rpc("fn_stap_afronden_met_afwijking", {
        p_stap_id: stapId,
        p_procedure_id: id,
        p_motivering: motivering,
        p_bevestigd: body.bevestigd ?? false,
      });
      if (rpcFout) {
        // Eigen SQLSTATE 'PC001' = kritiek open zonder bevestiging → 409.
        if (rpcFout.code === "PC001") {
          return NextResponse.json(
            {
              error: "Er staat een kritieke vereiste open; bevestig expliciet om af te ronden.",
              bevestiging_vereist: true,
            },
            { status: 409 }
          );
        }
        // 42501 = eigen slot (rol/fonds) → 403.
        if (rpcFout.code === "42501") {
          return NextResponse.json(
            { error: "Niet bevoegd om een afwijking vast te leggen" },
            { status: 403 }
          );
        }
        // 23514 = validatie (geen afwijking nodig / lege motivering / poort) → 400,
        // met de nette melding van de functie (geen schema-lek).
        if (rpcFout.code === "23514") {
          return NextResponse.json({ error: rpcFout.message }, { status: 400 });
        }
        console.error("Afwijking vastleggen fout:", rpcFout);
        return NextResponse.json({ error: "Afronden met afwijking mislukt" }, { status: 500 });
      }

      // Afgeleide toestand (buiten de transactie, herstelbaar): activatie-cascade.
      const cascade = await pasActivatieCascadeToe(
        supabase,
        id,
        { volgorde: stap.volgorde, naam: stap.naam },
        { gebruikerId: ctx.gebruikerId, naam: ctx.naam, email: ctx.email }
      );

      return NextResponse.json({
        ok: true,
        // Nieuw contract van DEZE route (niet van de bestaande PATCH): een luide
        // achterstand is al gelogd; de aanroeper wordt gewaarschuwd.
        ...(cascade.ok
          ? {}
          : {
              waarschuwing:
                "De stap is afgerond met afwijking; de vervolgactivering is nog niet voltooid en wordt hersteld.",
            }),
      });
    } catch (e) {
      console.error("Fout in POST …/afwijking:", e);
      return NextResponse.json({ error: "Serverfout" }, { status: 500 });
    }
}

export const POST = withFondsRoute(
  { capability: "procedures.afwijking.vastleggen" },
  afrondenMetAfwijkingHandler
);
