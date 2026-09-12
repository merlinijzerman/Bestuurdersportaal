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

export interface ModelcontextRij<T> {
  waarde: T;
  fondsId?: string | null;
  actorId?: string | null;
  privateRef?: string | null;
  status?: string | null;
  actief?: boolean | null;
  geldigVanaf?: string | null;
  geldigTot?: string | null;
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

function isActueel<T>(rij: ModelcontextRij<T>, peildatum: string): boolean {
  if (rij.actief === false) return false;
  if (rij.geldigVanaf && rij.geldigVanaf > peildatum) return false;
  if (rij.geldigTot && rij.geldigTot < peildatum) return false;
  if (rij.status && ["ingetrokken", "gearchiveerd", "historisch", "vervallen", "geannuleerd"].includes(rij.status)) return false;
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
    if (rij.fondsId != null && rij.fondsId !== context.fondsId) throw new ModelcontextWeigering("buiten_scope");
    if (rij.actorId != null && rij.actorId !== actorId) throw new ModelcontextWeigering("buiten_scope");
    // Een rij met een private locator vereist altijd een expliciete,
    // server-afgeleide selector. Een lege selector is geen fondsbrede wildcard.
    if (rij.privateRef != null && !refs.has(rij.privateRef)) throw new ModelcontextWeigering("buiten_scope");
    if (!isActueel(rij, peildatum)) throw new ModelcontextWeigering("niet_actueel");
  }
  return rows.map((rij) => rij.waarde);
}
