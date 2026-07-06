// ============================================================================
//  Platform — Identiteiten & rechten (Increment P3/B14, TO §4.3, FO §5.4).
// ----------------------------------------------------------------------------
//  Het toekenningspad: toon de platform-identiteiten met hun ACTIEVE
//  capability-grants en bied (binnen MVP-scope) toekennen/intrekken van
//  NIET-ZWARE capabilities aan. Identiteiten zelf worden in deze iteratie NIET
//  via de UI aangemaakt (blijven via SQL-bootstrap).
//
//  LEESKANT via de service-role-client: platform_identity_capabilities is voor de
//  anon-key deny-by-default (geen RLS-leespolicy). Dit is read-only autorisatie-
//  INZICHT — geen businessmutatie — en is gegate op grant||revoke. Zelfde
//  precedent als lib/platform-auth.ts, dat de service-role ook alleen voor
//  identiteits-/autorisatie-resolutie gebruikt. Alle MUTATIES lopen uitsluitend
//  via de server-actions (acties.ts) achter withPlatform.
// ============================================================================

import { createPlatformSupabase } from "@/lib/supabase-platform";
import { huidigePlatformIdentiteit } from "@/lib/platform-auth";
import {
  PLATFORM_CAPABILITIES,
  isZwareCapability,
  type PlatformCapability,
} from "@/lib/platform-capabilities";
import RechtenClient, {
  type IdentiteitMetRechten,
  type ToekenbareCap,
} from "./_components/RechtenClient";

export const dynamic = "force-dynamic";

const GELDIGE_CAPS = new Set<string>(PLATFORM_CAPABILITIES);

// Korte, leesbare labels per capability (UI). Bron-van-waarheid voor de codes
// blijft lib/platform-capabilities.ts.
const CAP_LABEL: Record<string, string> = {
  "platform.generic.library.manage": "Generieke bibliotheek beheren",
  "platform.config.manage": "Standaardcatalogus / configuratie beheren",
  "platform.tenants.manage": "Fondsen beheren",
  "platform.identities.manage": "Platform-identiteiten beheren",
  "platform.capabilities.grant": "Capabilities toekennen",
  "platform.capabilities.revoke": "Capabilities intrekken",
  "platform.observability.read": "Observability inzien",
  "platform.logs.read": "Cross-tenant logs inzien",
  "platform.security.operate": "Securityoperaties",
  "platform.support.operate": "Support-operaties",
  "platform.compliance.read": "Compliance inzien",
  "platform.contact.manage": "Contactaanvragen beheren",
};

export default async function RechtenPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const caps = identiteit?.capabilities ?? [];
  const magToekennen = caps.includes("platform.capabilities.grant");
  const magIntrekken = caps.includes("platform.capabilities.revoke");
  const magInzien = magToekennen || magIntrekken;

  // Toekenbaar in deze iteratie = uitsluitend de niet-zware capabilities.
  const toekenbareCaps: ToekenbareCap[] = PLATFORM_CAPABILITIES.filter(
    (c) => !isZwareCapability(c)
  ).map((c) => ({ capability: c, label: CAP_LABEL[c] ?? c }));

  if (!magInzien) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Identiteiten &amp; rechten</h1>
        </div>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je hebt geen recht om het rechtenregister in te zien. Dit vereist{" "}
          <code className="font-mono">platform.capabilities.grant</code> of{" "}
          <code className="font-mono">platform.capabilities.revoke</code>.
        </div>
      </div>
    );
  }

  const svc = createPlatformSupabase();
  const [{ data: identiteiten }, { data: grants }] = await Promise.all([
    svc
      .from("platform_identities")
      .select("id, email, naam, actief")
      .order("naam", { ascending: true }),
    svc
      .from("platform_identity_capabilities")
      .select("identity_id, capability, toegekend_op")
      .is("ingetrokken_op", null),
  ]);

  const grantsPerId = new Map<string, { capability: string; toegekend_op: string | null }[]>();
  for (const g of (grants ?? []) as { identity_id: string; capability: string; toegekend_op: string | null }[]) {
    const lijst = grantsPerId.get(g.identity_id) ?? [];
    lijst.push({ capability: g.capability, toegekend_op: g.toegekend_op });
    grantsPerId.set(g.identity_id, lijst);
  }

  const rijen: IdentiteitMetRechten[] = (
    (identiteiten ?? []) as { id: string; email: string; naam: string; actief: boolean }[]
  ).map((i) => ({
    id: i.id,
    email: i.email,
    naam: i.naam,
    actief: i.actief,
    isZelf: i.id === identiteit?.id,
    capabilities: (grantsPerId.get(i.id) ?? [])
      .map((g) => ({
        capability: g.capability,
        label: CAP_LABEL[g.capability] ?? g.capability,
        zwaar: GELDIGE_CAPS.has(g.capability)
          ? isZwareCapability(g.capability as PlatformCapability)
          : false,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Identiteiten &amp; rechten</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Beheer welke platform-identiteit welke capabilities heeft. In deze
          versie kun je uitsluitend <strong>niet-zware</strong> capabilities
          toekennen of intrekken; zware capabilities (o.a. fondsen beheren,
          identiteiten beheren, rechten uitdelen) lopen via het gecontroleerde
          bootstrap-/vier-ogen-pad. Elke wijziging vereist een reden en wordt
          append-only geaudit.
        </p>
      </div>

      <RechtenClient
        identiteiten={rijen}
        toekenbareCaps={toekenbareCaps}
        magToekennen={magToekennen}
        magIntrekken={magIntrekken}
      />
    </div>
  );
}
