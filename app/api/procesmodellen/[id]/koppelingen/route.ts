import { NextRequest, NextResponse } from "next/server";
import { errorResponse, badRequest } from "@/core/lib/api-errors";
import {
  catalogusContext,
  magCatalogusBeheren,
  logCatalogus,
} from "@/core/lib/catalogus-api";

// type → join-tabel + doel-kolom. Fondsconsistentie + template-onkoppelbaarheid
// worden declaratief door de composite-FK afgedwongen (besluit 0007); een
// inconsistente of template-koppeling faalt op de FK en geeft hier 400.
const KOPPEL_MAP = {
  gremium: { tabel: "procesmodel_gremia", kolom: "gremium_id" },
  expertise: { tabel: "procesmodel_expertises", kolom: "expertise_id" },
  focusgebied: { tabel: "procesmodel_focusgebieden", kolom: "focusgebied_id" },
} as const;

type KoppelType = keyof typeof KOPPEL_MAP;

function parseType(v: unknown): KoppelType | null {
  return v === "gremium" || v === "expertise" || v === "focusgebied" ? v : null;
}

// POST — koppel een gremium/expertise/focusgebied aan het procesmodel.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: procesmodelId } = await params;
    const { supabase, user, profiel } = await catalogusContext();
    if (!user) return badRequest("koppelingen.POST", "Niet ingelogd", 401);
    if (!profiel?.fonds_id)
      return badRequest("koppelingen.POST", "Geen fonds gekoppeld aan profiel");
    if (!magCatalogusBeheren(profiel.rol))
      return badRequest("koppelingen.POST", "Onvoldoende rechten", 403);

    const body = (await req.json()) as { type?: unknown; doel_id?: unknown };
    const type = parseType(body.type);
    const doelId = typeof body.doel_id === "string" ? body.doel_id : null;
    if (!type) return badRequest("koppelingen.POST", "Ongeldig koppeltype");
    if (!doelId) return badRequest("koppelingen.POST", "doel_id is verplicht");

    const { tabel, kolom } = KOPPEL_MAP[type];
    const { data, error } = await supabase
      .from(tabel)
      .insert({
        fonds_id: profiel.fonds_id,
        procesmodel_id: procesmodelId,
        [kolom]: doelId,
        aangemaakt_door: user.id,
      })
      .select()
      .single();

    if (error) {
      // FK-schending (inconsistent fonds / globale template) of duplicaat.
      if (error.code === "23503")
        return badRequest(
          "koppelingen.POST",
          "Koppeling niet toegestaan: het orgaan hoort niet bij dit fonds of is een globale template."
        );
      if (error.code === "23505")
        return badRequest("koppelingen.POST", "Deze koppeling bestaat al.");
      return errorResponse("koppelingen.POST", error);
    }

    await logCatalogus(supabase, {
      fonds_id: profiel.fonds_id,
      entiteit: "koppeling",
      entiteit_id: data.id,
      event_type: "gekoppeld",
      actor_id: user.id,
      payload: { procesmodel_id: procesmodelId, type, doel_id: doelId },
    });
    return NextResponse.json({ koppeling: data });
  } catch (e) {
    return errorResponse("koppelingen.POST", e);
  }
}

// DELETE — ontkoppel (body: { type, doel_id }).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: procesmodelId } = await params;
    const { supabase, user, profiel } = await catalogusContext();
    if (!user) return badRequest("koppelingen.DELETE", "Niet ingelogd", 401);
    if (!profiel?.fonds_id)
      return badRequest("koppelingen.DELETE", "Geen fonds gekoppeld aan profiel");
    if (!magCatalogusBeheren(profiel.rol))
      return badRequest("koppelingen.DELETE", "Onvoldoende rechten", 403);

    const body = (await req.json()) as { type?: unknown; doel_id?: unknown };
    const type = parseType(body.type);
    const doelId = typeof body.doel_id === "string" ? body.doel_id : null;
    if (!type) return badRequest("koppelingen.DELETE", "Ongeldig koppeltype");
    if (!doelId) return badRequest("koppelingen.DELETE", "doel_id is verplicht");

    const { tabel, kolom } = KOPPEL_MAP[type];
    const { error } = await supabase
      .from(tabel)
      .delete()
      .eq("procesmodel_id", procesmodelId)
      .eq(kolom, doelId);
    if (error) return errorResponse("koppelingen.DELETE", error);

    await logCatalogus(supabase, {
      fonds_id: profiel.fonds_id,
      entiteit: "koppeling",
      entiteit_id: null,
      event_type: "ontkoppeld",
      actor_id: user.id,
      payload: { procesmodel_id: procesmodelId, type, doel_id: doelId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse("koppelingen.DELETE", e);
  }
}
