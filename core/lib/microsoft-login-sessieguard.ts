// ============================================================================
//  core/lib/microsoft-login-sessieguard.ts — guard L3 (server-only).
//  Fase 1B (#335 T2): oauth-sessies. Fase 1C (#344): óók wachtwoordsessies.
// ----------------------------------------------------------------------------
//  De Auth-hook (L1) is de primaire afdwinging: hij weigert élke tokenuitgifte
//  die niet bij het fondsbeleid past, ook een refresh. Deze guard is SECUNDAIR
//  en sluit het gat van een REEDS uitgegeven access-token: hij beëindigt in elk
//  chokepoint een sessie die volgens het actuele beleid niet meer mag bestaan.
//
//  Wat er in fase 1C verandert (bewust; besluit 0212 vervangt de "byte-identiek
//  wachtwoordpad"-invariant uit 0211): een niet-oauth-sessie werd voorheen zonder
//  enige gateway-aanroep doorgelaten. In modus `verplicht` mag zij niet meer
//  bestaan, dus wordt nu voor ELKE sessie het beleid opgehaald
//  (login_private.sessiebeleid — één functieaanroep op de bestaande pool).
//
//  BEWUST ONGECACHET. Een omslag naar `verplicht`, een ingetrokken break-glass of
//  een gesloten koppelvenster werkt zo bij het eerstvolgende serververzoek. Een
//  cache zou het intrekkingsvenster onvoorspelbaar maken; de bovengrens blijft
//  `jwt_exp` (≤ 600 s op Preview) en dat is precies wat het runbook meet.
//
//  Chokepoints: withFondsRoute (401 in dezelfde vorm als "geen sessie"),
//  haalFondsSessie, tenant-layout, login-layout, platform-layout (R-34) en L4 in
//  /auth/callback. De gateway is de bron; het token wordt alleen gedecodeerd om
//  te bepalen of het een oauth-sessie is. Gatewayfout = fail-closed; ontbrekende
//  gatewayCONFIGURATIE = het wachtwoordpad zoals het altijd was (zie
//  microsoft-login-beleid-core: zonder gateway kan geen fonds `verplicht` staan).
// ============================================================================
import "server-only";
import type { createServerSupabase } from "@/core/lib/supabase-server";
import { rolUitAccessToken, sessieIsOAuth } from "@/core/lib/microsoft-login-sessieguard-core";
import { beoordeelPortaalSessieKern, type PortaalSessieOordeel } from "@/core/lib/microsoft-login-beleid-core";
import { gatewayFoutcategorie } from "@/core/lib/microsoft-login-binding-core";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** Het access-token van de huidige sessie (uit de cookie), of null. */
export async function huidigAccessToken(supabase: Supabase): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Beoordeelt de sessie van `gebruikerId` tegen het actuele fondsbeleid.
 * Oauth zonder `active` binding → beëindigen (fase 1B). Wachtwoord (of magic
 * link/herstel) in een fonds op `verplicht` → beëindigen, tenzij er een levende
 * break-glassuitzondering of een geopende koppel-/herstelsessie is (fase 1C).
 */
export async function beoordeelPortaalSessie(supabase: Supabase, gebruikerId: string): Promise<PortaalSessieOordeel> {
  const token = await huidigAccessToken(supabase);
  const isOAuth = sessieIsOAuth(token);
  const rol = rolUitAccessToken(token);
  try {
    const { sessiebeleid } = await import("@/core/lib/microsoft-login-gateway");
    // De guard OORDEELT alleen; hij opent geen vensters. Het verhogen van een
    // break-glasssessie is een expliciete route (POST /api/microsoft-login/verhoging),
    // zodat het nooit een bijwerking van een willekeurig verzoek is en een
    // mislukking niet stilletjes wordt genegeerd (reviewbevinding P1).
    return beoordeelPortaalSessieKern({ isOAuth, beleid: await sessiebeleid(gebruikerId), rol });
  } catch (fout) {
    const categorie = gatewayFoutcategorie(fout);
    return beoordeelPortaalSessieKern({
      isOAuth,
      beleid: null,
      rol,
      uitval: categorie === "config_ontbreekt" ? "config" : "fout",
    });
  }
}

/** Beëindigt de sessie lokaal (best-effort; in een Server Component kan de cookie
 *  niet worden weggeschreven — de redirect naar /login met `fout` laat de client
 *  de sessie alsnog opruimen, en de hook weigert de eerstvolgende refresh). */
export async function beeindigSessie(supabase: Supabase): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* best-effort */
  }
}

/** Heeft de gebruiker een `azure`-identiteit in Supabase (L4-signaal)? */
export function heeftAzureIdentiteit(user: { identities?: Array<{ provider: string }> | null } | null | undefined): boolean {
  return (user?.identities ?? []).some((i) => i.provider === "azure");
}

/** Doel na een beëindigde sessie op de tenant-surface. */
export const LOGIN_NA_BEEINDIGING = "/login?fout=microsoft";
