// #368 — uitvoerende grens voor niet-citeerbare modelcontextlezingen.
// De query blijft providerspecifiek in de serverlaag, maar kan pas data
// vrijgeven na scope-, status-, cap-, provider- en cancellationcontrole.
import type { RetrievalContext } from "./contract";
import { bewaakNaIO } from "./afbreken";

export type ModelcontextLezingSoort =
  | "profiel" | "organisatie" | "portaalstand" | "agendapunt"
  | "fondsmodules" | "risicomatrix" | "risico" | "proces"
  | "documentlabels" | "gespreksdraad";

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

export function fondsModelcontextRij<T>(
  waarde: T,
  fondsId: string,
  privateRef: string | null,
  geldigheid: ModelcontextGeldigheid
): ModelcontextRij<T> {
  return { waarde, scope: { soort: "fonds", fondsId }, privateRef, geldigheid };
}

export function actorModelcontextRij<T>(
  waarde: T,
  fondsId: string,
  actorId: string,
  privateRef: string | null,
  geldigheid: ModelcontextGeldigheid
): ModelcontextRij<T> {
  return { waarde, scope: { soort: "actor", fondsId, actorId }, privateRef, geldigheid };
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
  if (geldigheid.soort === "niet_van_toepassing") return true;
  if (geldigheid.actief === false) return false;
  if (geldigheid.geldigVanaf && geldigheid.geldigVanaf > peildatum) return false;
  if (geldigheid.geldigTot && geldigheid.geldigTot < peildatum) return false;
  if (geldigheid.status && ["ingetrokken", "gearchiveerd", "historisch", "vervallen", "geannuleerd"].includes(geldigheid.status)) return false;
  return true;
}

export async function leesModelcontext<T>(opdracht: {
  context: RetrievalContext;
  soort: ModelcontextLezingSoort;
  scope: ModelcontextScope;
  maxItems: number;
  lees: (signal: AbortSignal) => PromiseLike<ModelcontextProviderResult<T>>;
}): Promise<T[]> {
  const { context, scope } = opdracht;
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
    if (rij.scope.soort === "fonds" && rij.scope.fondsId !== context.fondsId) throw new ModelcontextWeigering("buiten_scope");
    if (rij.scope.soort === "actor"
      && (rij.scope.fondsId !== context.fondsId || rij.scope.actorId !== actorId)) {
      throw new ModelcontextWeigering("buiten_scope");
    }
    if (rij.scope.soort === "generiek" && rij.scope.bibliotheek !== "generiek") {
      throw new ModelcontextWeigering("buiten_scope");
    }
    if (rij.scope.soort === "generiek" && !context.bronbeleid.bronsoorten.includes("generiek")) {
      throw new ModelcontextWeigering("buiten_scope");
    }
    if ((rij.scope.soort === "fonds" || rij.scope.soort === "actor")
      && !context.bronbeleid.bronsoorten.includes("fonds")) {
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
