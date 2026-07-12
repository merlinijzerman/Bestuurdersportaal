import { NextRequest, NextResponse } from "next/server";
import { errorResponse, badRequest } from "@/core/lib/api-errors";
import {
  catalogusContext,
  magCatalogusBeheren,
  logCatalogus,
} from "@/core/lib/catalogus-api";

const FREQUENTIES = [
  "jaarlijks",
  "kwartaal",
  "maandelijks",
  "ad_hoc",
  "projectmatig",
  "doorlopend",
];

// GET — procesmodellen van het eigen fonds (RLS-begrensd).
export async function GET() {
  try {
    const { supabase, user, profiel } = await catalogusContext();
    if (!user) return badRequest("procesmodellen.GET", "Niet ingelogd", 401);
    if (!profiel?.fonds_id)
      return badRequest("procesmodellen.GET", "Geen fonds gekoppeld aan profiel");

    const { data, error } = await supabase
      .from("procesmodellen")
      .select("*")
      .order("generiek_procestype", { ascending: true });
    if (error) return errorResponse("procesmodellen.GET", error);
    return NextResponse.json({ procesmodellen: data ?? [] });
  } catch (e) {
    return errorResponse("procesmodellen.GET", e);
  }
}

// POST — nieuw fonds-specifiek procesmodel (catalog.manage).
export async function POST(req: NextRequest) {
  try {
    const { supabase, user, profiel } = await catalogusContext();
    if (!user) return badRequest("procesmodellen.POST", "Niet ingelogd", 401);
    if (!profiel?.fonds_id)
      return badRequest("procesmodellen.POST", "Geen fonds gekoppeld aan profiel");
    if (!magCatalogusBeheren(profiel.rol))
      return badRequest("procesmodellen.POST", "Onvoldoende rechten", 403);

    const body = (await req.json()) as Record<string, unknown>;
    const naam = (body.naam as string | undefined)?.trim();
    const generiek = (body.generiek_procestype as string | undefined)?.trim();
    if (!naam) return badRequest("procesmodellen.POST", "Naam is verplicht");
    if (!generiek)
      return badRequest("procesmodellen.POST", "Generiek procestype is verplicht");
    const frequentie = body.frequentie as string | undefined;
    if (frequentie && !FREQUENTIES.includes(frequentie))
      return badRequest("procesmodellen.POST", "Ongeldige frequentie");

    const { data, error } = await supabase
      .from("procesmodellen")
      .insert({
        fonds_id: profiel.fonds_id,
        generiek_procestype: generiek,
        naam,
        domein: (body.domein as string | undefined)?.trim() || null,
        omschrijving: (body.omschrijving as string | undefined)?.trim() || null,
        frequentie: frequentie || null,
        verwachte_documenttypen: Array.isArray(body.verwachte_documenttypen)
          ? (body.verwachte_documenttypen as string[])
          : [],
        synoniemen: Array.isArray(body.synoniemen)
          ? (body.synoniemen as string[])
          : [],
        default_tijdlijnfases: Array.isArray(body.default_tijdlijnfases)
          ? (body.default_tijdlijnfases as string[])
          : [],
      })
      .select()
      .single();
    if (error || !data) return errorResponse("procesmodellen.POST", error);

    await logCatalogus(supabase, {
      fonds_id: profiel.fonds_id,
      entiteit: "procesmodel",
      entiteit_id: data.id,
      event_type: "aangemaakt",
      actor_id: user.id,
      payload: { naam, generiek_procestype: generiek },
    });
    return NextResponse.json({ procesmodel: data });
  } catch (e) {
    return errorResponse("procesmodellen.POST", e);
  }
}
