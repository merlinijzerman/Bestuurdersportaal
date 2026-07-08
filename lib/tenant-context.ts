// ============================================================================
//  Server-side fonds-context uit de request-host (besluit 0040, B4) — SERVER-ONLY.
// ----------------------------------------------------------------------------
//  Dunne orchestratie: haal de actieve host→fonds-mapping (service-role, gecachet)
//  op en laat de pure resolver (T1.1) er de fondscontext uit afleiden. De host
//  komt uit de server-context (headers), nooit uit de UI of de request-body —
//  dat is de kern van B4.
//
//  T1.3 (besluit 0042): naast de resolutie levert deze module de FAIL-CLOSED
//  toegangsbeoordeling. De env-schakelaar TENANT_ENFORCE bepaalt of geweigerd
//  wordt; staat die uit, dan blijft het observe-gedrag (T1.2) ongewijzigd.
// ============================================================================

import "server-only";
import { haalActieveTenantDomains } from "@/lib/tenant-domains";
import { bepaalFondsContext, type FondsResolutie } from "@/lib/tenant-host";
import { beoordeelToegang, type ToegangsOordeel } from "@/lib/tenant-enforce";

/** Resolveert de fondscontext voor een request-host. `host` levert de caller aan
 *  uit de server-context (bv. `(await headers()).get("host")`). Fail-closed:
 *  onbekende/lege/inactieve host → `{ onbekend }`. */
export async function haalFondsContext(
  host: string | null | undefined
): Promise<FondsResolutie> {
  const domains = await haalActieveTenantDomains();
  return bepaalFondsContext({ host, domains });
}

/** Env-schakelaar (besluit 0042): fail-closed afdwinging staat alleen aan bij
 *  `TENANT_ENFORCE=on`. Per-omgeving in Vercel te zetten — productie pas ná de
 *  seed- en observatie-gate; preview/staging laten uit om lockout te voorkomen. */
export function tenantEnforceAan(): boolean {
  return process.env.TENANT_ENFORCE === "on";
}

/** Resolveert de host én beoordeelt in één keer of het request door mag. De
 *  caller levert de server-geverifieerde sessie-fonds aan (nooit een client-
 *  waarde). Geeft naast het oordeel de resolutie terug zodat de caller kan
 *  loggen (observe blijft ook onder enforce staan). */
export async function beoordeelHostToegang(
  host: string | null | undefined,
  sessieFondsId: string | null
): Promise<{ resolutie: FondsResolutie; oordeel: ToegangsOordeel }> {
  const resolutie = await haalFondsContext(host);
  const oordeel = beoordeelToegang({
    resolutie,
    sessieFondsId,
    enforce: tenantEnforceAan(),
  });
  return { resolutie, oordeel };
}
