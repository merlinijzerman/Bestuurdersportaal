// ============================================================================
//  #368 — Supabase-adapter voor niet-zoekende evidence en contentvrije preflight.
// ----------------------------------------------------------------------------
//  Alle database-identifiers blijven in deze server-only module. Uitgaand zijn
//  alleen opaque bron/passsage/citation-identiteiten en domeinwaarden. Queries
//  lopen met de aangeleverde sessieclient (RLS), serverfonds en requestsignal.
// ============================================================================
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bewaakNaIO, isAfbreking } from "./afbreken";
import type {
  EvidenceAudit,
  EvidenceItem,
  EvidenceOpdracht,
  EvidenceUitkomst,
  PresentieUitkomst,
} from "./evidence-contract";
import { maakCitationId, maakDocumentIdentiteit, maakPassageIdentiteit, maakVolledigeVersieHash } from "./identiteit";
import type { Versiebewijs } from "./contract";
import type { ActueleVersiestand, Bronresultaat, RetrievalAdapter, RetrievalContext } from "./contract";
import { verifieerToelating } from "./toelatingspoort";
import { binnenCentraleServergrens } from "./orkestratie";
import { neutraliseerBrontekst } from "../bron-afbakening";
import { neutraliseerModelcontextTekst } from "./modelcontext";
import { bevatPersoonsgegevens } from "../pii-gate";
import { generiekGeldigheidsstatus, isReviewVerlopen } from "../generiek-status";

const SHA256_HEX = /^[a-f0-9]{64}$/;
export const MAX_PRESENTIE_DOCUMENTEN = 2000;
export const MAX_PRESENTIE_RIJEN = 2000;
export const MAX_BESLUITEN = 12;
export const MAX_SEMANTISCHE_UNITS = 500;

function hash(waarde: unknown): string {
  return createHash("sha256").update(JSON.stringify(waarde)).digest("hex");
}

function peildatum(opdracht: EvidenceOpdracht): string {
  return opdracht.context.verzoekStartOp.slice(0, 10);
}

function isGeneriekDocument(document: Pick<DocumentVersieRij, "fonds_id" | "bibliotheek">): boolean {
  return document.fonds_id == null && document.bibliotheek === "generiek";
}

function documentIsActueel(
  document: DocumentVersieRij,
  opdracht: EvidenceOpdracht,
  opties: { explicieteDocumentScope?: boolean } = {}
): boolean {
  const peil = peildatum(opdracht);
  if (document.actief === false) return false;
  if (document.geldig_vanaf && document.geldig_vanaf > peil) return false;
  if (document.geldig_tot && document.geldig_tot < peil) return false;
  if (isGeneriekDocument(document)) {
    const status = generiekGeldigheidsstatus(document);
    const statusToegestaan = status === "published"
      || (opties.explicieteDocumentScope === true && status === "draft");
    return statusToegestaan && !isReviewVerlopen(document.volgende_review, peil);
  }
  const fondsStatusToegestaan = ["vastgesteld", "van_kracht"].includes(document.status ?? "")
    || (opties.explicieteDocumentScope === true
      && (document.status == null || document.status === "concept"));
  return document.fonds_id === opdracht.context.fondsId
    && fondsStatusToegestaan
    && (document.bronstatus ?? "actief") === "actief";
}

function piiAudit(teksten: readonly string[]): {
  pii_gedetecteerd: boolean;
  pii_soorten?: NonNullable<EvidenceAudit["pii_soorten"]>;
} {
  const soorten = [...new Set(teksten.flatMap((tekst) => bevatPersoonsgegevens(tekst).soorten))];
  return soorten.length > 0 ? { pii_gedetecteerd: true, pii_soorten: soorten } : { pii_gedetecteerd: false };
}

function geweigerd<T>(
  opdracht: EvidenceOpdracht,
  soort: "besluitregistratie" | "semantische_unit",
  gevraagd: number,
  fout: "buiten_scope" | "providerfout" | "onvolledig" | "afgekapt"
): EvidenceUitkomst<T> {
  return {
    status: "geweigerd",
    items: [],
    audit: {
      correlation_id: opdracht.context.correlationId,
      soort,
      gevraagd,
      toegelaten: 0,
      gerenderde_tekens: 0,
      limiet: opdracht.maxGerenderdeTekens,
      afgekapt: fout === "afgekapt",
      fout,
    },
  };
}

function versieVoor(
  privateDocumentRef: string,
  privateVersieRef: string | null,
  bestandHash: string | null,
  documentdatum: string | null,
  gecontroleerdOp: string
): Versiebewijs {
  if (privateVersieRef && bestandHash && SHA256_HEX.test(bestandHash)) {
    return {
      soort: "hash",
      waarde: maakVolledigeVersieHash(privateDocumentRef, privateVersieRef, bestandHash),
      gecontroleerdOp,
    };
  }
  if (documentdatum && /^\d{4}-\d{2}-\d{2}$/.test(documentdatum)) {
    return { soort: "status-datum", waarde: documentdatum, gecontroleerdOp };
  }
  return { soort: "onbekend", waarde: null, gecontroleerdOp };
}

async function toetsMetCentralePoort<T>(
  context: RetrievalContext,
  items: readonly EvidenceItem<T>[],
  actueleVersies: ReadonlyMap<string, ActueleVersiestand>,
  procesPerRef: ReadonlyMap<string, string | null> = new Map()
): Promise<boolean> {
  const bronnen: Bronresultaat[] = items.map((item) => ({
    ref: item.ref,
    bronsoort: item.bronsoort,
    titel: item.titel,
    documentIdentiteit: {
      id: item.documentIdentiteit,
      fondsId: item.bronsoort === "generiek" ? null : context.fondsId,
      bibliotheek: item.bronsoort === "generiek" ? "generiek" : "fonds",
      bron: item.soort === "besluitregistratie" ? "Decision Object" : "Semantische evidence",
      procesId: procesPerRef.get(item.ref) ?? null,
    },
    passageIdentiteit: { id: item.passageIdentiteit },
    versie: item.versie,
    locator: item.locator,
    passage: item.passage,
    status: item.status,
    rang: { positie: 0 },
  }));
  const adapter: RetrievalAdapter = {
    naam: "supabase-rag",
    capabilities: () => ({
      bronsoorten: ["fonds", "generiek"],
      strategieen: ["bevroren"],
      ondersteundeFilters: [],
      versiebewijs: true,
      versiebeleid: { sterk: ["hash"], gedegradeerd: ["status-datum"] },
      permissionProof: false,
      preview: false,
      cancellation: true,
      timeout: true,
    }),
    zoek: async () => ({ kandidaten: [], methode: "geen", provider: "supabase", latencyMs: 0, opgehaald: 0 }),
    verifieerVersies: async () => new Map(actueleVersies),
  };
  const capabilities = adapter.capabilities();
  if (bronnen.some((bron) => !binnenCentraleServergrens(context, capabilities, bron))) return false;
  const uitkomst = await verifieerToelating(context, adapter, [bronnen]);
  return uitkomst.geweigerd.length === 0 && uitkomst.toegelatenPerSpoor[0].length === bronnen.length;
}

/** Contentvrije presentiecheck. Bij cap/fout komt nooit een gedeeltelijke set vrij. */
export async function controleerChunkPresentie(
  supabase: SupabaseClient,
  opdracht: EvidenceOpdracht,
  privateDocumentRefs: readonly string[],
  opties: { explicieteDocumentScope?: boolean } = {}
): Promise<PresentieUitkomst> {
  const refs = [...new Set(privateDocumentRefs)];
  const basis = {
    correlation_id: opdracht.context.correlationId,
    soort: "chunk_presentie" as const,
    gevraagd: refs.length,
    toegelaten: 0,
    gerenderde_tekens: 0,
    limiet: 0,
    afgekapt: false,
  };
  if (refs.length === 0) return { status: "compleet", documentIdentiteiten: new Set(), audit: basis };
  if (refs.length > Math.min(opdracht.maxItems, MAX_PRESENTIE_DOCUMENTEN)) {
    return {
      status: "geweigerd",
      documentIdentiteiten: new Set(),
      audit: { ...basis, afgekapt: true, fout: "afgekapt" },
    };
  }
  try {
    let query = supabase
      .from("document_chunks")
      .select("document_id, documenten!inner(id, fonds_id, bibliotheek, status, bronstatus, actief, geldig_vanaf, geldig_tot, volgende_review)")
      .in("document_id", refs)
      .limit(MAX_PRESENTIE_RIJEN + 1);
    if (opdracht.context.signal) query = query.abortSignal(opdracht.context.signal);
    const { data, error } = await query;
    bewaakNaIO(opdracht.context.signal, error);
    if (error) {
      return { status: "geweigerd", documentIdentiteiten: new Set(), audit: { ...basis, fout: "providerfout" } };
    }
    // De capstatus gaat vóór rij-inhoudvalidatie: zodra de provider meer dan de
    // contractgrens teruggeeft, weten we principieel niet of alle gevraagde
    // documenten zijn opgelost. Geen enkele gedeeltelijke rij mag dan vrij.
    if ((data?.length ?? 0) > MAX_PRESENTIE_RIJEN) {
      return { status: "geweigerd", documentIdentiteiten: new Set(), audit: { ...basis, afgekapt: true, fout: "afgekapt" } };
    }
    const documentenPerRef = new Map<string, DocumentVersieRij>();
    const buitenScope = (data ?? []).some((r) => {
      const gekoppeld = (r as unknown as { documenten?: DocumentVersieRij | DocumentVersieRij[] | null }).documenten;
      const document = Array.isArray(gekoppeld) ? gekoppeld[0] : gekoppeld;
      if (!document || !refs.includes(r.document_id as string) || !documentIsActueel(document, opdracht, opties)) return true;
      if (!isGeneriekDocument(document) && document.fonds_id !== opdracht.context.fondsId) return true;
      const bronsoort = isGeneriekDocument(document) ? "generiek" as const : "fonds" as const;
      const documentIdentiteit = maakDocumentIdentiteit(
        bronsoort === "generiek" ? "generiek" : `fonds:${opdracht.context.fondsId}`,
        r.document_id as string
      );
      const passageIdentiteit = maakPassageIdentiteit(documentIdentiteit, "chunk-presentie");
      const binnenGrens = binnenCentraleServergrens(
        {
          ...opdracht.context,
          scope: { ...opdracht.context.scope, documentIds: refs },
        },
        { bronsoorten: ["fonds", "generiek"] },
        {
          ref: passageIdentiteit,
          bronsoort,
          titel: "",
          documentIdentiteit: {
            id: documentIdentiteit,
            fondsId: bronsoort === "generiek" ? null : opdracht.context.fondsId,
            bibliotheek: bronsoort === "generiek" ? "generiek" : "fonds",
          },
          passageIdentiteit: { id: passageIdentiteit },
          versie: { soort: "onbekend", waarde: null, gecontroleerdOp: null },
          locator: {},
          passage: "",
          status: { actueel: true },
          rang: { positie: 0 },
        }
      );
      if (!binnenGrens) return true;
      documentenPerRef.set(r.document_id as string, document);
      return false;
    });
    if (buitenScope) {
      return { status: "geweigerd", documentIdentiteiten: new Set(), audit: { ...basis, fout: "buiten_scope" } };
    }
    const gevonden = new Set((data ?? []).map((r) => r.document_id as string));
    // Als de rijen-cap is bereikt terwijl nog niet ieder document is opgelost,
    // is de afwezigheid niet bewezen. Geef dan geen gedeeltelijke set vrij.
    if (gevonden.size < refs.length) return {
      status: "geweigerd", documentIdentiteiten: new Set(), audit: { ...basis, fout: "onvolledig" },
    };
    const opaque = new Set([...gevonden].map((id) => {
      const document = documentenPerRef.get(id)!;
      return maakDocumentIdentiteit(isGeneriekDocument(document) ? "generiek" : `fonds:${opdracht.context.fondsId}`, id);
    }));
    return {
      status: "compleet",
      documentIdentiteiten: opaque,
      audit: { ...basis, toegelaten: opaque.size },
    };
  } catch (error) {
    if (isAfbreking(error)) throw error;
    return { status: "geweigerd", documentIdentiteiten: new Set(), audit: { ...basis, fout: "providerfout" } };
  }
}

export interface BesluitEvidenceWaarde {
  besluitCode: string;
  titel: string;
  besluitvraag: string;
  aanleiding: string | null;
  reikwijdte: string | null;
  governanceOrgaan: string | null;
  complexiteit: string | null;
  risiconiveau: string | null;
  mandaatgevoelig: boolean;
  toezichtgevoelig: boolean;
  beleidsafwijking: boolean;
  aiRisicoklasse: string | null;
  status: string;
  datum: string | null;
}

interface BesluitRij {
  id: string;
  procedure_id: string;
  fonds_id: string;
  besluit_code: string | null;
  titel: string | null;
  besluitvraag: string | null;
  aanleiding: string | null;
  scope: string | null;
  governance_orgaan: string | null;
  complexiteit: string | null;
  risiconiveau: string | null;
  mandaatgevoelig: boolean | null;
  toezichtgevoelig: boolean | null;
  beleidsafwijking: boolean | null;
  ai_risicoklasse: string | null;
  status: string | null;
  gewenste_besluitdatum: string | null;
  laatst_gewijzigd: string | null;
}

const BESLUIT_SELECT = "id, procedure_id, fonds_id, besluit_code, titel, besluitvraag, aanleiding, scope, governance_orgaan, complexiteit, risiconiveau, mandaatgevoelig, toezichtgevoelig, beleidsafwijking, ai_risicoklasse, status, gewenste_besluitdatum, laatst_gewijzigd";

function besluitWaarde(r: BesluitRij): BesluitEvidenceWaarde {
  return {
    besluitCode: r.besluit_code ?? "",
    titel: r.titel ?? "",
    besluitvraag: r.besluitvraag ?? "",
    aanleiding: r.aanleiding ?? null,
    reikwijdte: r.scope ?? null,
    governanceOrgaan: r.governance_orgaan ?? null,
    complexiteit: r.complexiteit ?? null,
    risiconiveau: r.risiconiveau ?? null,
    mandaatgevoelig: r.mandaatgevoelig === true,
    toezichtgevoelig: r.toezichtgevoelig === true,
    beleidsafwijking: r.beleidsafwijking === true,
    aiRisicoklasse: r.ai_risicoklasse ?? null,
    status: r.status ?? "",
    datum: r.gewenste_besluitdatum ?? r.laatst_gewijzigd ?? null,
  };
}

function neutraliseerVeld(waarde: string | null): string | null {
  return waarde == null ? null : neutraliseerModelcontextTekst(waarde).tekst;
}

function neutraliseerBesluitWaarde(waarde: BesluitEvidenceWaarde): BesluitEvidenceWaarde {
  return {
    ...waarde,
    besluitCode: neutraliseerModelcontextTekst(waarde.besluitCode).tekst,
    titel: neutraliseerModelcontextTekst(waarde.titel).tekst,
    besluitvraag: neutraliseerModelcontextTekst(waarde.besluitvraag).tekst,
    aanleiding: neutraliseerVeld(waarde.aanleiding),
    reikwijdte: neutraliseerVeld(waarde.reikwijdte),
    governanceOrgaan: neutraliseerVeld(waarde.governanceOrgaan),
    complexiteit: neutraliseerVeld(waarde.complexiteit),
    risiconiveau: neutraliseerVeld(waarde.risiconiveau),
    aiRisicoklasse: neutraliseerVeld(waarde.aiRisicoklasse),
    status: neutraliseerModelcontextTekst(waarde.status).tekst,
  };
}

function renderBesluitWaarde(waarde: BesluitEvidenceWaarde): string {
  return [
    `Besluitregistratie: ${waarde.besluitCode} — ${waarde.titel}`,
    `Status: ${waarde.status}`,
    `Besluitvraag: ${waarde.besluitvraag}`,
    `Aanleiding: ${waarde.aanleiding ?? "—"}`,
    `Reikwijdte: ${waarde.reikwijdte ?? "—"}`,
    `Governance-orgaan: ${waarde.governanceOrgaan ?? "—"}`,
    `Complexiteit: ${waarde.complexiteit ?? "—"}`,
    `Risiconiveau: ${waarde.risiconiveau ?? "—"}`,
    `Mandaatgevoelig: ${waarde.mandaatgevoelig ? "ja" : "nee"}`,
    `Toezichtgevoelig: ${waarde.toezichtgevoelig ? "ja" : "nee"}`,
    `Beleidsafwijking: ${waarde.beleidsafwijking ? "ja" : "nee"}`,
    `AI-risicoklasse: ${waarde.aiRisicoklasse ?? "—"}`,
    `Datum: ${waarde.datum ?? "—"}`,
  ].join("\n");
}

const FORMELE_STATUSSEN = [
  "geagendeerd", "in_bespreking", "besloten", "voorwaardelijk_besloten",
  "in_uitvoering", "in_evaluatie", "afgesloten",
] as const;
const BESLUIT_STATUSSEN = new Set([
  "concept", "in_onderbouwing", "in_validatie", "in_review", "geagendeerd",
  "in_bespreking", "besloten", "voorwaardelijk_besloten", "afgewezen",
  "aangehouden", "geescaleerd", "teruggezet", "in_uitvoering", "in_evaluatie",
  "afgesloten", "heropend", "geannuleerd",
]);

export async function leesBesluitEvidence(
  supabase: SupabaseClient,
  opdracht: EvidenceOpdracht,
  selectie: { privateProcedureRefs?: readonly string[]; privateDecisionRef?: string; alleenFormeel?: boolean }
): Promise<EvidenceUitkomst<BesluitEvidenceWaarde>> {
  const procedures = [...new Set(selectie.privateProcedureRefs ?? [])];
  const gevraagd = selectie.privateDecisionRef ? 1 : procedures.length;
  const max = Math.min(opdracht.maxItems, MAX_BESLUITEN);
  // Een Decision Object mag uitsluitend onder een expliciete, server-afgeleide
  // processcope worden gelezen. Bij een id-selectie bindt documentIds tevens de
  // concrete registratie; een afwijking faalt vóór de providerquery.
  if (!opdracht.context.scope?.procesId) {
    return geweigerd(opdracht, "besluitregistratie", gevraagd, "buiten_scope");
  }
  if (procedures.length > 0 && (procedures.length !== 1 || procedures[0] !== opdracht.context.scope.procesId)) {
    return geweigerd(opdracht, "besluitregistratie", gevraagd, "buiten_scope");
  }
  if (selectie.privateDecisionRef
    && !opdracht.context.scope.documentIds?.includes(selectie.privateDecisionRef)) {
    return geweigerd(opdracht, "besluitregistratie", gevraagd, "buiten_scope");
  }
  if (gevraagd === 0 || gevraagd > max) return gevraagd === 0
    ? { status: "compleet", items: [], audit: { correlation_id: opdracht.context.correlationId, soort: "besluitregistratie", gevraagd: 0, toegelaten: 0, gerenderde_tekens: 0, limiet: opdracht.maxGerenderdeTekens, afgekapt: false } }
    : geweigerd(opdracht, "besluitregistratie", gevraagd, "afgekapt");
  try {
    let query = supabase
      .from("decision_objects")
      .select(BESLUIT_SELECT)
      .eq("fonds_id", opdracht.context.fondsId)
      .limit(max + 1);
    query = selectie.privateDecisionRef
      ? query.eq("id", selectie.privateDecisionRef)
      : query.in("procedure_id", procedures);
    if (!selectie.privateDecisionRef && !selectie.alleenFormeel) query = query.eq("is_primary_decision", true);
    if (selectie.alleenFormeel) query = query.in("status", [...FORMELE_STATUSSEN]);
    if (opdracht.context.signal) query = query.abortSignal(opdracht.context.signal);
    const { data, error } = await query;
    bewaakNaIO(opdracht.context.signal, error);
    if (error) return geweigerd(opdracht, "besluitregistratie", gevraagd, "providerfout");
    const rows = (data ?? []) as unknown as BesluitRij[];
    if (selectie.privateDecisionRef
      && (rows.length !== 1 || rows[0]?.id !== selectie.privateDecisionRef)) {
      return geweigerd(opdracht, "besluitregistratie", gevraagd, "buiten_scope");
    }
    if (rows.length > max || rows.some((r) => r.fonds_id !== opdracht.context.fondsId)) {
      return geweigerd(opdracht, "besluitregistratie", gevraagd, rows.length > max ? "afgekapt" : "buiten_scope");
    }
    if (rows.some((r) => !r.status || !BESLUIT_STATUSSEN.has(r.status))) {
      return geweigerd(opdracht, "besluitregistratie", gevraagd, "onvolledig");
    }
    // V5 voor structurele evidence: herlees exact dezelfde veldprojectie vlak
    // vóór vrijgave. Een wijziging tussen selectie en rendering weigert alles.
    let v5 = new Map<string, BesluitRij>();
    if (rows.length > 0) {
      let v5Query = supabase
        .from("decision_objects")
        .select(BESLUIT_SELECT)
        .eq("fonds_id", opdracht.context.fondsId)
        .in("id", rows.map((r) => r.id));
      if (opdracht.context.signal) v5Query = v5Query.abortSignal(opdracht.context.signal);
      const { data: v5Data, error: v5Error } = await v5Query;
      bewaakNaIO(opdracht.context.signal, v5Error);
      if (v5Error) return geweigerd(opdracht, "besluitregistratie", gevraagd, "providerfout");
      v5 = new Map(((v5Data ?? []) as unknown as BesluitRij[]).map((r) => [r.id, r]));
    }
    const gecontroleerdOp = new Date().toISOString();
    const items: EvidenceItem<BesluitEvidenceWaarde>[] = [];
    let tekens = 0;
    for (const r of rows) {
      if (r.procedure_id !== opdracht.context.scope.procesId) {
        return geweigerd(opdracht, "besluitregistratie", gevraagd, "buiten_scope");
      }
      const ruweWaarde = besluitWaarde(r);
      const waarde = neutraliseerBesluitWaarde(ruweWaarde);
      const passage = renderBesluitWaarde(waarde);
      // Exact het gerenderde blok plus de scheiding tussen meerdere records.
      tekens += passage.length + (items.length > 0 ? 2 : 0);
      const documentIdentiteit = maakDocumentIdentiteit(`fonds:${opdracht.context.fondsId}:decision`, r.id);
      const passageIdentiteit = maakPassageIdentiteit(documentIdentiteit, "besluitregistratie");
      const versie: Versiebewijs = r.laatst_gewijzigd
        ? {
            soort: "hash",
            waarde: maakVolledigeVersieHash(r.id, r.laatst_gewijzigd, hash(ruweWaarde)),
            gecontroleerdOp,
          }
        : { soort: "onbekend", waarde: null, gecontroleerdOp };
      if (!versie.waarde) return geweigerd(opdracht, "besluitregistratie", gevraagd, "onvolledig");
      items.push({
        soort: "besluitregistratie",
        ref: passageIdentiteit,
        documentIdentiteit,
        passageIdentiteit,
        citationId: maakCitationId(documentIdentiteit, passageIdentiteit, versie.soort, versie.waarde),
        bronsoort: "fonds",
        titel: neutraliseerBrontekst(`Besluitregistratie ${waarde.besluitCode} — ${waarde.titel}`).tekst,
        versie,
        status: { documentstatus: waarde.status, bronstatus: "actief", actueel: !["geannuleerd", "heropend"].includes(waarde.status) },
        locator: {},
        passage,
        gerenderdeTekens: passage.length + (items.length > 0 ? 2 : 0),
        waarde,
      });
    }
    if (tekens > opdracht.maxGerenderdeTekens) return geweigerd(opdracht, "besluitregistratie", gevraagd, "afgekapt");
    const refPerPrivate = new Map(rows.map((r, i) => [r.id, items[i].ref]));
    const actueleVersies = new Map<string, ActueleVersiestand>();
    for (const r of rows) {
      const ref = refPerPrivate.get(r.id)!;
      const actueel = v5.get(r.id);
      const documentIdentiteit = items.find((item) => item.ref === ref)!.documentIdentiteit;
      const passageIdentiteit = ref;
      const versie = actueel?.laatst_gewijzigd
        ? { soort: "hash" as const, waarde: maakVolledigeVersieHash(actueel.id, actueel.laatst_gewijzigd, hash(besluitWaarde(actueel))) }
        : { soort: "onbekend" as const, waarde: null };
      actueleVersies.set(ref, { beschikbaar: Boolean(actueel && versie.waarde), documentIdentiteit, passageIdentiteit, versie });
    }
    const procesPerRef = new Map(rows.map((r, i) => [items[i].ref, r.procedure_id ?? null]));
    const toelatingsContext: RetrievalContext = {
      ...opdracht.context,
      // Procedureselectie kent de concrete Decision Object-refs pas na de
      // server/RLS-query. Bind de centrale poort alsnog aan exact die set.
      scope: {
        ...opdracht.context.scope,
        documentIds: selectie.privateDecisionRef
          ? opdracht.context.scope.documentIds
          : rows.map((r) => r.id),
      },
    };
    if (!await toetsMetCentralePoort(toelatingsContext, items, actueleVersies, procesPerRef)) {
      return geweigerd(opdracht, "besluitregistratie", gevraagd, "onvolledig");
    }
    return {
      status: "compleet",
      items,
      audit: {
        correlation_id: opdracht.context.correlationId, soort: "besluitregistratie", gevraagd,
        toegelaten: items.length, gerenderde_tekens: tekens,
        limiet: opdracht.maxGerenderdeTekens, afgekapt: false,
        ...piiAudit(items.flatMap((item) => [item.titel, item.passage])),
        versies: {
          sterk: items.filter((item) => item.versie.soort === "hash").length,
          gedegradeerd: items.filter((item) => item.versie.soort === "status-datum").length,
        },
      },
    };
  } catch (error) {
    if (isAfbreking(error)) throw error;
    return geweigerd(opdracht, "besluitregistratie", gevraagd, "providerfout");
  }
}

export interface SemantischeEvidenceWaarde {
  conceptSleutel: string;
  type: string;
  valueNum: number | null;
  valueDate: string | null;
  valueText: string | null;
  valueRaw: string;
  valueUnit: string | null;
  page: number | null;
  evidence: string;
}

interface SemanticRij {
  id: string;
  fonds_id: string | null;
  document_id: string;
  extraction_run_id: string;
  type: string;
  value_num: number | null;
  value_date: string | null;
  value_text: string | null;
  value_raw: string;
  value_unit: string | null;
  page: number | null;
  evidence: string;
  concepts: { key: string } | null;
}

interface DocumentVersieRij {
  id: string;
  fonds_id: string | null;
  bibliotheek: string | null;
  bestand_hash: string | null;
  documentdatum: string | null;
  status: string | null;
  bronstatus: string | null;
  actief: boolean | null;
  titel: string | null;
  geldig_vanaf: string | null;
  geldig_tot: string | null;
  volgende_review: string | null;
}

function documentProjectieHash(document: DocumentVersieRij): string {
  return hash({
    id: document.id,
    fonds_id: document.fonds_id,
    bibliotheek: document.bibliotheek,
    bestand_hash: document.bestand_hash,
    documentdatum: document.documentdatum,
    status: document.status,
    bronstatus: document.bronstatus,
    actief: document.actief,
    titel: document.titel,
    geldig_vanaf: document.geldig_vanaf,
    geldig_tot: document.geldig_tot,
    volgende_review: document.volgende_review,
  });
}

const SEMANTIC_SELECT = "id, fonds_id, document_id, extraction_run_id, type, value_num, value_date, value_text, value_raw, value_unit, page, evidence, concepts!inner(key)";
const DOCUMENT_VERSIE_SELECT = "id, fonds_id, bibliotheek, bestand_hash, documentdatum, status, bronstatus, actief, titel, geldig_vanaf, geldig_tot, volgende_review";

function ruweSemantischeWaarde(r: SemanticRij): SemantischeEvidenceWaarde | null {
  if (!r.concepts?.key) return null;
  return {
    conceptSleutel: r.concepts.key,
    type: r.type,
    valueNum: r.value_num,
    valueDate: r.value_date,
    valueText: r.value_text,
    valueRaw: r.value_raw,
    valueUnit: r.value_unit,
    page: r.page,
    evidence: r.evidence,
  };
}

function neutraliseerSemantischeWaarde(waarde: SemantischeEvidenceWaarde): SemantischeEvidenceWaarde {
  return {
    ...waarde,
    conceptSleutel: neutraliseerModelcontextTekst(waarde.conceptSleutel).tekst,
    type: neutraliseerModelcontextTekst(waarde.type).tekst,
    valueText: neutraliseerVeld(waarde.valueText),
    valueRaw: neutraliseerModelcontextTekst(waarde.valueRaw).tekst,
    valueUnit: neutraliseerVeld(waarde.valueUnit),
    evidence: neutraliseerModelcontextTekst(waarde.evidence).tekst,
  };
}

function normaliseerSemantischeSet(rows: SemanticRij[]): {
  rows: SemanticRij[];
  runId: string;
  ruweWaarden: SemantischeEvidenceWaarde[];
} | null {
  if (rows.length === 0) return { rows: [], runId: "", ruweWaarden: [] };
  const runIds = new Set(rows.map((r) => r.extraction_run_id));
  if (runIds.size !== 1 || [...runIds][0].length === 0) return null;
  const gesorteerd = [...rows].sort((a, b) => {
    const ak = a.concepts?.key ?? "";
    const bk = b.concepts?.key ?? "";
    return ak.localeCompare(bk) || a.type.localeCompare(b.type);
  });
  const sleutels = gesorteerd.map((r) => r.concepts?.key ?? "");
  if (sleutels.some((k) => k.length === 0) || new Set(sleutels).size !== sleutels.length) return null;
  const ruweWaarden = gesorteerd.map(ruweSemantischeWaarde);
  if (ruweWaarden.some((v) => v === null)) return null;
  return { rows: gesorteerd, runId: [...runIds][0], ruweWaarden: ruweWaarden as SemantischeEvidenceWaarde[] };
}

function renderSemantischeWaarde(titel: string, waarde: SemantischeEvidenceWaarde): string {
  return [
    `Semantische evidence — ${titel}`,
    `Concept: ${waarde.conceptSleutel}`,
    `Type: ${waarde.type}`,
    `Waarde: ${waarde.valueRaw}`,
    `Tekstwaarde: ${waarde.valueText ?? "—"}`,
    `Getal: ${waarde.valueNum ?? "—"}`,
    `Datum: ${waarde.valueDate ?? "—"}`,
    `Eenheid: ${waarde.valueUnit ?? "—"}`,
    `Pagina: ${waarde.page ?? "—"}`,
    `Onderbouwing: ${waarde.evidence}`,
  ].join("\n");
}

export async function leesSemantischeEvidence(
  supabase: SupabaseClient,
  opdracht: EvidenceOpdracht,
  privateDocumentRef: string
): Promise<EvidenceUitkomst<SemantischeEvidenceWaarde>> {
  const max = Math.min(opdracht.maxItems, MAX_SEMANTISCHE_UNITS);
  const legeAudit = (): EvidenceUitkomst<SemantischeEvidenceWaarde> => ({
    status: "compleet",
    items: [],
    audit: {
      correlation_id: opdracht.context.correlationId,
      soort: "semantische_unit",
      gevraagd: 1,
      toegelaten: 0,
      gerenderde_tekens: 0,
      limiet: opdracht.maxGerenderdeTekens,
      afgekapt: false,
      pii_gedetecteerd: false,
      versies: { sterk: 0, gedegradeerd: 0 },
    },
  });
  try {
    let documentQuery = supabase
      .from("documenten")
      .select(DOCUMENT_VERSIE_SELECT)
      .eq("id", privateDocumentRef);
    let unitsQuery = supabase
      .from("semantic_units")
      .select(SEMANTIC_SELECT)
      .eq("document_id", privateDocumentRef)
      .order("concept_id", { ascending: true })
      .order("id", { ascending: true })
      .limit(max + 1);
    if (opdracht.context.signal) {
      documentQuery = documentQuery.abortSignal(opdracht.context.signal);
      unitsQuery = unitsQuery.abortSignal(opdracht.context.signal);
    }
    const [documentResult, unitsResult] = await Promise.all([documentQuery.maybeSingle(), unitsQuery]);
    bewaakNaIO(opdracht.context.signal, documentResult.error ?? unitsResult.error);
    if (documentResult.error || unitsResult.error) return geweigerd(opdracht, "semantische_unit", 1, "providerfout");
    const document = documentResult.data as unknown as DocumentVersieRij | null;
    const gelezenRows = (unitsResult.data ?? []) as unknown as SemanticRij[];
    if (!document || document.id !== privateDocumentRef
      || (!isGeneriekDocument(document) && document.fonds_id !== opdracht.context.fondsId)) {
      return geweigerd(opdracht, "semantische_unit", 1, "buiten_scope");
    }
    const namespace = isGeneriekDocument(document) ? "generiek" : `fonds:${opdracht.context.fondsId}`;
    const documentIdentiteit = maakDocumentIdentiteit(namespace, privateDocumentRef);
    const documentScope = opdracht.context.scope?.documentIds;
    if (!documentScope?.some((ref) => ref === privateDocumentRef || ref === documentIdentiteit)) {
      return geweigerd(opdracht, "semantische_unit", 1, "buiten_scope");
    }
    if (!documentIsActueel(document, opdracht)) return geweigerd(opdracht, "semantische_unit", 1, "onvolledig");
    if (gelezenRows.length > max) return geweigerd(opdracht, "semantische_unit", 1, "afgekapt");
    if (isGeneriekDocument(document) && gelezenRows.length === 0) {
      // semantic_units is tenantgebonden. Een geldige generieke vergelijkbron
      // valt daarom gecontroleerd door naar het gewone retrieval/LLM-pad.
      return legeAudit();
    }
    if (gelezenRows.some((r) => r.fonds_id !== document.fonds_id || r.document_id !== privateDocumentRef)) {
      return geweigerd(opdracht, "semantische_unit", 1, "buiten_scope");
    }
    const set = normaliseerSemantischeSet(gelezenRows);
    if (!set) return geweigerd(opdracht, "semantische_unit", 1, "onvolledig");
    const rows = set.rows;
    const gecontroleerdOp = new Date().toISOString();
    const setHash = hash(set.ruweWaarden);
    const setVersie = versieVoor(
      privateDocumentRef,
      `${set.runId}:${setHash}`,
      document.bestand_hash,
      document.documentdatum,
      gecontroleerdOp
    );
    if (!setVersie.waarde || setVersie.soort !== "hash") {
      return geweigerd(opdracht, "semantische_unit", 1, "onvolledig");
    }
    const items: EvidenceItem<SemantischeEvidenceWaarde>[] = [];
    const gerenderdeBlokken: string[] = [];
    let tekens = 0;
    for (const [index, r] of rows.entries()) {
      const waarde = neutraliseerSemantischeWaarde(set.ruweWaarden[index]);
      const titel = neutraliseerModelcontextTekst(document.titel ?? "Document").tekst;
      const gerenderd = renderSemantischeWaarde(titel, waarde);
      tekens += gerenderd.length + (items.length > 0 ? 2 : 0);
      gerenderdeBlokken.push(gerenderd);
      // De passage-identiteit is domeingedefinieerd op conceptsleutel; de
      // willekeurige semantic_units.id is uitsluitend een opslagdetail.
      const passageIdentiteit = maakPassageIdentiteit(documentIdentiteit, `semantic-unit:${waarde.conceptSleutel}`);
      items.push({
        soort: "semantische_unit",
        ref: passageIdentiteit,
        documentIdentiteit,
        passageIdentiteit,
        citationId: maakCitationId(documentIdentiteit, passageIdentiteit, setVersie.soort, setVersie.waarde),
        bronsoort: isGeneriekDocument(document) ? "generiek" : "fonds",
        titel,
        versie: setVersie,
        status: {
          documentstatus: document.status,
          bronstatus: document.bronstatus,
          geldigTot: document.geldig_tot,
          actueel: true,
        },
        locator: { pagina: r.page },
        passage: r.evidence,
        gerenderdeTekens: gerenderd.length + (items.length > 0 ? 2 : 0),
        waarde,
      });
    }
    if (tekens > opdracht.maxGerenderdeTekens) return geweigerd(opdracht, "semantische_unit", 1, "afgekapt");
    // Centrale V5/herlezing: documenthash én de canonieke unitprojectie worden
    // opnieuw gelezen. Vervanging van semantic_units tijdens de vergelijking
    // kan daardoor nooit met de oude evidence doorlopen.
    let v5DocumentQuery = supabase
      .from("documenten")
      .select(DOCUMENT_VERSIE_SELECT)
      .eq("id", privateDocumentRef);
    let v5UnitsQuery = supabase
      .from("semantic_units")
      .select(SEMANTIC_SELECT)
      .eq("document_id", privateDocumentRef)
      .order("concept_id", { ascending: true })
      .order("id", { ascending: true })
      .limit(max + 1);
    if (opdracht.context.signal) {
      v5DocumentQuery = v5DocumentQuery.abortSignal(opdracht.context.signal);
      v5UnitsQuery = v5UnitsQuery.abortSignal(opdracht.context.signal);
    }
    const [v5DocumentResult, v5UnitsResult] = await Promise.all([v5DocumentQuery.maybeSingle(), v5UnitsQuery]);
    bewaakNaIO(opdracht.context.signal, v5DocumentResult.error ?? v5UnitsResult.error);
    if (v5DocumentResult.error || v5UnitsResult.error) return geweigerd(opdracht, "semantische_unit", 1, "providerfout");
    const v5Document = v5DocumentResult.data as unknown as DocumentVersieRij | null;
    const v5Rows = (v5UnitsResult.data ?? []) as unknown as SemanticRij[];
    const v5Set = normaliseerSemantischeSet(v5Rows);
    const v5DocumentIdentiteit = v5Document
      ? maakDocumentIdentiteit(isGeneriekDocument(v5Document) ? "generiek" : `fonds:${opdracht.context.fondsId}`, privateDocumentRef)
      : null;
    const v5Geldig = Boolean(
      v5Document
      && v5Set
      && v5Document.id === privateDocumentRef
      && v5Rows.length <= max
      && documentIsActueel(v5Document, opdracht)
      && v5DocumentIdentiteit === documentIdentiteit
      && documentProjectieHash(v5Document) === documentProjectieHash(document)
      && v5Set.runId === set.runId
      && hash(v5Set.ruweWaarden) === setHash
    );
    const v5Versie = v5Geldig && v5Document && v5Set
      ? versieVoor(
          privateDocumentRef,
          `${v5Set.runId}:${hash(v5Set.ruweWaarden)}`,
          v5Document.bestand_hash,
          v5Document.documentdatum,
          gecontroleerdOp
        )
      : { soort: "onbekend" as const, waarde: null, gecontroleerdOp };
    const actueleVersies = new Map<string, ActueleVersiestand>();
    for (const item of items) {
      actueleVersies.set(item.ref, {
        beschikbaar: v5Versie.soort === "hash" && v5Versie.waarde === setVersie.waarde,
        documentIdentiteit,
        passageIdentiteit: item.passageIdentiteit,
        versie: { soort: v5Versie.soort, waarde: v5Versie.waarde },
      });
    }
    if (!await toetsMetCentralePoort(opdracht.context, items, actueleVersies)) {
      return geweigerd(opdracht, "semantische_unit", 1, "onvolledig");
    }
    return {
      status: "compleet",
      items,
      audit: {
        correlation_id: opdracht.context.correlationId, soort: "semantische_unit", gevraagd: 1,
        toegelaten: items.length, gerenderde_tekens: tekens,
        limiet: opdracht.maxGerenderdeTekens, afgekapt: false,
        ...piiAudit(gerenderdeBlokken),
        versies: { sterk: items.length, gedegradeerd: 0 },
      },
    };
  } catch (error) {
    if (isAfbreking(error)) throw error;
    return geweigerd(opdracht, "semantische_unit", 1, "providerfout");
  }
}
