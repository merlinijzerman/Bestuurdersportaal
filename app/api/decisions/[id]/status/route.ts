// POST /api/decisions/[id]/status
//
// Statusovergang van een Decision Object. Controlelagen:
//
//   1. §4.4-signalering i.p.v. de oude readiness-gate (besluit 0187/0193).
//      Readiness was een ZACHT bestuurlijk oordeel dat als harde 400-gate was
//      ingekleed; §4.5 houdt alleen de harde invarianten (I1–I7). Uitvoering
//      (stappen) en bestuurlijke duiding (status) zijn gescheiden: een bestuur
//      mag besluiten vóór de nazorg af is. Gaat een besluit-transitie
//      (besloten/voorwaardelijk_besloten) door terwijl er vereisten open staan
//      BÓVEN optioneel, dan is dat geen blokkade maar wél een verantwoording:
//      een motivering is verplicht (I2, zelfde vorm als de afwijking bij
//      afronden), en het besluit wordt append-only vastgelegd
//      (`besluit_genomen_met_openstaande_vereisten`, de vorm die P4's
//      status-feitenmatrix blijft schrijven). De respons draagt een concrete
//      waarschuwing per zwaarte.
//
//   2. Open-stemming-guard: geen (voorwaardelijk) besloten met een open
//      gekoppelde stemming (VERGADERINGEN-V2 §7.6). Ongemoeid.
//
//   3. Status-overgangstrigger (DB, I4): `fn_decision_status_check` blokkeert
//      ongeldige overgangen (bv. concept → besloten). Fout netjes afgevangen.
//
// Audit-snapshot wordt door de DB-trigger automatisch aangemaakt bij overgang
// naar besloten/voorwaardelijk_besloten/in_evaluatie/afgesloten.
//
// Body: { status: DecisionStatus, reden?: string, motivering?: string }
//   `motivering` is verplicht bij een besluit met iets open boven optioneel.

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import {
  mapDecisionToProcedureStatus,
  type DecisionStatus,
} from "@/core/lib/decision-view";
import { buildDecisionDossierView } from "@/core/lib/decision";
import {
  openStaandeVereisten,
  heeftOpenBovenOptioneel,
  type OpenPerZwaarte,
} from "@/core/lib/besluitmoment-telling";
import { MIN_MOTIVERING_LENGTE } from "@/core/lib/afwijking";

const ALLE_STATUSSEN: DecisionStatus[] = [
  "concept",
  "in_onderbouwing",
  "in_validatie",
  "in_review",
  "geagendeerd",
  "in_bespreking",
  "besloten",
  "voorwaardelijk_besloten",
  "afgewezen",
  "aangehouden",
  "geescaleerd",
  "teruggezet",
  "in_uitvoering",
  "in_evaluatie",
  "afgesloten",
  "heropend",
  "geannuleerd",
];

// P3/PR-D (#168): de besluit-transities die "een feit stellen" — hier geldt de
// §4.4-signalering (motivering + vastlegging bij openstaande vereisten), niet meer
// de harde readiness-gate (besluit 0187).
const BESLUIT_TRANSITIES: DecisionStatus[] = ["besloten", "voorwaardelijk_besloten"];

interface Body {
  status?: DecisionStatus;
  reden?: string;
  // §4.4/I2: verplichte motivering wanneer een besluit doorgaat met iets open
  // boven optioneel — zelfde vorm als de afwijking bij afronden (PR-C).
  motivering?: string;
}

interface DecisionRowMin {
  id: string;
  procedure_id: string;
  status: DecisionStatus;
  complexiteit: "routine" | "complicated" | "complex";
  risiconiveau: "laag" | "middel" | "hoog";
}

export const POST = withFondsRoute({ capability: "decisions.manage" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: decisionId } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as Body;
    if (!body.status || !ALLE_STATUSSEN.includes(body.status)) {
      return NextResponse.json(
        { error: `Ongeldige status: ${body.status}` },
        { status: 400 }
      );
    }
    const target = body.status;

    // 1. Decision laden (RLS bewaakt fonds-isolatie).
    const { data: decRow, error: leesFout } = await supabase
      .from("decision_objects")
      .select("id, procedure_id, status, complexiteit, risiconiveau")
      .eq("id", decisionId)
      .maybeSingle();
    if (leesFout || !decRow) {
      return NextResponse.json(
        { error: "Decision Object niet gevonden of geen toegang" },
        { status: 404 }
      );
    }
    const decision = decRow as DecisionRowMin;

    if (decision.status === target) {
      return NextResponse.json({
        decision,
        gewijzigd: false,
        boodschap: "Status was al gelijk.",
      });
    }

    const actorNaam = ctx.naam;

    // 3. §4.4-signalering i.p.v. de harde readiness-gate (besluit 0187/0193).
    //    De overgang wordt NIET geblokkeerd omdat er iets open staat — een bestuur
    //    mag besluiten vóór de nazorg af is. Maar een besluit-transitie die doorgaat
    //    met iets open bóven optioneel is geen vrije doorgang: er is een motivering
    //    verplicht (zelfde vorm als de afwijking bij afronden, PR-C — I2), en het
    //    besluit wordt append-only vastgelegd. Niet blokkeren, wél onthouden.
    let openBijBesluit: OpenPerZwaarte | null = null;
    let besluitMotivering: string | null = null;
    if (BESLUIT_TRANSITIES.includes(target)) {
      const view = await buildDecisionDossierView(supabase, decisionId, {});
      const open = openStaandeVereisten(view.evidence);
      if (heeftOpenBovenOptioneel(open)) {
        const motivering = body.motivering?.trim();
        if (!motivering || motivering.length < MIN_MOTIVERING_LENGTE) {
          return NextResponse.json(
            {
              error: `Er staan vereisten open boven optioneel. Een besluit met openstaande vereisten vereist een motivering van minimaal ${MIN_MOTIVERING_LENGTE} tekens.`,
              openstaand: { kritiek: open.kritiek.length, vereist: open.vereist.length },
            },
            { status: 400 }
          );
        }
        openBijBesluit = open;
        besluitMotivering = motivering;
      }
    }

    // 3b. Guard: geen overgang naar (voorwaardelijk) besloten met een open
    //     gekoppelde stemming. Het besluit zou anders losraken van het
    //     stemproces (zie VERGADERINGEN-V2-ONTWERP.md §7.6).
    if (target === "besloten" || target === "voorwaardelijk_besloten") {
      const { data: openStemming } = await supabase
        .from("stemmingen")
        .select("id, vraag")
        .eq("decision_id", decisionId)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (openStemming) {
        return NextResponse.json(
          {
            error:
              "Er staat nog een open stemronde gekoppeld aan dit besluit. Sluit of trek die eerst in voordat u het besluit registreert.",
            open_stemming_id: (openStemming as { id: string }).id,
          },
          { status: 400 }
        );
      }
    }

    // 4. Update uitvoeren — DB-trigger valideert de transitie zelf.
    const { data: bijgewerkt, error: updFout } = await supabase
      .from("decision_objects")
      .update({ status: target })
      .eq("id", decisionId)
      .select()
      .single();
    if (updFout || !bijgewerkt) {
      // Trigger-fout van fn_decision_status_check is hier de meest
      // waarschijnlijke oorzaak. Eerder gaven we de DB-melding letterlijk
      // door, maar dat kan schema-details lekken (kolomnamen, constraint-
      // namen). Vanaf WP6 (Route A) tonen we alleen de generieke fallback;
      // de oorzaak wordt server-side gelogd voor traceerbaarheid.
      console.error("Decision status-overgang fout:", updFout);
      return NextResponse.json(
        { error: "Statusovergang mislukt. Mogelijk is deze overgang niet toegestaan." },
        { status: 400 }
      );
    }

    // 5. Governance events — eerst het besluit-met-openstaande-vereisten (0193,
    //    de vastleggingsvorm die P4's status-feitenmatrix blijft schrijven), dan
    //    status_gewijzigd.
    if (openBijBesluit) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "besluit_genomen_met_openstaande_vereisten",
        actor_id: ctx.gebruikerId,
        actor_naam: actorNaam,
        object_type: "decision_object",
        object_id: decisionId,
        reden: besluitMotivering,
        nieuwe_waarde: {
          target_status: target,
          openstaand: openBijBesluit, // per zwaarte, {label, requirement_sleutel}
        },
      });
    }

    await supabase.from("governance_events").insert({
      decision_id: decisionId,
      event_type: "status_gewijzigd",
      actor_id: ctx.gebruikerId,
      actor_naam: actorNaam,
      object_type: "decision_object",
      object_id: decisionId,
      reden: body.reden ?? null,
      oude_waarde: { status: decision.status },
      nieuwe_waarde: { status: target },
    });

    // 6. Sync naar `procedures.status` zodat het overzicht (/procedures)
    // consistent blijft. Bij eindstatussen (afgewezen/geannuleerd/
    // afgesloten) zetten we óók `afgerond_op` zodat het bestaande
    // "Procedure is afgerond"-blok op de detailpagina werkt.
    const legacyStatus = mapDecisionToProcedureStatus(target);
    const procUpdate: Record<string, unknown> = { status: legacyStatus };
    if (legacyStatus === "afgerond") {
      procUpdate.afgerond_op = new Date().toISOString();
    }
    const { error: procFout } = await supabase
      .from("procedures")
      .update(procUpdate)
      .eq("id", decision.procedure_id);
    if (procFout) {
      // Niet fataal — de Decision Object-update is gelukt; we loggen
      // een waarschuwing zodat we het in de Vercel-logs zien.
      console.warn(
        `procedures.status sync mislukt voor procedure ${decision.procedure_id}:`,
        procFout
      );
    }

    return NextResponse.json({
      decision: bijgewerkt,
      gewijzigd: true,
      procedure_status: legacyStatus,
      // §4.4-signalering: concreet, per zwaarte op besluitmoment-schaal — niet vaag.
      ...(openBijBesluit
        ? {
            waarschuwing: {
              boodschap:
                "Besluit genomen terwijl er vereisten openstonden — vastgelegd in het dossier.",
              openstaand: {
                kritiek: openBijBesluit.kritiek.length,
                vereist: openBijBesluit.vereist.length,
              },
            },
          }
        : {}),
    });
  } catch (e) {
    console.error("Fout in POST /api/decisions/[id]/status:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
