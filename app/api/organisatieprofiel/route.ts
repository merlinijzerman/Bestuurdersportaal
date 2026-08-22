// ============================================================================
//  /api/organisatieprofiel — tenant-zelfservice op het generieke organisatie-
//  profiel (FO Organisatieprofiel v0.4; besluit 0038 herzien).
//
//  GET — leest het profiel van het eigen fonds (RLS: eigen fonds) + de rol van
//        de aanroeper (voor UI-gating). Iedere ingelogde gebruiker mag lezen.
//  PUT — upsert (1-op-1 op fonds_id). ALLEEN de beheerder: capability
//        organisation.profile.manage (rol 'beheerder'). RLS borgt eigen-fonds,
//        deze route de rolgate — huispatroon (RLS = isolatie, code = rol).
//
//  Uitsluitend anon-key + RLS; geen service-role. Audit = bijgewerkt_door/-op
//  (touch-trigger); bewust geen aparte logtabel (tabelontwerp 2026-07-06).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";

export const dynamic = "force-dynamic";

const MAX_STRATEGISCH = 600;

const FEIT_VELDEN = ["organisatietype", "uitvoerende_partijen", "omvang", "kernfeiten"] as const;
const STRATEGISCHE_VELDEN = [
  "missie",
  "visie",
  "strategische_speerpunten",
  "risicohouding",
] as const;

const PROFIEL_KOLOMMEN =
  "organisatietype, uitvoerende_partijen, omvang, kernfeiten, missie, visie, " +
  "strategische_speerpunten, risicohouding, peildatum, bijgewerkt_door, bijgewerkt_op";

function tekstOfNull(waarde: unknown): string | null {
  if (typeof waarde !== "string") return null;
  const t = waarde.trim();
  return t.length > 0 ? t : null;
}

export const GET = withFondsRoute({}, async (ctx) => {
  try {
    const supabase = ctx.supabase;

    // RLS beperkt de SELECT tot het eigen fonds; er is er hoogstens één.
    const { data: profiel } = await supabase
      .from("organisatie_profielen")
      .select(PROFIEL_KOLOMMEN)
      .maybeSingle();

    return NextResponse.json({ profiel: profiel ?? null, rol: ctx.rol ?? null });
  } catch (e) {
    console.error("Fout in GET /api/organisatieprofiel:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});

export const PUT = withFondsRoute({}, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    // Rolgate: fonds-breed profiel → beheerder-only (analoog aan catalog.manage).
    if (!(await requireCapability(ctx.gebruikerId, "organisation.profile.manage"))) {
      return NextResponse.json(
        { error: "Geen rechten om het organisatieprofiel te beheren (organisation.profile.manage)" },
        { status: 403 }
      );
    }

    if (!ctx.fondsId) {
      return NextResponse.json(
        { error: "Profiel heeft nog geen fonds; organisatieprofiel-beheer niet mogelijk." },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const waarden: Record<string, string | null> = {};
    for (const k of [...FEIT_VELDEN, ...STRATEGISCHE_VELDEN]) waarden[k] = tekstOfNull(body[k]);
    const peildatum = tekstOfNull(body.peildatum); // 'YYYY-MM-DD' of null

    // Tekenlimiet strategische velden (mirror van de DB-CHECK; nette 400 vooraf).
    const veldfouten: Record<string, string> = {};
    for (const k of STRATEGISCHE_VELDEN) {
      const val = waarden[k];
      if (val && val.length > MAX_STRATEGISCH) {
        veldfouten[k] = `Maximaal ${MAX_STRATEGISCH} tekens (nu ${val.length}).`;
      }
    }
    if (Object.keys(veldfouten).length > 0) {
      return NextResponse.json(
        { error: "Controleer de gemarkeerde velden.", veldfouten },
        { status: 400 }
      );
    }

    // Upsert 1-op-1 op fonds_id. RLS (eigen fonds) borgt de tenant-grens; de
    // touch-trigger zet bijgewerkt_op. bijgewerkt_door = weergavenaam bewerker.
    const { error } = await supabase.from("organisatie_profielen").upsert(
      {
        fonds_id: ctx.fondsId,
        ...waarden,
        peildatum,
        bijgewerkt_door: ctx.naam ?? null,
      },
      { onConflict: "fonds_id" }
    );
    if (error) {
      console.error("Organisatieprofiel opslaan fout:", error);
      return NextResponse.json({ error: "Opslaan mislukt." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PUT /api/organisatieprofiel:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
