// ============================================================================
//  core/lib/microsoft-login-ratelimit-core.ts — PURE sleutelafleiding voor de
//  tempolimiet op de ongeauthenticeerde startroute /auth/microsoft-login/start
//  (fase 1B, #335 T2; besluit V9 — reviewcorrectie PR #339).
// ----------------------------------------------------------------------------
//  Besluit V9: dedicated limiet `microsoft_login_start`, per IP + host, 20 pogingen
//  per 10 minuten, ATOMISCH geteld. De bestaande DB-limiter (`fn_rate_limit_check`)
//  telt op auth.uid() en is op een route zonder sessie niet inzetbaar; daarom een
//  minimale, atomische teller in de private gateway:
//  `login_private.tel_startpoging(p_sleutel, p_limiet, p_venster_seconden)`
//  (migratie 2026_09_07_microsoft_login_startlimiet.sql; TS: gateway.telStartpoging).
//
//  De sleutel is een HMAC-SHA256 van `ip|host` onder de eigen loginsleutel
//  (domeinscheiding via een vast label). Er wordt dus geen ruw IP opgeslagen en
//  de sleutel is zonder de geheime sleutel niet naar een IP terug te rekenen.
//  Een mislukte telling is FAIL-CLOSED: zonder database kan de flow toch niet
//  starten (de transactie staat in dezelfde database).
// ============================================================================

import { createHmac } from "node:crypto";

export const MICROSOFT_LOGIN_START_LIMIET = { limiet: 20, vensterSeconden: 600 } as const;

const HMAC_LABEL = "m365login:v1:startlimiet";

/** HMAC-SHA256(sleutel, label|ip|host) als hex; `-` als ip of host ontbreekt. */
export function startSleutel(ip: string | null | undefined, host: string | null | undefined, sleutel: Buffer): string {
  if (sleutel.length !== 32) throw new Error("Microsoft-login-sleutel is ongeldig voor de startlimiet.");
  return createHmac("sha256", sleutel).update(`${HMAC_LABEL}|${ip ?? "-"}|${host ?? "-"}`).digest("hex");
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

export type StartTelling = { toegestaan: boolean; resterend: number; resetOp: Date | null };
