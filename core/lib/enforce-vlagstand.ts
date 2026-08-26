// ============================================================================
//  Opgeloste stand van de EPIC-W-handhavingsvlaggen.
//
//  Dit is het meetpunt voor operationele checks: geen ruwe env-waarden, maar
//  de booleaanse stand waarop de wrapper daadwerkelijk beslist. De mapping
//  blijft hier expliciet zodat een nieuwe ENFORCE_*-vlag niet stilzwijgend
//  buiten de healthcheck kan vallen.
//
//  W11 (#188): ENFORCE_AUDIT hoort er OOK bij — anders valt precies de vlag met
//  de omgekeerde semantiek (uit = niets schrijven) buiten de healthcheck, en dat
//  is wat de regel hierboven wil voorkomen. Zie #183 §5b.
// ============================================================================

import { auditEnforceVoorOmgeving } from "./audit-enforce";
import { capabilityEnforceVoorOmgeving } from "./capability-enforce";
import { ratelimitEnforceVoorOmgeving } from "./ratelimit-enforce";
import { schemaEnforceVoorOmgeving } from "./schema-enforce";

export type EnforceOmgeving = {
  ENFORCE_CAPABILITY?: string | null;
  ENFORCE_SCHEMA?: string | null;
  ENFORCE_RATELIMIT?: string | null;
  ENFORCE_AUDIT?: string | null;
};

export type EnforceVlagstand = {
  ENFORCE_CAPABILITY: boolean;
  ENFORCE_SCHEMA: boolean;
  ENFORCE_RATELIMIT: boolean;
  ENFORCE_AUDIT: boolean;
};

/**
 * Resolveert exact de vier EPIC-W-handhavingsvlaggen. Gebruik deze functie voor
 * diagnostiek in plaats van de env-waarden rechtstreeks te projecteren: "on" is de
 * semantiek van de enforce-modules, niet van Vercel.
 */
export function enforceVlagstandVoorOmgeving(env: EnforceOmgeving): EnforceVlagstand {
  return {
    ENFORCE_CAPABILITY: capabilityEnforceVoorOmgeving({
      enforceCapability: env.ENFORCE_CAPABILITY,
    }),
    ENFORCE_SCHEMA: schemaEnforceVoorOmgeving({
      enforceSchema: env.ENFORCE_SCHEMA,
    }),
    ENFORCE_RATELIMIT: ratelimitEnforceVoorOmgeving({
      enforceRateLimit: env.ENFORCE_RATELIMIT,
    }),
    ENFORCE_AUDIT: auditEnforceVoorOmgeving({
      enforceAudit: env.ENFORCE_AUDIT,
    }),
  };
}

/** Productiestand voor serverroutes; alleen de opgeloste booleans verlaten de app. */
export function huidigeEnforceVlagstand(): EnforceVlagstand {
  return enforceVlagstandVoorOmgeving({
    ENFORCE_CAPABILITY: process.env.ENFORCE_CAPABILITY,
    ENFORCE_SCHEMA: process.env.ENFORCE_SCHEMA,
    ENFORCE_RATELIMIT: process.env.ENFORCE_RATELIMIT,
    ENFORCE_AUDIT: process.env.ENFORCE_AUDIT,
  });
}
