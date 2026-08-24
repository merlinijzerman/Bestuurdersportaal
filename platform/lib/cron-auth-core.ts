// ============================================================================
//  cron-auth-core.ts — de PURE bearer-beoordeling, zonder I/O en zonder
//  `server-only`, zodat de sanity-suite haar buiten Next kan draaien.
// ----------------------------------------------------------------------------
//  cron-auth.ts leest env en headers en delegeert de beslissing hierheen.
//  Hier zit de tweede grens die W5b PR 2 (#103, deliverable 3) toevoegt: naast
//  fail-closed op een ONTBREKEND secret nu ook een ENTROPIE-ONDERGRENS — een te
//  kort secret wordt geweigerd in plaats van geaccepteerd.
// ============================================================================
import { timingSafeEqual } from "node:crypto";

/**
 * Minimale lengte van CRON_SECRET. Een secret korter dan dit wordt geweigerd
 * (fail-closed), niet geaccepteerd. Lengte is een proxy voor entropie: 32 tekens
 * dekt zowel 128-bit hex als een ruime base64-sleutel, en sluit de kale,
 * met-de-hand-gekozen waarden uit die H-02 als risico noemt.
 *
 * ⚠ OPERATIONELE VOLGORDE: roteer CRON_SECRET naar ≥ deze lengte in ELKE
 * omgeving VÓÓR deze code daar deployt. Anders zetten de cron-routes zichzelf
 * fail-closed (401) tot de rotatie rond is — dezelfde "config eerst, dan code"-
 * regel als bij een migratie. Zie OMGEVINGEN-RUNBOOK.md.
 */
export const CRON_SECRET_MIN_LENGTE = 32;

/**
 * Beoordeelt een `Authorization`-header tegen een secret, puur.
 *
 * Fail-closed bij: ontbrekend secret, te kort secret (< {@link CRON_SECRET_MIN_LENGTE}),
 * ontbrekende header, of lengteverschil. De constant-time vergelijking lekt
 * alleen de lengte, niet de inhoud; de lengtecheck vooraf is nodig omdat
 * timingSafeEqual gelijke bufferlengtes eist.
 */
export function beoordeelCronBearer(args: {
  secret: string | null | undefined;
  authHeader: string | null | undefined;
}): boolean {
  const { secret, authHeader } = args;
  if (!secret) return false;
  if (secret.length < CRON_SECRET_MIN_LENGTE) return false;
  if (!authHeader) return false;
  const verwacht = Buffer.from(`Bearer ${secret}`, "utf8");
  const gekregen = Buffer.from(authHeader, "utf8");
  if (verwacht.length !== gekregen.length) return false;
  return timingSafeEqual(verwacht, gekregen);
}
