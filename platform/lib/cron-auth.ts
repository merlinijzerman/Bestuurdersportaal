// ============================================================================
//  cron-auth.ts — gedeelde beveiliging voor machine-/cron-routes (P5)
// ----------------------------------------------------------------------------
//  Eén implementatie van het patroon dat app/api/aqlab/worker/route.ts sinds
//  AQL-2 hanteert:
//
//    1. DEPLOY_TARGET-guard — de cron-definities in vercel.json vuren in BEIDE
//       Vercel-projecten (variant C, besluit 0066), maar machine-routes horen
//       alleen in het beheer-project: dat is het enige project met de
//       service-role. Op de gedeelde app-/publieke surface wordt de route een
//       no-op.
//    2. CRON_SECRET-bearer met constant-time vergelijking (bevinding L-02).
//
//  VOLGORDE IS BEWUST: de skip staat VÓÓR de auth, exact zoals in de worker.
//  Gevolg is dat een onbevoegde aanroep op de app-surface een 200 met
//  `skipped` krijgt in plaats van een 401 — dat verraadt alleen de waarde van
//  DEPLOY_TARGET en geen enkel diagnostisch detail. Afwijken zou een tweede
//  patroon introduceren voor hetzelfde probleem; dat weegt zwaarder.
//
//  De worker zelf draagt nog zijn eigen kopie van deze twee functies. Die is
//  hier BEWUST niet aangepast: een monitoringtranche hoort geen werkend
//  cron-pad te verbouwen. Migreren kan in een opruimtranche.
// ============================================================================

import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * True als deze route op de gedeelde (app/publiek) surface draait en dus moet
 * no-oppen. Zonder DEPLOY_TARGET (enkel-projectopstelling) draait hij door —
 * backward-compat, gelijk aan de worker.
 */
export function draaitOpAppSurface(): boolean {
  return process.env.DEPLOY_TARGET === "app";
}

/**
 * Constant-time bearer-check tegen CRON_SECRET.
 *
 * Fail-closed: zonder geconfigureerd secret is niemand geautoriseerd. De
 * lengtecheck vooraf is nodig omdat timingSafeEqual gelijke bufferlengtes eist;
 * die lekt alleen de lengte, niet de inhoud.
 */
export function geautoriseerdeCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const verwacht = Buffer.from(`Bearer ${secret}`, "utf8");
  const gekregen = Buffer.from(auth, "utf8");
  if (verwacht.length !== gekregen.length) return false;
  return timingSafeEqual(verwacht, gekregen);
}
