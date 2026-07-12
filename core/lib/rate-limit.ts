// ============================================================================
// Rate limiting helper — Security Route A WP2 (in-stack, Postgres)
// ----------------------------------------------------------------------------
// Roept de security-definer-functie `fn_rate_limit_check` in Postgres aan en
// geeft een nette beslissing terug. De functie is het enige schrijf-/leespad
// naar de teller-tabel; directe writes worden via RLS geweigerd, zodat een
// gebruiker zijn eigen teller niet kan resetten (zie de migratie
// 2026_06_10_rate_limiting.sql).
//
// De teller wordt in de DB op auth.uid() gesleuteld — we sturen bewust GEEN
// gebruiker-id mee vanuit de client, want dat zou te spoofen zijn.
//
// Centrale configuratie (één plek, zodat tuning eenvoudig is):
//   - chat            20 / 5 min   (uit SECURITY-ROUTE-A-PLAN.md)
//   - upload          10 / uur     (uit SECURITY-ROUTE-A-PLAN.md)
//   - voorbereiding   30 / uur     (AI-route, analoog begrensd)
//   - besluit_concept 30 / uur     (AI-route, analoog begrensd)
// ============================================================================

import type { createServerSupabase } from "@/core/lib/supabase-server";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

/** Eén limiet-instelling: endpoint-sleutel, aantal toegestane requests, venster. */
export type Limiet = {
  /** Endpoint-sleutel waarop geteld wordt (per gebruiker apart geteld). */
  endpoint: string;
  /** Maximaal aantal toegestane requests binnen het venster. */
  limiet: number;
  /** Tijdvenster als Postgres-interval-literal (bv. "5 minutes", "1 hour"). */
  venster: string;
};

/**
 * Centrale limiet-configuratie. Wijzig hier om te tunen — de routes verwijzen
 * uitsluitend naar deze constanten.
 */
export const LIMIETEN = {
  chat: { endpoint: "chat", limiet: 20, venster: "5 minutes" },
  upload: { endpoint: "upload", limiet: 10, venster: "1 hour" },
  voorbereiding: { endpoint: "voorbereiding", limiet: 30, venster: "1 hour" },
  besluit_concept: { endpoint: "besluit_concept", limiet: 30, venster: "1 hour" },
} as const satisfies Record<string, Limiet>;

export type LimietBeslissing = {
  /** Of het request door mag. */
  toegestaan: boolean;
  /** Resterend budget binnen het venster (>= 0). */
  resterend: number;
  /** Wanneer er weer ruimte komt. Null als onbekend (bv. bij fail-open). */
  resetAt: Date | null;
};

type RpcResultaat = {
  toegestaan: boolean;
  resterend: number;
  reset_at: string | null;
};

/**
 * Controleer en registreer een request tegen de rate-limit-teller.
 *
 * Hergebruikt de meegegeven (geauthenticeerde) Supabase-client uit de route, zodat
 * de functie in de DB de juiste auth.uid() ziet.
 *
 * **Fail-open**: faalt de DB-call, dan laten we het request bewust toe en loggen
 * we de fout. Een rate-limiter mag de hele applicatie niet platleggen bij een
 * tijdelijke DB-storing (conform de risicotabel in SECURITY-ROUTE-A-PLAN.md).
 */
export async function controleerLimiet(
  supabase: SupabaseClient,
  sleutel: Limiet
): Promise<LimietBeslissing> {
  const { data, error } = await supabase.rpc("fn_rate_limit_check", {
    p_endpoint: sleutel.endpoint,
    p_limiet: sleutel.limiet,
    p_venster: sleutel.venster,
  });

  if (error || !data) {
    // Fail-open: toelaten, maar wel signaleren in de server-logs.
    console.error(`[rate-limit:${sleutel.endpoint}] check mislukt — fail-open`, error);
    return { toegestaan: true, resterend: sleutel.limiet, resetAt: null };
  }

  const res = data as RpcResultaat;
  return {
    toegestaan: res.toegestaan,
    resterend: res.resterend,
    resetAt: res.reset_at ? new Date(res.reset_at) : null,
  };
}
