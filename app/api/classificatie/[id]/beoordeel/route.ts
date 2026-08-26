// ============================================================================
//  POST /api/classificatie/[id]/beoordeel — Increment E
//
//  Beoordeelt een OPEN classificatievoorstel: bevestigen (past de primaire
//  koppeling toe) of afwijzen. Capability-gated (classification.review). Werkt
//  tegen classificatie_voorstellen met eigen statusovergangen; de governance-
//  handeling landt append-only in document_metadata_log (decisions/0010).
//
//  body: { actie: 'bevestigen' | 'afwijzen', opmerking?: string }
//  Tenant-isolatie via RLS (anon-key + fonds_id). Geen service-role.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { z } from "zod";
import {
  logClassificatieKoppeling,
  bouwClassificatieReden,
} from "@/core/lib/classificatie-service";

export const dynamic = "force-dynamic";

const GELDIGE_ACTIES = ["bevestigen", "afwijzen"] as const;

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "classificatie.beoordelen" }, capability: "classification.review", schema: z.object({ "actie": z.unknown().optional(), "opmerking": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    if (!(await requireCapability(ctx.gebruikerId, "classification.review"))) {
      return NextResponse.json(
        { error: "Geen rechten om classificaties te beoordelen (classification.review)" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      actie?: string;
      opmerking?: string;
    };
    if (!GELDIGE_ACTIES.includes(body.actie as (typeof GELDIGE_ACTIES)[number])) {
      return NextResponse.json({ error: `Ongeldige actie: ${body.actie}` }, { status: 400 });
    }

    // Voorstel ophalen (RLS scopet op eigen fonds).
    const { data: voorstel } = await supabase
      .from("classificatie_voorstellen")
      .select(
        "id, document_id, fonds_id, voorgestelde_procesinstantie_id, confidence, bron, status, toelichting"
      )
      .eq("id", id)
      .maybeSingle();
    if (!voorstel) {
      return NextResponse.json({ error: "Voorstel niet gevonden" }, { status: 404 });
    }
    // Re-decision-guard: alleen een OPEN voorstel is beoordeelbaar. Auto-toegepast
    // wordt teruggedraaid via de aparte terugdraai-route.
    if (voorstel.status !== "open") {
      return NextResponse.json(
        { error: `Voorstel is niet meer open (status: ${voorstel.status}).` },
        { status: 409 }
      );
    }

    const { data: doc } = await supabase
      .from("documenten")
      .select("titel, fonds_id, procesinstantie_id")
      .eq("id", voorstel.document_id)
      .maybeSingle();

    const nu = new Date().toISOString();

    // ── Afwijzen: status + audit, geen koppeling ──
    if (body.actie === "afwijzen") {
      const { error: vErr } = await supabase
        .from("classificatie_voorstellen")
        .update({ status: "afgewezen", beoordeeld_door: ctx.gebruikerId })
        .eq("id", id);
      if (vErr) {
        console.error("Voorstel afwijzen fout:", vErr);
        return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
      }
      const { error: logErr } = await logClassificatieKoppeling(supabase, {
        documentId: voorstel.document_id,
        documentTitel: doc?.titel ?? null,
        fondsId: voorstel.fonds_id,
        gebruikerId: ctx.gebruikerId,
        gebruikerNaam: ctx.naam ?? null,
        veldNaam: "classificatie_status",
        oudeWaarde: "open",
        nieuweWaarde: "afgewezen",
        reden: body.opmerking?.trim() || "voorstel afgewezen",
        ragImpact: false,
      });
      if (logErr) {
        return NextResponse.json(
          { error: "Afgewezen maar auditlog faalde" },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, actie: "afwijzen" });
    }

    // ── Bevestigen: koppeling toepassen (alleen als nog ongekoppeld) ──
    if (doc?.procesinstantie_id) {
      return NextResponse.json(
        { error: "Document is inmiddels al gekoppeld; classificatie hangt nooit om." },
        { status: 409 }
      );
    }
    if (!voorstel.voorgestelde_procesinstantie_id) {
      return NextResponse.json(
        { error: "Voorstel bevat geen procesinstantie om aan te koppelen." },
        { status: 400 }
      );
    }

    const { error: koppelErr } = await supabase
      .from("documenten")
      .update({ procesinstantie_id: voorstel.voorgestelde_procesinstantie_id })
      .eq("id", voorstel.document_id);
    if (koppelErr) {
      console.error("Koppeling toepassen fout:", koppelErr);
      return NextResponse.json(
        { error: "Koppelen mislukt (mogelijk fondsconsistentie)" },
        { status: 500 }
      );
    }

    const { error: vErr } = await supabase
      .from("classificatie_voorstellen")
      .update({ status: "bevestigd", beoordeeld_door: ctx.gebruikerId, toegepast_op: nu })
      .eq("id", id);
    if (vErr) {
      console.error("Voorstel bevestigen fout:", vErr);
      return NextResponse.json({ error: "Bijwerken mislukt" }, { status: 500 });
    }

    const { error: logErr } = await logClassificatieKoppeling(supabase, {
      documentId: voorstel.document_id,
      documentTitel: doc?.titel ?? null,
      fondsId: voorstel.fonds_id,
      gebruikerId: ctx.gebruikerId,
      gebruikerNaam: ctx.naam ?? null,
      veldNaam: "procesinstantie_id",
      oudeWaarde: null,
      nieuweWaarde: voorstel.voorgestelde_procesinstantie_id,
      reden: bouwClassificatieReden(
        voorstel.confidence,
        voorstel.bron,
        body.opmerking?.trim() || voorstel.toelichting
      ),
      ragImpact: true,
    });
    if (logErr) {
      return NextResponse.json(
        { error: "Gekoppeld maar auditlog faalde" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, actie: "bevestigen" });
  } catch (e) {
    console.error("Fout in POST /api/classificatie/[id]/beoordeel:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
