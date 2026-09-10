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

/**
 * Misbruik van een gesloten grendel. Een EIGEN fout, geen `RetrievalAfgebroken`:
 * dit is een programmeerfout in de keten, geen afbreking van de beurt, en
 * `isAfbreking()` mag hem dus niet als annulering aanzien.
 */
export class GrendelGesloten extends Error {
  constructor() {
    super("retrieval: de afbreekgrendel is al gesloten — deze beurt is afgerond");
    this.name = "GrendelGesloten";
  }
}

export interface Afbreekgrendel {
  /** Het samengestelde signaal: geef dit door aan élke I/O in de keten. */
  signal: AbortSignal;
  /** Waarom er is afgebroken; `null` zolang de keten loopt. */
  reden(): Afbrekingsreden | null;
  /**
   * Gooit zodra er is afgebroken — te gebruiken tussen twee stappen door.
   * Ná `stop()` gooit hij `GrendelGesloten`: werk buiten de levensduur van de
   * grendel is per definitie onbewaakt, en dat hoort LUID te falen.
   */
  bewaak(): void;
  /** Is de grendel gesloten? Een gesloten grendel bewaakt niets meer. */
  gesloten(): boolean;
  /** Sluit de grendel en ruimt timer en luisteraar op. Idempotent. */
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
  let gesloten = false;

  // Timer én luisteraar worden op ÉÉN plek opgeruimd, en die plek wordt langs
  // alle drie de uitgangen bereikt: afbreken, sluiten, en de deadline die vuurt.
  // Zonder dat laatste zou een keten die `stop()` nooit haalt — omdat fase 2
  // niet wordt aangeroepen — een luisteraar op het clientsignaal achterlaten.
  const ruimOp = () => {
    clearTimeout(timer);
    clientSignal?.removeEventListener("abort", opClientAbort);
  };

  const afbreken = (r: Afbrekingsreden) => {
    if (reden !== null) return;
    reden = r;
    ruimOp();
    ctrl.abort(new RetrievalAfgebroken(r));
  };

  const opClientAbort = () => afbreken("annulering");
  const timer = setTimeout(() => afbreken("timeout"), timeoutMs);
  // `unref` bestaat alleen in Node; in de edge-runtime is het een no-op.
  (timer as unknown as { unref?: () => void }).unref?.();

  if (clientSignal) {
    if (clientSignal.aborted) afbreken("annulering");
    else clientSignal.addEventListener("abort", opClientAbort, { once: true });
  }

  return {
    signal: ctrl.signal,
    reden: () => reden,
    gesloten: () => gesloten,
    bewaak() {
      if (reden !== null) throw new RetrievalAfgebroken(reden);
      // Een GESLOTEN grendel die stil `void` teruggeeft is het gevaarlijkst wat
      // deze module kan doen: de aanroeper denkt bewaakt te zijn en is het niet.
      if (gesloten) throw new GrendelGesloten();
    },
    stop() {
      gesloten = true;
      ruimOp();
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
    const f = e as { name?: string; cause?: unknown; categorie?: string; message?: string; hint?: string };
    if (f.name === "AbortError" || f.name === "TimeoutError") return true;
    if (f.cause instanceof RetrievalAfgebroken) return true;
    // De AI-gateway NORMALISEERT een abort naar een eigen fout. Zonder deze
    // regel ziet de reranker dat als providerfout en valt hij alsnog terug op
    // de RRF-volgorde — precies wat na een afbreking niet mag.
    if (f.categorie === "geannuleerd") return true;
    // PostgREST GOOIT een abort niet door: `postgrest-js` vangt hem en levert
    // een gewoon `{ error: { message: "AbortError: …", hint: "Request was
    // aborted …" } }`-resultaat op. Een afgebroken RPC zou daarmee als
    // providerfout doorgaan en de FTS-terugval starten.
    if (typeof f.message === "string" && /^AbortError|^TimeoutError/.test(f.message)) return true;
    if (typeof f.hint === "string" && /Request was aborted/i.test(f.hint)) return true;
    if (f.cause && isAfbreking(f.cause)) return true;
  }
  return false;
}

/** De afbrekingsreden uit een fout, of `null` als het er geen is. */
/**
 * DE GEZAGHEBBENDE controle na een I/O-stap. Vorm-herkenning is een vangnet;
 * of er is afgebroken weet alleen het signaal zelf. `postgrest-js` levert een
 * abort als gewoon foutresultaat en de gateway als eigen foutcategorie — beide
 * zouden anders als providerfout een terugval starten.
 */
export function bewaakNaIO(signal: AbortSignal | undefined, e?: unknown): void {
  if (signal?.aborted) throw signal.reason ?? new RetrievalAfgebroken("annulering");
  if (e !== undefined && isAfbreking(e)) throw e;
}

export function redenVan(e: unknown): Afbrekingsreden | null {
  if (e instanceof RetrievalAfgebroken) return e.reden;
  if (typeof e === "object" && e !== null) {
    const c = (e as { cause?: unknown }).cause;
    if (c instanceof RetrievalAfgebroken) return c.reden;
    if ((e as { name?: string }).name === "TimeoutError") return "timeout";
    if ((e as { name?: string }).name === "AbortError") return "annulering";
    const c2 = (e as { cause?: unknown }).cause;
    if (c2) {
      const r = redenVan(c2);
      if (r) return r;
    }
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
