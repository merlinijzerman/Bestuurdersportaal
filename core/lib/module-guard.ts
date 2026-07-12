// ============================================================================
//  Module-beschikbaarheidsguard voor API-routes (T8, v0.4 §9).
// ----------------------------------------------------------------------------
//  Dwingt BESCHIKBAARHEID server-side af op hoog-risico module-entrypoints: een
//  directe API-call op een via het manifest UITGEZETTE module wordt geweigerd —
//  niet alleen UI-verborgen. Spiegelt de opzet van lib/tenant-route-guard.ts.
//
//  KERNRANDVOORWAARDE: dit is een BESCHIKBAARHEIDS-check, GÉÉN autorisatie. Hij
//  komt BOVENOP requireCapability() + RLS en vervangt die nooit. Een module "aan"
//  betekent nog steeds: de capability-/RLS-gate van de route bepaalt of je mag.
//  `fonds_id` wordt door de caller server-side afgeleid, nooit uit de body.
// ============================================================================

import "server-only";
import { NextResponse } from "next/server";
import { moduleBeschikbaar } from "@/core/lib/fonds-config";
import type { ModuleKey } from "@/core/lib/module-registry";

/**
 * Geeft een 403-NextResponse terug als de module niet beschikbaar is voor dit
 * fonds, anders `null` (request mag door — mits de capability-/RLS-gate óók slaagt).
 *
 * Gebruik in een route:
 *   const weigering = await weigerAlsModuleUit(fondsId, "ai");
 *   if (weigering) return weigering;
 */
export async function weigerAlsModuleUit(
  fondsId: string | null | undefined,
  moduleKey: ModuleKey
): Promise<NextResponse | null> {
  // Geen fonds-context = geen beschikbaarheidsbewijs → weiger (fail-safe voor de
  // guard; de aanroepende route heeft sowieso al een auth/None-fonds-afhandeling).
  if (!fondsId) {
    return NextResponse.json(
      { error: "Geen fondscontext" },
      { status: 400 }
    );
  }
  const beschikbaar = await moduleBeschikbaar(fondsId, moduleKey);
  if (!beschikbaar) {
    return NextResponse.json(
      { error: `Module '${moduleKey}' is niet beschikbaar voor dit fonds` },
      { status: 403 }
    );
  }
  return null;
}
