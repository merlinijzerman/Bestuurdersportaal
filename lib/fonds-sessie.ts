// ============================================================================
//  Fonds-sessiecontext voor server-componenten (T11).
// ----------------------------------------------------------------------------
//  Eén plek die per request de ingelogde gebruiker + het server-side afgeleide
//  fonds_id + rol oplevert. Pagina's leiden hun fonds NOOIT uit de request-body
//  of URL af; altijd uit het profiel (RLS-client). De (dashboard)-layout dwingt
//  auth + host→fonds al af — dit is de defense-in-depth op paginaniveau.
// ============================================================================

import "server-only";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";

export type FondsSessie = {
  userId: string;
  fondsId: string;
  rol: string | null;
};

/**
 * Haalt de fonds-sessiecontext op. Geen sessie of geen fonds-profiel →
 * redirect naar login (fail-safe; een platform-identiteit hoort niet op de
 * tenant-surface, conform de layout-gate).
 */
export async function haalFondsSessie(): Promise<FondsSessie> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id, rol")
    .eq("id", user.id)
    .single();

  if (!profiel?.fonds_id) redirect("/login");

  return { userId: user.id, fondsId: profiel.fonds_id, rol: profiel.rol ?? null };
}
