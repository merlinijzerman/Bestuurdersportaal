// POST /api/procedures/[id]/afschrift
// -----------------------------------------------------------------------------
// T6 — Afschrift aanmaken (enqueue). Valideert toegang + bureau-gate, legt een
// rij op status='bezig' vast en laat de cron-worker de bundel bouwen (jobmodel).
// Runt onder de user-RLS-client: de RLS-insertpolicy (eigen fonds + niet-bureau)
// is de harde grens, deze route de UX/defense-in-depth.
//
// Body: { aanleiding?: string, versie?: 'actueel' | 'besluitmoment' }.
// Antwoord: 202 met { id } — de UI pollt GET /afschriften tot status 'gereed'.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import { isBureauRol } from "@/core/lib/bureau-gate";

export const dynamic = "force-dynamic";

// Bureau-rol-weigering: het afschrift bevat de bundel mét stemgedrag per
// bestuurslid (stemmingen.uitslag), precies wat 2026_08_05_bestuursbureau_rol
// voor deze rol afschermt. Zelfde boodschap als de auditdossier-route.
// LET OP: niet exporteren — Next.js weigert onbekende route-exports bij `next build`.
const AFSCHRIFT_BUREAU_WEIGERING =
  "Het afschrift bevat het auditdossier met stemgedrag per bestuurslid en is daarom niet beschikbaar voor het bestuursbureau.";

type Versie = "actueel" | "besluitmoment";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: procedureId } = await params;
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, fonds_id, rol")
      .eq("id", user.id)
      .maybeSingle();

    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: profiel?.fonds_id ?? null,
      gebruikerId: user.id,
      label: "procedures.afschrift.POST",
    });
    if (!hostOordeel.toegestaan) {
      return NextResponse.json({ error: "Dit webadres hoort niet bij uw fonds." }, { status: 403 });
    }

    // Bureau-gate: het afschrift bevat stemgedrag (ontwerpbeslissing 4).
    if (isBureauRol(profiel?.rol)) {
      return NextResponse.json({ error: AFSCHRIFT_BUREAU_WEIGERING }, { status: 403 });
    }

    // RLS: bestaat de procedure en hoort die bij het fonds van de gebruiker?
    const { data: procedure } = await supabase
      .from("procedures")
      .select("id, fonds_id")
      .eq("id", procedureId)
      .maybeSingle();
    if (!procedure) {
      return NextResponse.json({ error: "Procedure niet gevonden of geen toegang" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      aanleiding?: unknown;
      versie?: unknown;
    };
    const aanleiding =
      typeof body.aanleiding === "string" && body.aanleiding.trim()
        ? body.aanleiding.trim().slice(0, 2000)
        : null;
    const versie: Versie = body.versie === "besluitmoment" ? "besluitmoment" : "actueel";

    // Verouderingsanker: laatste governance-event van de besluiten van dit proces
    // + laatste procedure_log-regel. dossier_stand_op = het laatste bekende moment.
    const { data: decisionIdsRows } = await supabase
      .from("decision_objects")
      .select("id")
      .eq("procedure_id", procedureId);
    const decisionIds = (decisionIdsRows ?? []).map((r) => r.id as string);

    let dossierStandEventId: string | null = null;
    let dossierStandOp: string | null = null;
    if (decisionIds.length > 0) {
      const { data: laatsteEvent } = await supabase
        .from("governance_events")
        .select("id, tijdstip")
        .in("decision_id", decisionIds)
        .order("tijdstip", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (laatsteEvent) {
        dossierStandEventId = laatsteEvent.id as string;
        dossierStandOp = laatsteEvent.tijdstip as string;
      }
    }
    const { data: laatsteLog } = await supabase
      .from("procedure_log")
      .select("tijdstip")
      .eq("procedure_id", procedureId)
      .order("tijdstip", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (laatsteLog?.tijdstip && (!dossierStandOp || (laatsteLog.tijdstip as string) > dossierStandOp)) {
      dossierStandOp = laatsteLog.tijdstip as string;
    }

    // Rij vastleggen (status='bezig'). De worker bouwt en zet 'gereed'.
    const { data: rij, error: insErr } = await supabase
      .from("procedure_afschriften")
      .insert({
        procedure_id: procedureId,
        fonds_id: procedure.fonds_id,
        versie,
        aanleiding,
        gebouwd_onder_rol: profiel?.rol ?? null,
        dossier_stand_event_id: dossierStandEventId,
        dossier_stand_op: dossierStandOp,
        aangemaakt_door: user.id,
      })
      .select("id")
      .single();
    if (insErr || !rij) {
      console.error("Afschrift-insert mislukt:", insErr);
      return NextResponse.json({ error: "Kon het afschrift niet aanmaken." }, { status: 500 });
    }

    // Auditspoor (procedure_log — governance_events accepteert geen procesbreed
    // event met decision_id=null wegens de RLS-policy; ontwerpbeslissing 8/1.3).
    await supabase.from("procedure_log").insert({
      procedure_id: procedureId,
      event_type: "afschrift_aangemaakt",
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
      payload: { afschrift_id: rij.id, versie, aanleiding },
    });

    return NextResponse.json({ id: rij.id, status: "bezig" }, { status: 202 });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/afschrift:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
