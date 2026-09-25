// ============================================================================
//  #413 T4-B — Foutnormalisatie van de Copilot Retrieval-adapter.
// ----------------------------------------------------------------------------
//  DRIE REGELS, EN ZE VOLGEN ALLE DRIE UIT DE PLANREVIEW.
//
//  1. DE ADAPTER RAADT NIET. 401 en 403 kunnen een ontbrekende Copilot-licentie
//     zijn, maar net zo goed ingetrokken consent. Wij vertalen de HTTP-status,
//     en verder niets; welke van de twee het was, stelt een mens vast aan de
//     hand van de readinessstand.
//  2. NIETS UIT DE PROVIDER KOMT IN EEN FOUT TERECHT. Geen responsbody, geen
//     Graph-foutboodschap, geen URL, geen header. Een `CopilotFout` draagt een
//     vaste code en een HTTP-status, meer niet — deze objecten reizen door naar
//     audit en telemetrie, en die zijn inhouds- en identifiervrij (§3.6).
//  3. AFBREKING IS GEEN PROVIDERFOUT. Cancellation en deadline beëindigen de
//     hele beurt; ze worden DOORGEGOOID en nooit tot een weigering
//     gereduceerd, precies zoals de toelatingspoort dat doet.
//
//  RETRY. Alleen 429 en 5xx zijn herhaalbaar, en dan nog uitsluitend binnen het
//  requestbudget. 401/402/403 herhalen heeft geen zin en kost quotum; na een
//  annulering of deadline is herhalen ronduit fout.
// ============================================================================
import type { RetrievalFoutcategorie } from "../retrieval/contract";
import { isAfbreking, redenVan } from "../retrieval/afbreken";

/** Vaste, inhoudsvrije codes. Deze verzameling is gesloten (zie §3.6). */
export type CopilotFoutcode =
  | "copilot_toegang_geweigerd"
  | "copilot_billing"
  | "copilot_rate_limit"
  | "copilot_providerfout"
  | "copilot_timeout"
  | "copilot_annulering"
  | "copilot_configuratie"
  | "copilot_responsvorm"
  | "copilot_budget";

export class CopilotFout extends Error {
  readonly code: CopilotFoutcode;
  readonly categorie: RetrievalFoutcategorie;
  /** Mag deze fout binnen het budget nog een poging krijgen? */
  readonly herhaalbaar: boolean;
  /** Uitsluitend de statuscode; nooit body, header of boodschap. */
  readonly httpStatus: number | null;

  constructor(
    code: CopilotFoutcode,
    categorie: RetrievalFoutcategorie,
    opties: { herhaalbaar?: boolean; httpStatus?: number | null } = {},
  ) {
    // De boodschap is de CODE, niet een beschrijving: zo kan er ook via
    // `error.message` geen providertekst in een logregel belanden.
    super(code);
    this.name = "CopilotFout";
    this.code = code;
    this.categorie = categorie;
    this.herhaalbaar = opties.herhaalbaar ?? false;
    this.httpStatus = opties.httpStatus ?? null;
  }
}

/**
 * De statusvertaling.
 *
 * 402 is het enige eenduidige billingsignaal en wordt daarom `configuratiefout`
 * en niet `toestemming_geweigerd`: het zegt niets over wat deze gebruiker mag
 * zien, en het moet in de readinessstand `billing_ontbreekt` terechtkomen in
 * plaats van als autorisatieweigering te worden geboekt.
 *
 * Een 3xx is hier een fout en geen redirect: wij volgen geen enkele omleiding
 * van dit endpoint af — dat zou de endpointpin zinloos maken.
 */
export function foutVoorHttpStatus(status: number): CopilotFout {
  if (status === 401 || status === 403) {
    return new CopilotFout("copilot_toegang_geweigerd", "toestemming_geweigerd", { httpStatus: status });
  }
  if (status === 402) {
    return new CopilotFout("copilot_billing", "configuratiefout", { httpStatus: status });
  }
  if (status === 429) {
    return new CopilotFout("copilot_rate_limit", "rate_limit", { herhaalbaar: true, httpStatus: status });
  }
  if (status >= 500 && status <= 599) {
    return new CopilotFout("copilot_providerfout", "providerfout", { herhaalbaar: true, httpStatus: status });
  }
  // 4xx buiten de bovenstaande: wij hebben iets verkeerd gevormd (400, 404,
  // 413, 415). Dat is onze configuratie, geen storing bij de provider, en
  // herhalen levert exact hetzelfde antwoord.
  return new CopilotFout("copilot_configuratie", "configuratiefout", { httpStatus: status });
}

/**
 * Normaliseert alles wat `fetch` of het parsen kan opleveren.
 *
 * GOOIT DOOR bij een afbreking: de beurt is beëindigd en de keten moet stoppen,
 * niet met een genormaliseerde weigering verdergaan. Dat is dezelfde regel die
 * `verifieerToelating()` hanteert voor zijn hooks.
 */
export function normaliseerCopilotFout(fout: unknown): CopilotFout {
  if (fout instanceof CopilotFout) return fout;
  // ÉÉN tak, bewust. `isAfbreking()` herkent behalve onze eigen
  // `RetrievalAfgebroken` ook een kaal `AbortError`/`TimeoutError` en de
  // genormaliseerde varianten uit de AI-gateway. Er is dus geen afbreking die
  // hier alsnog als providerfout kan eindigen — en dat is precies de bedoeling:
  // een afgebroken beurt mag nooit als weigering of storing worden geboekt.
  if (isAfbreking(fout)) throw fout;
  // Netwerkfout, DNS, TLS, afgebroken verbinding: een storing, en dus geen
  // uitspraak over de rechten van de gebruiker.
  return new CopilotFout("copilot_providerfout", "providerfout", { herhaalbaar: true });
}

/** Voor de diagnostiek: de afbrekingsreden, als het er een is. */
export function afbrekingsredenVan(fout: unknown): "annulering" | "timeout" | null {
  return redenVan(fout);
}
