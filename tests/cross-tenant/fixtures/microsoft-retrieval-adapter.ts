// ============================================================================
//  #370 — Hermetische Microsoft-retrievalfixture.
// ----------------------------------------------------------------------------
//  Dit is nadrukkelijk GEEN productadapter. De fixture staat onder tests, doet
//  geen netwerk- of schijf-I/O en wordt nergens vanuit de applicatie bedraad.
//  Zij oefent uitsluitend het providerneutrale RetrievalAdapter-contract met
//  synthetische, fondsgebonden en niet-herleidbare lokale referenties.
// ============================================================================
import { isAfbreking, slaapMetSignaal } from "../../../core/lib/retrieval/afbreken";
import {
  maakDocumentIdentiteit,
  maakPassageIdentiteit,
  maakVolledigeVersieHash,
} from "../../../core/lib/retrieval/identiteit";
import type {
  ActueleVersiestand,
  AdapterCapabilities,
  AdapterUitkomst,
  Bronregistratiestand,
  Bronresultaat,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalFoutcategorie,
  RetrievalQuery,
  Toegangsbewijs,
} from "../../../core/lib/retrieval/contract";

export type MicrosoftFixtureScenario =
  | "algemeen"
  | "beperkt"
  | "historisch"
  | "gewijzigd"
  | "verplaatst"
  | "ingetrokken";

export type MicrosoftFixtureBewijsvariant =
  | "volledig"
  | "ontbreekt"
  | "voor_verzoek"
  | "verlopen"
  | "andere_actor"
  | "ander_verzoek"
  | "andere_resultaatref"
  | "andere_bronref";

export interface MicrosoftFixtureOpties {
  scenario?: MicrosoftFixtureScenario;
  bewijs?: MicrosoftFixtureBewijsvariant;
  versieOntbreekt?: boolean;
  /** Onbetrouwbare providerprojectie; wordt bij runtime fail-closed gevalideerd. */
  bronInvoer?: readonly unknown[];
  vertragingMs?: number;
  versieVertragingMs?: number;
  v5VertragingMs?: number;
  /** Laat de interne providernaad gooien; de adapter normaliseert de fout. */
  providerFout?: MicrosoftFixtureProviderfoutcode;
  /** Simuleert een adaptergrens vóór de centrale kandidatenbegrenzing. */
  maxKandidatenTerug?: number;
}

export interface MicrosoftFixtureWaarneming {
  zoekAanroepen: number;
  versieAanroepen: number;
  v5Aanroepen: number;
  aangebodenKandidaten: number;
  versieReferenties: number;
  v5Referenties: number;
}

export interface MicrosoftRetrievalFixture {
  adapter: RetrievalAdapter;
  waarneming(): Readonly<MicrosoftFixtureWaarneming>;
  wachtTotVersieStart(): Promise<void>;
  /** Deterministische synchronisatie voor cancellationtests in de V5-herlezing. */
  wachtTotV5Start(): Promise<void>;
  /** Testnaad voor een intrekking ná zoek() en vóór de V5-herlezing. */
  trekAlleBronnenIn(): void;
}

export type MicrosoftFixtureProviderfoutcode =
  | "niet_gevonden"
  | "buiten_scope"
  | "toegang"
  | "configuratie"
  | "provider_timeout"
  | "limiet"
  | "onverwacht";

interface SynthetischeBron {
  resultaatRef: string;
  documentRef: string;
  registratieRef: string;
  versieWaarde: string;
  bestandHash: string;
  configuratieVersie: number;
  titel: string;
  passageNr: number;
  mappad: string;
  documentstatus: string;
  actueel: boolean;
  geldigTot?: string;
  toegestaan: boolean;
}

const CAPABILITIES: Readonly<AdapterCapabilities> = {
  bronsoorten: ["sharepoint"],
  strategieen: ["gericht", "volledig", "vergelijk"],
  // De fixture past alleen `modus` werkelijk toe. Elke andere filterclaim zou
  // een ongefilterde, bredere kandidatenset doorlaten.
  ondersteundeFilters: ["modus"],
  versiebewijs: true,
  versiebeleid: { sterk: ["hash"], gedegradeerd: [] },
  permissionProof: true,
  preview: true,
  cancellation: true,
  timeout: true,
};

/**
 * Een synthetische ruwe providerprojectie voor runtimevalidatietests. Het
 * retourtype is bewust `unknown`: pas de adaptergrens mag deze vorm vertrouwen.
 */
export function maakSynthetischeMicrosoftFixtureBron(): unknown {
  return {
    resultaatRef: "loc-r-7f12",
    documentRef: "loc-d-19c4",
    registratieRef: "loc-b-3a81",
    versieWaarde: "loc-v-0042",
    bestandHash: "a".repeat(64),
    configuratieVersie: 7,
    titel: "Synthetisch bestuursstuk A",
    passageNr: 1,
    mappad: "/Bestuur/Beleid",
    documentstatus: "van_kracht",
    actueel: true,
    toegestaan: true,
  };
}

const BASIS: readonly SynthetischeBron[] = Object.freeze([
  {
    resultaatRef: "loc-r-7f12",
    documentRef: "loc-d-19c4",
    registratieRef: "loc-b-3a81",
    versieWaarde: "loc-v-0042",
    bestandHash: "a".repeat(64),
    configuratieVersie: 7,
    titel: "Synthetisch bestuursstuk A",
    passageNr: 1,
    mappad: "/Bestuur/Beleid",
    documentstatus: "van_kracht",
    actueel: true,
    toegestaan: true,
  },
  {
    resultaatRef: "loc-r-8b37",
    documentRef: "loc-d-20d5",
    registratieRef: "loc-b-4c92",
    versieWaarde: "loc-v-0043",
    bestandHash: "b".repeat(64),
    configuratieVersie: 7,
    titel: "Synthetisch bestuursstuk B",
    passageNr: 2,
    mappad: "/Bestuur/Reglementen",
    documentstatus: "van_kracht",
    actueel: true,
    toegestaan: true,
  },
]);

function isRecord(waarde: unknown): waarde is Record<string, unknown> {
  return typeof waarde === "object" && waarde !== null && !Array.isArray(waarde);
}

function lokaleRef(waarde: unknown, soort: "r" | "d" | "b" | "v"): waarde is string {
  return typeof waarde === "string" && new RegExp(`^loc-${soort}-[a-z0-9]+$`).test(waarde);
}

/** De runtimegrens tussen een onbekende providerprojectie en Bronresultaat. */
function valideerBronInvoer(waarde: unknown): SynthetischeBron | null {
  if (!isRecord(waarde)) return null;
  if (!lokaleRef(waarde.resultaatRef, "r")) return null;
  if (!lokaleRef(waarde.documentRef, "d")) return null;
  if (!lokaleRef(waarde.registratieRef, "b")) return null;
  if (!lokaleRef(waarde.versieWaarde, "v")) return null;
  if (typeof waarde.bestandHash !== "string" || !/^[a-f0-9]{64}$/.test(waarde.bestandHash)) return null;
  if (!Number.isInteger(waarde.configuratieVersie) || Number(waarde.configuratieVersie) < 1) return null;
  if (typeof waarde.titel !== "string" || waarde.titel.length === 0) return null;
  if (!Number.isInteger(waarde.passageNr) || Number(waarde.passageNr) < 1) return null;
  // Locator is verplicht en lokaal: geen URL en geen externe itemidentiteit.
  if (typeof waarde.mappad !== "string" || !waarde.mappad.startsWith("/") || waarde.mappad.includes("://")) return null;
  if (typeof waarde.documentstatus !== "string" || waarde.documentstatus.length === 0) return null;
  if (typeof waarde.actueel !== "boolean" || typeof waarde.toegestaan !== "boolean") return null;
  if (waarde.geldigTot !== undefined && typeof waarde.geldigTot !== "string") return null;
  return waarde as unknown as SynthetischeBron;
}

class MicrosoftFixtureProviderfout extends Error {
  constructor(readonly code: MicrosoftFixtureProviderfoutcode) {
    super("synthetische providerfout");
    this.name = "MicrosoftFixtureProviderfout";
  }
}

/** Providerprivate fout → uitsluitend een genormaliseerde contractcategorie. */
function normaliseerProviderfout(fout: unknown): RetrievalFoutcategorie {
  if (!(fout instanceof MicrosoftFixtureProviderfout)) return "providerfout";
  switch (fout.code) {
    case "niet_gevonden":
      return "geen_resultaten";
    case "buiten_scope":
      return "buiten_scope";
    case "toegang":
      return "toestemming_geweigerd";
    case "configuratie":
      return "configuratiefout";
    case "provider_timeout":
      return "timeout";
    case "limiet":
      return "rate_limit";
    case "onverwacht":
      return "providerfout";
  }
}

function pasModusToe(bronnen: SynthetischeBron[], query: RetrievalQuery): SynthetischeBron[] {
  switch (query.filters?.modus) {
    case "actueel":
    case "besluitvorming":
      return bronnen.filter((bron) => bron.actueel);
    case "historisch":
      return bronnen.filter((bron) => !bron.actueel);
    case "alles":
    case undefined:
      return bronnen;
  }
}

function bronnenVoor(scenario: MicrosoftFixtureScenario): SynthetischeBron[] {
  const bronnen = BASIS.map((bron) => ({ ...bron }));
  switch (scenario) {
    case "beperkt":
      // Een verboden bron wordt door de adapter zelf niet aangeboden (V1).
      return [{ ...bronnen[0] }, { ...bronnen[1], toegestaan: false }];
    case "historisch":
      return [
        {
          ...bronnen[0],
          versieWaarde: "loc-v-0011",
          documentstatus: "vervangen",
          actueel: false,
          geldigTot: "2025-12-31",
        },
      ];
    case "gewijzigd":
      return [{ ...bronnen[0], versieWaarde: "loc-v-0044" }];
    case "verplaatst":
      return [{ ...bronnen[0], mappad: "/Bestuur/Archief/Herordend" }];
    case "ingetrokken":
      return [{ ...bronnen[0] }];
    case "algemeen":
      return bronnen;
  }
}

function maakBewijs(
  ctx: RetrievalContext,
  bron: SynthetischeBron,
  resultaatRef: string,
  variant: MicrosoftFixtureBewijsvariant
): Toegangsbewijs | undefined {
  if (variant === "ontbreekt") return undefined;

  const basis: Toegangsbewijs = {
    toegestaan: true,
    resultaatRef,
    bronregistratieRef: bron.registratieRef,
    gebruikerId: ctx.actor.soort === "gebruiker" ? ctx.actor.id : "",
    correlationId: ctx.correlationId,
    // Gelijk aan het server-side verzoekbegin: reproduceerbaar én binnen V4.
    gecontroleerdOp: ctx.verzoekStartOp,
    basis: "delegated_user",
    bronconfiguratieVersie: bron.configuratieVersie,
  };

  switch (variant) {
    case "voor_verzoek":
      return { ...basis, gecontroleerdOp: new Date(Date.parse(ctx.verzoekStartOp) - 1).toISOString() };
    case "verlopen":
      // Ná verzoekStartOp, maar bij een verzoek dat >60 s loopt toch te oud.
      return { ...basis, gecontroleerdOp: new Date(Date.parse(ctx.verzoekStartOp) + 1_000).toISOString() };
    case "andere_actor":
      return { ...basis, gebruikerId: "loc-actor-anders" };
    case "ander_verzoek":
      return { ...basis, correlationId: "loc-verzoek-anders" };
    case "andere_resultaatref":
      return { ...basis, resultaatRef: "loc-r-anders" };
    case "andere_bronref":
      return { ...basis, bronregistratieRef: "loc-b-anders" };
    case "volledig":
      return basis;
  }
}

function alsResultaat(
  ctx: RetrievalContext,
  bron: SynthetischeBron,
  positie: number,
  opties: MicrosoftFixtureOpties
): Bronresultaat {
  const documentIdentiteit = maakDocumentIdentiteit(`microsoft-fixture:${ctx.fondsId}`, bron.documentRef);
  const passageIdentiteit = maakPassageIdentiteit(documentIdentiteit, bron.resultaatRef);
  const toegangscontrole = maakBewijs(ctx, bron, passageIdentiteit, opties.bewijs ?? "volledig");
  return {
    ref: passageIdentiteit,
    bronsoort: "sharepoint",
    titel: bron.titel,
    documentIdentiteit: {
      id: documentIdentiteit,
      bibliotheek: "fonds",
      bron: "Microsoft 365",
      fondsId: ctx.fondsId,
    },
    passageIdentiteit: { id: passageIdentiteit },
    versie: {
      soort: "hash",
      waarde: opties.versieOntbreekt
        ? null
        : maakVolledigeVersieHash(bron.documentRef, bron.versieWaarde, bron.bestandHash),
      gecontroleerdOp: ctx.verzoekStartOp,
    },
    bronregistratieRef: bron.registratieRef,
    ...(toegangscontrole ? { toegangscontrole } : {}),
    locator: { mappad: bron.mappad, paragraaf: `fixture-${bron.passageNr}` },
    passage:
      bron.passageNr === 1
        ? "Synthetische regeling over bestuursbesluiten."
        : "Kunstmatige procedure voor financieel toezicht.",
    status: {
      documentstatus: bron.documentstatus,
      bronstatus: "verbonden",
      geldigTot: bron.geldigTot ?? null,
      actueel: bron.actueel,
    },
    rang: { positie, score: 1 - positie / 100 },
    previewMogelijk: true,
    curatie: { normgewicht: null, wettelijkRegime: null },
    weergave: { bronorganisatie: "Synthetische fondsbron", opslagPad: bron.mappad, bestandstype: "pdf" },
  };
}

/**
 * Bouwt een volledig in-memory RetrievalAdapter. Geen optie bevat een token,
 * endpoint of externe bronidentifier; de observatie bewaart alleen tellingen.
 */
export function maakMicrosoftRetrievalFixture(opties: MicrosoftFixtureOpties = {}): MicrosoftRetrievalFixture {
  const scenario = opties.scenario ?? "algemeen";
  const bronInvoer = opties.bronInvoer ?? bronnenVoor(scenario);
  const synthetischeBronnen = bronInvoer.map(valideerBronInvoer).filter((bron): bron is SynthetischeBron => bron !== null);
  const standen = new Map<string, Bronregistratiestand>(
    synthetischeBronnen.map((bron) => [
      bron.registratieRef,
      {
        verbonden: true,
        versie: bron.configuratieVersie,
      },
    ])
  );
  const meting: MicrosoftFixtureWaarneming = {
    zoekAanroepen: 0,
    versieAanroepen: 0,
    v5Aanroepen: 0,
    aangebodenKandidaten: 0,
    versieReferenties: 0,
    v5Referenties: 0,
  };
  const versiestanden = new Map<string, ActueleVersiestand>();
  let meldVersieStart!: () => void;
  const versieGestart = new Promise<void>((resolve) => {
    meldVersieStart = resolve;
  });
  let meldV5Start!: () => void;
  const v5Gestart = new Promise<void>((resolve) => {
    meldV5Start = resolve;
  });

  const trekAlleBronnenIn = () => {
    for (const [ref, stand] of standen) standen.set(ref, { ...stand, verbonden: false });
  };

  const adapter: RetrievalAdapter = {
    naam: "microsoft-sharepoint",
    capabilities(): AdapterCapabilities {
      // Elke aanroeper krijgt eigen arrays; de capabilities kunnen dus niet via
      // een test per ongeluk voor latere verzoeken worden gemuteerd.
      return {
        ...CAPABILITIES,
        bronsoorten: [...CAPABILITIES.bronsoorten],
        strategieen: [...CAPABILITIES.strategieen],
        ondersteundeFilters: [...CAPABILITIES.ondersteundeFilters],
        versiebeleid: {
          sterk: [...CAPABILITIES.versiebeleid.sterk],
          gedegradeerd: [...CAPABILITIES.versiebeleid.gedegradeerd],
        },
      };
    },
    async zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<AdapterUitkomst> {
      meting.zoekAanroepen++;
      try {
        if (opties.vertragingMs && opties.vertragingMs > 0) {
          await slaapMetSignaal(opties.vertragingMs, ctx.signal);
        }
        if (opties.providerFout) throw new MicrosoftFixtureProviderfout(opties.providerFout);

        // De volledige ruwe set wordt bij ELK verzoek gevalideerd. Eén kapotte
        // identiteit of locator maakt de vertaling onbetrouwbaar: alles dicht.
        const gevalideerd = bronInvoer.map(valideerBronInvoer);
        if (gevalideerd.some((bron) => bron === null)) {
          return {
            kandidaten: [],
            methode: "geen",
            provider: "microsoft",
            latencyMs: opties.vertragingMs ?? 0,
            opgehaald: 0,
            fout: "configuratiefout",
          };
        }

        const toegestaan = (gevalideerd as SynthetischeBron[]).filter((bron) => bron.toegestaan);
        const gefilterd = pasModusToe(toegestaan, query);
        const alleKandidaten = gefilterd.map((bron, index) => alsResultaat(ctx, bron, index + 1, opties));
        for (const [index, kandidaat] of alleKandidaten.entries()) {
          const bron = gefilterd[index];
          const actueleVersie = scenario === "gewijzigd"
            ? maakVolledigeVersieHash(bron.documentRef, `${bron.versieWaarde}-actueel`, bron.bestandHash)
            : kandidaat.versie.waarde;
          versiestanden.set(kandidaat.ref, {
            beschikbaar: true,
            documentIdentiteit: kandidaat.documentIdentiteit.id,
            passageIdentiteit: kandidaat.passageIdentiteit.id,
            versie: { soort: kandidaat.versie.soort, waarde: actueleVersie },
          });
        }
        const limiet = Math.max(0, opties.maxKandidatenTerug ?? alleKandidaten.length);
        const kandidaten = alleKandidaten.slice(0, limiet);
        const afgekapt = kandidaten.length < alleKandidaten.length;
        meting.aangebodenKandidaten += kandidaten.length;

        // Race-naad: de resultaten zijn al gemaakt; pas nu verandert de actuele
        // bronstand die de toelatingspoort via V5 request-lokaal herleest.
        if (scenario === "ingetrokken") trekAlleBronnenIn();

        return {
          kandidaten,
          methode: "sharepoint_live",
          provider: "microsoft",
          latencyMs: opties.vertragingMs ?? 0,
          opgehaald: alleKandidaten.length,
          ...(afgekapt ? { truncatie: { reden: "kandidaten" as const }, fout: "truncatie" as const } : {}),
        };
      } catch (fout) {
        // Een requestafbreking is nooit een providerfout en mag niet worden
        // opgegeten door normalisatie.
        if (isAfbreking(fout)) throw fout;
        return {
          kandidaten: [],
          methode: "geen",
          provider: "microsoft",
          latencyMs: opties.vertragingMs ?? 0,
          opgehaald: 0,
          fout: normaliseerProviderfout(fout),
        };
      }
    },
    async verifieerVersies(
      ctx: RetrievalContext,
      refs: readonly string[]
    ): Promise<Map<string, ActueleVersiestand>> {
      meting.versieAanroepen++;
      meting.versieReferenties += refs.length;
      meldVersieStart();
      if (opties.versieVertragingMs && opties.versieVertragingMs > 0) {
        await slaapMetSignaal(opties.versieVertragingMs, ctx.signal);
      }
      return new Map(
        refs.flatMap((ref) => {
          const stand = versiestanden.get(ref);
          return stand ? ([[ref, { ...stand, versie: { ...stand.versie } }]] as const) : [];
        })
      );
    },
    async verifieerBronregistratie(
      ctx: RetrievalContext,
      refs: readonly string[]
    ): Promise<Map<string, Bronregistratiestand>> {
      meting.v5Aanroepen++;
      meting.v5Referenties += refs.length;
      meldV5Start();
      if (opties.v5VertragingMs && opties.v5VertragingMs > 0) {
        await slaapMetSignaal(opties.v5VertragingMs, ctx.signal);
      }
      return new Map(
        refs.flatMap((ref) => {
          const stand = standen.get(ref);
          return stand ? ([[ref, { ...stand }]] as const) : [];
        })
      );
    },
  };

  return {
    adapter,
    waarneming: () => Object.freeze({ ...meting }),
    wachtTotVersieStart: () => versieGestart,
    wachtTotV5Start: () => v5Gestart,
    trekAlleBronnenIn,
  };
}
