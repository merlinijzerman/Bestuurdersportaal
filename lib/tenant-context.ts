// ============================================================================
//  Server-side fonds-context uit de request-host (besluit 0040, B4) — SERVER-ONLY.
// ----------------------------------------------------------------------------
//  Dunne orchestratie: haal de actieve host→fonds-mapping (service-role, gecachet)
//  op en laat de pure resolver (T1.1) er de fondscontext uit afleiden. De host
//  komt uit de server-context (headers), nooit uit de UI of de request-body —
//  dat is de kern van B4.
//
//  OBSERVEREND (T1.2): deze helper bepaalt alleen de resolutie; de binding
//  (app/(dashboard)/layout.tsx) logt de uitkomst en blokkeert niets. De
//  fail-closed afdwinging over alle entrypoints is T1.3.
// ============================================================================

import "server-only";
import { haalActieveTenantDomains } from "@/lib/tenant-domains";
import { bepaalFondsContext, type FondsResolutie } from "@/lib/tenant-host";

/** Resolveert de fondscontext voor een request-host. `host` levert de caller aan
 *  uit de server-context (bv. `(await headers()).get("host")`). Fail-closed:
 *  onbekende/lege/inactieve host → `{ onbekend }`. */
export async function haalFondsContext(
  host: string | null | undefined
): Promise<FondsResolutie> {
  const domains = await haalActieveTenantDomains();
  return bepaalFondsContext({ host, domains });
}
