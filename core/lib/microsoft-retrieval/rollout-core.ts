// ============================================================================
//  #423 T4-D — browserveilige kern van de Copilot-rolloutpoort.
// ----------------------------------------------------------------------------
//  Puur: geen netwerk, geen database, geen server-only import. Alles wat hier
//  staat is deterministisch te testen zonder Microsoft, en juist daarom leeft de
//  beslissingslogica hier en niet in de orkestratie.
//
//  Twee dingen die dit bestand hard maakt:
//
//  1. `gereed` ontstaat alleen uit een VOLLEDIGE conjunctie binnen één
//     momentopname. Geen OR-fallback, geen "een andere laag zal dit wel
//     gecontroleerd hebben".
//  2. Het onderscheid tussen BEWUST UIT en een READINESSGAT. Bewust uit levert
//     geen spoor en geen fout; een gat met open schakelaars stopt fail-closed.
//     Stil doorgaan op een kleinere bronverzameling is de gevaarlijke uitkomst:
//     dan oogt een antwoord compleet terwijl het op minder bronnen rust.
// ============================================================================

/** De twee delegated scopes die Copilot Retrieval voor SharePoint vereist. */
export const COPILOT_VEREISTE_SCOPES = ["Files.Read.All", "Sites.Read.All"] as const;
export type CopilotVereisteScope = typeof COPILOT_VEREISTE_SCOPES[number];

/**
 * De ENIGE host waarvan een scope-URI mag komen. Een scope die als URI binnenkomt
 * en niet exact van deze host is, telt niet — ook niet als het pad er goed uitziet.
 */
export const COPILOT_SCOPE_HOST = "graph.microsoft.com";

export type CopilotReadinessToestand =
  | "uit"
  | "configuratie_ongeldig"
  | "consent_ontbreekt"
  | "billing_ontbreekt"
  | "tijdelijk_geblokkeerd"
  | "gereed_onder_voorbehoud"
  | "gereed";

/** Toestanden waarbij de arm niet eens wordt aangemaakt: geen spoor, geen call. */
export function isBewustUit(toestand: CopilotReadinessToestand): boolean {
  return toestand === "uit";
}

/**
 * Toestanden die een gevraagde beurt fail-closed stoppen. `gereed_onder_voorbehoud`
 * hoort hier NIET bij: dat is een tussenstand die nog naar `gereed` kan gaan zodra
 * het tokenbewijs klopt.
 */
export function stoptBeurt(toestand: CopilotReadinessToestand): boolean {
  return toestand === "configuratie_ongeldig"
    || toestand === "consent_ontbreekt"
    || toestand === "billing_ontbreekt"
    || toestand === "tijdelijk_geblokkeerd";
}

// ---------------------------------------------------------------------------
//  Scopenormalisatie
// ---------------------------------------------------------------------------

/**
 * Normaliseert één scope naar een vergelijkbare, kleine-letter vorm.
 *
 * Microsoft levert scopes soms kaal (`Files.Read.All`) en soms als volledige URI
 * (`https://graph.microsoft.com/Files.Read.All`), met wisselende casing. Beide
 * vormen moeten herkend worden — maar een URI telt UITSLUITEND wanneer hij exact
 * van `graph.microsoft.com` komt. `https://graph.microsoft.com.evil.example/...`
 * is geen Graph-scope, hoe erg het er ook op lijkt.
 *
 * Levert `null` bij alles wat niet eenduidig te herleiden is. Fail-closed: een
 * scope die we niet begrijpen, is geen scope die we accepteren.
 */
export function normaliseerScope(scope: string): string | null {
  const ruw = scope.trim();
  if (!ruw) return null;

  // Kale vorm: geen schema, geen pad, geen witruimte.
  if (!ruw.includes("/")) {
    return /^[A-Za-z0-9._-]+$/.test(ruw) ? ruw.toLowerCase() : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(ruw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  // Exacte host. Geen subdomein, geen suffix, geen poort, geen credentials.
  if (parsed.hostname.toLowerCase() !== COPILOT_SCOPE_HOST) return null;
  if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return null;

  // Precies één padsegment. `/v1.0/Files.Read.All` of een diepere vorm is geen
  // scope-URI die wij kennen, dus die accepteren we niet.
  const segmenten = parsed.pathname.split("/").filter((deel) => deel.length > 0);
  if (segmenten.length !== 1) return null;
  // `new URL()` accepteert een kapotte percent-codering zoals `%E0%A4%A`; pas
  // decodeURIComponent struikelt erover met een URIError. Die mag hier niet
  // ontsnappen: een scope die we niet kunnen lezen is geen scope die we
  // accepteren, dus fail-closed naar null in plaats van een worp.
  let naam: string;
  try {
    naam = decodeURIComponent(segmenten[0]);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9._-]+$/.test(naam) ? naam.toLowerCase() : null;
}

/**
 * Toetst of ALLE vereiste scopes aanwezig zijn, met exacte naamvergelijking.
 *
 * Bewust geen `includes()` op een samengevoegde string: `Files.Read.All` zou dan
 * matchen op `Files.Read.All.Something`, en dat is een andere permissie.
 */
export function heeftBeideScopes(scopes: readonly string[]): boolean {
  const genormaliseerd = new Set(
    scopes.map((scope) => normaliseerScope(scope)).filter((scope): scope is string => scope !== null),
  );
  return COPILOT_VEREISTE_SCOPES.every((vereist) => genormaliseerd.has(vereist.toLowerCase()));
}

/** Welke van de vereiste scopes ontbreken; uitsluitend voor inhoudsvrije diagnostiek. */
export function ontbrekendeScopes(scopes: readonly string[]): CopilotVereisteScope[] {
  const genormaliseerd = new Set(
    scopes.map((scope) => normaliseerScope(scope)).filter((scope): scope is string => scope !== null),
  );
  return COPILOT_VEREISTE_SCOPES.filter((vereist) => !genormaliseerd.has(vereist.toLowerCase()));
}

// ---------------------------------------------------------------------------
//  Readinessbewijs en beoordeling
// ---------------------------------------------------------------------------

/**
 * Het profiel dat de tokenbron over ZICHZELF declareert. Readiness leidt tenant,
 * client-id en credentialmodel hier uit af en nergens anders: twee afleidingen van
 * hetzelfde feit kunnen uiteenlopen, en dan is onduidelijk welke won.
 */
export interface CopilotTokenbronProfiel {
  readonly tenantId: string;
  readonly clientId: string;
  /** Eén literal. Een public-client-labprofiel is hiermee typematig uitgesloten. */
  readonly credentialmodel: "confidential_client_secret";
}

/** Eén momentopname van alles waar readiness op steunt. */
export interface CopilotReadinessBewijs {
  /** Globale kill switch. Afwezige rij ⇒ `false`; de lezer beslist dat, niet dit bestand. */
  globaleRolloutAan: boolean;
  fondsflagAan: boolean;
  billingGeldig: boolean;
  /** Vensterblokkade na een eerdere weigering of 429. */
  tijdelijkGeblokkeerd: boolean;
  verbinding: {
    status: string;
    tenantId: string;
    actorObjectId: string;
    /** `null` voor elke verbinding van vóór de client-id-migratie. */
    clientId: string | null;
    scopes: readonly string[];
    verbindingVersie: number;
  } | null;
  fondsId: string;
  actorId: string;
  verwachteFondsId: string;
  verwachteActorId: string;
}

export interface CopilotReadinessUitkomst {
  toestand: CopilotReadinessToestand;
  /** Stempel van de momentopname; de herlezing vóór toelating vergelijkt hierop. */
  verbindingVersie: number | null;
}

/**
 * De volledige conjunctie, in vaste volgorde. De eerste die faalt bepaalt de
 * uitkomst, zodat de reden altijd de meest fundamentele is.
 */
export function beoordeelReadiness(
  bewijs: CopilotReadinessBewijs,
  profiel: CopilotTokenbronProfiel,
): CopilotReadinessUitkomst {
  // 1 — bewust uit. Eerst, zodat een dichte schakelaar nooit een providerfout
  //     of auditspoor oplevert.
  if (!bewijs.globaleRolloutAan || !bewijs.fondsflagAan) {
    return { toestand: "uit", verbindingVersie: null };
  }

  const verbinding = bewijs.verbinding;
  const versie = verbinding?.verbindingVersie ?? null;

  // 2 — configuratie: fonds/actor van het verzoek, en de client-id van de
  //     verbinding tegenover het profiel van de tokenbron.
  if (bewijs.fondsId !== bewijs.verwachteFondsId || bewijs.actorId !== bewijs.verwachteActorId) {
    return { toestand: "configuratie_ongeldig", verbindingVersie: versie };
  }
  if (!verbinding) return { toestand: "consent_ontbreekt", verbindingVersie: null };
  if (verbinding.clientId === null || verbinding.clientId !== profiel.clientId) {
    return { toestand: "configuratie_ongeldig", verbindingVersie: versie };
  }
  if (verbinding.tenantId !== profiel.tenantId) {
    return { toestand: "configuratie_ongeldig", verbindingVersie: versie };
  }

  // 3 — consent: de verbinding moet werkelijk gekoppeld zijn.
  if (verbinding.status !== "gekoppeld" || !verbinding.actorObjectId) {
    return { toestand: "consent_ontbreekt", verbindingVersie: versie };
  }

  // 4 — beide scopes, zoals opgeslagen. Het token bevestigt dit later opnieuw.
  if (!heeftBeideScopes(verbinding.scopes)) {
    return { toestand: "configuratie_ongeldig", verbindingVersie: versie };
  }

  // 5 — billing.
  if (!bewijs.billingGeldig) {
    return { toestand: "billing_ontbreekt", verbindingVersie: versie };
  }

  // 6 — vensterblokkade.
  if (bewijs.tijdelijkGeblokkeerd) {
    return { toestand: "tijdelijk_geblokkeerd", verbindingVersie: versie };
  }

  // 7 — alles klopt volgens onze eigen database. Bewust nog niet `gereed`: dat is
  //     een bewering van onszelf, geen bevestiging van Microsoft.
  return { toestand: "gereed_onder_voorbehoud", verbindingVersie: versie };
}

// ---------------------------------------------------------------------------
//  Tokenbewijs
// ---------------------------------------------------------------------------

/** Wat Microsoft werkelijk heeft uitgegeven, niet wat onze database beweert. */
export interface CopilotTokenBevestiging {
  tenantId: string;
  actorObjectId: string;
  clientId: string;
  scopes: readonly string[];
}

export type CopilotTokenOordeel =
  | { ok: true }
  | { ok: false; reden: "scopes" | "tenant" | "actor" | "app" };

/**
 * Toetst het WERKELIJK verkregen tokenresultaat tegen het profiel en tegen de
 * verbinding waarop readiness zich baseerde.
 *
 * Waarom dit los staat van stap 4 hierboven: `gedelegeerdToken` in de bestaande
 * connector geeft tenant en actor terug uit de opgeslagen verbinding, niet uit het
 * token. Zou readiness daarop leunen, dan controleren we onze eigen database tegen
 * zichzelf en weten we nog steeds niet wat Microsoft heeft uitgegeven.
 */
export function beoordeelTokenbevestiging(
  bevestiging: CopilotTokenBevestiging,
  profiel: CopilotTokenbronProfiel,
  verbinding: { tenantId: string; actorObjectId: string },
): CopilotTokenOordeel {
  if (!heeftBeideScopes(bevestiging.scopes)) return { ok: false, reden: "scopes" };
  if (bevestiging.tenantId !== profiel.tenantId || bevestiging.tenantId !== verbinding.tenantId) {
    return { ok: false, reden: "tenant" };
  }
  if (bevestiging.actorObjectId !== verbinding.actorObjectId) return { ok: false, reden: "actor" };
  if (bevestiging.clientId !== profiel.clientId) return { ok: false, reden: "app" };
  return { ok: true };
}

/**
 * Is de eerder gelezen readiness nog geldig? Vergelijkt de stempel plus de velden
 * die alleen bij (her)koppelen of intrekken veranderen.
 *
 * Een tokenverversing hoogt `verbinding_versie` bewust NIET op, dus een normale
 * refresh midden in een beurt breekt de beurt niet af.
 */
export function readinessNogGeldig(
  eerder: CopilotReadinessUitkomst,
  nu: CopilotReadinessUitkomst,
): boolean {
  if (eerder.toestand !== "gereed_onder_voorbehoud" && eerder.toestand !== "gereed") return false;
  if (nu.toestand !== "gereed_onder_voorbehoud" && nu.toestand !== "gereed") return false;
  if (eerder.verbindingVersie === null || nu.verbindingVersie === null) return false;
  return eerder.verbindingVersie === nu.verbindingVersie;
}
