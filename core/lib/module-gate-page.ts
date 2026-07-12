// ============================================================================
//  Pagina-toegangsguard voor fonds-modules (T11, v0.4 §9/§13).
// ----------------------------------------------------------------------------
//  De server-component-tegenhanger van lib/module-guard.ts (dat API-routes een
//  403-NextResponse teruggeeft). Een server-component kan geen NextResponse
//  teruggeven, dus weigeren we met notFound() (404 — lekt geen bestaan/scope).
//
//  DRIE ONAFHANKELIJKE LAGEN, alle server-side (v0.4 §9):
//    1. Autorisatie  — rol/capability (requireCapability-equivalent, puur op de
//                      al-gelezen rol). Onbekende rol / geen profiel → geweigerd.
//    2. Beschikbaarheid — het T8-manifest (module aan/uit voor dit fonds).
//    3. Datacontext  — de fonds-RLS op de module-data (buiten deze guard, in de
//                      queries zelf).
//  BESCHIKBAARHEID ≠ AUTORISATIE: een module "aan" opent nooit de rolgate, en een
//  rol met capability ziet een via het manifest uitgezette module alsnog niet.
// ============================================================================

import "server-only";
import { notFound } from "next/navigation";
import { moduleBeschikbaar } from "@/core/lib/fonds-config";
import { rolHeeftCapability, type Capability } from "@/core/lib/capabilities";
import type { ModuleKey } from "@/core/lib/module-registry";
import { haalFondsSessie, type FondsSessie } from "@/core/lib/fonds-sessie";

/**
 * Dwingt af dat de ingelogde gebruiker de module MAG zien (capability) ÉN dat de
 * module voor het fonds BESCHIKBAAR is (manifest). Weigert met notFound() zodra
 * één van beide faalt. Geeft de sessiecontext terug voor de RLS-queries.
 */
export async function vereisModuleToegang(
  moduleKey: ModuleKey,
  capability: Capability
): Promise<FondsSessie> {
  const sessie = await haalFondsSessie();

  // 1. Autorisatie (rolgate) — server-side, op de al server-side afgeleide rol.
  if (!rolHeeftCapability(sessie.rol, capability)) notFound();

  // 2. Beschikbaarheid (manifest) — server-side, niet alleen UI-verborgen.
  const beschikbaar = await moduleBeschikbaar(sessie.fondsId, moduleKey);
  if (!beschikbaar) notFound();

  return sessie;
}
