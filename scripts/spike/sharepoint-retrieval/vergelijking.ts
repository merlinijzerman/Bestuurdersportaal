// ============================================================================
//  #407 T2 — vaste kwaliteitsvergelijking over vier meetarmen.
// ----------------------------------------------------------------------------
//  Deze laag voegt geen productiepad toe. Zij draait dezelfde vaste scenario's
//  langs dezelfde acceptatieset en levert uitsluitend inhoudsvrije meetrijen op:
//  fixturecodes, verhoudingen, tellingen, timing en korte versievingerafdrukken.
//  Geen vraagtekst, passage, extract, token of private Graph-identifier.
// ============================================================================
import {
  maakVeiligeMeetrij,
  voerSharePointRetrievalSpikeUit,
  type SpikeDependencies,
} from "./prototype";
import { voerCopilotRetrievalSpikeUit } from "./copilot-retrieval";
import type {
  SpikeBronresultaat,
  SpikeCopilotUitkomst,
  SpikeVergelijkRoute,
  SpikeVraag,
  VeiligeVergelijkrij,
} from "./types";

/**
 * De vier armen uit #407. De eerste drie doen echte retrieval; `candidate_union`
 * is uitdrukkelijk GEEN vierde strategie maar een MEETARM: zij verenigt centraal
 * de kandidaatsets die de andere drie armen al volledig fail-closed hebben
 * geverifieerd. Daardoor kost de unie geen extra Graph-call, geen extra download
 * en geen tweede verificatieketen, en kan er per definitie niets in de unie
 * belanden dat niet zelfstandig is bewezen.
 */
export const VERGELIJK_ARMEN = [
  "drive_search_extract",
  "microsoft_search",
  "copilot_retrieval",
  "candidate_union",
] as const satisfies readonly SpikeVergelijkRoute[];
export type VergelijkArm = typeof VERGELIJK_ARMEN[number];

/** De drie armen die daadwerkelijk bij Microsoft ophalen. */
export const PRIMAIRE_ARMEN = ["drive_search_extract", "microsoft_search", "copilot_retrieval"] as const;

export interface VergelijkOpdracht {
  ronde: number;
  vraag: SpikeVraag;
  armen?: readonly VergelijkArm[];
  correlationId: () => string;
  signal?: AbortSignal;
  timeoutMs?: number;
  concurrency?: number;
  /** Feitelijke Copilot-POST-pogingen voor deze meting; standaard en minimum 1. */
  copilotRequestBudget?: number;
}

function leeg(): number {
  return 0;
}

function verrijk(
  rij: ReturnType<typeof maakVeiligeMeetrij>,
  vraag: SpikeVraag,
  extra: { afwijzingLokalisatie: number; extractLokalisatieDekking: number },
): VeiligeVergelijkrij {
  return {
    ...rij,
    afwijzingLokalisatie: extra.afwijzingLokalisatie,
    extractLokalisatieDekking: extra.extractLokalisatieDekking,
    semantisch: vraag.semantisch === true,
  };
}

function verhouding(teller: number, noemer: number): number {
  return noemer === 0 ? 0 : Number(Math.min(1, teller / noemer).toFixed(3));
}

/** Eén live arm, met dezelfde meetprojectie als #353. */
export async function voerArmUit(
  deps: SpikeDependencies,
  arm: typeof PRIMAIRE_ARMEN[number],
  opdracht: VergelijkOpdracht,
): Promise<{ rij: VeiligeVergelijkrij; kandidaten: SpikeBronresultaat[] }> {
  if (arm === "copilot_retrieval") {
    const uitkomst: SpikeCopilotUitkomst = await voerCopilotRetrievalSpikeUit(deps, {
      correlationId: opdracht.correlationId(),
      vraag: opdracht.vraag,
      signal: opdracht.signal,
      timeoutMs: opdracht.timeoutMs,
      concurrency: opdracht.concurrency,
      requestBudget: opdracht.copilotRequestBudget,
    });
    const rij = verrijk(maakVeiligeMeetrij(opdracht.ronde, opdracht.vraag, uitkomst), opdracht.vraag, {
      afwijzingLokalisatie: uitkomst.afwijzingen.lokalisatie,
      // Elke toegelaten passage van deze arm is per definitie uit een
      // gelokaliseerd Microsoft-extract opgebouwd.
      extractLokalisatieDekking: verhouding(uitkomst.gelokaliseerdeExtracts, uitkomst.kandidaten.length),
    });
    return { rij, kandidaten: uitkomst.kandidaten };
  }

  const uitkomst = await voerSharePointRetrievalSpikeUit(deps, {
    route: arm,
    correlationId: opdracht.correlationId(),
    vraag: opdracht.vraag,
    signal: opdracht.signal,
    timeoutMs: opdracht.timeoutMs,
    concurrency: opdracht.concurrency,
  });
  const rij = verrijk(maakVeiligeMeetrij(opdracht.ronde, opdracht.vraag, uitkomst), opdracht.vraag, {
    // De lexicale armen bieden geen extract aan; deze tellers blijven 0.
    afwijzingLokalisatie: leeg(),
    extractLokalisatieDekking: leeg(),
  });
  return { rij, kandidaten: uitkomst.kandidaten };
}

/**
 * Centrale meetunie over de al geverifieerde kandidaatsets. Ontdubbelt op
 * fixturecode en rangschikt deterministisch met reciprocal-rank fusion over de
 * posities die elke arm zelf toekende. Latency, calls, downloads en bytes zijn
 * de som van de bijdragende armen: de unie doet zelf geen enkele call.
 */
export function verenigArmen(
  ronde: number,
  vraag: SpikeVraag,
  bijdragen: ReadonlyArray<{ rij: VeiligeVergelijkrij; kandidaten: SpikeBronresultaat[] }>,
): VeiligeVergelijkrij {
  const RRF_K = 60;
  const scores = new Map<string, number>();
  const besteKandidaat = new Map<string, SpikeBronresultaat>();
  for (const bijdrage of bijdragen) {
    for (const kandidaat of bijdrage.kandidaten) {
      scores.set(kandidaat.fixtureCode, (scores.get(kandidaat.fixtureCode) ?? 0) + 1 / (RRF_K + kandidaat.rang.positie));
      const huidig = besteKandidaat.get(kandidaat.fixtureCode);
      if (!huidig || kandidaat.rang.positie < huidig.rang.positie) besteKandidaat.set(kandidaat.fixtureCode, kandidaat);
    }
  }
  const geordend = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([fixtureCode], index) => {
      const kandidaat = besteKandidaat.get(fixtureCode)!;
      return { ...kandidaat, rang: { positie: index + 1, score: scores.get(fixtureCode) ?? null } };
    });

  const som = (kies: (rij: VeiligeVergelijkrij) => number) => bijdragen.reduce((totaal, bijdrage) => totaal + kies(bijdrage.rij), 0);
  const rij = maakVeiligeMeetrij<"candidate_union">(ronde, vraag, {
    route: "candidate_union",
    searchScope: null,
    provider: "microsoft",
    methode: "sharepoint_live",
    kandidaten: geordend,
    // De noemer voor kandidaatprecision is de som van wat de armen aan hun
    // verificatieketen hebben aangeboden; ontdubbelen zou de unie gratis laten
    // scoren op werk dat wél is gedaan.
    kandidatenVoorVerificatie: som((r) => r.kandidatenVoorVerificatie),
    latencyMs: som((r) => r.latencyMs),
    ...(geordend.length === 0 ? { fout: "geen_resultaten" as const } : {}),
    afwijzingen: {
      mapping: som((r) => r.afwijzingMapping),
      binding: som((r) => r.afwijzingBinding),
      root: som((r) => r.afwijzingRoot),
      rechten_configuratie: som((r) => r.afwijzingRechtenConfiguratie),
      versie: som((r) => r.afwijzingVersie),
      extractie: som((r) => r.afwijzingExtractie),
      preview: som((r) => r.afwijzingPreview),
      actualiteit: som((r) => r.afwijzingActualiteit),
      lokalisatie: som((r) => r.afwijzingLokalisatie),
    },
    meting: {
      calls: som((r) => r.microsoftCalls),
      downloads: som((r) => r.downloads),
      responseBytes: som((r) => r.responseBytes),
      contentBytes: som((r) => r.contentBytes),
      throttles: som((r) => r.throttles),
      retries: som((r) => r.retries),
    },
  });
  return verrijk(rij, vraag, {
    afwijzingLokalisatie: som((r) => r.afwijzingLokalisatie),
    extractLokalisatieDekking: verhouding(
      bijdragen
        .filter((bijdrage) => bijdrage.rij.route === "copilot_retrieval")
        .reduce((totaal, bijdrage) => totaal + bijdrage.kandidaten.length, 0),
      geordend.length,
    ),
  });
}

/** Voert één scenario over alle gevraagde armen uit, in vaste volgorde. */
export async function voerVergelijkingUit(
  deps: SpikeDependencies,
  opdracht: VergelijkOpdracht,
): Promise<VeiligeVergelijkrij[]> {
  const gevraagd = opdracht.armen ?? VERGELIJK_ARMEN;
  const bijdragen: Array<{ rij: VeiligeVergelijkrij; kandidaten: SpikeBronresultaat[] }> = [];
  for (const arm of PRIMAIRE_ARMEN) {
    if (!gevraagd.includes(arm)) continue;
    bijdragen.push(await voerArmUit(deps, arm, opdracht));
  }
  const rijen = bijdragen.map((bijdrage) => bijdrage.rij);
  if (gevraagd.includes("candidate_union")) {
    rijen.push(verenigArmen(opdracht.ronde, opdracht.vraag, bijdragen));
  }
  return rijen;
}

// ---------------------------------------------------------------------------
//  Rapportage
// ---------------------------------------------------------------------------

export interface ArmSamenvatting {
  arm: SpikeVergelijkRoute;
  runs: number;
  geslaagd: number;
  exacteBronsets: number;
  recall: number;
  precision: number;
  mrr: number;
  ndcg: number;
  locatorDekking: number;
  passageDekking: number;
  versieDekking: number;
  previewDekking: number;
  extractLokalisatieDekking: number;
  /** Aandeel runs met actualiteitsbeleid dat exact de juiste versie toeliet. */
  actualiteitscorrectheid: number;
  mediaanLatencyMs: number;
  p95LatencyMs: number;
  microsoftCalls: number;
  downloads: number;
  responseBytes: number;
  contentBytes: number;
  throttles: number;
  retries: number;
  afvalPerControle: Record<string, number>;
  foutcategorieen: Record<string, number>;
}

function gemiddelde(waarden: readonly number[]): number {
  return waarden.length === 0 ? 0 : Number((waarden.reduce((som, waarde) => som + waarde, 0) / waarden.length).toFixed(3));
}

function percentiel(waarden: readonly number[], p: number): number {
  if (waarden.length === 0) return 0;
  const gesorteerd = [...waarden].sort((a, b) => a - b);
  return gesorteerd[Math.min(gesorteerd.length - 1, Math.max(0, Math.ceil(gesorteerd.length * p) - 1))];
}

export function vatVergelijkingSamen(rijen: readonly VeiligeVergelijkrij[]): ArmSamenvatting[] {
  const groepen = new Map<SpikeVergelijkRoute, VeiligeVergelijkrij[]>();
  for (const rij of rijen) groepen.set(rij.route, [...(groepen.get(rij.route) ?? []), rij]);
  const volgorde = VERGELIJK_ARMEN.filter((arm) => groepen.has(arm));
  return volgorde.map((arm) => {
    const waarden = groepen.get(arm)!;
    const som = (kies: (rij: VeiligeVergelijkrij) => number) => waarden.reduce((totaal, rij) => totaal + kies(rij), 0);
    return {
      arm,
      runs: waarden.length,
      geslaagd: waarden.filter((rij) => rij.resultaat === "geslaagd").length,
      exacteBronsets: waarden.filter((rij) => rij.exacteBronset).length,
      recall: gemiddelde(waarden.map((rij) => rij.recall)),
      precision: gemiddelde(waarden.map((rij) => rij.precision)),
      mrr: gemiddelde(waarden.map((rij) => rij.mrr)),
      ndcg: gemiddelde(waarden.map((rij) => rij.ndcg)),
      locatorDekking: gemiddelde(waarden.map((rij) => rij.locatorDekking)),
      // Passagedekking is per meting gelijk aan de locatordekking van toegelaten
      // bronnen: elke toegelaten bron draagt precies één gelokaliseerde passage.
      passageDekking: gemiddelde(waarden.map((rij) => (rij.gevondenFixtures.length === 0 ? 0 : rij.locatorDekking))),
      versieDekking: gemiddelde(waarden.map((rij) => rij.versieDekking)),
      previewDekking: gemiddelde(waarden.map((rij) => rij.previewDekking)),
      extractLokalisatieDekking: gemiddelde(waarden.map((rij) => rij.extractLokalisatieDekking)),
      // Correct is: exact de vooraf vastgelegde bronset, dus geen historische
      // bron bij een actuele vraag en omgekeerd.
      actualiteitscorrectheid: verhouding(waarden.filter((rij) => rij.exacteBronset).length, waarden.length),
      mediaanLatencyMs: percentiel(waarden.map((rij) => rij.latencyMs), 0.5),
      p95LatencyMs: percentiel(waarden.map((rij) => rij.latencyMs), 0.95),
      microsoftCalls: som((rij) => rij.microsoftCalls),
      downloads: som((rij) => rij.downloads),
      responseBytes: som((rij) => rij.responseBytes),
      contentBytes: som((rij) => rij.contentBytes),
      throttles: som((rij) => rij.throttles),
      retries: som((rij) => rij.retries),
      afvalPerControle: {
        mapping: som((rij) => rij.afwijzingMapping),
        binding: som((rij) => rij.afwijzingBinding),
        root: som((rij) => rij.afwijzingRoot),
        rechten_configuratie: som((rij) => rij.afwijzingRechtenConfiguratie),
        versie: som((rij) => rij.afwijzingVersie),
        extractie: som((rij) => rij.afwijzingExtractie),
        preview: som((rij) => rij.afwijzingPreview),
        actualiteit: som((rij) => rij.afwijzingActualiteit),
        lokalisatie: som((rij) => rij.afwijzingLokalisatie),
      },
      foutcategorieen: Object.fromEntries(
        [...new Set(waarden.map((rij) => rij.foutcategorie))]
          .filter((categorie): categorie is NonNullable<typeof categorie> => categorie !== null)
          .map((categorie) => [categorie, waarden.filter((rij) => rij.foutcategorie === categorie).length]),
      ),
    };
  });
}

export interface SemantischeWinst {
  arm: SpikeVergelijkRoute;
  semantischeRuns: number;
  /** Recall op uitsluitend de semantische scenario's. */
  semantischeRecall: number;
  /** Beste semantische recall van de lexicale armen op dezelfde scenario's. */
  lexicaleReferentie: number;
  /** Verschil; positief betekent aantoonbare semantische winst. */
  winst: number;
  /** Harde grens: winst telt alleen mee zonder bronsetvervuiling. */
  bronsetvervuiling: number;
}

const LEXICALE_ARMEN: readonly SpikeVergelijkRoute[] = ["drive_search_extract", "microsoft_search"];

/**
 * Semantische winst is pas winst wanneer zij niet met bronsetvervuiling wordt
 * gekocht. `bronsetvervuiling` telt de semantische runs waarin de arm iets
 * toeliet dat niet exact de vooraf vastgelegde bronset was; staat die teller
 * niet op 0, dan is de winst voor het besluit waardeloos.
 */
export function bepaalSemantischeWinst(rijen: readonly VeiligeVergelijkrij[]): SemantischeWinst[] {
  const semantisch = rijen.filter((rij) => rij.semantisch);
  if (semantisch.length === 0) return [];
  const recallPerArm = (arm: SpikeVergelijkRoute) => {
    const waarden = semantisch.filter((rij) => rij.route === arm);
    return { waarden, recall: gemiddelde(waarden.map((rij) => rij.recall)) };
  };
  const lexicaleReferentie = Math.max(0, ...LEXICALE_ARMEN.map((arm) => recallPerArm(arm).recall));
  const aanwezig = VERGELIJK_ARMEN.filter((arm) => semantisch.some((rij) => rij.route === arm));
  return aanwezig.map((arm) => {
    const { waarden, recall } = recallPerArm(arm);
    return {
      arm,
      semantischeRuns: waarden.length,
      semantischeRecall: recall,
      lexicaleReferentie,
      winst: Number((recall - lexicaleReferentie).toFixed(3)),
      bronsetvervuiling: waarden.filter((rij) => !rij.exacteBronset).length,
    };
  });
}

export interface Kwaliteitsrapport {
  schemaVersie: 2;
  doel: string;
  gemetenOp: string;
  inhoudPersistentOpgeslagen: false;
  armen: readonly SpikeVergelijkRoute[];
  rondes: number;
  scenarios: string[];
  samenvatting: ArmSamenvatting[];
  semantischeWinst: SemantischeWinst[];
  metingen: VeiligeVergelijkrij[];
}

export function maakKwaliteitsrapport(args: {
  doel: string;
  gemetenOp: string;
  rondes: number;
  armen: readonly SpikeVergelijkRoute[];
  rijen: VeiligeVergelijkrij[];
}): Kwaliteitsrapport {
  return {
    schemaVersie: 2,
    doel: args.doel,
    gemetenOp: args.gemetenOp,
    inhoudPersistentOpgeslagen: false,
    armen: args.armen,
    rondes: args.rondes,
    scenarios: [...new Set(args.rijen.map((rij) => rij.vraagcode))].sort(),
    samenvatting: vatVergelijkingSamen(args.rijen),
    semantischeWinst: bepaalSemantischeWinst(args.rijen),
    metingen: args.rijen,
  };
}
