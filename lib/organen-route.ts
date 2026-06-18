// ============================================================================
//  Route-factory voor de organen (gremia / expertises / kritische
//  focusgebieden). De drie tabellen zijn vrijwel identiek; alleen gremia heeft
//  een `type`-veld. Eén factory levert de GET/POST en PATCH-handlers, zodat de
//  route-bestanden dun blijven.
//
//  Lezen = eigen fonds + globale templates (RLS-leespolicy). Schrijven = eigen
//  fonds + catalog.manage. Nieuwe records zijn fonds-specifiek
//  (gekopieerd_van_id NULL). (De)activeren = soft-disable via actief; organen
//  worden nooit hard-deleted (koppelingen blijven behouden, FO §4 module 2).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, badRequest } from "@/lib/api-errors";
import {
  catalogusContext,
  magCatalogusBeheren,
  logCatalogus,
  type CatalogusLogEntry,
} from "@/lib/catalogus-api";

const GREMIA_TYPES = ["besluitvormend", "adviserend", "toezichthoudend", "uitvoerend"];

export type OrgaanConfig = {
  tabel: "gremia" | "expertises" | "kritische_focusgebieden";
  entiteit: CatalogusLogEntry["entiteit"];
  heeftType: boolean;
  label: string;
};

export function organenLijstCreate(cfg: OrgaanConfig) {
  // GET — eigen fonds + globale templates (RLS), gesorteerd.
  async function GET() {
    try {
      const { supabase, user, profiel } = await catalogusContext();
      if (!user) return badRequest(`${cfg.label}.GET`, "Niet ingelogd", 401);
      if (!profiel?.fonds_id)
        return badRequest(`${cfg.label}.GET`, "Geen fonds gekoppeld aan profiel");

      const { data, error } = await supabase
        .from(cfg.tabel)
        .select("*")
        .order("sort_order", { ascending: true })
        .order("naam", { ascending: true });
      if (error) return errorResponse(`${cfg.label}.GET`, error);
      return NextResponse.json({ items: data ?? [] });
    } catch (e) {
      return errorResponse(`${cfg.label}.GET`, e);
    }
  }

  // POST — nieuw fonds-specifiek orgaan (catalog.manage).
  async function POST(req: NextRequest) {
    try {
      const { supabase, user, profiel } = await catalogusContext();
      if (!user) return badRequest(`${cfg.label}.POST`, "Niet ingelogd", 401);
      if (!profiel?.fonds_id)
        return badRequest(`${cfg.label}.POST`, "Geen fonds gekoppeld aan profiel");
      if (!magCatalogusBeheren(profiel.rol))
        return badRequest(`${cfg.label}.POST`, "Onvoldoende rechten", 403);

      const body = (await req.json()) as Record<string, unknown>;
      const naam = (body.naam as string | undefined)?.trim();
      if (!naam) return badRequest(`${cfg.label}.POST`, "Naam is verplicht");

      const insert: Record<string, unknown> = {
        fonds_id: profiel.fonds_id,
        naam,
        omschrijving: (body.omschrijving as string | undefined)?.trim() || null,
        sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
      };
      if (cfg.heeftType) {
        const type = body.type as string | undefined;
        if (type && !GREMIA_TYPES.includes(type))
          return badRequest(`${cfg.label}.POST`, "Ongeldig type");
        insert.type = type || null;
      }

      const { data, error } = await supabase
        .from(cfg.tabel)
        .insert(insert)
        .select()
        .single();
      if (error) {
        if (error.code === "23505")
          return badRequest(`${cfg.label}.POST`, "Er bestaat al een item met deze naam.");
        return errorResponse(`${cfg.label}.POST`, error);
      }

      await logCatalogus(supabase, {
        fonds_id: profiel.fonds_id,
        entiteit: cfg.entiteit,
        entiteit_id: data.id,
        event_type: "aangemaakt",
        actor_id: user.id,
        payload: { naam },
      });
      return NextResponse.json({ item: data });
    } catch (e) {
      return errorResponse(`${cfg.label}.POST`, e);
    }
  }

  return { GET, POST };
}

export function organenPatch(cfg: OrgaanConfig) {
  // PATCH — bewerken / soft-disable (actief=false). Geen hard delete.
  async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const { id } = await params;
      const { supabase, user, profiel } = await catalogusContext();
      if (!user) return badRequest(`${cfg.label}.PATCH`, "Niet ingelogd", 401);
      if (!profiel?.fonds_id)
        return badRequest(`${cfg.label}.PATCH`, "Geen fonds gekoppeld aan profiel");
      if (!magCatalogusBeheren(profiel.rol))
        return badRequest(`${cfg.label}.PATCH`, "Onvoldoende rechten", 403);

      const body = (await req.json()) as Record<string, unknown>;
      const update: Record<string, unknown> = {
        bijgewerkt: new Date().toISOString(),
      };
      if (typeof body.naam === "string") update.naam = body.naam.trim();
      if (typeof body.omschrijving === "string")
        update.omschrijving = body.omschrijving.trim() || null;
      if (typeof body.sort_order === "number") update.sort_order = body.sort_order;
      if (typeof body.actief === "boolean") update.actief = body.actief;
      if (cfg.heeftType && typeof body.type === "string") {
        if (!GREMIA_TYPES.includes(body.type))
          return badRequest(`${cfg.label}.PATCH`, "Ongeldig type");
        update.type = body.type;
      }

      const { data, error } = await supabase
        .from(cfg.tabel)
        .update(update)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) return errorResponse(`${cfg.label}.PATCH`, error);
      if (!data) return badRequest(`${cfg.label}.PATCH`, "Item niet gevonden", 404);

      await logCatalogus(supabase, {
        fonds_id: profiel.fonds_id,
        entiteit: cfg.entiteit,
        entiteit_id: id,
        event_type: body.actief === false ? "gedeactiveerd" : "gewijzigd",
        actor_id: user.id,
        payload: { velden: Object.keys(update).filter((k) => k !== "bijgewerkt") },
      });
      return NextResponse.json({ item: data });
    } catch (e) {
      return errorResponse(`${cfg.label}.PATCH`, e);
    }
  }

  return { PATCH };
}
