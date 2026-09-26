import "server-only";
import { microsoftConfigVoorFonds, type MicrosoftConfigWaarden } from "@/core/lib/microsoft-config-core";
export { veiligeMicrosoftReturnUrl } from "@/core/lib/microsoft-config-core";

export const MICROSOFT_SCOPES = ["openid", "profile", "offline_access", "User.Read"] as const;
/** Alleen na een bewuste fase-2A-actie toegevoegd; nooit bij fase-1-connect. */
export const MICROSOFT_OUTLOOK_SCOPES = [...MICROSOFT_SCOPES, "Calendars.Read.Shared"] as const;
/** Fase 3 (#321): uitsluitend de Selected-scope; site-toegang wordt buiten het
 * portaal per site verleend en de effectieve toegang is de doorsnede van die
 * grant en de eigen rechten van de gebruiker. Nooit bij fase-1-connect. */
export const MICROSOFT_SHAREPOINT_SCOPES = [...MICROSOFT_SCOPES, "Sites.Selected"] as const;
/** Uitsluitend voor de tijdelijke, dubbel gegate PGB Preview-retrievalsmoke.
 * Deze brede delegated scope blijft buiten de normale connector-allowlist. */
export const MICROSOFT_SEARCH_SPIKE_SCOPE = "Files.Read.All" as const;
export const MICROSOFT_SEARCH_SPIKE_SCOPES = [...MICROSOFT_SHAREPOINT_SCOPES, MICROSOFT_SEARCH_SPIKE_SCOPE] as const;
/** De volledige verzameling scopes die een incrementele consent ooit mag dragen.
 * Alles buiten deze lijst (bredere lees-, site- of schrijfscopes) is verboden. */
export const MICROSOFT_TOEGESTANE_SCOPES = [...new Set<string>([...MICROSOFT_OUTLOOK_SCOPES, ...MICROSOFT_SHAREPOINT_SCOPES])] as readonly string[];

export type MicrosoftConfig = MicrosoftConfigWaarden;

export function microsoftConfig(fondsId?: string): MicrosoftConfig {
  return microsoftConfigVoorFonds(process.env, fondsId);
}
