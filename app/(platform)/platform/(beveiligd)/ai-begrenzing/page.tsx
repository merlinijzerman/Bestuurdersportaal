// ============================================================================
//  Platform — AI-begrenzing: quota, kill switch en modelallowlist (besluit 0180)
// ----------------------------------------------------------------------------
//  LEZEN gebeurt achter `platform.observability.read`. BEDIENEN vereist een
//  ándere capability, en dat is bewust: stoppen en heractiveren horen bij
//  `platform.security.operate`, quota en allowlist bij `platform.config.manage`.
//  De weergave toont daarom precies de bediening die déze beheerder heeft — de
//  echte afdwinging zit in de server-acties, die elk hun eigen withPlatform met
//  eigen capability draaien.
//
//  Deze module is de EERSTE gebruiker van `platform.security.operate`; die
//  capability bestond al maar werd nergens afgedwongen.
// ============================================================================

import { withPlatformRead, PlatformError } from "@/platform/lib/platform-wrapper";
import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import { haalAiBegrenzingOverzicht } from "@/platform/lib/ai-begrenzing-lees";
import AiBegrenzingClient from "./_components/AiBegrenzingClient";

export const dynamic = "force-dynamic";

const CAP_LEZEN = "platform.observability.read" as const;
const CAP_BEDIENEN = "platform.security.operate" as const;
const CAP_CONFIG = "platform.config.manage" as const;

export default async function AiBegrenzingPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const caps = identiteit?.capabilities ?? [];
  const magLezen = caps.includes(CAP_LEZEN);

  if (!magLezen) {
    return (
      <Omhulsel>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          U heeft geen rechten om de AI-begrenzing in te zien. Vereist de capability{" "}
          <code className="font-mono">{CAP_LEZEN}</code>.
        </div>
      </Omhulsel>
    );
  }

  let overzicht: Awaited<ReturnType<typeof haalAiBegrenzingOverzicht>>;
  try {
    overzicht = await withPlatformRead(
      { capability: CAP_LEZEN, handeling: "ai.begrenzing.inzien" },
      async (svc) => {
        const o = await haalAiBegrenzingOverzicht(svc);
        return {
          resultaat: o,
          // Effect = uitsluitend aantallen; nooit tellerstanden per gebruiker of
          // configuratiewaarden in het auditspoor.
          effect: {
            fondsen: o.fondsen.length,
            gebruikers: o.gebruikers.length,
            gelezen_rijen: o.gelezenRijen,
            afgekapt: o.afgekapt,
          },
        };
      }
    );
  } catch (e) {
    if (!(e instanceof PlatformError)) throw e;
    return (
      <Omhulsel>
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          De AI-begrenzing kon niet worden geopend ({e.foutcode}). Log opnieuw in met
          tweefactorauthenticatie of neem contact op met een platformbeheerder.
        </div>
      </Omhulsel>
    );
  }

  return (
    <Omhulsel>
      <AiBegrenzingClient
        overzicht={overzicht}
        ikId={identiteit?.id ?? null}
        magBedienen={caps.includes(CAP_BEDIENEN)}
        magConfigureren={caps.includes(CAP_CONFIG)}
      />
    </Omhulsel>
  );
}

function Omhulsel({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">AI-begrenzing</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Maandquota, kill switches en de modelallowlist voor alle kostendragende AI in deze
          omgeving. Wijzigingen werken onmiddellijk en vereisen geen nieuwe uitrol. Elke handeling
          komt met actor, tijdstip en reden in het auditspoor.
        </p>
      </div>
      {children}
    </div>
  );
}
