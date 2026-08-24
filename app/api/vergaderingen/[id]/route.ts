import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

type VergaderingRow = {
  id: string;
  fonds_id: string;
  titel: string;
  datum: string;
  locatie: string | null;
  status: "gepland" | "in_voorbereiding" | "afgerond";
  aangemaakt_door: string | null;
};

// ============================================================
//  PATCH /api/vergaderingen/[id]
//  Wijzigen van de vergaderkop: titel, locatie en/of datum.
//  Rechten: aanmaker (aangemaakt_door) + voorzitter/beheerder —
//  zelfde model als agendapunten (app/api/agendapunten/[id]).
//  Afgeronde vergaderingen zijn niet wijzigbaar (governance:
//  het verslagleggingsobject ligt dan vast).
//  Audit: diff-gebaseerde entry in vergadering_log (append-only,
//  migratie 2026_07_20_vergadering_wijzigen.sql).
// ============================================================
export const PATCH = withFondsRoute({ capability: "vergaderingen.manage", schema: z.object({ "datum": z.unknown().optional(), "locatie": z.unknown().optional(), "titel": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    const { data: vergaderingRaw } = await supabase
      .from("vergaderingen")
      .select("id, fonds_id, titel, datum, locatie, status, aangemaakt_door")
      .eq("id", id)
      .maybeSingle();

    if (!vergaderingRaw) {
      return NextResponse.json({ error: "Vergadering niet gevonden" }, { status: 404 });
    }
    const vergadering = vergaderingRaw as VergaderingRow;

    if (vergadering.status === "afgerond") {
      return NextResponse.json(
        { error: "Een afgeronde vergadering kan niet meer worden gewijzigd" },
        { status: 400 }
      );
    }

    // Profiel + rol (zelfde rechtenmodel als agendapunt-PATCH)

    const isEigenaar = vergadering.aangemaakt_door === ctx.gebruikerId;
    const isPrivileged =
      ctx.rol === "voorzitter" || ctx.rol === "beheerder";

    if (!isEigenaar && !isPrivileged) {
      return NextResponse.json(
        { error: "U heeft geen recht om deze vergadering te wijzigen" },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      titel?: string;
      locatie?: string | null;
      datum?: string;
    };

    // ── Bouw update-payload + diff ───────────────────────────
    const gewijzigdeVelden: string[] = [];
    const updatePayload: Record<string, unknown> = {};
    const diff: Record<string, { oud: unknown; nieuw: unknown }> = {};

    if (body.titel !== undefined && body.titel.trim() !== vergadering.titel) {
      if (!body.titel.trim()) {
        return NextResponse.json({ error: "Titel mag niet leeg zijn" }, { status: 400 });
      }
      updatePayload.titel = body.titel.trim();
      diff.titel = { oud: vergadering.titel, nieuw: body.titel.trim() };
      gewijzigdeVelden.push("titel");
    }

    if (body.locatie !== undefined) {
      const nieuw = body.locatie?.trim() || null;
      if (nieuw !== vergadering.locatie) {
        updatePayload.locatie = nieuw;
        diff.locatie = { oud: vergadering.locatie, nieuw };
        gewijzigdeVelden.push("locatie");
      }
    }

    if (body.datum !== undefined) {
      const parsed = new Date(body.datum);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Ongeldige datum" }, { status: 400 });
      }
      const nieuweIso = parsed.toISOString();
      if (nieuweIso !== new Date(vergadering.datum).toISOString()) {
        updatePayload.datum = nieuweIso;
        diff.datum = { oud: vergadering.datum, nieuw: nieuweIso };
        gewijzigdeVelden.push("datum");
      }
    }

    if (gewijzigdeVelden.length === 0) {
      return NextResponse.json({ error: "Geen wijzigingen meegegeven" }, { status: 400 });
    }

    // ── Audit-velden + update ───────────────────────────────
    updatePayload.gewijzigd_op = new Date().toISOString();
    updatePayload.gewijzigd_door = ctx.gebruikerId;

    const { data: updated, error: updFout } = await supabase
      .from("vergaderingen")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (updFout) {
      console.error("PATCH vergadering fout:", updFout);
      return NextResponse.json({ error: "Wijzigen mislukt" }, { status: 500 });
    }

    // ── Append-only log (na de mutatie, conform guardrail) ──
    const { error: logFout } = await supabase.from("vergadering_log").insert({
      vergadering_id: id,
      event_type: "vergadering_gewijzigd",
      actor_id: ctx.gebruikerId,
      payload: {
        velden: gewijzigdeVelden,
        diff,
      },
    });
    if (logFout) {
      // Zichtbaar maken maar de geslaagde mutatie niet verhullen; zelfde
      // afweging als elders (best-effort logging mag de response niet breken).
      console.error("vergadering_log insert fout:", logFout);
    }

    return NextResponse.json({ vergadering: updated });
  } catch (e) {
    console.error("Fout in PATCH /api/vergaderingen/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
