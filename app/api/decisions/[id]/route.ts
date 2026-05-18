// PATCH /api/decisions/[id]
//
// Bewerken van Decision Object-velden: titel, besluitvraag, aanleiding,
// scope, governance_orgaan, vertrouwelijkheid, classificatie (zes
// dimensies), gewenste_besluitdatum, eigenaar_naam.
//
// Status-overgangen worden hier NIET afgehandeld — daar komt later
// een aparte route voor (1D), met readiness-check als gate. Hier
// blokkeren we expliciet pogingen om de status te muteren.
//
// Loggt per mutatie een governance_event:
//   • 'decision_metadata_gewijzigd' — algemene velden (titel, scope, ...)
//   • 'classificatie_gewijzigd'     — bij wijziging op een classificatie-dimensie
//   • 'classificatie_bevestigd'     — éénmalig bij eerste expliciete bevestiging
//                                     (dat opent de readiness-field-check)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

const VERTROUWELIJKHEID = [
  "publiek",
  "intern",
  "vertrouwelijk",
  "strikt_vertrouwelijk",
] as const;
const COMPLEXITEIT = ["routine", "complicated", "complex"] as const;
const RISICONIVEAU = ["laag", "middel", "hoog"] as const;

type WijzigBody = Partial<{
  titel: string;
  besluitvraag: string;
  aanleiding: string | null;
  scope: string | null;
  governance_orgaan: string | null;
  vertrouwelijkheid: (typeof VERTROUWELIJKHEID)[number];
  complexiteit: (typeof COMPLEXITEIT)[number];
  risiconiveau: (typeof RISICONIVEAU)[number];
  mandaatgevoelig: boolean;
  toezichtgevoelig: boolean;
  beleidsafwijking: boolean;
  ai_risicoklasse: (typeof RISICONIVEAU)[number];
  eigenaar_naam: string | null;
  gewenste_besluitdatum: string | null;
  classificatie_bevestigd: boolean; // pseudo-veld; logt event
}>;

const CLASSIFICATIE_KEYS = [
  "complexiteit",
  "risiconiveau",
  "mandaatgevoelig",
  "toezichtgevoelig",
  "beleidsafwijking",
  "ai_risicoklasse",
] as const;

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

    // Status mag hier niet worden gewijzigd.
    if ("status" in body) {
      return NextResponse.json(
        {
          error:
            "Statusovergangen worden via /api/decisions/[id]/status afgehandeld (komt in 1D).",
        },
        { status: 400 }
      );
    }

    // Huidige rij ophalen om diff te kunnen loggen + RLS-check.
    const { data: huidig, error: leesFout } = await supabase
      .from("decision_objects")
      .select("*")
      .eq("id", id)
      .single();
    if (leesFout || !huidig) {
      return NextResponse.json(
        { error: "Decision Object niet gevonden" },
        { status: 404 }
      );
    }

    const wijzigingen: Record<string, unknown> = {};
    const oudeWaarden: Record<string, unknown> = {};
    const nieuweWaarden: Record<string, unknown> = {};
    const classificatieGewijzigd: string[] = [];

    const eenvoudige_velden: (keyof WijzigBody)[] = [
      "titel",
      "besluitvraag",
      "aanleiding",
      "scope",
      "governance_orgaan",
      "vertrouwelijkheid",
      "eigenaar_naam",
      "gewenste_besluitdatum",
    ];
    for (const veld of eenvoudige_velden) {
      if (body[veld] === undefined) continue;
      const nieuw = body[veld] as unknown;
      const oud = (huidig as Record<string, unknown>)[veld];
      if (nieuw === oud) continue;
      wijzigingen[veld] = nieuw;
      oudeWaarden[veld] = oud;
      nieuweWaarden[veld] = nieuw;
    }

    for (const veld of CLASSIFICATIE_KEYS) {
      if (body[veld] === undefined) continue;
      const nieuw = body[veld] as unknown;
      const oud = (huidig as Record<string, unknown>)[veld];
      if (nieuw === oud) continue;
      wijzigingen[veld] = nieuw;
      oudeWaarden[veld] = oud;
      nieuweWaarden[veld] = nieuw;
      classificatieGewijzigd.push(veld);
    }

    const wilBevestigen = body.classificatie_bevestigd === true;

    if (Object.keys(wijzigingen).length === 0 && !wilBevestigen) {
      return NextResponse.json({
        decision: huidig,
        gewijzigd: false,
      });
    }

    // Validatie van enum-waarden — kort en defensief.
    if (
      "vertrouwelijkheid" in wijzigingen &&
      !VERTROUWELIJKHEID.includes(
        wijzigingen.vertrouwelijkheid as (typeof VERTROUWELIJKHEID)[number]
      )
    ) {
      return NextResponse.json(
        { error: "Ongeldige vertrouwelijkheid" },
        { status: 400 }
      );
    }
    if (
      "complexiteit" in wijzigingen &&
      !COMPLEXITEIT.includes(
        wijzigingen.complexiteit as (typeof COMPLEXITEIT)[number]
      )
    ) {
      return NextResponse.json(
        { error: "Ongeldige complexiteit" },
        { status: 400 }
      );
    }
    for (const veld of [
      "risiconiveau",
      "ai_risicoklasse",
    ] as const) {
      if (
        veld in wijzigingen &&
        !RISICONIVEAU.includes(
          wijzigingen[veld] as (typeof RISICONIVEAU)[number]
        )
      ) {
        return NextResponse.json(
          { error: `Ongeldige ${veld}` },
          { status: 400 }
        );
      }
    }

    // Update uitvoeren als er échte wijzigingen zijn.
    let bijgewerkt = huidig;
    if (Object.keys(wijzigingen).length > 0) {
      const { data: na, error: updateFout } = await supabase
        .from("decision_objects")
        .update(wijzigingen)
        .eq("id", id)
        .select()
        .single();
      if (updateFout || !na) {
        console.error("Decision update fout:", updateFout);
        return NextResponse.json(
          { error: "Update mislukt" },
          { status: 500 }
        );
      }
      bijgewerkt = na;
    }

    // Actor-naam voor governance-events.
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();
    const actorNaam = profiel?.naam ?? null;

    // Events: één voor metadata, één voor classificatie.
    const algemeneVelden = Object.keys(wijzigingen).filter(
      (k) => !(CLASSIFICATIE_KEYS as readonly string[]).includes(k)
    );
    if (algemeneVelden.length > 0) {
      await supabase.from("governance_events").insert({
        decision_id: id,
        event_type: "decision_metadata_gewijzigd",
        actor_id: user.id,
        actor_naam: actorNaam,
        object_type: "decision_object",
        object_id: id,
        oude_waarde: Object.fromEntries(
          algemeneVelden.map((k) => [k, oudeWaarden[k]])
        ),
        nieuwe_waarde: Object.fromEntries(
          algemeneVelden.map((k) => [k, nieuweWaarden[k]])
        ),
      });
    }
    if (classificatieGewijzigd.length > 0) {
      await supabase.from("governance_events").insert({
        decision_id: id,
        event_type: "classificatie_gewijzigd",
        actor_id: user.id,
        actor_naam: actorNaam,
        object_type: "decision_object",
        object_id: id,
        oude_waarde: Object.fromEntries(
          classificatieGewijzigd.map((k) => [k, oudeWaarden[k]])
        ),
        nieuwe_waarde: Object.fromEntries(
          classificatieGewijzigd.map((k) => [k, nieuweWaarden[k]])
        ),
      });
    }

    // Eenmalig bevestigingsevent — opent de field-readiness voor classificatie.
    if (wilBevestigen) {
      const { count } = await supabase
        .from("governance_events")
        .select("id", { count: "exact", head: true })
        .eq("decision_id", id)
        .eq("event_type", "classificatie_bevestigd");
      if ((count ?? 0) === 0) {
        await supabase.from("governance_events").insert({
          decision_id: id,
          event_type: "classificatie_bevestigd",
          actor_id: user.id,
          actor_naam: actorNaam,
          object_type: "decision_object",
          object_id: id,
          nieuwe_waarde: {
            complexiteit: bijgewerkt.complexiteit,
            risiconiveau: bijgewerkt.risiconiveau,
            mandaatgevoelig: bijgewerkt.mandaatgevoelig,
            toezichtgevoelig: bijgewerkt.toezichtgevoelig,
            beleidsafwijking: bijgewerkt.beleidsafwijking,
            ai_risicoklasse: bijgewerkt.ai_risicoklasse,
          },
        });
      }
    }

    return NextResponse.json({ decision: bijgewerkt, gewijzigd: true });
  } catch (e) {
    console.error("Fout in PATCH /api/decisions/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
