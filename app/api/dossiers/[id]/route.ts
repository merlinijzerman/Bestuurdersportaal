// ============================================================
//  GET/PATCH /api/dossiers/[id] — Increment B
//
//  GET   — één dossier (procesinstantie) + effectieve dossierstatus
//          uit `vw_dossier_status`.
//  PATCH — handmatig dossierstatus + periode beheren. De dossierstatus
//          is ALLEEN handmatig zetbaar wanneer er GEEN primair Decision
//          Object is; anders is de status afgeleid (acceptatiecriterium 3:
//          geen tegenstrijdige status). Dit wordt server-side afgedwongen,
//          niet alleen in de UI.
//
//  Statuswijziging wordt append-only gelogd in `procedure_log`
//  (bestaand auditpatroon — geen UPDATE/DELETE op logs).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  DOSSIER_STATUSSEN,
  PERIODE_TYPES,
  type DossierStatus,
  type PeriodeType,
} from "@/lib/dossier";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
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

    const { data: dossier, error } = await supabase
      .from("procedures")
      .select(
        "id, template_code, titel, beschrijving, status, gestart_op, deadline, periode_type, periode_start, periode_eind, periode_jaar, procesmodel_id"
      )
      .eq("id", id)
      .maybeSingle();
    if (error || !dossier) {
      return NextResponse.json(
        { error: "Dossier niet gevonden" },
        { status: 404 }
      );
    }

    const { data: statusView } = await supabase
      .from("vw_dossier_status")
      .select(
        "procedure_id, decision_id, decision_status, afgeleid_van_decision, dossierstatus, sublabel"
      )
      .eq("procedure_id", id)
      .maybeSingle();

    return NextResponse.json({ dossier, status_view: statusView ?? null });
  } catch (e) {
    console.error("Fout in GET /api/dossiers/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

type PatchBody = {
  status?: string;
  motivering?: string;
  periode_type?: string | null;
  periode_start?: string | null;
  periode_eind?: string | null;
  periode_jaar?: number | null;
};

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

    const body = (await req.json()) as PatchBody;

    const { data: huidig, error: leesFout } = await supabase
      .from("procedures")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    if (leesFout || !huidig) {
      return NextResponse.json(
        { error: "Dossier niet gevonden" },
        { status: 404 }
      );
    }

    const wijzigingen: Record<string, unknown> = {};
    const oudeWaarden: Record<string, unknown> = {};
    const nieuweWaarden: Record<string, unknown> = {};

    // ── Statuswijziging: alleen geldig zonder primair Decision Object ──
    if (body.status !== undefined) {
      if (!DOSSIER_STATUSSEN.includes(body.status as DossierStatus)) {
        return NextResponse.json(
          { error: `Ongeldige dossierstatus: ${body.status}` },
          { status: 400 }
        );
      }

      // Is er een primair Decision Object? Dan is de status afgeleid en
      // mag ze niet handmatig worden gezet (server-side gating).
      const { data: primair } = await supabase
        .from("decision_objects")
        .select("id")
        .eq("procedure_id", id)
        .eq("is_primary_decision", true)
        .maybeSingle();
      if (primair) {
        return NextResponse.json(
          {
            error:
              "De dossierstatus wordt afgeleid uit het primaire Decision Object en kan niet handmatig worden gewijzigd. Beheer de status via het Decision Object.",
          },
          { status: 409 }
        );
      }

      const motivering = body.motivering?.trim();
      if (!motivering || motivering.length < 3) {
        return NextResponse.json(
          { error: "Motivering is verplicht bij statuswijziging (min. 3 tekens)" },
          { status: 400 }
        );
      }

      if (body.status !== huidig.status) {
        wijzigingen.status = body.status;
        oudeWaarden.status = huidig.status;
        nieuweWaarden.status = body.status;
      }
    }

    // ── Periode-velden (vrij beheerbaar) ──────────────────────────────
    if (body.periode_type !== undefined) {
      if (
        body.periode_type !== null &&
        !PERIODE_TYPES.includes(body.periode_type as PeriodeType)
      ) {
        return NextResponse.json(
          { error: `Ongeldig periode_type: ${body.periode_type}` },
          { status: 400 }
        );
      }
      wijzigingen.periode_type = body.periode_type;
    }
    if (body.periode_start !== undefined)
      wijzigingen.periode_start = body.periode_start;
    if (body.periode_eind !== undefined)
      wijzigingen.periode_eind = body.periode_eind;
    if (body.periode_jaar !== undefined)
      wijzigingen.periode_jaar = body.periode_jaar;

    if (Object.keys(wijzigingen).length === 0) {
      return NextResponse.json(
        { error: "Geen wijzigingen meegegeven" },
        { status: 400 }
      );
    }

    const { data: bijgewerkt, error: updateFout } = await supabase
      .from("procedures")
      .update(wijzigingen)
      .eq("id", id)
      .select()
      .single();
    if (updateFout || !bijgewerkt) {
      console.error("Dossier-update fout:", updateFout);
      return NextResponse.json({ error: "Update mislukt" }, { status: 500 });
    }

    // Append-only audit-event (alleen bij een echte statuswijziging; de
    // periode-only wijziging loggen we als metadata-event).
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();

    const heeftStatusWijziging = "status" in nieuweWaarden;
    await supabase.from("procedure_log").insert({
      procedure_id: id,
      event_type: heeftStatusWijziging
        ? "dossierstatus_handmatig_gewijzigd"
        : "dossier_periode_gewijzigd",
      actor_id: user.id,
      actor_naam: profiel?.naam || null,
      payload: heeftStatusWijziging
        ? {
            oud: oudeWaarden,
            nieuw: nieuweWaarden,
            motivering: body.motivering?.trim(),
          }
        : { velden: Object.keys(wijzigingen) },
    });

    return NextResponse.json({ dossier: bijgewerkt });
  } catch (e) {
    console.error("Fout in PATCH /api/dossiers/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
