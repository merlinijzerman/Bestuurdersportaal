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
import { haalTenantDomainVoorHost } from "@/core/lib/tenant-domains";
import { bepaalFondsContext, type FondsResolutie } from "@/core/lib/tenant-host";
import {
  beoordeelToegang,
  tenantEnforceVoorOmgeving,
  type ToegangsOordeel,
} from "@/core/lib/tenant-enforce";

/** Resolveert de fondscontext voor een request-host. `host` levert de caller aan
 *  uit de server-context (bv. `(await headers()).get("host")`). Fail-closed:
 *  onbekende/lege/inactieve host → `{ onbekend }`. D1: de host-resolutie loopt
 *  via de anon-RPC (0/1 rij); bepaalFondsContext blijft de pure beslislaag. */
export async function haalFondsContext(
  host: string | null | undefined
): Promise<FondsResolutie> {
  const rij = await haalTenantDomainVoorHost(host);
  return bepaalFondsContext({ host, domains: rij ? [rij] : [] });
}

/** Fail-closed omgevingscontract. Productie en Preview kunnen de tenantgrens
 *  niet meer via een ontbrekende/foute env-var uitschakelen. Lokaal blijft
 *  `TENANT_ENFORCE=on` beschikbaar om dezelfde harde poort te testen. */
export function tenantEnforceAan(): boolean {
  return tenantEnforceVoorOmgeving({
    tenantEnforce: process.env.TENANT_ENFORCE,
    vercelEnv: process.env.VERCEL_ENV,
    vercelTargetEnv: process.env.VERCEL_TARGET_ENV,
    deployTarget: process.env.DEPLOY_TARGET,
  });
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
