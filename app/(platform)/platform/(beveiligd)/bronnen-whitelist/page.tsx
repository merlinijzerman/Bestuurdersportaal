// ============================================================================
//  Platform — Bronnen-whitelist (Scenario A live web-retrieval, besluit 0072).
// ----------------------------------------------------------------------------
//  Beheer-UI voor de platformbrede whitelist van gezaghebbende domeinen die de
//  live web-retrieval begrenst. De whitelist-tabel geeft de anon+RLS-client
//  alleen ACTIEVE entries; dit scherm heeft ook inactieve/in_review-entries
//  nodig en leest daarom via de service-role (server-action whitelistData,
//  geaudit). Beheer vereist platform.config.manage; zonder die capability is er
//  geen inzage (de inactieve entries zijn service-role-only).
// ============================================================================

import { huidigePlatformIdentiteit } from "@/platform/lib/platform-auth";
import { whitelistData } from "./acties";
import BronnenWhitelistClient from "./_components/BronnenWhitelistClient";

export const dynamic = "force-dynamic";

const CAP = "platform.config.manage";

export default async function BronnenWhitelistPagina() {
  const identiteit = await huidigePlatformIdentiteit();
  const magBeheren = (identiteit?.capabilities ?? []).includes(CAP);

  const data = magBeheren ? await whitelistData() : { entries: [], log: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold">Bronnen-whitelist</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/70">
          Gezaghebbende domeinen die de live web-retrieval (Scenario A) begrenzen.
          De AI-assistent haalt uitsluitend binnen deze whitelist op en toont
          webbronnen met bronvertrouwen (normgewicht). Wijzigingen zijn
          append-only geaudit; activeren zet een bron direct live in de retrieval.
        </p>
      </div>

      {!magBeheren ? (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink">
          Je hebt geen inzage in de bronnen-whitelist. Beheer/inzage vereist de
          capability <code className="font-mono">{CAP}</code>.
        </div>
      ) : (
        <BronnenWhitelistClient
          entries={data.entries}
          log={data.log}
          magBeheren={magBeheren}
        />
      )}
    </div>
  );
}
