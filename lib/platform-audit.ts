// ============================================================================
//  Twee-fasen audit naar platform_event_log (Increment P0 — TO §4.2/§7, FO §7).
// ----------------------------------------------------------------------------
//  Elke platformhandeling levert een attempt-event (VÓÓR uitvoering) en een
//  result-event (NA uitvoering), append-only en gehasht-geketend door de
//  DB-triggers. Kernregels:
//   - Audit en businessactie zitten in GESCHEIDEN transacties: deze helpers
//     gebruiken een eigen service-role-client, los van de client waarmee de
//     businessactie draait. Een rollback van de businessactie wist het
//     attempt-event dus NIET (TO §12 test 19).
//   - Attempt fail-closed: logAttempt() GOOIT bij schrijffout, zodat de wrapper
//     503 kan geven en de handeling niet doorgaat.
//   - Result gegarandeerd: logResultGegarandeerd() schrijft met retry +
//     idempotentie op correlatie_id; lukt het na retries niet, dan is dat een
//     kritiek securitysignaal (gemarkeerd hiaat), geen stille verdwijning.
//   - Sessieloze pogingen: logSecurity() schrijft met identity_id=null
//     (best-effort), zodat scan-/brute-force-pogingen herleidbaar blijven zonder
//     de identiteitsketen te vervuilen.
// ============================================================================

import "server-only";
import { createPlatformSupabase } from "@/lib/supabase-platform";
import type { PlatformCapability } from "@/lib/platform-capabilities";

export type AuditUitkomst = "succes" | "fout" | "geweigerd" | "geannuleerd";

export type AttemptInput = {
  correlatieId: string;
  identityId: string | null;
  capability: PlatformCapability;
  handeling: string;
  doelFondsId?: string | null;
  doelObject?: string | null;
  reden?: string | null;
  bronIp?: string | null;
  verwachteScope?: unknown;
};

export type ResultInput = {
  correlatieId: string;
  identityId: string | null;
  capability: PlatformCapability;
  handeling: string;
  doelFondsId?: string | null;
  doelObject?: string | null;
  reden?: string | null;
  uitkomst: AuditUitkomst;
  foutcode?: string | null;
  effect?: unknown;
};

type EventRow = {
  correlatie_id: string;
  fase: "attempt" | "result";
  identity_id: string | null;
  capability: string;
  handeling: string;
  doel_fonds_id: string | null;
  doel_object: string | null;
  reden: string | null;
  bron_ip: string | null;
  verwachte_scope: unknown;
  uitkomst: AuditUitkomst | null;
  foutcode: string | null;
  effect: unknown;
};

function attemptRow(i: AttemptInput): EventRow {
  return {
    correlatie_id: i.correlatieId,
    fase: "attempt",
    identity_id: i.identityId,
    capability: i.capability,
    handeling: i.handeling,
    doel_fonds_id: i.doelFondsId ?? null,
    doel_object: i.doelObject ?? null,
    reden: i.reden ?? null,
    bron_ip: i.bronIp ?? null,
    verwachte_scope: i.verwachteScope ?? null,
    uitkomst: null,
    foutcode: null,
    effect: null,
  };
}

function resultRow(i: ResultInput): EventRow {
  return {
    correlatie_id: i.correlatieId,
    fase: "result",
    identity_id: i.identityId,
    capability: i.capability,
    handeling: i.handeling,
    doel_fonds_id: i.doelFondsId ?? null,
    doel_object: i.doelObject ?? null,
    reden: i.reden ?? null,
    bron_ip: null,
    verwachte_scope: null,
    uitkomst: i.uitkomst,
    foutcode: i.foutcode ?? null,
    effect: i.effect ?? null,
  };
}

/** Schrijft het attempt-event. Eigen client = eigen transactie. Gooit bij
 *  schrijffout (fail-closed): de wrapper laat de handeling dan NIET doorgaan. */
export async function logAttempt(input: AttemptInput): Promise<void> {
  const svc = createPlatformSupabase();
  const { error } = await svc.from("platform_event_log").insert(attemptRow(input));
  if (error) {
    throw new Error(`attempt-event niet schrijfbaar: ${error.message}`);
  }
}

/** Schrijft het result-event met idempotentie op correlatie_id + retry. Geeft
 *  true bij succes, false bij een gemarkeerd hiaat (kritiek signaal, geen
 *  exception zodat de business-uitkomst leidend blijft voor de gebruiker). */
export async function logResultGegarandeerd(
  input: ResultInput,
  pogingen = 3
): Promise<boolean> {
  const svc = createPlatformSupabase();

  for (let poging = 1; poging <= pogingen; poging++) {
    // Idempotentie: bestaat er al een result voor deze correlatie_id, dan klaar.
    const { data: bestaand } = await svc
      .from("platform_event_log")
      .select("id")
      .eq("correlatie_id", input.correlatieId)
      .eq("fase", "result")
      .limit(1)
      .maybeSingle();
    if (bestaand) return true;

    const { error } = await svc.from("platform_event_log").insert(resultRow(input));
    if (!error) return true;
  }

  // Gemarkeerd hiaat: result kon niet worden geschreven. Dit is zelf een
  // kritiek securitysignaal (detectiejob "attempt zonder result", TO §6/§14).
  console.error(
    `[PLATFORM-AUDIT][HIAAT] result-event niet geschreven na ${pogingen} pogingen`,
    {
      correlatie_id: input.correlatieId,
      capability: input.capability,
      handeling: input.handeling,
      uitkomst: input.uitkomst,
    }
  );
  return false;
}

/** Sessieloze/ongeauthenticeerde poging: best-effort attempt+result met
 *  identity_id=null. Mag de hoofdflow niet breken (geen throw). */
export async function logSecurity(input: {
  correlatieId: string;
  capability: PlatformCapability;
  handeling: string;
  doelObject?: string | null;
  reden?: string | null;
  bronIp?: string | null;
  foutcode: string;
}): Promise<void> {
  try {
    const svc = createPlatformSupabase();
    await svc.from("platform_event_log").insert(
      attemptRow({
        correlatieId: input.correlatieId,
        identityId: null,
        capability: input.capability,
        handeling: input.handeling,
        doelObject: input.doelObject ?? null,
        reden: input.reden ?? null,
        bronIp: input.bronIp ?? null,
      })
    );
    await svc.from("platform_event_log").insert(
      resultRow({
        correlatieId: input.correlatieId,
        identityId: null,
        capability: input.capability,
        handeling: input.handeling,
        uitkomst: "geweigerd",
        foutcode: input.foutcode,
      })
    );
  } catch {
    // Best-effort: sessieloze logging mag de 403-respons niet blokkeren.
  }
}
