import { vi } from "vitest";

/**
 * Minimale, ketenbare stub van de supabase-browserclient — genoeg om een
 * component te monteren dat bij mount zijn profiel en gesprekken ophaalt.
 *
 * Bewust NIET generiek: elke tabel levert een vaste uitkomst uit `tabellen`.
 * Een echte querybuilder namaken zou de test laten testen wat de mock doet.
 */
export function maakSupabaseStub({
  userId = "gebruiker-1",
  tabellen = {} as Record<string, unknown>,
}: { userId?: string | null; tabellen?: Record<string, unknown> } = {}) {
  const from = vi.fn((tabel: string) => {
    const data = tabellen[tabel] ?? null;
    const resultaat = { data, error: null };
    const keten: Record<string, unknown> = {};
    for (const naam of ["select", "eq", "order", "limit", "ilike", "insert", "update"]) {
      keten[naam] = vi.fn(() => keten);
    }
    keten.single = vi.fn(async () => resultaat);
    keten.maybeSingle = vi.fn(async () => resultaat);
    // Een keten zonder afsluiter (bijv. .limit()) wordt zelf ge-await.
    keten.then = (op: (w: unknown) => unknown) => Promise.resolve(resultaat).then(op);
    return keten;
  });

  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    from,
  };
}
