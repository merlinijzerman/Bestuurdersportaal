import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { notifyUser } from "@/core/lib/notifications";
import { isBureauRol, BUREAU_WEIGERING } from "@/core/lib/bureau-gate";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import { z } from "zod";

const REDEN_MIN = 10;

// ============================================================
//  POST /api/stemmingen/[id]/intrekken — trek een open stemronde in.
//
//  Rechten: starter (geopend_door) / voorzitter / beheerder.
//  Verplichte reden (min 10 tekens). Notificeert starter + alle stemmers.
// ============================================================
export const POST = withFondsRoute({ capability: "stemming.deelname", schema: z.object({ "reden": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: stemmingId } = params as { id: string };
    const supabase = ctx.supabase;

    // VEN-2 — BESCHIKBAARHEIDSGATE (nadrukkelijk GÉÉN autorisatie). De module
    // 'stemmingen' staat registry-breed uit (defaultActief=false,
    // manifestBeheerbaar=false), dus deze route weigert voor elk fonds met 403.
    // Bewust hier, als eerste stap ná de auth-preambule van withFondsRoute en
    // VÓÓR body-validatie en resource-lookups: anders hangt de weigering af van
    // een geldige body of een bestaand record, en levert een directe API-call
    // een 400/404 op in plaats van het bedoelde 403.
    // `ctx.fondsId` is server-side afgeleid uit het eigen profiel — nooit uit de
    // request-body, en nooit uit het aangesproken record.
    const moduleWeigering = await weigerAlsModuleUit(ctx.fondsId, "stemmingen");
    if (moduleWeigering) return moduleWeigering;

    let body: { reden?: string } = {};
    try {
      body = (await req.json()) as { reden?: string };
    } catch {
      body = {};
    }
    const reden = (body.reden ?? "").trim();
    if (reden.length < REDEN_MIN) {
      return NextResponse.json(
        { error: `Reden verplicht (minimaal ${REDEN_MIN} tekens)` },
        { status: 400 }
      );
    }

    const { data: stemming } = await supabase
      .from("stemmingen")
      .select("id, status, fonds_id, agendapunt_id, vraag, geopend_door")
      .eq("id", stemmingId)
      .maybeSingle();
    if (!stemming) {
      return NextResponse.json({ error: "Stemming niet gevonden" }, { status: 404 });
    }
    const st = stemming as {
      id: string;
      status: string;
      fonds_id: string;
      agendapunt_id: string;
      vraag: string;
      geopend_door: string;
    };

    if (st.status !== "open") {
      return NextResponse.json(
        { error: "Alleen een open stemronde kan worden ingetrokken" },
        { status: 400 }
      );
    }

    const rol = ctx.rol;
    // T1 bureau-rol (§5.3): geen stemronde intrekken. Vóór de starter-tak.
    if (isBureauRol(rol)) {
      return NextResponse.json({ error: BUREAU_WEIGERING.stemronde }, { status: 403 });
    }
    const isPrivileged = rol === "voorzitter" || rol === "beheerder";
    if (st.geopend_door !== ctx.gebruikerId && !isPrivileged) {
      return NextResponse.json(
        { error: "Alleen de starter, voorzitter of beheerder mag de stemronde intrekken" },
        { status: 403 }
      );
    }

    const { data: ingetrokken, error: updFout } = await supabase
      .from("stemmingen")
      .update({
        status: "ingetrokken",
        ingetrokken_reden: reden,
        gesloten_op: new Date().toISOString(),
        gesloten_door: ctx.gebruikerId,
      })
      .eq("id", stemmingId)
      .select()
      .single();
    if (updFout) {
      console.error("Stemming intrekken fout:", updFout);
      return NextResponse.json({ error: "Intrekken mislukt" }, { status: 500 });
    }

    // Notificatie: starter + alle stemmers
    const { data: agendapunt } = await supabase
      .from("agendapunten")
      .select("vergadering_id")
      .eq("id", st.agendapunt_id)
      .maybeSingle();
    const vergaderingId =
      (agendapunt as { vergadering_id?: string } | null)?.vergadering_id ?? "";

    const { data: stemmenRaw } = await supabase
      .from("stem_uitbrengingen")
      .select("stemgerechtigde_id")
      .eq("stemming_id", stemmingId);
    const ontvangers = new Set<string>();
    ontvangers.add(st.geopend_door);
    for (const r of (stemmenRaw || []) as { stemgerechtigde_id: string }[]) {
      ontvangers.add(r.stemgerechtigde_id);
    }

    await Promise.all(
      Array.from(ontvangers).map((ontvangerId) =>
        notifyUser(
          supabase,
          "stemronde_ingetrokken",
          ontvangerId,
          st.fonds_id,
          {
            type: "stemronde_ingetrokken",
            agendapunt_titel: st.vraag.slice(0, 120),
            ingetrokken_reden: reden,
            actor_naam: "Een collega",
            vergadering_id: vergaderingId,
          },
          {
            gerelateerd_aan_type: "agendapunt",
            gerelateerd_aan_id: st.agendapunt_id,
            actor_id: ctx.gebruikerId,
          }
        )
      )
    );

    return NextResponse.json({ stemming: ingetrokken });
  } catch (e) {
    console.error("Fout in POST /api/stemmingen/[id]/intrekken:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
