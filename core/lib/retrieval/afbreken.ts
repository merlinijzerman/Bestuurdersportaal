// ============================================================================
//  #322 F4-T2-1/PR-B — Annulering en deadline, met een EXPLICIETE oorzaak.
// ----------------------------------------------------------------------------
//  Twee dingen breken een beurt af, en ze betekenen niet hetzelfde:
//    • de client verbreekt de verbinding  → foutcategorie `annulering`;
//    • de deadline verloopt               → foutcategorie `timeout`.
//  Een kaal `AbortSignal` vertelt dat verschil niet. Deze module stelt één
//  samengesteld signaal samen dat wél weet waaróm het is afgegaan.
//
//  DE KERNREGEL (besluit 0213, ontwerp §4.4): na een afbreking mag GEEN enkele
//  fail-safe alsnog vuren. De retrievalketen kent er drie — rerank valt terug op
//  de RRF-volgorde, een mislukte query-embedding valt terug op FTS, en een
//  falende hybride RPC doet hetzelfde. Die zijn er voor PROVIDERfouten. Vangen
//  ze ook een afbreking, dan doet de keten ná de annulering alsnog werk, en dat
//  is precies wat cancellation moet voorkomen. `isAfbreking()` onderscheidt de
//  twee; elke fail-safe moet daarop eerst doorgooien.
// ============================================================================

export type Afbrekingsreden = "annulering" | "timeout";

/** Fout die door de keten heen reist en zijn eigen oorzaak draagt. */
export class RetrievalAfgebroken extends Error {
  readonly reden: Afbrekingsreden;
  constructor(reden: Afbrekingsreden) {
    super(reden === "timeout" ? "retrieval: deadline verlopen" : "retrieval: door de client afgebroken");
    this.name = "RetrievalAfgebroken";
    this.reden = reden;
  }
}

/** Grenzen voor de deadline. Buiten bereik of onleesbaar → de veilige default. */
export const TIMEOUT_MIN_MS = 5_000;
export const TIMEOUT_MAX_MS = 60_000;
export const TIMEOUT_DEFAULT_MS = 20_000;

/**
 * Leest `retrieval_timeout_ms` uit de fondsconfiguratie. Een ontbrekende,
 * onleesbare of buiten-bereik-waarde levert 20 s — nooit "geen grens": een
 * kapotte configuratie mag niet stilzwijgend de begrenzing uitzetten.
 */
export function timeoutUitConfig(waarde: unknown): number {
  const n = typeof waarde === "number" ? waarde : Number.parseInt(String(waarde ?? ""), 10);
  if (!Number.isFinite(n)) return TIMEOUT_DEFAULT_MS;
  if (n < TIMEOUT_MIN_MS || n > TIMEOUT_MAX_MS) return TIMEOUT_DEFAULT_MS;
  return n;
}

export interface Afbreekgrendel {
  /** Het samengestelde signaal: geef dit door aan élke I/O in de keten. */
  signal: AbortSignal;
  /** Waarom er is afgebroken; `null` zolang de keten loopt. */
  reden(): Afbrekingsreden | null;
  /** Gooit zodra er is afgebroken — te gebruiken tussen twee stappen door. */
  bewaak(): void;
  /** Ruimt de timer op; altijd aanroepen in een `finally`. */
  stop(): void;
}

/**
 * Stelt het samengestelde signaal samen uit de clientverbinding en de deadline.
 * `AbortSignal.any` bestaat in Node 20+, maar de reden zou daarmee verloren
 * gaan; daarom een eigen controller die per bron onthoudt waaróm hij afging.
 */
export function maakAfbreekgrendel(clientSignal: AbortSignal | undefined, timeoutMs: number): Afbreekgrendel {
  const ctrl = new AbortController();
  let reden: Afbrekingsreden | null = null;

  const afbreken = (r: Afbrekingsreden) => {
    if (reden !== null) return;
    reden = r;
    ctrl.abort(new RetrievalAfgebroken(r));
  };

  const timer = setTimeout(() => afbreken("timeout"), timeoutMs);
  // `unref` bestaat alleen in Node; in de edge-runtime is het een no-op.
  (timer as unknown as { unref?: () => void }).unref?.();

  const opClientAbort = () => afbreken("annulering");
  if (clientSignal) {
    if (clientSignal.aborted) afbreken("annulering");
    else clientSignal.addEventListener("abort", opClientAbort, { once: true });
  }

  return {
    signal: ctrl.signal,
    reden: () => reden,
    bewaak() {
      if (reden !== null) throw new RetrievalAfgebroken(reden);
    },
    stop() {
      clearTimeout(timer);
      clientSignal?.removeEventListener("abort", opClientAbort);
    },
  };
}

/**
 * Is deze fout een afbreking? Elke fail-safe moet hierop eerst doorgooien.
 * Herkent zowel onze eigen fout als de `AbortError` die `fetch` en PostgREST
 * gooien wanneer hun signaal afgaat.
 */
export function isAfbreking(e: unknown): boolean {
  if (e instanceof RetrievalAfgebroken) return true;
  if (typeof e === "object" && e !== null) {
    const f = e as { name?: string; cause?: unknown };
    if (f.name === "AbortError" || f.name === "TimeoutError") return true;
    if (f.cause instanceof RetrievalAfgebroken) return true;
  }
  return false;
}

/** De afbrekingsreden uit een fout, of `null` als het er geen is. */
export function redenVan(e: unknown): Afbrekingsreden | null {
  if (e instanceof RetrievalAfgebroken) return e.reden;
  if (typeof e === "object" && e !== null) {
    const c = (e as { cause?: unknown }).cause;
    if (c instanceof RetrievalAfgebroken) return c.reden;
    if ((e as { name?: string }).name === "TimeoutError") return "timeout";
    if ((e as { name?: string }).name === "AbortError") return "annulering";
  }
  return null;
}

/**
 * Wachten dat meebreekt. De retry-backoff van de embeddingclient sliep hiervoor
 * blind door: bij een afbreking wachtte de keten eerst nog twee seconden en
 * deed dáárna pas een poging die toch al niet meer mocht.
 */
export function slaapMetSignaal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new RetrievalAfgebroken("annulering"));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", opAbort);
      resolve();
    }, ms);
    const opAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new RetrievalAfgebroken("annulering"));
    };
    signal?.addEventListener("abort", opAbort, { once: true });
  });
}
