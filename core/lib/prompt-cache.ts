// ============================================================================
//  Prompt-caching voor een bestuurderssessie (#438 PR2).
// ----------------------------------------------------------------------------
//  Cache-identiteit is HMAC-afgeleid: een document of client kan de sentinels
//  niet voorspellen. Zonder serversleutel blijft de bestaande per-requestgrens
//  gelden en wordt alleen het statische systeemprompt gecachet.
// ============================================================================

import { createHmac } from "node:crypto";
import type { Bericht, TekstBlok } from "./ai-gateway/contract";
import { hmacSleutel } from "./audit-hmac";

export const PROMPT_CACHE_TTL = "1h" as const;

export function berekenPromptCacheScope(invoer: {
  sleutel: string;
  fondsId: string;
  actorId: string;
  gesprekId: string;
}): string {
  return createHmac("sha256", invoer.sleutel)
    .update(`prompt-cache-v1\n${invoer.fondsId}\n${invoer.actorId}\n${invoer.gesprekId}`, "utf8")
    .digest("hex");
}

export function promptCacheScopeVoor(invoer: {
  fondsId: string;
  actorId: string;
  gesprekId: string | null;
}): string | null {
  const sleutel = hmacSleutel();
  if (!sleutel || !invoer.gesprekId) return null;
  return berekenPromptCacheScope({ ...invoer, gesprekId: invoer.gesprekId, sleutel: sleutel.sleutel });
}

/** Cachet de volledige prefix tot en met het laatste gebruikersbericht. */
export function markeerLaatsteGebruikersberichtVoorCache(
  berichten: readonly Bericht[]
): Bericht[] {
  let gemarkeerd = false;
  return [...berichten].reverse().map((bericht) => {
    if (gemarkeerd || bericht.role !== "user") return bericht;
    gemarkeerd = true;
    const blokken: TekstBlok[] = typeof bericht.content === "string"
      ? [{ type: "text", text: bericht.content }]
      : bericht.content.map((blok) => ({ ...blok }));
    if (blokken.length === 0) return bericht;
    blokken[blokken.length - 1] = {
      ...blokken[blokken.length - 1],
      cache_control: { type: "ephemeral", ttl: PROMPT_CACHE_TTL },
    };
    return { ...bericht, content: blokken };
  }).reverse();
}

