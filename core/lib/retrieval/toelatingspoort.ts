// ============================================================================
//  #322 F4-T2-1/PR-C — De TOELATINGSPOORT (V1–V5, ontwerp §4.2.1).
// ----------------------------------------------------------------------------
//  Een capability-boolean is geen bewijs. `permissionProof: true` zei tot nu toe
//  alleen dát een adapter rechten controleert, niet dát hij het voor DIT
//  resultaat, DEZE gebruiker en DIT verzoek heeft gedaan. Deze poort maakt die
//  claim toetsbaar: vijf voorwaarden, alle vijf noodzakelijk, en wie er één mist
//  wordt geweigerd — nooit gedegradeerd, nooit alsnog toegelaten op een zwakker
//  bewijs.
//
//  PROVIDERNEUTRAAL. Deze module kent geen providernamen en geen bronsoorten.
//  Wat een resultaat moet meebrengen volgt UITSLUITEND uit
//  `capabilities().permissionProof`. Een gate in de contracttests verbiedt dat
//  hier ooit op `microsoft` of een bronsoort wordt vergeleken — dat was de fout
//  van PR-A ronde 1, waar het contract feitelijk Supabase-only bleek.
//
//  WAAR HIJ DRAAIT. Direct ná de adapteruitkomst en VÓÓR de
//  kandidatenbegrenzing. Niet pas vóór de selectie: kapt de pool eerst af op
//  `maxKandidaten`, dan kan een geweigerde bron een toelaatbare kandidaat uit de
//  pool hebben verdrongen. Die bron telt dan alsnog mee — onzichtbaar, want hij
//  staat nergens meer in. Poort eerst, dan begrenzen.
//
//  FAIL-CLOSED. Elke twijfel weigert: ontbrekend bewijs bij een adapter die
//  bewijs belooft, een ontbrekende V5-hook, een ontbrekende map-entry, een
//  afwijkende referentie, een onleesbaar tijdstip, of een hook die gooit.
// ============================================================================
import type {
  Bronresultaat,
  RetrievalAdapter,
  RetrievalContext,
  Bronregistratiestand,
} from "./contract";

/** Waarom een kandidaat is geweigerd. Inhoudsvrij; gaat naar het auditspoor. */
export type Weigergrond =
  | "geen_bewijs"
  | "bewijs_niet_beloofd"
  | "binding_ander_resultaat"
  | "v1_niet_toegestaan"
  | "v2_andere_gebruiker"
  | "v3_ander_verzoek"
  | "v4_venster"
  | "v5_bron_gewijzigd"
  | "v5_hook_ontbreekt"
  | "v5_hook_fout"
  | "v5_geen_stand";

export interface Poortuitkomst {
  toegelaten: Bronresultaat[];
  /** Per geweigerde kandidaat de grond. Inhoudsvrij: ref + grond, meer niet. */
  geweigerd: { ref: string; grond: Weigergrond }[];
}

/** Bovengrens van het geldigheidsvenster (§4.2.1 V4). Geen streefwaarde. */
export const BEWIJS_MAX_LEEFTIJD_MS = 60_000;
/** Speling naar de toekomst voor klokverschil tussen twee systemen. */
export const BEWIJS_KLOKSPELING_MS = 2_000;

/**
 * Leest een ISO-tijdstempel NUMERIEK. `new Date("onzin").getTime()` is `NaN`, en
 * elke vergelijking met `NaN` is `false` — dan zou een onleesbaar tijdstip
 * stilzwijgend álle vensters doorstaan of juist niet, afhankelijk van de kant
 * van de vergelijking. Expliciet `null` dwingt de aanroeper tot een keuze.
 */
function tijdstip(waarde: string | null | undefined): number | null {
  if (typeof waarde !== "string" || waarde.length === 0) return null;
  const ms = Date.parse(waarde);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * De poort. `standen` is de V5-herlezing, één keer per unieke
 * `bronregistratieRef` gedaan door de aanroeper (`verifieerToelating`).
 */
function beoordeel(
  bron: Bronresultaat,
  ctx: RetrievalContext,
  eistBewijs: boolean,
  poortNu: number,
  verzoekStart: number | null,
  standen: Map<string, Bronregistratiestand> | null,
  hookFout: boolean
): Weigergrond | null {
  const bewijs = bron.toegangscontrole;

  if (!eistBewijs) {
    // Een adapter die GEEN bewijs belooft, mag er ook geen meesturen. Zonder
    // deze controle kan hij stilzwijgend iets claimen dat nergens wordt
    // getoetst — precies de schijnzekerheid die dit contract moet uitsluiten.
    return bewijs ? "bewijs_niet_beloofd" : null;
  }
  if (!bewijs) return "geen_bewijs";

  // V1 — de adapter had dit resultaat zelf al moeten weglaten.
  if (bewijs.toegestaan !== true) return "v1_niet_toegestaan";

  // BINDING AAN DE KANDIDAAT. Zonder deze twee is een bewijs overdraagbaar:
  // binnen één verzoek zijn actor, correlatie-id en configuratieversie per
  // definitie gelijk, dus een geldig bewijs voor bron A past dan zomaar op
  // kandidaat B.
  if (bewijs.resultaatRef !== bron.ref) return "binding_ander_resultaat";

  // V2 — een verse, geldige proof die bij een ANDERE gebruiker hoort.
  const actorId = ctx.actor.soort === "gebruiker" ? ctx.actor.id : null;
  if (!actorId || bewijs.gebruikerId !== actorId) return "v2_andere_gebruiker";

  // V3 — een proof uit een EERDERE request van dezelfde gebruiker.
  if (bewijs.correlationId !== ctx.correlationId) return "v3_ander_verzoek";

  // V4 — het venster. `basis: "rls"` kent geen eigen venster (de tenant-client
  // is daar zelf het bewijs), maar V2 en V3 gelden onverkort.
  if (bewijs.basis !== "rls") {
    const gecontroleerd = tijdstip(bewijs.gecontroleerdOp);
    if (gecontroleerd === null) return "v4_venster";
    if (verzoekStart === null) return "v4_venster";
    if (gecontroleerd < verzoekStart) return "v4_venster";
    if (gecontroleerd > poortNu + BEWIJS_KLOKSPELING_MS) return "v4_venster";
    if (poortNu - gecontroleerd > BEWIJS_MAX_LEEFTIJD_MS) return "v4_venster";
  }

  // V5 — de ACTUELE stand van de bronregistratie.
  if (hookFout) return "v5_hook_fout";
  if (standen === null) return "v5_hook_ontbreekt";
  if (typeof bewijs.bronregistratieRef !== "string" || bewijs.bronregistratieRef.length === 0) {
    return "v5_geen_stand";
  }
  const stand = standen.get(bewijs.bronregistratieRef);
  if (!stand) return "v5_geen_stand";
  if (!stand.verbonden) return "v5_bron_gewijzigd";
  if (stand.versie !== bewijs.bronconfiguratieVersie) return "v5_bron_gewijzigd";

  return null;
}

/**
 * Voert de poort uit over de kandidaten van ÉÉN adapteraanroep.
 *
 * `poortNu` wordt ÉÉN keer bepaald en voor alle kandidaten gebruikt: zou elke
 * kandidaat zijn eigen "nu" krijgen, dan kan een trage lus de een nog net binnen
 * het venster laten vallen en de ander niet, en is de uitkomst afhankelijk van
 * de volgorde waarin toevallig is geïtereerd.
 */
export async function verifieerToelating(
  ctx: RetrievalContext,
  adapter: RetrievalAdapter,
  kandidaten: readonly Bronresultaat[]
): Promise<Poortuitkomst> {
  const eistBewijs = adapter.capabilities().permissionProof === true;
  const poortNu = Date.now();
  const verzoekStart = tijdstip(ctx.verzoekStartOp);

  let standen: Map<string, Bronregistratiestand> | null = null;
  // Een hook die GOOIT is iets anders dan een hook die ONTBREEKT: het eerste is
  // een mislukte controle, het tweede een adapter die zijn belofte niet
  // waarmaakt. Beide weigeren gesloten, maar het auditspoor hoort ze te kunnen
  // onderscheiden — anders lijkt een storing op een ontwerpfout.
  let hookFout = false;
  if (eistBewijs) {
    // Eén herlezing per UNIEKE bronregistratie, gedeeld over alle kandidaten van
    // dit spoor. Request-lokaal — nooit over verzoeken heen, want dan is de
    // herlezing weer de momentopname die zij vervangt.
    const refs = [
      ...new Set(
        kandidaten
          .map((k) => k.toegangscontrole?.bronregistratieRef)
          .filter((r): r is string => typeof r === "string" && r.length > 0)
      ),
    ];
    if (adapter.verifieerBronregistratie && refs.length > 0) {
      try {
        standen = await adapter.verifieerBronregistratie(ctx, refs);
      } catch {
        // Een mislukte controle, geen "onbekend" — weigert gesloten. De
        // afbreking van de beurt zelf loopt via het signaal en komt hier niet
        // als weigergrond terecht.
        standen = null;
        hookFout = true;
      }
    } else if (adapter.verifieerBronregistratie) {
      // Geen enkele kandidaat droeg een bronregistratieref; de hook heeft niets
      // te doen. `beoordeel` weigert die kandidaten op `v5_geen_stand`.
      standen = new Map();
    }
  }

  const toegelaten: Bronresultaat[] = [];
  const geweigerd: { ref: string; grond: Weigergrond }[] = [];
  for (const bron of kandidaten) {
    const grond = beoordeel(bron, ctx, eistBewijs, poortNu, verzoekStart, standen, hookFout);
    if (grond === null) toegelaten.push(bron);
    else geweigerd.push({ ref: bron.ref, grond });
  }
  return { toegelaten, geweigerd };
}
