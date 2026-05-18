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
import { createServerSupabase } from "@/lib/supabase-server";

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
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol")
      .eq("id", user.id)
      .maybeSingle();
    const isPrivileged =
      profiel?.rol === "voorzitter" || profiel?.rol === "beheerder";

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
        bestuurder_id: user.id,
        bestuurder_naam: body.bestuurder_naam?.trim() || profiel?.naam || "",
        zichtbaarheid: body.zichtbaarheid ?? "gedeelde_zorg",
        formeel_vastgesteld: body.formeel_vastgesteld ?? false,
        standpunt: body.standpunt.trim(),
        argument: body.argument?.trim() || null,
        gekoppeld_risico_id: body.gekoppeld_risico_id ?? null,
        gekoppeld_aanname_id: body.gekoppeld_aanname_id ?? null,
        gekoppeld_voorwaarde_id: body.gekoppeld_voorwaarde_id ?? null,
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
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
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
}
