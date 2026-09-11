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
  ActueleVersiestand,
  Bronregistratiestand,
  Bronresultaat,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "./contract";
import { isAfbreking } from "./afbreken";

/** Waarom een kandidaat is geweigerd. Inhoudsvrij; gaat naar het auditspoor. */
export type Weigergrond =
  | "filter_niet_ondersteund"
  | "identiteit_ontbreekt"
  | "buiten_server_scope"
  | "geen_bewijs"
  | "bewijs_niet_beloofd"
  | "versiebewijs_ontbreekt"
  | "versiebeleid_ontbreekt"
  | "versiesoort_niet_toegestaan"
  | "versie_hook_ontbreekt"
  | "versie_hook_fout"
  | "versiestand_ontbreekt"
  | "versie_gewijzigd"
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
 * De genormaliseerde foutcategorie (§4.4). Drie soorten falen die in het
 * auditspoor NIET op elkaar mogen lijken:
 *   • `toestemming_geweigerd` — de gebruiker mocht dit niet zien, of het was
 *     niet aan te tonen dat hij het mocht;
 *   • `configuratiefout` — de ADAPTER hield zich niet aan zijn eigen contract;
 *   • `providerfout` — de PROVIDER faalde (een Graph-503). Dat zegt niets over
 *     de rechten van de gebruiker.
 * Alle drie weigeren gesloten. Maar een storing bij Microsoft rapporteren als
 * een gewone autorisatieweigering zou het incident onzichtbaar maken én de
 * gebruiker ten onrechte als "niet bevoegd" boeken.
 */
export type Weigercategorie =
  | "buiten_scope"
  | "toestemming_geweigerd"
  | "configuratiefout"
  | "providerfout";

const CATEGORIE: Record<Weigergrond, Weigercategorie> = {
  identiteit_ontbreekt: "configuratiefout",
  buiten_server_scope: "buiten_scope",
  geen_bewijs: "toestemming_geweigerd",
  binding_ander_resultaat: "toestemming_geweigerd",
  binding_andere_bron: "toestemming_geweigerd",
  v1_niet_toegestaan: "toestemming_geweigerd",
  v2_andere_gebruiker: "toestemming_geweigerd",
  v3_ander_verzoek: "toestemming_geweigerd",
  v4_venster: "toestemming_geweigerd",
  v5_bron_gewijzigd: "toestemming_geweigerd",
  v5_geen_stand: "toestemming_geweigerd",
  // Een hook die GOOIT: de provider faalde. Fail-closed blijft staan, maar het
  // is een storing — geen uitspraak over wat deze gebruiker mag.
  v5_hook_fout: "providerfout",
  versie_hook_fout: "providerfout",
  // De adapter belooft iets wat hij niet waarmaakt.
  filter_niet_ondersteund: "configuratiefout",
  bewijs_niet_beloofd: "configuratiefout",
  versiebewijs_ontbreekt: "configuratiefout",
  versiebeleid_ontbreekt: "configuratiefout",
  versiesoort_niet_toegestaan: "configuratiefout",
  versie_hook_ontbreekt: "configuratiefout",
  versiestand_ontbreekt: "toestemming_geweigerd",
  versie_gewijzigd: "toestemming_geweigerd",
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

function geldigeKalenderdatum(waarde: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(waarde)) return false;
  const datum = new Date(`${waarde}T00:00:00.000Z`);
  return Number.isFinite(datum.getTime()) && datum.toISOString().slice(0, 10) === waarde;
}

interface Oordeelcontext {
  ctx: RetrievalContext;
  caps: AdapterCapabilities;
  poortNu: number;
  verzoekStart: number | null;
  standen: Map<string, Bronregistratiestand> | null;
  hookFout: boolean;
  versiestanden: Map<string, ActueleVersiestand> | null;
  versieHookFout: boolean;
}

function beoordeel(bron: Bronresultaat, o: Oordeelcontext): Weigergrond | null {
  // IDENTITEIT — controleer ook runtime-invoer. Een adapter kan uit JavaScript,
  // een fixture of een externe provider komen en het TypeScriptcontract dus
  // omzeilen. Alleen onze versiegebonden opaque sleutels mogen ranking bereiken.
  if (
    typeof bron.ref !== "string" ||
    !/^passage_v1_[a-f0-9]{64}$/.test(bron.ref) ||
    typeof bron.documentIdentiteit?.id !== "string" ||
    !/^doc_v1_[a-f0-9]{64}$/.test(bron.documentIdentiteit.id) ||
    typeof bron.passageIdentiteit?.id !== "string" ||
    !/^passage_v1_[a-f0-9]{64}$/.test(bron.passageIdentiteit.id) ||
    bron.ref !== bron.passageIdentiteit.id
  ) {
    return "identiteit_ontbreekt";
  }

  // VERSIEBEWIJS — los van rechten. Een adapter die versiebewijs belooft maar
  // het niet levert, laat een resultaat door dat later niet meer is terug te
  // voeren op de versie die het model zag.
  const w = bron.versie?.waarde;
  if (typeof w !== "string" || w.length === 0 || bron.versie.soort === "onbekend") {
    return "versiebewijs_ontbreekt";
  }
  const beleid = o.caps.versiebeleid;
  if (!beleid) return "versiebeleid_ontbreekt";
  // De twee beleidslijsten zijn geen vrije labels. Een adapter mag een zwakke
  // status-datum niet onder `sterk` schuiven (of een sterke hash als
  // `gedegradeerd` declareren) om de bedoelde semantiek te omzeilen.
  const sterkeSoort = /^(etag|ctag|hash)$/.test(bron.versie.soort);
  const gedegradeerdeSoort = bron.versie.soort === "status-datum";
  const semantischToegestaan =
    (sterkeSoort && beleid.sterk.includes(bron.versie.soort)) ||
    (gedegradeerdeSoort && beleid.gedegradeerd.includes(bron.versie.soort));
  if (!semantischToegestaan) {
    return "versiesoort_niet_toegestaan";
  }
  const sterkeVorm = sterkeSoort
    && /^version_v1_[a-f0-9]{64}$/.test(w);
  const gedegradeerdeVorm = gedegradeerdeSoort
    && geldigeKalenderdatum(w);
  if (!sterkeVorm && !gedegradeerdeVorm) return "versiebewijs_ontbreekt";
  if (o.versieHookFout) return "versie_hook_fout";
  if (o.versiestanden === null) return "versie_hook_ontbreekt";
  const actuele = o.versiestanden.get(bron.ref);
  if (!actuele?.beschikbaar) return "versiestand_ontbreekt";
  if (
    actuele.documentIdentiteit !== bron.documentIdentiteit.id ||
    actuele.passageIdentiteit !== bron.passageIdentiteit.id ||
    actuele.versie.soort !== bron.versie.soort ||
    actuele.versie.waarde !== w
  ) {
    return "versie_gewijzigd";
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
  let versiestanden: Map<string, ActueleVersiestand> | null = null;
  let versieHookFout = false;

  {
    const refs = [
      ...new Set(
        kandidatenPerSpoor
          .flat()
          .map((k) => k.ref)
          .filter((r): r is string => typeof r === "string" && r.length > 0)
      ),
    ];
    if (!adapter.verifieerVersies) {
      versiestanden = null;
    } else if (refs.length === 0) {
      versiestanden = new Map();
    } else {
      try {
        versiestanden = await adapter.verifieerVersies(ctx, refs);
      } catch (e) {
        // Cancellation/deadline is geen providerfout die de poort tot een
        // weigering mag reduceren: de hele beurt is beëindigd. Doorgooien
        // voorkomt dat de rechtenherlezing en verdere retrieval-I/O nog start.
        if (isAfbreking(e)) throw e;
        versiestanden = null;
        versieHookFout = true;
      }
    }
  }

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
      } catch (e) {
        // Zelfde ketenregel als bij versieherlezing: alleen echte provider-
        // fouten worden genormaliseerd; een afbreking stopt onmiddellijk.
        if (isAfbreking(e)) throw e;
        standen = null;
        hookFout = true;
      }
    }
  }

  const o: Oordeelcontext = {
    ctx, caps, poortNu, verzoekStart, standen, hookFout, versiestanden, versieHookFout,
  };
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
    // Ook per GROND geteld: anders klopt de claim "per categorie én per grond"
    // niet, en tellen de gronden niet op tot het totaal.
    gronden.filter_niet_ondersteund = (gronden.filter_niet_ondersteund ?? 0) + filterweigeringen;
    categorieen.configuratiefout = (categorieen.configuratiefout ?? 0) + filterweigeringen;
  }
  return { geweigerd: totaal, categorieen, gronden };
}
