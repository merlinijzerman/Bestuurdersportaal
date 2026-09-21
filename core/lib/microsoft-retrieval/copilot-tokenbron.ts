// ============================================================================
//  #423 T4-D — de Copilot-tokenbron en de vaste toelatingsvolgorde.
// ----------------------------------------------------------------------------
//  Deze module bevat GEEN implementatie die zelf een client opbouwt. De bron
//  wordt geïnjecteerd; dat is wat een fonds- of tenantroute ervan weerhoudt om
//  per ongeluk een secret of een service-role mee te trekken.
//
//  Waarom een eigen bron en niet `sharepointAccessToken`:
//  `gedelegeerdToken(ctx, scope)` in `microsoft-connector.ts` neemt exact ÉÉN
//  scope — de parametertypering kent `Sites.Read.All` niet eens — en het
//  retourobject vult tenant en actor uit de OPGESLAGEN verbinding, niet uit het
//  token. Beide eigenschappen maken die keten ongeschikt voor een arm die twee
//  scopes nodig heeft en het resultaat wil bevestigen. De bestaande functies
//  blijven daarom ongemoeid; die zijn van Outlook, SharePoint en de smoke.
// ============================================================================
import {
  beoordeelTokenbevestiging,
  readinessNogGeldig,
  type CopilotReadinessUitkomst,
  type CopilotTokenBevestiging,
  type CopilotTokenbronProfiel,
} from "./rollout-core";

export interface CopilotTokenContext {
  fondsId: string;
  gebruikerId: string;
}

export interface CopilotTokenbewijs {
  accessToken: string;
  /** Uit het werkelijke resultaat; nooit overgeschreven met databasewaarden. */
  bevestigd: CopilotTokenBevestiging;
}

/**
 * De bron declareert haar eigen identiteit. Readiness leest tenant, client-id en
 * credentialmodel HIERUIT en niet daarnaast nog eens uit `microsoftConfig()`.
 */
export interface CopilotTokenbron {
  readonly profiel: CopilotTokenbronProfiel;
  haalToken(ctx: CopilotTokenContext): Promise<CopilotTokenbewijs>;
}

export type CopilotToelatingUitkomst =
  | { toegelaten: true; token: CopilotTokenbewijs; readiness: CopilotReadinessUitkomst }
  | {
      toegelaten: false;
      /** Inhoudsvrije reden; nooit een fouttekst, claim of Graph-body. */
      reden:
        | "uit"
        | "configuratie_ongeldig"
        | "consent_ontbreekt"
        | "billing_ontbreekt"
        | "tijdelijk_geblokkeerd"
        | "tokenbewijs_ongeldig"
        | "readiness_gewijzigd"
        | "tokenbron_onbereikbaar";
    };

export interface CopilotToelatingDeps {
  /** Leest readiness uit de private laag. Wordt twee keer aangeroepen: vóór en ná. */
  leesReadiness: (ctx: CopilotTokenContext) => Promise<{
    uitkomst: CopilotReadinessUitkomst;
    verbinding: { tenantId: string; actorObjectId: string } | null;
  }>;
  tokenbron: CopilotTokenbron;
}

/**
 * De vaste volgorde, en de enige plek waar hij wordt bepaald:
 *
 *   1. VOORLOPIGE readiness  — uit onze eigen database
 *   2. TOKENBEWIJS           — wat Microsoft werkelijk uitgaf
 *   3. ACTUELE HERLEZING     — is stap 1 nog waar?
 *   4. pas daarna Retrieval  — door de aanroeper, niet hier
 *
 * Stap 3 staat bewust ná stap 2. Een intrekking die tussen het lezen en het
 * ophalen valt, zou anders onopgemerkt blijven: we hadden dan een geldig token in
 * handen op grond van een toestand die inmiddels niet meer bestond.
 *
 * Deze functie doet zelf GEEN Retrieval-call. Zij levert hooguit een toegelaten
 * token op; wat daarmee gebeurt is aan de adapter.
 */
export async function beoordeelToelating(
  deps: CopilotToelatingDeps,
  ctx: CopilotTokenContext,
): Promise<CopilotToelatingUitkomst> {
  // ── 1. Voorlopige readiness ───────────────────────────────────────────────
  const eerste = await deps.leesReadiness(ctx);
  const toestand = eerste.uitkomst.toestand;

  if (toestand === "uit") return { toegelaten: false, reden: "uit" };
  if (
    toestand === "configuratie_ongeldig"
    || toestand === "consent_ontbreekt"
    || toestand === "billing_ontbreekt"
    || toestand === "tijdelijk_geblokkeerd"
  ) {
    return { toegelaten: false, reden: toestand };
  }
  if (!eerste.verbinding) return { toegelaten: false, reden: "consent_ontbreekt" };

  // ── 2. Tokenbewijs ────────────────────────────────────────────────────────
  let token: CopilotTokenbewijs;
  try {
    token = await deps.tokenbron.haalToken(ctx);
  } catch {
    // De onderliggende fout wordt bewust niet doorgegeven: hij kan een claim, een
    // URL of een Graph-body bevatten.
    return { toegelaten: false, reden: "tokenbron_onbereikbaar" };
  }

  const oordeel = beoordeelTokenbevestiging(
    token.bevestigd,
    deps.tokenbron.profiel,
    eerste.verbinding,
  );
  if (!oordeel.ok) return { toegelaten: false, reden: "tokenbewijs_ongeldig" };

  // ── 3. Actuele herlezing ──────────────────────────────────────────────────
  const tweede = await deps.leesReadiness(ctx);
  if (!readinessNogGeldig(eerste.uitkomst, tweede.uitkomst)) {
    return { toegelaten: false, reden: "readiness_gewijzigd" };
  }

  // ── 4. Toegelaten. De Retrieval-call is aan de aanroeper. ─────────────────
  return {
    toegelaten: true,
    token,
    readiness: { toestand: "gereed", verbindingVersie: tweede.uitkomst.verbindingVersie },
  };
}
