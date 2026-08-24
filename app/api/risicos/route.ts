import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import {
  CategorieSlug,
  NiveauSlug,
  TypeRisicoSlug,
  leidNiveauAf,
} from "@/core/lib/risico-config";

const TOEGESTANE_CATEGORIEEN: CategorieSlug[] = [
  "financieel_actuarieel",
  "governance_organisatie",
  "operationeel_datakwaliteit",
  "informatie_communicatie",
];

const TOEGESTANE_NIVEAUS: NiveauSlug[] = ["laag", "middel", "hoog"];
const TOEGESTANE_TYPES: TypeRisicoSlug[] = ["structureel", "tijdelijk"];

export const POST = withFondsRoute({ capability: "risicos.manage" }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      titel?: string;
      categorie?: string;
      toelichting?: string | null;
      kans?: number;
      impact?: number;
      niveau?: string;
      niveau_handmatig?: boolean;
      type_risico?: string;
    };

    const titel = body.titel?.trim();
    const categorie = body.categorie as CategorieSlug | undefined;
    const kans = Number(body.kans);
    const impact = Number(body.impact);
    const niveauHandmatig = !!body.niveau_handmatig;
    const niveau = (
      niveauHandmatig && body.niveau
        ? body.niveau
        : leidNiveauAf(kans || 1, impact || 1)
    ) as NiveauSlug;
    const typeRisico = (body.type_risico || "structureel") as TypeRisicoSlug;

    if (!titel) {
      return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
    }
    if (!categorie || !TOEGESTANE_CATEGORIEEN.includes(categorie)) {
      return NextResponse.json({ error: "Ongeldige categorie" }, { status: 400 });
    }
    if (!Number.isInteger(kans) || kans < 1 || kans > 5) {
      return NextResponse.json(
        { error: "Kans moet een getal zijn van 1 t/m 5" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(impact) || impact < 1 || impact > 5) {
      return NextResponse.json(
        { error: "Impact moet een getal zijn van 1 t/m 5" },
        { status: 400 }
      );
    }
    if (!TOEGESTANE_NIVEAUS.includes(niveau)) {
      return NextResponse.json({ error: "Ongeldig niveau" }, { status: 400 });
    }
    if (!TOEGESTANE_TYPES.includes(typeRisico)) {
      return NextResponse.json({ error: "Ongeldig type" }, { status: 400 });
    }

    if (!ctx.fondsId) {
      return NextResponse.json(
        { error: "Geen fonds gekoppeld aan profiel" },
        { status: 400 }
      );
    }

    // T8 — BESCHIKBAARHEIDSgate: staat de risicomatrix-module in het manifest van
    // dit fonds UIT, dan weigeren we de directe API-call (403). BESCHIKBAARHEID ≠
    // AUTORISATIE: komt bovenop RLS, vervangt die niet. fonds_id is server-side afgeleid.
    const moduleWeigering = await weigerAlsModuleUit(ctx.fondsId, "risicomatrix");
    if (moduleWeigering) return moduleWeigering;

    const { data: risico, error } = await supabase
      .from("risicos")
      .insert({
        fonds_id: ctx.fondsId,
        categorie,
        titel,
        toelichting: body.toelichting || null,
        kans,
        impact,
        niveau,
        niveau_handmatig: niveauHandmatig,
        type_risico: typeRisico,
        status: "actief",
        aangemaakt_door: ctx.gebruikerId,
      })
      .select()
      .single();

    if (error || !risico) {
      console.error("Risico aanmaken fout:", error);
      return NextResponse.json(
        { error: "Aanmaken mislukt" },
        { status: 500 }
      );
    }

    await supabase.from("risico_log").insert({
      risico_id: risico.id,
      event_type: "risico_aangemaakt",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam || null,
      payload: { kans, impact, niveau, type_risico: typeRisico },
    });

    return NextResponse.json({ risico });
  } catch (e) {
    console.error("Fout in POST /api/risicos:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
