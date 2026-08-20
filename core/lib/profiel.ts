// ============================================================================
//  haalProfiel — één centrale profielresolutie voor de route-wrapper (W2).
// ----------------------------------------------------------------------------
//  Levert BEWUST vier kolommen: id, naam, rol, fonds_id. Niet de superset van
//  alle 19 kolomvarianten die routes vandaag selecteren. Routes die méér nodig
//  hebben (bv. /api/profiel leest tien kolommen) doen daarvoor een eigen
//  aanvullende query — anders trekt elke route het volledige persoonlijke
//  profiel op, precies de kolomverzameling die besluit 0017 afschermt.
//
//  Uitsluitend de RLS-client (anon-key). Geen service-role.
// ============================================================================
import type { createServerSupabase } from "@/core/lib/supabase-server";

type RlsClient = Awaited<ReturnType<typeof createServerSupabase>>;

export type Profiel = {
  readonly id: string;
  readonly naam: string | null;
  /** Rauwe DB-rol (bestuurder|voorzitter|beheerder|bestuursbureau). Het
   *  genormaliseerde rolmodel is deploy 3 (W6/W7); v1 draagt de string door. */
  readonly rol: string | null;
  readonly fondsId: string | null;
};

/**
 * Haalt het profiel van de ingelogde gebruiker op via RLS (`id = auth.uid()`).
 * Geeft `null` als er geen profiel is — de aanroeper beslist wat dat betekent.
 * Eén foutafhandeling: elke fout of ontbrekende rij → `null`.
 */
export async function haalProfiel(
  supabase: RlsClient,
  gebruikerId: string
): Promise<Profiel | null> {
  const { data, error } = await supabase
    .from("profielen")
    .select("id, naam, rol, fonds_id")
    .eq("id", gebruikerId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id as string,
    naam: (data.naam as string | null) ?? null,
    rol: (data.rol as string | null) ?? null,
    fondsId: (data.fonds_id as string | null) ?? null,
  };
}
