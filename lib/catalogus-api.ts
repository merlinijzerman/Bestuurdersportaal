// ============================================================================
//  Gedeelde helpers voor de catalogus-/organen-API (Increment A).
// ----------------------------------------------------------------------------
//  Eén plek voor het terugkerende patroon: ingelogde gebruiker → fonds → rol,
//  de capability-check (catalog.manage) en het append-only loggen naar
//  catalogus_log. Houdt de routes kort en consistent.
// ============================================================================

import { createServerSupabase } from "@/lib/supabase-server";
import { rolHeeftCapability } from "@/lib/capabilities";

export type CatalogusSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

export type CatalogusContext = {
  supabase: CatalogusSupabase;
  user: { id: string } | null;
  profiel: { fonds_id: string | null; rol: string | null; naam: string | null } | null;
};

/** Haalt supabase-client + ingelogde gebruiker + (fonds_id, rol, naam) op. */
export async function catalogusContext(): Promise<CatalogusContext> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profiel: null };
  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id, rol, naam")
    .eq("id", user.id)
    .single();
  return { supabase, user, profiel };
}

/** Server-side capability-check voor beheeracties (catalog.manage). */
export function magCatalogusBeheren(rol: string | null | undefined): boolean {
  return rolHeeftCapability(rol, "catalog.manage");
}

export type CatalogusLogEntry = {
  fonds_id: string;
  entiteit:
    | "procesmodel"
    | "gremium"
    | "expertise"
    | "focusgebied"
    | "koppeling"
    | "import";
  entiteit_id?: string | null;
  event_type:
    | "aangemaakt"
    | "gewijzigd"
    | "gedeactiveerd"
    | "gekoppeld"
    | "ontkoppeld"
    | "geimporteerd";
  actor_id: string;
  payload?: Record<string, unknown>;
};

/** Append-only log naar catalogus_log. Mislukking mag de actie niet breken. */
export async function logCatalogus(
  supabase: CatalogusSupabase,
  entry: CatalogusLogEntry
): Promise<void> {
  const { error } = await supabase.from("catalogus_log").insert({
    fonds_id: entry.fonds_id,
    entiteit: entry.entiteit,
    entiteit_id: entry.entiteit_id ?? null,
    event_type: entry.event_type,
    actor_id: entry.actor_id,
    payload: entry.payload ?? {},
  });
  if (error) console.error("[catalogus_log] insert mislukt:", error);
}
