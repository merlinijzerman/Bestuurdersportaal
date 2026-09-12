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
  EvidenceItem,
  EvidenceOpdracht,
  EvidenceUitkomst,
  PresentieUitkomst,
} from "./evidence-contract";
import { maakCitationId, maakDocumentIdentiteit, maakPassageIdentiteit, maakVolledigeVersieHash } from "./identiteit";
import type { Versiebewijs } from "./contract";
import type { ActueleVersiestand, Bronresultaat, RetrievalAdapter, RetrievalContext } from "./contract";
import { verifieerToelating } from "./toelatingspoort";
import { neutraliseerBrontekst } from "../bron-afbakening";
import { bevatPersoonsgegevens } from "../pii-gate";

const SHA256_HEX = /^[a-f0-9]{64}$/;
export const MAX_PRESENTIE_DOCUMENTEN = 2000;
export const MAX_PRESENTIE_RIJEN = 2000;
export const MAX_BESLUITEN = 12;
export const MAX_SEMANTISCHE_UNITS = 500;

function hash(waarde: unknown): string {
  return createHash("sha256").update(JSON.stringify(waarde)).digest("hex");
}

function piiAudit(teksten: readonly string[]): { pii_gedetecteerd: boolean; pii_soorten?: string[] } {
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
      fondsId: context.fondsId,
      bibliotheek: "fonds",
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
      bronsoorten: ["fonds"],
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
  const uitkomst = await verifieerToelating(context, adapter, [bronnen]);
  return uitkomst.geweigerd.length === 0 && uitkomst.toegelatenPerSpoor[0].length === bronnen.length;
}

/** Contentvrije presentiecheck. Bij cap/fout komt nooit een gedeeltelijke set vrij. */
export async function controleerChunkPresentie(
  supabase: SupabaseClient,
  opdracht: EvidenceOpdracht,
  privateDocumentRefs: readonly string[]
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
      .select("document_id, documenten!inner(fonds_id, bibliotheek)")
      .in("document_id", refs)
      .limit(MAX_PRESENTIE_RIJEN + 1);
    if (opdracht.context.signal) query = query.abortSignal(opdracht.context.signal);
    const { data, error } = await query;
    bewaakNaIO(opdracht.context.signal, error);
    if (error) {
      return { status: "geweigerd", documentIdentiteiten: new Set(), audit: { ...basis, fout: "providerfout" } };
    }
    const buitenScope = (data ?? []).some((r) => {
      const documenten = (r as { documenten?: { fonds_id?: string | null; bibliotheek?: string | null } | null }).documenten;
      return documenten?.fonds_id !== opdracht.context.fondsId || !refs.includes(r.document_id as string);
    });
    if (buitenScope) {
      return { status: "geweigerd", documentIdentiteiten: new Set(), audit: { ...basis, fout: "buiten_scope" } };
    }
    const gevonden = new Set((data ?? []).map((r) => r.document_id as string));
    // Als de rijen-cap is bereikt terwijl nog niet ieder document is opgelost,
    // is de afwezigheid niet bewezen. Geef dan geen gedeeltelijke set vrij.
    if ((data?.length ?? 0) > MAX_PRESENTIE_RIJEN && gevonden.size < refs.length) {
      return { status: "geweigerd", documentIdentiteiten: new Set(), audit: { ...basis, afgekapt: true, fout: "afgekapt" } };
    }
    const opaque = new Set([...gevonden].map((id) => maakDocumentIdentiteit(`fonds:${opdracht.context.fondsId}`, id)));
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
      const waarde = besluitWaarde(r);
      const passage = neutraliseerBrontekst(
        `Besluitregistratie ${waarde.besluitCode} — ${waarde.titel}. Status: ${waarde.status}. Besluitvraag: ${waarde.besluitvraag}`
      ).tekst;
      // Alle domeinvelden kunnen door een caller worden gerenderd; budgetteer
      // daarom de volledige, canonieke projectie en niet slechts de samenvatting.
      tekens += JSON.stringify(waarde).length;
      const documentIdentiteit = maakDocumentIdentiteit(`fonds:${opdracht.context.fondsId}:decision`, r.id);
      const passageIdentiteit = maakPassageIdentiteit(documentIdentiteit, "besluitregistratie");
      const versie: Versiebewijs = r.laatst_gewijzigd
        ? {
            soort: "hash",
            waarde: maakVolledigeVersieHash(r.id, r.laatst_gewijzigd, hash(waarde)),
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
        titel: `Besluitregistratie ${waarde.besluitCode} — ${waarde.titel}`,
        versie,
        status: { documentstatus: waarde.status, bronstatus: "actief", actueel: !["geannuleerd", "heropend"].includes(waarde.status) },
        locator: {},
        passage,
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
    if (!await toetsMetCentralePoort(opdracht.context, items, actueleVersies, procesPerRef)) {
      return geweigerd(opdracht, "besluitregistratie", gevraagd, "onvolledig");
    }
    return {
      status: "compleet",
      items,
      audit: {
        correlation_id: opdracht.context.correlationId, soort: "besluitregistratie", gevraagd,
        toegelaten: items.length, gerenderde_tekens: tekens,
        limiet: opdracht.maxGerenderdeTekens, afgekapt: false,
        ...piiAudit(items.map((item) => item.passage)),
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
  fonds_id: string;
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
}

const SEMANTIC_SELECT = "id, fonds_id, document_id, extraction_run_id, type, value_num, value_date, value_text, value_raw, value_unit, page, evidence, concepts!inner(key)";

export async function leesSemantischeEvidence(
  supabase: SupabaseClient,
  opdracht: EvidenceOpdracht,
  privateDocumentRef: string
): Promise<EvidenceUitkomst<SemantischeEvidenceWaarde>> {
  const max = Math.min(opdracht.maxItems, MAX_SEMANTISCHE_UNITS);
  try {
    let documentQuery = supabase
      .from("documenten")
      .select("id, fonds_id, bibliotheek, bestand_hash, documentdatum, status, bronstatus, actief, titel")
      .eq("id", privateDocumentRef)
      .eq("fonds_id", opdracht.context.fondsId);
    let unitsQuery = supabase
      .from("semantic_units")
      .select(SEMANTIC_SELECT)
      .eq("fonds_id", opdracht.context.fondsId)
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
    const rows = (unitsResult.data ?? []) as unknown as SemanticRij[];
    if (!document || document.fonds_id !== opdracht.context.fondsId || rows.some((r) => r.fonds_id !== opdracht.context.fondsId || r.document_id !== privateDocumentRef)) {
      return geweigerd(opdracht, "semantische_unit", 1, "buiten_scope");
    }
    if (rows.length > max) return geweigerd(opdracht, "semantische_unit", 1, "afgekapt");
    const gecontroleerdOp = new Date().toISOString();
    const documentIdentiteit = maakDocumentIdentiteit(`fonds:${opdracht.context.fondsId}`, privateDocumentRef);
    const items: EvidenceItem<SemantischeEvidenceWaarde>[] = [];
    let tekens = 0;
    for (const r of rows) {
      if (!r.concepts?.key) return geweigerd(opdracht, "semantische_unit", 1, "onvolledig");
      const waarde: SemantischeEvidenceWaarde = {
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
      const versie = versieVoor(
        privateDocumentRef,
        `${r.extraction_run_id}:${hash(waarde)}`,
        document.bestand_hash,
        document.documentdatum,
        gecontroleerdOp
      );
      if (!versie.waarde || versie.soort !== "hash") return geweigerd(opdracht, "semantische_unit", 1, "onvolledig");
      const passageIdentiteit = maakPassageIdentiteit(documentIdentiteit, `semantic-unit:${r.id}`);
      tekens += r.evidence.length;
      items.push({
        soort: "semantische_unit",
        ref: passageIdentiteit,
        documentIdentiteit,
        passageIdentiteit,
        citationId: maakCitationId(documentIdentiteit, passageIdentiteit, versie.soort, versie.waarde),
        bronsoort: "fonds",
        titel: document.titel ?? "Document",
        versie,
        status: { documentstatus: document.status, bronstatus: document.bronstatus, actueel: document.actief !== false },
        locator: { pagina: r.page },
        passage: r.evidence,
        waarde,
      });
    }
    if (tekens > opdracht.maxGerenderdeTekens) return geweigerd(opdracht, "semantische_unit", 1, "afgekapt");
    // Centrale V5/herlezing: documenthash én de canonieke unitprojectie worden
    // opnieuw gelezen. Vervanging van semantic_units tijdens de vergelijking
    // kan daardoor nooit met de oude evidence doorlopen.
    let v5DocumentQuery = supabase
      .from("documenten")
      .select("id, fonds_id, bibliotheek, bestand_hash, documentdatum, status, bronstatus, actief, titel")
      .eq("id", privateDocumentRef)
      .eq("fonds_id", opdracht.context.fondsId);
    let v5UnitsQuery = supabase
      .from("semantic_units")
      .select(SEMANTIC_SELECT)
      .eq("fonds_id", opdracht.context.fondsId)
      .eq("document_id", privateDocumentRef)
      .in("id", rows.map((r) => r.id))
      .order("concept_id", { ascending: true })
      .order("id", { ascending: true });
    if (opdracht.context.signal) {
      v5DocumentQuery = v5DocumentQuery.abortSignal(opdracht.context.signal);
      v5UnitsQuery = v5UnitsQuery.abortSignal(opdracht.context.signal);
    }
    const [v5DocumentResult, v5UnitsResult] = await Promise.all([v5DocumentQuery.maybeSingle(), v5UnitsQuery]);
    bewaakNaIO(opdracht.context.signal, v5DocumentResult.error ?? v5UnitsResult.error);
    if (v5DocumentResult.error || v5UnitsResult.error) return geweigerd(opdracht, "semantische_unit", 1, "providerfout");
    const v5Document = v5DocumentResult.data as unknown as DocumentVersieRij | null;
    const v5PerId = new Map(((v5UnitsResult.data ?? []) as unknown as SemanticRij[]).map((r) => [r.id, r]));
    const actueleVersies = new Map<string, ActueleVersiestand>();
    for (const [index, r] of rows.entries()) {
      const actueel = v5PerId.get(r.id);
      const ref = items[index].ref;
      if (!actueel?.concepts?.key || !v5Document) {
        actueleVersies.set(ref, { beschikbaar: false, versie: { soort: "onbekend", waarde: null } });
        continue;
      }
      const actueleWaarde: SemantischeEvidenceWaarde = {
        conceptSleutel: actueel.concepts.key,
        type: actueel.type,
        valueNum: actueel.value_num,
        valueDate: actueel.value_date,
        valueText: actueel.value_text,
        valueRaw: actueel.value_raw,
        valueUnit: actueel.value_unit,
        page: actueel.page,
        evidence: actueel.evidence,
      };
      const versie = versieVoor(
        privateDocumentRef,
        `${actueel.extraction_run_id}:${hash(actueleWaarde)}`,
        v5Document.bestand_hash,
        v5Document.documentdatum,
        gecontroleerdOp
      );
      actueleVersies.set(ref, {
        beschikbaar: versie.soort === "hash" && Boolean(versie.waarde),
        documentIdentiteit,
        passageIdentiteit: ref,
        versie: { soort: versie.soort, waarde: versie.waarde },
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
        ...piiAudit(items.map((item) => item.passage)),
        versies: { sterk: items.length, gedegradeerd: 0 },
      },
    };
  } catch (error) {
    if (isAfbreking(error)) throw error;
    return geweigerd(opdracht, "semantische_unit", 1, "providerfout");
  }
}
