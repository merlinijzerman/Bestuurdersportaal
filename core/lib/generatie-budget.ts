// ============================================================================
//  #322 F4-T2-1/PR-B2 — Het tijdsbudget van de GENERATIE (G-13, issue #356).
// ----------------------------------------------------------------------------
//  Waarom een eigen budget, los van de retrievaldeadline: genereren is ander
//  werk met een ander profiel. Een bestuurlijke analyse van 8.000 tokens streamt
//  legitiem minutenlang; de retrievalketen hoort in tientallen seconden klaar te
//  zijn. Eén knop voor beide zou óf de retrievalgrens stil verruimen óf lange,
//  geldige antwoorden afknijpen.
//
//  WAAROM DIT BUDGET BESTAAT. Niet primair om kosten te beheersen — de
//  platformfunctieduur kapt sowieso af. Het bestaat om de beurt ZELF te
//  beëindigen, op tijd om het auditspoor te schrijven en de actie af te sluiten.
//  Kostenbeheersing komt van de clientdisconnect: die breekt de providercall af
//  op het moment dat er niemand meer luistert.
//
//  DE KLEM (besluit §5b bij #356). De retrieval- en generatiebudgetten zijn
//  onafhankelijk configureerbaar en tellen op binnen dezelfde invocatie. Aan de
//  bovenkant van beide banden is 60 + 285 = 345 s, ruim boven de 285 s die na de
//  afrondmarge resteert — dan doodt het platform de functie vóórdat onze eigen
//  deadline vuurt, en verdampt precies de marge die audit en afronding nodig
//  hebben. Het budget wordt daarom geklemd op wat er nog ÍS:
//
//      effectief = min(geconfigureerd, MAX_DURATION − MARGE − reedsVerstreken)
//
//  Blijft daar minder dan de ondergrens van over, dan is de beurt toch verloren:
//  dan starten we geen providercall meer maar ronden we meteen gecontroleerd af.
//  Een generatie beginnen die de functie niet kan afmaken kost geld en levert
//  niets — de bestuurder ziet dan een afgekapte respons zonder auditspoor.
// ============================================================================

/**
 * De platformgrens, expliciet in code. Het project draait op Vercel Pro met
 * Fluid Compute; 300 s is daar de standaard maximale functieduur en er is geen
 * projectoverride. `app/api/chat/route.ts` zet `maxDuration` op dezelfde waarde,
 * zodat de grens uit de code blijkt en niet uit een dashboardinstelling die
 * niemand in de repo ziet.
 */
export const MAX_DURATION_MS = 300_000;

/**
 * Gereserveerd voor de gatewaylogregel, het afronden van de `ai_actie` en het
 * sluiten van de respons. Ruim genomen: deze drie zijn netwerkaanroepen naar
 * twee verschillende systemen, en juist op het afbreekpad — het pad dat we
 * duurzaam willen vastleggen — is er geen tweede kans.
 */
export const AFRONDMARGE_MS = 15_000;

/** Grenzen voor de fondsvlag `generatie_timeout_ms`. */
export const GENERATIE_TIMEOUT_MIN_MS = 30_000;
export const GENERATIE_TIMEOUT_MAX_MS = 285_000;
export const GENERATIE_TIMEOUT_DEFAULT_MS = 120_000;

/**
 * Leest `generatie_timeout_ms` uit de fondsconfiguratie. Ontbrekend, onleesbaar
 * of buiten bereik levert de veilige default — nooit "geen grens": een kapotte
 * configuratie mag de begrenzing niet stilzwijgend uitzetten.
 *
 * Zelfde vorm als `timeoutUitConfig` voor retrieval, bewust: twee begrenzingen
 * die zich verschillend gedragen bij onzin zijn een bron van verrassingen.
 */
export function generatieTimeoutUitConfig(waarde: unknown): number {
  const n = typeof waarde === "number" ? waarde : Number.parseInt(String(waarde ?? ""), 10);
  if (!Number.isFinite(n)) return GENERATIE_TIMEOUT_DEFAULT_MS;
  if (n < GENERATIE_TIMEOUT_MIN_MS || n > GENERATIE_TIMEOUT_MAX_MS) return GENERATIE_TIMEOUT_DEFAULT_MS;
  return n;
}

export interface Budgetuitkomst {
  /** Het budget in ms; alleen betekenisvol als `genoeg` waar is. */
  budgetMs: number;
  /** Is er genoeg tijd om überhaupt te beginnen? */
  genoeg: boolean;
  /** Wat er na de marge resteerde — voor de logregel, ook als het te weinig was. */
  resterendMs: number;
}

/**
 * Het effectieve budget: het geconfigureerde, geklemd op wat de functieduur na
 * de afrondmarge nog toelaat.
 *
 * `reedsVerstrekenMs` hoort van een MONOTONE klok te komen (`performance.now()`).
 * `Date.now()` kan springen door NTP-correcties; dan zou het budget mee-springen
 * en in het slechtste geval negatief worden zonder dat er tijd verstreken is.
 */
export function effectiefGeneratiebudget(
  geconfigureerdMs: number,
  reedsVerstrekenMs: number
): Budgetuitkomst {
  const resterend = MAX_DURATION_MS - AFRONDMARGE_MS - Math.max(0, reedsVerstrekenMs);
  const budget = Math.min(geconfigureerdMs, resterend);
  return {
    budgetMs: budget,
    genoeg: budget >= GENERATIE_TIMEOUT_MIN_MS,
    resterendMs: resterend,
  };
}

/**
 * Begrenst de STRIKTE AFRONDING zelf (randvoorwaarde bij #356). Zonder deze
 * grens kan een vastlopende RPC precies de marge opeten die voor die afronding
 * is gereserveerd — en dan verliezen we alsnog het spoor dat we wilden borgen.
 *
 * Ruim binnen `AFRONDMARGE_MS`, zodat er ná een trage afronding nog tijd is om
 * de respons te sluiten.
 */
export const AFRONDING_TIMEOUT_MS = 5_000;
