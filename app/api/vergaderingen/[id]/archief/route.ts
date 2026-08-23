import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import {
  magArchiveren,
  magDearchiveren,
} from "@/core/lib/vergadering-archief";

// ============================================================================
//  POST /api/vergaderingen/[id]/archief   { actie: "archiveren"|"terughalen" }
// ----------------------------------------------------------------------------
//  Besluit 0145 — handmatig archiveren van een vergadering.
//
//  WAAROM EEN EIGEN ROUTE EN GEEN VELD IN DE BESTAANDE PATCH
//  ---------------------------------------------------------
//  PATCH /api/vergaderingen/[id] weigert élke wijziging aan een AFGERONDE
//  vergadering ("het verslagleggingsobject ligt dan vast"). Dat is terecht voor
//  titel/datum/locatie, maar het is precies de afgeronde vergadering die je
//  wilt kunnen archiveren. Archivering onder die PATCH schuiven zou die
//  governance-regel moeten verzwakken. Een eigen route houdt beide scherp:
//  daar ligt de inhoud vast, hier gaat het alleen over zichtbaarheid.
//
//  RECHTEN: iedereen binnen het eigen fonds. Bewust géén rolgate — archiveren
//  is omkeerbaar, verwijdert niets en laat een auditregel achter. De tenantgrens
//  wordt door RLS afgedwongen (fonds_id = eigen fonds), en de expliciete
//  fondscheck hieronder maakt daar een 403 met uitleg van in plaats van een
//  stille 404 uit de policy.
//
//  VOORWAARDE: archiveren mag pas als de DATUM verstreken is (pure regel in
//  core/lib/vergadering-archief.ts, met sanity-tests). Bewust niet "pas als de
//  status afgerond is": een vergadering die nooit is afgerond zou dan eeuwig in
//  de lijst blijven staan — de aanleiding van dit besluit.
//
//  AUDIT: append-only regel in vergadering_log met een EIGEN eventtype, zodat
//  "de kop is aangepast" en "de vergadering is uit de lijst gehaald" in het log
//  uit elkaar te houden zijn.
// ============================================================================

type VergaderingRij = {
  id: string;
  fonds_id: string | null;
  titel: string;
  datum: string;
  gearchiveerd_op: string | null;
};

export const POST = withFondsRoute({ capability: "vergaderingen.manage" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const body = (await req.json().catch(() => ({}))) as { actie?: string };
    const actie = body.actie === "terughalen" ? "terughalen" : "archiveren";

    const { data: rij } = await supabase
      .from("vergaderingen")
      .select("id, fonds_id, titel, datum, gearchiveerd_op")
      .eq("id", id)
      .maybeSingle();

    if (!rij) {
      return NextResponse.json({ error: "Vergadering niet gevonden" }, { status: 404 });
    }
    const vergadering = rij as VergaderingRij;

    // Tweede linie naast RLS: expliciet, met een leesbare melding.
    if (!ctx.fondsId || vergadering.fonds_id !== ctx.fondsId) {
      return NextResponse.json(
        { error: "Deze vergadering hoort niet bij uw fonds." },
        { status: 403 }
      );
    }

    const oordeel =
      actie === "archiveren" ? magArchiveren(vergadering) : magDearchiveren(vergadering);
    if (!oordeel.mag) {
      return NextResponse.json(
        { error: oordeel.melding, foutcode: oordeel.foutcode },
        { status: 400 }
      );
    }

    const nu = new Date().toISOString();
    const { data: updated, error: updFout } = await supabase
      .from("vergaderingen")
      .update(
        actie === "archiveren"
          ? { gearchiveerd_op: nu, gearchiveerd_door: ctx.gebruikerId }
          : { gearchiveerd_op: null, gearchiveerd_door: null }
      )
      .eq("id", id)
      .select("id, titel, datum, gearchiveerd_op")
      .single();

    if (updFout) {
      console.error("Archiveren vergadering fout:", updFout);
      return NextResponse.json(
        { error: "Archiveren is niet gelukt. Probeer het opnieuw." },
        { status: 500 }
      );
    }

    // Append-only log NA de mutatie (conform guardrail). Best-effort: een
    // mislukte logregel mag een geslaagde mutatie niet verhullen, maar wordt
    // wel zichtbaar gemaakt in de serverlog.
    const { error: logFout } = await supabase.from("vergadering_log").insert({
      vergadering_id: id,
      event_type:
        actie === "archiveren" ? "vergadering_gearchiveerd" : "vergadering_gedearchiveerd",
      actor_id: ctx.gebruikerId,
      payload: {
        actor_naam: ctx.naam ?? null,
        // Snapshot: de titel kan later wijzigen, het log moet zelfstandig
        // leesbaar blijven.
        titel_snapshot: vergadering.titel,
        vergaderdatum: vergadering.datum,
      },
    });
    if (logFout) {
      console.error("vergadering_log insert fout (archief):", logFout);
    }

    return NextResponse.json({ vergadering: updated });
  } catch (e) {
    console.error("Fout in POST /api/vergaderingen/[id]/archief:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
