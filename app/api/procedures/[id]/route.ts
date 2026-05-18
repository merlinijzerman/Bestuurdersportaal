// ============================================================
//  PATCH /api/procedures/[id] — Iteratie 3-B
//
//  Bewerk titel, beschrijving en deadline van een lopende procedure
//  na aanmaak. Wijzigingen worden gelogd in `procedure_log` met de
//  diff van oude/nieuwe waarden en een verplichte motivering, zodat
//  het traject auditeerbaar blijft.
//
//  Wat NIET via deze route:
//   - Status-overgangen (gebruik /stappen/[stapId] of Decision Object-status)
//   - Eigenaars-mutaties (komt in een latere iteratie met FK)
//   - Template-wijziging (procedures gebruiken snapshot-pattern; nieuwe
//     procedure starten is dan de juiste actie)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

type WijzigBody = {
  titel?: string;
  beschrijving?: string | null;
  deadline?: string | null;
  motivering?: string;
};

const BEWERKBARE_VELDEN = ["titel", "beschrijving", "deadline"] as const;
type BewerkbaarVeld = (typeof BEWERKBARE_VELDEN)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as WijzigBody;
    const motivering = body.motivering?.trim();
    if (!motivering || motivering.length < 3) {
      return NextResponse.json(
        { error: "Motivering is verplicht (min. 3 tekens)" },
        { status: 400 }
      );
    }

    // 1. Lees huidige waarden — nodig voor de diff en voor validatie.
    const { data: huidig, error: leesFout } = await supabase
      .from("procedures")
      .select("id, titel, beschrijving, deadline, status")
      .eq("id", id)
      .maybeSingle();
    if (leesFout || !huidig) {
      return NextResponse.json(
        { error: "Procedure niet gevonden" },
        { status: 404 }
      );
    }

    // Bewerken van afgeronde procedures bewust niet toegestaan — die
    // zijn historisch en hun metadata is onderdeel van het auditspoor.
    if (huidig.status === "afgerond") {
      return NextResponse.json(
        { error: "Een afgeronde procedure kan niet meer worden bewerkt" },
        { status: 400 }
      );
    }

    // 2. Bouw diff. Alleen velden die echt veranderen worden meegenomen.
    const wijzigingen: Record<string, unknown> = {};
    const oudeWaarden: Record<string, unknown> = {};
    const nieuweWaarden: Record<string, unknown> = {};
    const gewijzigdeVelden: string[] = [];

    for (const veld of BEWERKBARE_VELDEN) {
      const nieuw = body[veld as BewerkbaarVeld];
      if (nieuw === undefined) continue;

      // Trim strings; converteer "" naar null voor optionele velden.
      let normaal: string | null;
      if (typeof nieuw === "string") {
        const trimmed = nieuw.trim();
        if (veld === "titel" && trimmed.length === 0) {
          return NextResponse.json(
            { error: "Titel mag niet leeg zijn" },
            { status: 400 }
          );
        }
        normaal = trimmed.length === 0 ? null : trimmed;
      } else if (nieuw === null) {
        if (veld === "titel") {
          return NextResponse.json(
            { error: "Titel mag niet leeg zijn" },
            { status: 400 }
          );
        }
        normaal = null;
      } else {
        continue; // Onverwacht type — overslaan.
      }

      const oud = (huidig as Record<string, unknown>)[veld] ?? null;
      if (normaal === oud) continue;

      wijzigingen[veld] = normaal;
      oudeWaarden[veld] = oud;
      nieuweWaarden[veld] = normaal;
      gewijzigdeVelden.push(veld);
    }

    if (gewijzigdeVelden.length === 0) {
      return NextResponse.json(
        { error: "Geen wijzigingen meegegeven" },
        { status: 400 }
      );
    }

    // 3. Voer de update uit.
    const { data: bijgewerkt, error: updateFout } = await supabase
      .from("procedures")
      .update(wijzigingen)
      .eq("id", id)
      .select()
      .single();
    if (updateFout || !bijgewerkt) {
      console.error("Procedure-update fout:", updateFout);
      return NextResponse.json(
        { error: "Update mislukt" },
        { status: 500 }
      );
    }

    // 4. Schrijf audit-event met diff + motivering.
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();

    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: "procedure_metadata_gewijzigd",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: {
        velden: gewijzigdeVelden,
        oud: oudeWaarden,
        nieuw: nieuweWaarden,
        motivering,
      },
    });

    return NextResponse.json({ procedure: bijgewerkt });
  } catch (e) {
    console.error("Fout in PATCH /api/procedures/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
