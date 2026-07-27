// ============================================================================
//  Platform — Tenant-gebruikers per fonds (Increment P3-B, FO §10).
// ----------------------------------------------------------------------------
//  Overzicht + aanmaak-/beheerpad voor tenant-gebruikers, per EXPLICIET gekozen
//  fonds. Leeskant via de service-role-client (identiteits-/toegangsmetadata is
//  voor de anon-key deny-by-default); ALLE mutaties lopen via de server-actions
//  (acties.ts) achter withPlatform. Gate: platform.tenants.manage (B-2, 0083).
//
//  GEEN default-fonds (R1-discipline, 0044): zonder expliciete ?fonds-keuze toont
//  de pagina alleen de fondskiezer — geen 'eerste fonds', geen limit 1.
//
//  DATAMINIMALISATIE (FO §10): uitsluitend identiteits-/toegangsmetadata
//  (e-mail, rol, status, e-mail bevestigd, laatste login, aangemaakt) — geen
//  profielinhoud.
// ============================================================================

import { createPlatformSupabase } from "@/platform/lib/supabase-platform";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import GebruikersClient, {
  type FondsOptie,
  type TenantGebruiker,
} from "./_components/GebruikersClient";

export const dynamic = "force-dynamic";

/** banned_until wordt niet in alle supabase-js-versies getypeerd; runtime
 *  levert het wel. Smalle, defensieve cast op de admin-respons. */
type AuthUserRuntime = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  created_at?: string | null;
};

function isGeblokkeerd(banned_until: string | null | undefined): boolean {
  if (!banned_until) return false;
  const t = Date.parse(banned_until);
  return Number.isFinite(t) && t > Date.now();
}

export default async function GebruikersPagina({
  searchParams,
}: {
  searchParams: Promise<{ fonds?: string }>;
}) {
  const identiteit = await huidigePlatformIdentiteit();
  const magBeheren = (identiteit?.capabilities ?? []).includes("platform.tenants.manage");

  if (!magBeheren) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-2xl font-bold">Tenant-gebruikers</h1>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je hebt geen recht om tenant-gebruikers te beheren. Dit vereist{" "}
          <code className="font-mono">platform.tenants.manage</code>.
        </div>
      </div>
    );
  }

  const { fonds: gekozenFonds } = await searchParams;
  const svc = createPlatformSupabase();

  const { data: fondsenData } = await svc
    .from("fondsen")
    .select("id, naam, slug")
    .order("naam", { ascending: true });
  const fondsen: FondsOptie[] = (fondsenData ?? []) as FondsOptie[];

  // Alleen laden als er een GELDIG, expliciet gekozen fonds is (geen default).
  const geldigFonds = gekozenFonds && fondsen.some((f) => f.id === gekozenFonds) ? gekozenFonds : null;

  let gebruikers: TenantGebruiker[] = [];
  if (geldigFonds) {
    const { data: profielen } = await svc
      .from("profielen")
      .select("id, naam, rol, aangemaakt")
      .eq("fonds_id", geldigFonds)
      .order("naam", { ascending: true });

    const rijen = (profielen ?? []) as { id: string; naam: string | null; rol: string | null; aangemaakt: string | null }[];

    // Auth-metadata per profiel hydrateren (bounded op fondsgrootte). Bij MVP-
    // schaal is dit een handvol calls; bij groei is een paginerende listUsers of
    // een SECURITY DEFINER-RPC de vervolgstap (zie 0083 / openstaande punten).
    gebruikers = await Promise.all(
      rijen.map(async (p) => {
        const { data: authData } = await svc.auth.admin.getUserById(p.id);
        const u = (authData?.user ?? null) as AuthUserRuntime | null;
        return {
          id: p.id,
          naam: p.naam ?? "",
          rol: (p.rol ?? "bestuurder") as TenantGebruiker["rol"],
          email: u?.email ?? "",
          emailBevestigd: Boolean(u?.email_confirmed_at),
          laatsteLogin: u?.last_sign_in_at ?? null,
          geblokkeerd: isGeblokkeerd(u?.banned_until),
          aangemaakt: p.aangemaakt ?? u?.created_at ?? null,
        };
      })
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">Tenant-gebruikers</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Onboarding-/interventiepad: maak per fonds een tenant-gebruiker aan en
          beheer rol en toegang. Fonds is altijd een <strong>expliciete</strong>{" "}
          keuze. Elke handeling vereist een reden en wordt append-only geaudit.
          Het beheer van gebruikers hoort primair bij het fonds zelf; dit pad is
          voor onboarding en incidenten (FO §10).
        </p>
      </div>

      <GebruikersClient
        fondsen={fondsen}
        gekozenFondsId={geldigFonds}
        gebruikers={gebruikers}
      />
    </div>
  );
}
