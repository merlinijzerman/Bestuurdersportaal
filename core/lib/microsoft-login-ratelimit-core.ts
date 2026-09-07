// ============================================================================
//  core/lib/microsoft-login-ratelimit-core.ts — PURE vensterlimiter voor de
//  ongeauthenticeerde startroute /auth/microsoft-login/start (fase 1B, #335 T2; V9).
// ----------------------------------------------------------------------------
//  Besluit V9: dedicated limiet `microsoft_login_start`, per IP + host, 20 pogingen
//  per 10 minuten. De bestaande DB-limiter (`fn_rate_limit_check`) telt op
//  auth.uid() en is alleen door `authenticated` uitvoerbaar — op een route ZONDER
//  sessie is hij niet inzetbaar, en T2 voegt geen SQL toe (T1-laag bevroren).
//  Daarom een in-geheugen glijdend venster in het Node-proces.
//
//  BEKENDE BEPERKING (gedocumenteerd, geen stille aanname): op Vercel is dit
//  per serverless-instantie en best-effort. Het remt scriptgebruik per instantie
//  en is een tempo-, geen volumegrens; de echte grenzen blijven Entra (E1–E7),
//  de eenmalige transactie (replay dood) en de hook (L1). De sleutel is
//  sha256(ip|host): er wordt geen ruw IP bewaard.
//
//  De geauthenticeerde koppel-start (/api/microsoft-login/koppelen/start) gebruikt
//  de DB-limiet `LIMIETEN.microsoft_login_start` via de wrapper (zelfde getallen).
// ============================================================================

import { createHash } from "node:crypto";

export const MICROSOFT_LOGIN_START_LIMIET = { limiet: 20, vensterMs: 10 * 60_000 } as const;

export type LimiterBeslissing = { toegestaan: boolean; resterend: number; resetAtMs: number | null };

export function startSleutel(ip: string | null | undefined, host: string | null | undefined): string {
  return createHash("sha256").update(`${ip ?? "-"}|${host ?? "-"}`).digest("hex");
}

/** Eerste IP uit x-forwarded-for (Vercel zet de client vooraan), anders x-real-ip. */
export function clientIpUitHeaders(get: (naam: string) => string | null): string | null {
  const xff = get("x-forwarded-for");
  if (xff) {
    const eerste = xff.split(",")[0]?.trim();
    if (eerste) return eerste;
  }
  const real = get("x-real-ip")?.trim();
  return real || null;
}

export function maakVensterLimiter(config: { limiet: number; vensterMs: number } = MICROSOFT_LOGIN_START_LIMIET) {
  const tijdstippen = new Map<string, number[]>();
  let laatsteOpruiming = 0;

  function opruimen(nuMs: number) {
    if (nuMs - laatsteOpruiming < config.vensterMs) return;
    laatsteOpruiming = nuMs;
    for (const [sleutel, lijst] of tijdstippen) {
      const levend = lijst.filter((t) => nuMs - t < config.vensterMs);
      if (levend.length) tijdstippen.set(sleutel, levend);
      else tijdstippen.delete(sleutel);
    }
  }

  return {
    /** Telt de poging en beslist. */
    beoordeel(sleutel: string, nuMs: number = Date.now()): LimiterBeslissing {
      opruimen(nuMs);
      const levend = (tijdstippen.get(sleutel) ?? []).filter((t) => nuMs - t < config.vensterMs);
      if (levend.length >= config.limiet) {
        tijdstippen.set(sleutel, levend);
        return { toegestaan: false, resterend: 0, resetAtMs: levend[0]! + config.vensterMs };
      }
      levend.push(nuMs);
      tijdstippen.set(sleutel, levend);
      return { toegestaan: true, resterend: config.limiet - levend.length, resetAtMs: null };
    },
    /** Alleen voor tests. */
    _aantalSleutels(): number {
      return tijdstippen.size;
    },
  };
}

export type VensterLimiter = ReturnType<typeof maakVensterLimiter>;
