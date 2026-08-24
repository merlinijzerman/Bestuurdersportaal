// POST /api/decisions/[id]/dissent
//
// Maakt een dissent-notitie aan voor een Decision Object. Zichtbaarheid
// bepaalt wie het ziet — RLS in Supabase doet het primaire werk
// (sectie 13.2 ontwerpdoc), deze route doet defense-in-depth
// validatie op de aangevraagde zichtbaarheid:
//
//   • prive             — alleen de auteur (geen rolcheck nodig).
//   • gedeelde_zorg     — voor voorzitter/beheerder + auteur (default).
//   • formele_dissent   — alle bestuurders binnen fonds.
//   • minderheidsnotitie — formeel vastgesteld in dossier.
//
// `formeel_vastgesteld=true` is een voorbehouden actie van voorzitter
// of beheerder — vandaar een server-side rolcheck.
//
// Body:
//   {
//     standpunt: string,
//     argument?: string | null,
//     zichtbaarheid?: 'prive'|'gedeelde_zorg'|'formele_dissent'|'minderheidsnotitie',
//     formeel_vastgesteld?: boolean,                // alleen voor voorzitter/beheerder
//     bestuurder_naam?: string,                     // override; default uit profiel
//     gekoppeld_risico_id?: string | null,
//     gekoppeld_aanname_id?: string | null,
//     gekoppeld_voorwaarde_id?: string | null
//   }

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { isBureauRol, BUREAU_WEIGERING } from "@/core/lib/bureau-gate";
import { z } from "zod";

const ZICHTBAARHEID = [
  "prive",
  "gedeelde_zorg",
  "formele_dissent",
  "minderheidsnotitie",
] as const;

interface CreateBody {
  standpunt?: string;
  argument?: string | null;
  zichtbaarheid?: (typeof ZICHTBAARHEID)[number];
  formeel_vastgesteld?: boolean;
  bestuurder_naam?: string;
  gekoppeld_risico_id?: string | null;
  gekoppeld_aanname_id?: string | null;
  gekoppeld_voorwaarde_id?: string | null;
  stemming_id?: string | null; // optionele koppeling naar een tegen-stem
}

export const POST = withFondsRoute({ capability: "decisions.manage", schema: z.object({ "argument": z.unknown().optional(), "bestuurder_naam": z.unknown().optional(), "formeel_vastgesteld": z.unknown().optional(), "gekoppeld_aanname_id": z.unknown().optional(), "gekoppeld_risico_id": z.unknown().optional(), "gekoppeld_voorwaarde_id": z.unknown().optional(), "standpunt": z.unknown().optional(), "stemming_id": z.unknown().optional(), "zichtbaarheid": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: decisionId } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as CreateBody;

    if (
      !body.standpunt ||
      typeof body.standpunt !== "string" ||
      !body.standpunt.trim()
    ) {
      return NextResponse.json(
        { error: "Standpunt is verplicht" },
        { status: 400 }
      );
    }
    if (
      body.zichtbaarheid &&
      !ZICHTBAARHEID.includes(body.zichtbaarheid)
    ) {
      return NextResponse.json(
        { error: `Ongeldige zichtbaarheid: ${body.zichtbaarheid}` },
        { status: 400 }
      );
    }

    // Decision-bestaan + RLS-check.
    const { data: decision } = await supabase
      .from("decision_objects")
      .select("id")
      .eq("id", decisionId)
      .maybeSingle();
    if (!decision) {
      return NextResponse.json(
        { error: "Decision Object niet gevonden of geen toegang" },
        { status: 404 }
      );
    }

    // Profiel ophalen voor naam + rolcheck.
    const isPrivileged =
      ctx.rol === "voorzitter" || ctx.rol === "beheerder";

    // T1 bureau-rol (§5.3): geen dissent vastleggen, in geen enkele
    // zichtbaarheidsvorm. Zonder deze check zou het bureau langs de tak
    // `bestuurder_id = auth.uid()` in de RLS-schrijfpolicy binnenkomen — die tak
    // is met migratie 2026_08_05_bestuursbureau_rol.sql dichtgezet; dit is de
    // leesbare tegenhanger.
    if (isBureauRol(ctx.rol)) {
      return NextResponse.json({ error: BUREAU_WEIGERING.dissent }, { status: 403 });
    }

    if (body.formeel_vastgesteld && !isPrivileged) {
      return NextResponse.json(
        {
          error:
            "Formele vaststelling is voorbehouden aan voorzitter of beheerder.",
        },
        { status: 403 }
      );
    }

    // Default: 'minderheidsnotitie' valt onder formele vastlegging — dat
    // mag pas als de rol dat toestaat. We laten de bestuurder zo'n
    // standpunt wel als 'gedeelde_zorg' indienen; opwaardering naar
    // minderheidsnotitie gebeurt door voorzitter/beheerder.
    if (body.zichtbaarheid === "minderheidsnotitie" && !isPrivileged) {
      return NextResponse.json(
        {
          error:
            "Minderheidsnotitie kan alleen door voorzitter/beheerder worden vastgelegd. Probeer 'formele_dissent' of 'gedeelde_zorg'.",
        },
        { status: 403 }
      );
    }

    const { data: nieuw, error: insertFout } = await supabase
      .from("decision_dissent")
      .insert({
        decision_id: decisionId,
        bestuurder_id: ctx.gebruikerId,
        bestuurder_naam: body.bestuurder_naam?.trim() || ctx.naam || "",
        zichtbaarheid: body.zichtbaarheid ?? "gedeelde_zorg",
        formeel_vastgesteld: body.formeel_vastgesteld ?? false,
        standpunt: body.standpunt.trim(),
        argument: body.argument?.trim() || null,
        gekoppeld_risico_id: body.gekoppeld_risico_id ?? null,
        gekoppeld_aanname_id: body.gekoppeld_aanname_id ?? null,
        gekoppeld_voorwaarde_id: body.gekoppeld_voorwaarde_id ?? null,
        stemming_id: body.stemming_id ?? null,
      })
      .select()
      .single();

    if (insertFout || !nieuw) {
      console.error("Dissent vastleggen fout:", insertFout);
      return NextResponse.json(
        { error: "Dissent vastleggen mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("governance_events").insert({
      decision_id: decisionId,
      event_type: "dissent_vastgelegd",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      object_type: "dissent",
      object_id: nieuw.id,
      nieuwe_waarde: {
        zichtbaarheid: nieuw.zichtbaarheid,
        formeel_vastgesteld: nieuw.formeel_vastgesteld,
        // standpunt-text bewust niet in event-payload (zichtbaarheid!)
      },
    });

    return NextResponse.json({ dissent: nieuw }, { status: 201 });
  } catch (e) {
    console.error("Fout in POST /api/decisions/[id]/dissent:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
