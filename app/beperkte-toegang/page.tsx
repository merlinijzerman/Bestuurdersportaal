// ============================================================================
//  /beperkte-toegang — de enige pagina die een AFGESCHAALDE sessie mag zien
//  (Microsoft-loginbeleid fase 1C, #344; besluit 0212).
// ----------------------------------------------------------------------------
//  Twee sessies komen hier terecht, beide met de databaserol `portaal_beperkt`
//  in hun token (de Auth-hook zet die claim, PostgREST doet er `set role` op):
//    * een break-glassaccount dat nog op AAL1 zit → moet de tweestapsverificatie
//      afronden; daarna geeft de hook de normale rol en volgt de verhoging;
//    * een koppel-/herstelsessie → mag uitsluitend (opnieuw) koppelen.
//  De pagina leest niets uit de tenantdata: dat kán deze sessie ook niet. Zij
//  toont alleen de eigen naam uit het profiel — het enige wat de beperkte rol
//  mag lezen — en de ene handeling die past.
// ============================================================================
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { huidigAccessToken } from "@/core/lib/microsoft-login-sessieguard";
import { rolUitAccessToken } from "@/core/lib/microsoft-login-sessieguard-core";
import { ROL_BEPERKT } from "@/core/lib/microsoft-login-beleid-core";
import BeperkteToegangPaneel from "./_components/BeperkteToegangPaneel";

export const dynamic = "force-dynamic";

export default async function BeperkteToegangPagina() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Geen afgeschaalde sessie? Dan hoort de gebruiker gewoon in het portaal.
  const token = await huidigAccessToken(supabase);
  if (rolUitAccessToken(token) !== ROL_BEPERKT) redirect("/");

  const { data: profiel } = await supabase.from("profielen").select("naam").eq("id", user.id).maybeSingle();
  const { data: factoren } = await supabase.auth.mfa.listFactors();
  const totp = factoren?.totp?.find((f) => f.status === "verified") ?? null;

  return (
    <BeperkteToegangPaneel
      naam={(profiel as { naam?: string | null } | null)?.naam ?? null}
      factorId={totp?.id ?? null}
    />
  );
}
