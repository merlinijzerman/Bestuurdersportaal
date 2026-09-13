// #368 — uitvoerende grens voor niet-citeerbare modelcontextlezingen.
// De query blijft providerspecifiek in de serverlaag, maar kan pas data
// vrijgeven na scope-, status-, cap-, provider- en cancellationcontrole.
import type { RetrievalContext } from "./contract";
import { bewaakNaIO } from "./afbreken";

export type ModelcontextLezingSoort =
  | "profiel" | "organisatie" | "portaalstand" | "agendapunt"
  | "fondsmodules" | "risicomatrix" | "risico" | "proces"
  | "documentlabels" | "gespreksdraad";

const MODELCONTEXT_LEZING_SOORTEN = new Set<string>([
  "profiel", "organisatie", "portaalstand", "agendapunt", "fondsmodules",
  "risicomatrix", "risico", "proces", "documentlabels", "gespreksdraad",
]);
const BRONSOORTEN = new Set<string>(["fonds", "generiek", "sharepoint", "notulen", "web"]);
const BEKENDE_STATUSSEN = new Set<string>([
  "actief", "inactief", "open", "gesloten", "concept", "vastgesteld", "van_kracht",
  "published", "draft", "lopend", "gepland", "afgerond", "gepauzeerd", "ingetrokken",
  "gearchiveerd", "historisch", "vervallen", "geannuleerd", "nieuw", "in_behandeling",
  "goedgekeurd", "afgekeurd", "voltooid", "mislukt", "pending",
  "in_uitvoering", "wacht_op_besluit", "ter_besluitvorming", "besloten",
  "in_implementatie", "heropend", "in_voorbereiding", "genomen",
]);
const NIET_ACTUELE_STATUSSEN = new Set<string>([
  "inactief", "gesloten", "afgerond", "ingetrokken", "gearchiveerd", "historisch",
  "vervallen", "geannuleerd", "afgekeurd", "mislukt",
]);

export interface ModelcontextScope {
  fondsId: string;
  actorId?: string;
  privateRefs?: readonly string[];
}

export type ModelcontextScopeBevestiging =
  | { soort: "fonds"; fondsId: string }
  | { soort: "actor"; fondsId: string; actorId: string }
  | { soort: "generiek"; bibliotheek: "generiek" };

export type ModelcontextGeldigheid =
  | { soort: "niet_van_toepassing" }
  | {
      soort: "geverifieerd";
      status: string | null;
      actief: boolean | null;
      geldigVanaf: string | null;
      geldigTot: string | null;
    };

export interface ModelcontextRij<T> {
  waarde: T;
  /** Bevestigd uit de providerprojectie; nooit afgeleid uit request/body. */
  scope: ModelcontextScopeBevestiging;
  /** Expliciet null wanneer deze lezing geen private objectselector heeft. */
  privateRef: string | null;
  /** Levenscyclus is expliciet geverifieerd of aantoonbaar niet van toepassing. */
  geldigheid: ModelcontextGeldigheid;
}

export const MODELCONTEXT_GEEN_GELDIGHEID: ModelcontextGeldigheid = Object.freeze({
  soort: "niet_van_toepassing",
});

function record(waarde: unknown): Record<string, unknown> | null {
  return typeof waarde === "object" && waarde !== null && !Array.isArray(waarde)
    ? waarde as Record<string, unknown>
    : null;
}

function providerRelatie(rij: Record<string, unknown>, relatie: string): Record<string, unknown> | null {
  const gekoppeld = Array.isArray(rij[relatie]) ? (rij[relatie] as unknown[])[0] : rij[relatie];
  return record(gekoppeld);
}

/** Scope komt uitsluitend uit providerkolommen of bekende, server-gejoinede
 * parentrelaties. Ontbrekende provenance is ongeldig; callback-/requestwaarden
 * zijn nooit een fallback. */
function providerFondsId(waarde: unknown): string | null {
  const rij = record(waarde);
  if (!rij) return null;
  if (Object.hasOwn(rij, "fonds_id")) return typeof rij.fonds_id === "string" ? rij.fonds_id : null;
  for (const relatie of ["vergaderingen", "risicos", "procedures", "governance_log"] as const) {
    const gekoppeldeRij = providerRelatie(rij, relatie);
    if (gekoppeldeRij && Object.hasOwn(gekoppeldeRij, "fonds_id")) {
      return typeof gekoppeldeRij.fonds_id === "string" ? gekoppeldeRij.fonds_id : null;
    }
  }
  const stap = providerRelatie(rij, "procedure_stappen");
  const procedure = stap ? providerRelatie(stap, "procedures") : null;
  return procedure && typeof procedure.fonds_id === "string" ? procedure.fonds_id : null;
}

function providerActorId(waarde: unknown): string | null {
  const rij = record(waarde);
  if (!rij) return null;
  for (const veld of ["gebruiker_id", "actor_id", "id"] as const) {
    if (Object.hasOwn(rij, veld)) return typeof rij[veld] === "string" ? rij[veld] as string : null;
  }
  const log = providerRelatie(rij, "governance_log");
  return log && typeof log.gebruiker_id === "string" ? log.gebruiker_id : null;
}

export function fondsModelcontextRij<T>(
  waarde: T,
  _verwachtFondsId: string,
  privateRef: string | null,
  geldigheid: ModelcontextGeldigheid,
  /** Alleen voor een mapper die domeinvelden projecteert: de onbewerkte,
   * servergelezen scope-rij. Bij weglaten is `waarde` zelf die provider-rij. */
  providerRij: unknown = waarde
): ModelcontextRij<T> {
  const providerFonds = providerFondsId(providerRij);
  return {
    waarde,
    scope: { soort: "fonds", fondsId: providerFonds ?? "" },
    privateRef,
    geldigheid,
  };
}

export function actorModelcontextRij<T>(
  waarde: T,
  _verwachtFondsId: string,
  _verwachtActorId: string,
  privateRef: string | null,
  geldigheid: ModelcontextGeldigheid,
  providerRij: unknown = waarde
): ModelcontextRij<T> {
  const providerFonds = providerFondsId(providerRij);
  const providerActor = providerActorId(providerRij);
  return {
    waarde,
    scope: {
      soort: "actor",
      fondsId: providerFonds ?? "",
      actorId: providerActor ?? "",
    },
    privateRef,
    geldigheid,
  };
}

export function generiekModelcontextRij<T>(
  waarde: T,
  privateRef: string | null,
  geldigheid: ModelcontextGeldigheid
): ModelcontextRij<T> {
  return { waarde, scope: { soort: "generiek", bibliotheek: "generiek" }, privateRef, geldigheid };
}

export function documentModelcontextRij<T>(
  waarde: T,
  metadata: {
    fondsId: string | null;
    bibliotheek: string | null;
    status: string | null;
    actief: boolean | null;
    geldigVanaf: string | null;
    geldigTot: string | null;
  },
  privateRef: string | null
): ModelcontextRij<T> {
  const geldigheid = geverifieerdeModelcontextGeldigheid({
    status: metadata.status,
    actief: metadata.actief,
    geldigVanaf: metadata.geldigVanaf,
    geldigTot: metadata.geldigTot,
  });
  if (metadata.fondsId === null && metadata.bibliotheek === "generiek") {
    return generiekModelcontextRij(waarde, privateRef, geldigheid);
  }
  // Een ontbrekende of inconsistente providerprojectie blijft zichtbaar als
  // ongeldige scope en wordt door leesModelcontext fail-closed geweigerd.
  return fondsModelcontextRij(waarde, metadata.fondsId ?? "", privateRef, geldigheid);
}

export function geverifieerdeModelcontextGeldigheid(invoer: {
  status: string | null;
  actief: boolean | null;
  geldigVanaf: string | null;
  geldigTot: string | null;
}): ModelcontextGeldigheid {
  return { soort: "geverifieerd", ...invoer };
}

export interface ModelcontextProviderResult<T> {
  data: readonly ModelcontextRij<T>[] | null;
  error: unknown;
}

export class ModelcontextWeigering extends Error {
  constructor(readonly reden: "buiten_scope" | "providerfout" | "afgekapt" | "niet_actueel") {
    super(`modelcontext_${reden}`);
    this.name = "ModelcontextWeigering";
  }
}

/** Laat een duurzame inhoudsschrijf nooit starten nadat request of deadline afging. */
export async function voerDuurzameSchrijfBinnenDeadlineUit<T>(
  signal: AbortSignal,
  schrijf: () => PromiseLike<T>
): Promise<T> {
  bewaakNaIO(signal);
  return await schrijf();
}

function isActueel(geldigheid: ModelcontextGeldigheid, peildatum: string): boolean {
  switch (geldigheid.soort) {
    case "niet_van_toepassing":
      return true;
    case "geverifieerd": {
      if (geldigheid.status !== null && !BEKENDE_STATUSSEN.has(geldigheid.status)) return false;
      if (geldigheid.actief === false) return false;
      if (geldigheid.geldigVanaf && !/^\d{4}-\d{2}-\d{2}$/.test(geldigheid.geldigVanaf)) return false;
      if (geldigheid.geldigTot && !/^\d{4}-\d{2}-\d{2}$/.test(geldigheid.geldigTot)) return false;
      if (geldigheid.geldigVanaf && geldigheid.geldigVanaf > peildatum) return false;
      if (geldigheid.geldigTot && geldigheid.geldigTot < peildatum) return false;
      if (geldigheid.status && NIET_ACTUELE_STATUSSEN.has(geldigheid.status)) return false;
      return true;
    }
    default:
      return false;
  }
}

export async function leesModelcontext<T>(opdracht: {
  context: RetrievalContext;
  soort: ModelcontextLezingSoort;
  scope: ModelcontextScope;
  maxItems: number;
  lees: (signal: AbortSignal) => PromiseLike<ModelcontextProviderResult<T>>;
}): Promise<T[]> {
  const { context, scope } = opdracht;
  if (!MODELCONTEXT_LEZING_SOORTEN.has(opdracht.soort)) throw new ModelcontextWeigering("providerfout");
  if (!Array.isArray(context.bronbeleid.bronsoorten)
    || context.bronbeleid.bronsoorten.some((soort) => !BRONSOORTEN.has(soort))) {
    throw new ModelcontextWeigering("providerfout");
  }
  const actorId = context.actor.soort === "gebruiker" ? context.actor.id : null;
  if (scope.fondsId !== context.fondsId || (scope.actorId && scope.actorId !== actorId)) {
    throw new ModelcontextWeigering("buiten_scope");
  }
  const signal = context.signal;
  bewaakNaIO(signal);
  if (!signal) throw new ModelcontextWeigering("providerfout");
  const result = await new Promise<ModelcontextProviderResult<T>>((resolve, reject) => {
    const opAbort = () => reject(signal.reason ?? new DOMException("Afgebroken", "AbortError"));
    signal.addEventListener("abort", opAbort, { once: true });
    Promise.resolve(opdracht.lees(signal)).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", opAbort);
    });
  });
  bewaakNaIO(signal, result.error);
  if (result.error) throw new ModelcontextWeigering("providerfout");
  const rows = [...(result.data ?? [])];
  if (rows.length > Math.max(0, Math.floor(opdracht.maxItems))) throw new ModelcontextWeigering("afgekapt");
  const refs = new Set(scope.privateRefs ?? []);
  const peildatum = context.verzoekStartOp.slice(0, 10);
  for (const rij of rows) {
    if (!rij.scope || !rij.geldigheid || !("privateRef" in rij)) throw new ModelcontextWeigering("buiten_scope");
    switch (rij.scope.soort) {
      case "fonds":
        if (rij.scope.fondsId !== context.fondsId || !context.bronbeleid.bronsoorten.includes("fonds")) {
          throw new ModelcontextWeigering("buiten_scope");
        }
        break;
      case "actor":
        if (rij.scope.fondsId !== context.fondsId || rij.scope.actorId !== actorId
          || !context.bronbeleid.bronsoorten.includes("fonds")) {
          throw new ModelcontextWeigering("buiten_scope");
        }
        break;
      case "generiek":
        if (rij.scope.bibliotheek !== "generiek" || !context.bronbeleid.bronsoorten.includes("generiek")) {
          throw new ModelcontextWeigering("buiten_scope");
        }
        break;
      default:
        throw new ModelcontextWeigering("buiten_scope");
    }
    // Een rij met een private locator vereist altijd een expliciete,
    // server-afgeleide selector. Een lege selector is geen fondsbrede wildcard.
    if (refs.size > 0 && rij.privateRef == null) throw new ModelcontextWeigering("buiten_scope");
    if (rij.privateRef != null && !refs.has(rij.privateRef)) throw new ModelcontextWeigering("buiten_scope");
    if (!isActueel(rij.geldigheid, peildatum)) throw new ModelcontextWeigering("niet_actueel");
  }
  return rows.map((rij) => rij.waarde);
}
