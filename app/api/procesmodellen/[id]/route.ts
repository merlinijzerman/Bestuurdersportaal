import { NextRequest, NextResponse } from "next/server";
import { errorResponse, badRequest } from "@/lib/api-errors";
import {
  catalogusContext,
  magCatalogusBeheren,
  logCatalogus,
} from "@/lib/catalogus-api";

const FREQUENTIES = [
  "jaarlijks",
  "kwartaal",
  "maandelijks",
  "ad_hoc",
  "projectmatig",
  "doorlopend",
];

// GET — detail incl. gekoppelde gremia/expertises/focusgebieden.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, user, profiel } = await catalogusContext();
    if (!user) return badRequest("procesmodellen.detail.GET", "Niet ingelogd", 401);
    if (!profiel?.fonds_id)
      return badRequest("procesmodellen.detail.GET", "Geen fonds gekoppeld aan profiel");

    const { data: procesmodel, error } = await supabase
      .from("procesmodellen")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return errorResponse("procesmodellen.detail.GET", error);
    if (!procesmodel)
      return badRequest("procesmodellen.detail.GET", "Procesmodel niet gevonden", 404);

    const [gremia, expertises, focusgebieden] = await Promise.all([
      supabase
        .from("procesmodel_gremia")
        .select("id, gremium_id, gremia(id, naam, type)")
        .eq("procesmodel_id", id),
      supabase
        .from("procesmodel_expertises")
        .select("id, expertise_id, expertises(id, naam)")
        .eq("procesmodel_id", id),
      supabase
        .from("procesmodel_focusgebieden")
        .select("id, focusgebied_id, kritische_focusgebieden(id, naam)")
        .eq("procesmodel_id", id),
    ]);

    return NextResponse.json({
      procesmodel,
      koppelingen: {
        gremia: gremia.data ?? [],
        expertises: expertises.data ?? [],
        focusgebieden: focusgebieden.data ?? [],
      },
    });
  } catch (e) {
    return errorResponse("procesmodellen.detail.GET", e);
  }
}

// PATCH — bewerken/(de)activeren (catalog.manage).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, user, profiel } = await catalogusContext();
    if (!user) return badRequest("procesmodellen.PATCH", "Niet ingelogd", 401);
    if (!profiel?.fonds_id)
      return badRequest("procesmodellen.PATCH", "Geen fonds gekoppeld aan profiel");
    if (!magCatalogusBeheren(profiel.rol))
      return badRequest("procesmodellen.PATCH", "Onvoldoende rechten", 403);

    const body = (await req.json()) as Record<string, unknown>;
    const update: Record<string, unknown> = { bijgewerkt: new Date().toISOString() };
    if (typeof body.naam === "string") update.naam = body.naam.trim();
    if (typeof body.domein === "string") update.domein = body.domein.trim() || null;
    if (typeof body.omschrijving === "string")
      update.omschrijving = body.omschrijving.trim() || null;
    if (typeof body.frequentie === "string") {
      if (!FREQUENTIES.includes(body.frequentie))
        return badRequest("procesmodellen.PATCH", "Ongeldige frequentie");
      update.frequentie = body.frequentie;
    }
    if (Array.isArray(body.verwachte_documenttypen))
      update.verwachte_documenttypen = body.verwachte_documenttypen;
    if (Array.isArray(body.synoniemen)) update.synoniemen = body.synoniemen;
    if (Array.isArray(body.default_tijdlijnfases))
      update.default_tijdlijnfases = body.default_tijdlijnfases;
    if (typeof body.actief === "boolean") update.actief = body.actief;

    const { data, error } = await supabase
      .from("procesmodellen")
      .update(update)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return errorResponse("procesmodellen.PATCH", error);
    if (!data)
      return badRequest("procesmodellen.PATCH", "Procesmodel niet gevonden", 404);

    await logCatalogus(supabase, {
      fonds_id: profiel.fonds_id,
      entiteit: "procesmodel",
      entiteit_id: id,
      event_type: body.actief === false ? "gedeactiveerd" : "gewijzigd",
      actor_id: user.id,
      payload: { velden: Object.keys(update).filter((k) => k !== "bijgewerkt") },
    });
    return NextResponse.json({ procesmodel: data });
  } catch (e) {
    return errorResponse("procesmodellen.PATCH", e);
  }
}
