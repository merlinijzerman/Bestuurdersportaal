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
import type { NextRequest } from "next/server";
import { beoordeelCronBearer } from "./cron-auth-core";

/**
 * True als deze route op de gedeelde (app/publiek) surface draait en dus moet
 * no-oppen. Zonder DEPLOY_TARGET (enkel-projectopstelling) draait hij door —
 * backward-compat, gelijk aan de worker.
 */
export function draaitOpAppSurface(): boolean {
  return process.env.DEPLOY_TARGET === "app";
}

/**
 * Constant-time bearer-check tegen CRON_SECRET, met entropie-ondergrens.
 *
 * Fail-closed op: ontbrekend secret, een secret korter dan
 * `CRON_SECRET_MIN_LENGTE` (W5b PR 2, #103), ontbrekende header of
 * lengteverschil. De pure logica staat in cron-auth-core.ts zodat de sanity-
 * suite haar zonder Next kan draaien; hier lezen we alleen env en header.
 */
export function geautoriseerdeCron(req: NextRequest): boolean {
  return beoordeelCronBearer({
    secret: process.env.CRON_SECRET,
    authHeader: req.headers.get("authorization"),
  });
}
