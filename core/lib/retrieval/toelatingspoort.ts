// ============================================================================
//  #322 F4-T2-1/PR-C — De TOELATINGSPOORT (V1–V5, ontwerp §4.2.1).
// ----------------------------------------------------------------------------
//  Een capability-boolean is geen bewijs. `permissionProof: true` zei tot nu toe
//  alleen dát een adapter rechten controleert, niet dát hij het voor DIT
//  resultaat, DEZE gebruiker en DIT verzoek heeft gedaan. Deze poort maakt die
//  claim toetsbaar — en ook de twee andere beloften die een adapter doet:
//  welke filters hij ondersteunt en of hij versiebewijs levert.
//
//  PROVIDERNEUTRAAL. Deze module kent geen providernamen en geen bronsoorten.
//  Wat een resultaat moet meebrengen volgt UITSLUITEND uit de capabilities van
//  de adapter. Een gate in de tests verbiedt dat hier ooit op een providernaam
//  of bronsoort wordt beslist — dat was de fout van PR-A ronde 1.
//
//  TWEE MOMENTEN.
//    • VÓÓR `zoek()`: een filter dat de adapter niet ondersteunt is een fout,
//      nooit een stille no-op. Anders zoekt een adapter breder dan gevraagd en
//      ziet niemand het.
//    • NÁ `zoek()`, en vóór de kandidatenbegrenzing: per kandidaat versiebewijs
//      en rechtenbewijs. Niet pas vóór de selectie — kapt de pool eerst af, dan
//      kan een geweigerde bron een toelaatbare kandidaat hebben verdrongen.
//
//  ÉÉN BEOORDELING PER VERZOEK. Alle kandidaten van alle sporen gaan in één
//  batch: één `poortNu`, één V5-herlezing per unieke bronregistratie. Per spoor
//  apart zou dezelfde bron twee keer worden gelezen — en bij een intrekking
//  tussen die twee lezingen verschillend worden beoordeeld.
//
//  FAIL-CLOSED. Elke twijfel weigert.
// ============================================================================
import type {
  AdapterCapabilities,
  Bronregistratiestand,
  Bronresultaat,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "./contract";

/** Waarom een kandidaat is geweigerd. Inhoudsvrij; gaat naar het auditspoor. */
export type Weigergrond =
  | "geen_bewijs"
  | "bewijs_niet_beloofd"
  | "versiebewijs_ontbreekt"
  | "binding_ander_resultaat"
  | "binding_andere_bron"
  | "v1_niet_toegestaan"
  | "v2_andere_gebruiker"
  | "v3_ander_verzoek"
  | "v4_venster"
  | "v5_bron_gewijzigd"
  | "v5_hook_ontbreekt"
  | "v5_hook_fout"
  | "v5_geen_stand";

/**
 * De genormaliseerde foutcategorie (§4.4). Twee soorten falen die in het
 * auditspoor NIET op elkaar mogen lijken:
 *   • `toestemming_geweigerd` — de gebruiker mocht dit niet zien, of het was
 *     niet aan te tonen dat hij het mocht;
 *   • `configuratiefout` — de ADAPTER hield zich niet aan zijn eigen contract.
 * Het eerste is normaal bedrijf; het tweede is een defect dat iemand moet
 * oplossen.
 */
export type Weigercategorie = "toestemming_geweigerd" | "configuratiefout";

const CATEGORIE: Record<Weigergrond, Weigercategorie> = {
  geen_bewijs: "toestemming_geweigerd",
  binding_ander_resultaat: "toestemming_geweigerd",
  binding_andere_bron: "toestemming_geweigerd",
  v1_niet_toegestaan: "toestemming_geweigerd",
  v2_andere_gebruiker: "toestemming_geweigerd",
  v3_ander_verzoek: "toestemming_geweigerd",
  v4_venster: "toestemming_geweigerd",
  v5_bron_gewijzigd: "toestemming_geweigerd",
  v5_geen_stand: "toestemming_geweigerd",
  // Een hook die GOOIT: de rechten konden niet worden bevestigd. Dat is voor de
  // gebruiker een weigering, geen defect van het contract.
  v5_hook_fout: "toestemming_geweigerd",
  // De adapter belooft iets wat hij niet waarmaakt.
  bewijs_niet_beloofd: "configuratiefout",
  versiebewijs_ontbreekt: "configuratiefout",
  v5_hook_ontbreekt: "configuratiefout",
};

export function categorieVan(grond: Weigergrond): Weigercategorie {
  return CATEGORIE[grond];
}

export interface Weigering {
  /** Index van het spoor waaruit de kandidaat kwam. */
  spoor: number;
  ref: string;
  grond: Weigergrond;
}

export interface Poortuitkomst {
  toegelatenPerSpoor: Bronresultaat[][];
  geweigerd: Weigering[];
}

/** Bovengrens van het geldigheidsvenster (§4.2.1 V4). Geen streefwaarde. */
export const BEWIJS_MAX_LEEFTIJD_MS = 60_000;
/** Speling naar de toekomst voor klokverschil tussen twee systemen. */
export const BEWIJS_KLOKSPELING_MS = 2_000;

// ── Vóór zoek(): de filterbelofte ─────────────────────────────────────────────

/**
 * De filters uit de query die de adapter NIET ondersteunt. Alleen sleutels met
 * een werkelijke waarde tellen: `{ peildatum: undefined }` vraagt niets, en een
 * afwezig filter als overtreding aanmerken zou elke aanroep met een optioneel
 * veld doen stranden.
 */
export function nietOndersteundeFilters(caps: AdapterCapabilities, query: RetrievalQuery): string[] {
  const gebruikt = Object.entries(query.filters ?? {})
    .filter(([, waarde]) => waarde !== undefined)
    .map(([sleutel]) => sleutel);
  const ondersteund = new Set<string>(caps.ondersteundeFilters as string[]);
  return gebruikt.filter((s) => !ondersteund.has(s));
}

// ── Ná zoek(): per kandidaat ──────────────────────────────────────────────────

/**
 * Leest een ISO-tijdstempel NUMERIEK. `Date.parse("onzin")` is `NaN`, en elke
 * vergelijking met `NaN` is `false` — dan zou een onleesbaar tijdstip
 * stilzwijgend álle vensters doorstaan of juist niet, afhankelijk van de kant
 * van de vergelijking. Expliciet `null` dwingt de aanroeper tot een keuze.
 */
function tijdstip(waarde: string | null | undefined): number | null {
  if (typeof waarde !== "string" || waarde.length === 0) return null;
  const ms = Date.parse(waarde);
  return Number.isFinite(ms) ? ms : null;
}

interface Oordeelcontext {
  ctx: RetrievalContext;
  caps: AdapterCapabilities;
  poortNu: number;
  verzoekStart: number | null;
  standen: Map<string, Bronregistratiestand> | null;
  hookFout: boolean;
}

function beoordeel(bron: Bronresultaat, o: Oordeelcontext): Weigergrond | null {
  // VERSIEBEWIJS — los van rechten. Een adapter die versiebewijs belooft maar
  // het niet levert, laat een resultaat door dat later niet meer is terug te
  // voeren op de versie die het model zag.
  if (o.caps.versiebewijs === true) {
    const w = bron.versie?.waarde;
    if (typeof w !== "string" || w.length === 0) return "versiebewijs_ontbreekt";
  }

  const bewijs = bron.toegangscontrole;
  if (o.caps.permissionProof !== true) {
    // Een adapter die GEEN bewijs belooft, mag er ook geen meesturen — anders
    // claimt hij stilzwijgend iets dat nergens wordt getoetst.
    return bewijs ? "bewijs_niet_beloofd" : null;
  }
  if (!bewijs) return "geen_bewijs";

  // V1 — de adapter had dit resultaat zelf al moeten weglaten.
  if (bewijs.toegestaan !== true) return "v1_niet_toegestaan";

  // BINDING — het bewijs hoort bij DEZE kandidaat en DEZE bron. Binnen één
  // verzoek zijn actor, correlatie-id en configuratieversie per definitie
  // gelijk; zonder deze twee is een geldig bewijs overdraagbaar. De
  // bronreferentie wordt vergeleken met die OP HET RESULTAAT, niet met wat het
  // bewijs over zichzelf beweert.
  if (bewijs.resultaatRef !== bron.ref) return "binding_ander_resultaat";
  if (
    typeof bron.bronregistratieRef !== "string" ||
    bron.bronregistratieRef.length === 0 ||
    bewijs.bronregistratieRef !== bron.bronregistratieRef
  ) {
    return "binding_andere_bron";
  }

  // V2 — een verse, geldige proof die bij een ANDERE gebruiker hoort.
  const actorId = o.ctx.actor.soort === "gebruiker" ? o.ctx.actor.id : null;
  if (!actorId || bewijs.gebruikerId !== actorId) return "v2_andere_gebruiker";

  // V3 — een proof uit een EERDERE request van dezelfde gebruiker.
  if (bewijs.correlationId !== o.ctx.correlationId) return "v3_ander_verzoek";

  // V4 — het venster. `basis: "rls"` kent geen eigen venster (de tenant-client
  // is daar zelf het bewijs), maar V2 en V3 gelden onverkort.
  if (bewijs.basis !== "rls") {
    const gecontroleerd = tijdstip(bewijs.gecontroleerdOp);
    if (gecontroleerd === null || o.verzoekStart === null) return "v4_venster";
    if (gecontroleerd < o.verzoekStart) return "v4_venster";
    if (gecontroleerd > o.poortNu + BEWIJS_KLOKSPELING_MS) return "v4_venster";
    if (o.poortNu - gecontroleerd > BEWIJS_MAX_LEEFTIJD_MS) return "v4_venster";
  }

  // V5 — de ACTUELE stand, opgezocht onder de referentie VAN HET RESULTAAT.
  if (o.hookFout) return "v5_hook_fout";
  if (o.standen === null) return "v5_hook_ontbreekt";
  const stand = o.standen.get(bron.bronregistratieRef);
  if (!stand) return "v5_geen_stand";
  if (stand.verbonden !== true) return "v5_bron_gewijzigd";
  if (!Number.isInteger(stand.versie) || stand.versie !== bewijs.bronconfiguratieVersie) return "v5_bron_gewijzigd";

  return null;
}

/**
 * De poort, over ALLE sporen van één verzoek tegelijk.
 *
 * Eén `poortNu` en één V5-herlezing per unieke bronregistratie, daarna terug
 * geprojecteerd naar de sporen. Per spoor apart zou dezelfde bron twee keer
 * worden gelezen en — bij een intrekking tussen die lezingen — in het ene spoor
 * worden toegelaten en in het andere geweigerd.
 */
export async function verifieerToelating(
  ctx: RetrievalContext,
  adapter: RetrievalAdapter,
  kandidatenPerSpoor: readonly (readonly Bronresultaat[])[]
): Promise<Poortuitkomst> {
  const caps = adapter.capabilities();
  const poortNu = Date.now();
  const verzoekStart = tijdstip(ctx.verzoekStartOp);

  let standen: Map<string, Bronregistratiestand> | null = null;
  // Een hook die GOOIT is iets anders dan een hook die ONTBREEKT: het eerste is
  // een mislukte controle, het tweede een adapter die zijn belofte niet
  // waarmaakt. Beide weigeren gesloten, maar het auditspoor moet ze kunnen
  // onderscheiden — anders lijkt een storing op een ontwerpfout.
  let hookFout = false;

  if (caps.permissionProof === true) {
    // Referenties VAN DE RESULTATEN, niet uit de bewijzen: de herlezing hoort te
    // gaan over de bron die de adapter aanwijst, niet over een bewering.
    const refs = [
      ...new Set(
        kandidatenPerSpoor
          .flat()
          .map((k) => k.bronregistratieRef)
          .filter((r): r is string => typeof r === "string" && r.length > 0)
      ),
    ];
    if (!adapter.verifieerBronregistratie) {
      standen = null; // → v5_hook_ontbreekt, een configuratiefout
    } else if (refs.length === 0) {
      standen = new Map();
    } else {
      try {
        // Request-lokaal — nooit gecached tussen verzoeken, want dan is de
        // herlezing weer de momentopname die zij vervangt.
        standen = await adapter.verifieerBronregistratie(ctx, refs);
      } catch {
        standen = null;
        hookFout = true;
      }
    }
  }

  const o: Oordeelcontext = { ctx, caps, poortNu, verzoekStart, standen, hookFout };
  const toegelatenPerSpoor: Bronresultaat[][] = [];
  const geweigerd: Weigering[] = [];
  kandidatenPerSpoor.forEach((kandidaten, spoor) => {
    const toegelaten: Bronresultaat[] = [];
    for (const bron of kandidaten) {
      const grond = beoordeel(bron, o);
      if (grond === null) toegelaten.push(bron);
      else geweigerd.push({ spoor, ref: bron.ref, grond });
    }
    toegelatenPerSpoor.push(toegelaten);
  });
  return { toegelatenPerSpoor, geweigerd };
}

// ── Het auditspoor ────────────────────────────────────────────────────────────

/** Inhoudsvrije samenvatting voor `retrieval_meta`: tellingen, geen referenties. */
export interface Toelatingssamenvatting {
  geweigerd: number;
  categorieen: Partial<Record<Weigercategorie, number>>;
  gronden: Partial<Record<Weigergrond, number>>;
}

/**
 * Projecteert weigeringen naar een INHOUDSVRIJE samenvatting. Alleen tellingen:
 * referenties zijn opaque identifiers van documenten die de gebruiker juist níét
 * mocht zien, en horen daarom niet in het duurzame spoor.
 */
export function vatToelatingSamen(
  geweigerd: readonly { grond: Weigergrond }[],
  filterweigeringen = 0
): Toelatingssamenvatting | null {
  const totaal = geweigerd.length + filterweigeringen;
  if (totaal === 0) return null;
  const categorieen: Partial<Record<Weigercategorie, number>> = {};
  const gronden: Partial<Record<Weigergrond, number>> = {};
  for (const { grond } of geweigerd) {
    gronden[grond] = (gronden[grond] ?? 0) + 1;
    const c = categorieVan(grond);
    categorieen[c] = (categorieen[c] ?? 0) + 1;
  }
  if (filterweigeringen > 0) {
    categorieen.configuratiefout = (categorieen.configuratiefout ?? 0) + filterweigeringen;
  }
  return { geweigerd: totaal, categorieen, gronden };
}
