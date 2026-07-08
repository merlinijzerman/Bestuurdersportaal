// ============================================================================
//  Tenant-enforce — pure toegangsbeoordeling host↔fonds (besluit 0042, T1.3).
// ----------------------------------------------------------------------------
//  De observe-fase (T1.2) resolveerde de host→fonds-context en logde alleen. Deze
//  module is de FAIL-CLOSED afdwinging: gegeven de resolutie (T1.1/T1.2) en de
//  server-geverifieerde sessie-fonds beslist ze of het request door mag.
//
//  PUUR (geen I/O, geen `server-only`): de caller levert resolutie + sessie-fonds
//  + de env-schakelaar aan, net als bepaalFondsContext. Zo blijft dit server-loos
//  testbaar (lib/tenant-enforce.sanity.ts), spiegelend op platform-grant-regels.ts.
//
//  DEFENSE-IN-DEPTH: RLS per fonds_id blijft de primaire tenant-isolatie; deze
//  host-afdwinging is een tweede grens. `enforce=false` → altijd toegestaan, zodat
//  de observe-fase (T1.2) ongewijzigd blijft tot de env-schakelaar aan gaat.
// ============================================================================

import type { FondsResolutie } from "./tenant-host";

export type EnforceReden = "onbekende-host" | "fonds-mismatch";

export type ToegangsOordeel =
  | { toegestaan: true }
  | { toegestaan: false; reden: EnforceReden };

/** Beoordeelt of een request door mag op basis van de host-resolutie en de
 *  server-geverifieerde sessie-fonds. Fail-closed alleen bij `enforce=true`:
 *  - `enforce=false` → altijd toegestaan (observe-fase T1.2, ongewijzigd);
 *  - onbekende host → weigeren (`onbekende-host`);
 *  - host-fonds ≠ sessie-fonds (of geen sessie-fonds) → weigeren (`fonds-mismatch`);
 *  - host-fonds == sessie-fonds → toegestaan. */
export function beoordeelToegang(args: {
  resolutie: FondsResolutie;
  sessieFondsId: string | null;
  enforce: boolean;
}): ToegangsOordeel {
  const { resolutie, sessieFondsId, enforce } = args;

  if (!enforce) return { toegestaan: true };

  if (resolutie.type !== "gevonden") {
    return { toegestaan: false, reden: "onbekende-host" };
  }
  if (resolutie.fondsId !== sessieFondsId) {
    return { toegestaan: false, reden: "fonds-mismatch" };
  }
  return { toegestaan: true };
}
