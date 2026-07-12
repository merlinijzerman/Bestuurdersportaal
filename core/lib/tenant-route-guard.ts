// ============================================================================
//  Route-host-guard — host→fonds observe + fail-closed afdwinging voor API-routes.
// ----------------------------------------------------------------------------
//  T1.3-sluitstuk (besluit 0042, gate G2/T7): de tenant-surface-LAYOUT
//  (app/(dashboard)/layout.tsx) is het pagina-chokepoint, maar API-routes zijn
//  direct aanroepbaar bij die layout langs. Deze helper geeft hoogrisico-routes
//  dezelfde tweede grens: resolveer de host server-side, log de anomalie
//  (observe, besluit 0041) en weiger onder TENANT_ENFORCE=on als de host-fonds
//  niet matcht met de server-geverifieerde sessie-fonds (fail-closed, 0042).
//
//  DEFENSE-IN-DEPTH — géén vervanging van RLS. RLS per fonds_id blijft de
//  primaire isolatie; deze host-check is een aanvullende grens. Bij
//  `TENANT_ENFORCE≠on` geeft de guard ALTIJD "toegestaan" terug (observe-fase),
//  dus adoptie is gedrag-neutraal tot de env-flip — geen lockout-risico.
//
//  De caller levert de sessie-fonds aan (server-side uit profielen), nooit een
//  client-waarde. Identiek observe+enforce-contract als de layout, zodat er één
//  gedragsdefinitie is.
// ============================================================================

import "server-only";
import { headers } from "next/headers";
import { haalFondsContext, tenantEnforceAan } from "@/core/lib/tenant-context";
import { beoordeelToegang, type ToegangsOordeel } from "@/core/lib/tenant-enforce";

/** Resolveert de request-host, logt anomalieën en beoordeelt fail-closed of het
 *  request door mag. Spiegelt app/(dashboard)/layout.tsx.
 *
 *  - `enforce=off` → altijd `{ toegestaan: true }` (observe blijft loggen);
 *  - onbekende host / host-fonds ≠ sessie-fonds → onder enforce geweigerd;
 *  - LOGGING is best-effort (mag de request nooit breken); het OORDEEL is
 *    reliable: faalt de resolutie hard, dan weigeren we onder enforce. */
export async function beoordeelRouteHostToegang(args: {
  sessieFondsId: string | null;
  gebruikerId?: string;
  label: string;
}): Promise<ToegangsOordeel> {
  const { sessieFondsId, gebruikerId, label } = args;
  try {
    const host = (await headers()).get("host");
    const resolutie = await haalFondsContext(host);
    const hostFondsId = resolutie.type === "gevonden" ? resolutie.fondsId : null;
    const mismatch = hostFondsId !== null && hostFondsId !== sessieFondsId;
    // Proportioneel loggen (besluit 0041): alleen anomalieën — onbekende host of
    // host-fonds ≠ sessie-fonds. De happy path blijft stil.
    if (resolutie.type !== "gevonden" || mismatch) {
      console.warn("[TENANT-RESOLVE]", {
        route: label,
        host,
        resolutie: resolutie.type,
        hostFondsId,
        sessieFondsId,
        mismatch,
        gebruikerId,
        enforce: tenantEnforceAan(),
      });
    }
    return beoordeelToegang({
      resolutie,
      sessieFondsId,
      enforce: tenantEnforceAan(),
    });
  } catch (e) {
    console.warn(
      "[TENANT-RESOLVE] resolutie faalde",
      label,
      e instanceof Error ? e.message : e
    );
    // Fail-closed: een harde resolutiefout weigeren we alléén onder enforce.
    return tenantEnforceAan()
      ? { toegestaan: false, reden: "onbekende-host" }
      : { toegestaan: true };
  }
}
