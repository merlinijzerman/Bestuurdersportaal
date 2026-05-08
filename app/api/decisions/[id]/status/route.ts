// POST /api/decisions/[id]/status
//
// Statusovergang van een Decision Object. Twee lagen van controle:
//
//   1. Readiness-gate (applicatie-niveau, conform §9 ontwerpdoc):
//        in_review                   → reviewrijp
//        geagendeerd                 → bespreekrijp
//        besloten / voorwaardelijk_besloten → besluitrijp
//        afgesloten                  → verantwoordingsrijp
//                                      + (complex/hoog) evaluatierijp
//      Voor deze targets vragen we eerst readiness via
//      `fn_decision_readiness_check`. Als die niet voldoet:
//        a) bestuurder zonder override → 400 met ontbrekend.
//        b) voorzitter/beheerder met `override_reden` → status wordt
//           wel doorgezet, maar er komt een `override_<readiness>`
//           governance event bovenop het gewone `status_gewijzigd`.
//
//   2. Status-overgangstrigger (database-niveau):
//      `fn_decision_status_check` blokkeert ongeldige overgangen
//      (bv. concept → besloten). Die fout vangen we netjes af.
//
// Audit-snapshot wordt door de DB-trigger automatisch aangemaakt
// bij overgang naar besloten/voorwaardelijk_besloten/in_evaluatie/afgesloten.
//
// Body:
//   {
//     status: DecisionStatus,
//     reden?: string,
//     override_reden?: string         // alleen relevant bij faillende readiness
//   }

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type {
  DecisionStatus,
  ReadinessTarget,
  ReadinessResult,
} from "@/lib/decision-view";

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

// Mapping target-status → vereist readiness-niveau (§9 ontwerpdoc).
const READINESS_VOOR_STATUS: Partial<Record<DecisionStatus, ReadinessTarget>> = {
  in_review: "reviewrijp",
  geagendeerd: "bespreekrijp",
  besloten: "besluitrijp",
  voorwaardelijk_besloten: "besluitrijp",
  afgesloten: "verantwoordingsrijp",
  // 'evaluatierijp' wordt aanvullend gecheckt voor complex/hoog
  // bij overgang naar afgesloten — zie logica hieronder.
};

interface Body {
  status?: DecisionStatus;
  reden?: string;
  override_reden?: string;
}

interface DecisionRowMin {
  id: string;
  status: DecisionStatus;
  complexiteit: "routine" | "complicated" | "complex";
  risiconiveau: "laag" | "middel" | "hoog";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: decisionId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

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
      .select("id, status, complexiteit, risiconiveau")
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

    // 2. Rolcheck voor override.
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol")
      .eq("id", user.id)
      .maybeSingle();
    const isPrivileged =
      profiel?.rol === "voorzitter" || profiel?.rol === "beheerder";
    const actorNaam = profiel?.naam ?? null;

    // 3. Readiness-gate (alleen voor bepaalde targets).
    const readinessTarget = READINESS_VOOR_STATUS[target];
    const overrides: { target: ReadinessTarget; ontbrekend: unknown }[] = [];

    async function readiness(t: ReadinessTarget): Promise<ReadinessResult> {
      const { data, error } = await supabase.rpc(
        "fn_decision_readiness_check",
        { p_decision_id: decisionId, p_target: t }
      );
      if (error) {
        throw new Error(`Readiness-check faalde: ${error.message}`);
      }
      return data as ReadinessResult;
    }

    if (readinessTarget) {
      const result = await readiness(readinessTarget);
      if (!result.voldoet) {
        if (!body.override_reden || !isPrivileged) {
          return NextResponse.json(
            {
              error: `Dossier voldoet niet aan ${readinessTarget}.`,
              readiness: result,
              kan_overrulen: result.kan_overrulen,
              hint: isPrivileged
                ? "Voeg 'override_reden' toe om door te zetten."
                : "Vraag voorzitter of beheerder voor een onderbouwde override.",
            },
            { status: 400 }
          );
        }
        overrides.push({ target: readinessTarget, ontbrekend: result.ontbrekend });
      }

      // Aanvullend: voor 'afgesloten' bij complex/hoog ook 'evaluatierijp'
      if (
        target === "afgesloten" &&
        (decision.complexiteit === "complex" || decision.risiconiveau === "hoog")
      ) {
        const evRes = await readiness("evaluatierijp");
        if (!evRes.voldoet) {
          if (!body.override_reden || !isPrivileged) {
            return NextResponse.json(
              {
                error:
                  "Bij complex of hoog risico is voor afsluiting óók 'evaluatierijp' vereist.",
                readiness: evRes,
                hint: isPrivileged
                  ? "Voeg 'override_reden' toe om door te zetten."
                  : "Vraag voorzitter of beheerder voor een onderbouwde override.",
              },
              { status: 400 }
            );
          }
          overrides.push({ target: "evaluatierijp", ontbrekend: evRes.ontbrekend });
        }
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
      // waarschijnlijke oorzaak. We geven de DB-melding letterlijk
      // door zodat de frontend hem kan tonen.
      return NextResponse.json(
        {
          error:
            updFout?.message ??
            "Statusovergang mislukt. Mogelijk is deze overgang niet toegestaan.",
        },
        { status: 400 }
      );
    }

    // 5. Governance events — eerst eventuele overrides, dan status_gewijzigd.
    for (const ov of overrides) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: `override_${ov.target}`,
        actor_id: user.id,
        actor_naam: actorNaam,
        object_type: "decision_object",
        object_id: decisionId,
        reden: body.override_reden ?? null,
        oude_waarde: { ontbrekend: ov.ontbrekend },
        nieuwe_waarde: {
          target_status: target,
          readiness_target: ov.target,
        },
      });
    }

    await supabase.from("governance_events").insert({
      decision_id: decisionId,
      event_type: "status_gewijzigd",
      actor_id: user.id,
      actor_naam: actorNaam,
      object_type: "decision_object",
      object_id: decisionId,
      reden: body.reden ?? null,
      oude_waarde: { status: decision.status },
      nieuwe_waarde: { status: target },
    });

    return NextResponse.json({
      decision: bijgewerkt,
      gewijzigd: true,
      via_override: overrides.length > 0,
    });
  } catch (e) {
    console.error("Fout in POST /api/decisions/[id]/status:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
