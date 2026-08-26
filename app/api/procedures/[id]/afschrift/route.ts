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
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { isBureauRol } from "@/core/lib/bureau-gate";
import { sha256Hex } from "@/core/lib/afschrift-manifest";
import { AFSCHRIFT_AI_MODEL, AFSCHRIFT_PROMPTVERSIE } from "@/core/lib/afschrift-ai-config";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Bureau-rol-weigering: het afschrift bevat de bundel mét stemgedrag per
// bestuurslid (stemmingen.uitslag), precies wat 2026_08_05_bestuursbureau_rol
// voor deze rol afschermt. Zelfde boodschap als de auditdossier-route.
// LET OP: niet exporteren — Next.js weigert onbekende route-exports bij `next build`.
const AFSCHRIFT_BUREAU_WEIGERING =
  "Het afschrift bevat het auditdossier met stemgedrag per bestuurslid en is daarom niet beschikbaar voor het bestuursbureau.";

type Versie = "actueel" | "besluitmoment";

export const POST = withFondsRoute({ hostGuard: "afdwingen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.id.afschrift.post" }, capability: "procedures.manage", label: "procedures.afschrift.POST", schema: z.object({ "aanleiding": z.unknown().optional(), "aiLeeswijzer": z.unknown().optional(), "leeswijzerTekst": z.unknown().optional(), "versie": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: procedureId } = params as { id: string };
    const supabase = ctx.supabase;

    // Bureau-gate: het afschrift bevat stemgedrag (ontwerpbeslissing 4).
    if (isBureauRol(ctx.rol)) {
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
      leeswijzerTekst?: unknown;
      aiLeeswijzer?: unknown;
    };
    const aanleiding =
      typeof body.aanleiding === "string" && body.aanleiding.trim()
        ? body.aanleiding.trim().slice(0, 2000)
        : null;
    const versie: Versie = body.versie === "besluitmoment" ? "besluitmoment" : "actueel";

    // Fase 2: optionele vastgestelde leeswijzertekst (§2–4). Ontbreekt die, dan
    // bouwt de worker het deterministische sjabloon (fase-1-gedrag).
    const lw = body.leeswijzerTekst as
      | { hoeVerlopen?: unknown; watVastgelegd?: unknown; bijzonderheden?: unknown }
      | null
      | undefined;
    const leeswijzerTekst =
      lw && typeof lw.hoeVerlopen === "string" && typeof lw.watVastgelegd === "string" && typeof lw.bijzonderheden === "string"
        ? {
            hoeVerlopen: lw.hoeVerlopen.slice(0, 8000),
            watVastgelegd: lw.watVastgelegd.slice(0, 8000),
            bijzonderheden: lw.bijzonderheden.slice(0, 8000),
          }
        : null;
    const aiLeeswijzer = leeswijzerTekst !== null && body.aiLeeswijzer === true;
    // Provenance SERVER-SIDE (AI-governance-review M2): model/promptversie komen
    // uit de gedeelde config, niet uit de client-body — anders is het herkomstblok
    // in §6 spoofbaar.
    const aiModel = aiLeeswijzer ? AFSCHRIFT_AI_MODEL : null;
    const aiPromptversie = aiLeeswijzer ? AFSCHRIFT_PROMPTVERSIE : null;

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
        gebouwd_onder_rol: ctx.rol ?? null,
        dossier_stand_event_id: dossierStandEventId,
        dossier_stand_op: dossierStandOp,
        aangemaakt_door: ctx.gebruikerId,
        // Fase 2: de door de gebruiker vastgestelde leeswijzer (§2–4). Ook bij
        // een sjabloon-terugval (aiLeeswijzer=false) bewaren we de — mogelijk
        // geredigeerde — tekst, zodat wat de gebruiker zag ook in de bundel komt.
        ai_leeswijzer: aiLeeswijzer,
        ai_leeswijzer_tekst: leeswijzerTekst,
        ai_model: aiModel,
        ai_promptversie: aiPromptversie,
        ai_tekst_hash: leeswijzerTekst ? sha256Hex(JSON.stringify(leeswijzerTekst)) : null,
        // De vaststelling (mens-in-de-lus) leggen we vast zodra er een tekst is
        // vastgesteld — de CHECK-constraint eist dit bij ai_leeswijzer=true.
        ai_vastgesteld_door: leeswijzerTekst ? ctx.gebruikerId : null,
        ai_vastgesteld_op: leeswijzerTekst ? new Date().toISOString() : null,
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
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      payload: { afschrift_id: rij.id, versie, aanleiding },
    });

    return NextResponse.json({ id: rij.id, status: "bezig" }, { status: 202 });
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/afschrift:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
