// Alleen de lokale labsmoke mag deze beperkte providerdiagnostiek bewaren.
// De productieclient en het duurzame auditspoor blijven inhouds- en identifiervrij.
import { randomUUID } from "node:crypto";

const MAX_FOUTBODY_BYTES = 8 * 1024;
const LEESDEADLINE_MS = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProviderFoutcode =
  | "licentie_melding"
  | "insufficient_claims"
  | "authorization_request_denied"
  | "access_denied"
  | "invalid_authentication_token"
  | "forbidden"
  | "onbekend";

export interface VeiligeProviderDiagnostiek {
  /** Alleen een vaste categorie; nooit error.message of een willekeurige code. */
  foutcode: ProviderFoutcode;
  /** Alleen syntactisch geldige UUID's, bruikbaar bij een Microsoft-supportverzoek. */
  requestId: string | null;
  clientRequestId: string;
}

function veiligeUuid(waarde: unknown): string | null {
  return typeof waarde === "string" && UUID.test(waarde) ? waarde.toLowerCase() : null;
}

function object(waarde: unknown): Record<string, unknown> | null {
  return typeof waarde === "object" && waarde !== null && !Array.isArray(waarde)
    ? waarde as Record<string, unknown>
    : null;
}

/** Leest hoogstens 8 KiB en wacht hoogstens een seconde; diagnose mag de call niet ophouden. */
async function leesKleineFoutbody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || signal.aborted) return null;
  const lengte = Number(response.headers.get("content-length"));
  if (Number.isFinite(lengte) && lengte > MAX_FOUTBODY_BYTES) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    const annuleer = () => reject(new Error("diagnostiek_afgebroken"));
    stop = () => signal.removeEventListener("abort", annuleer);
    signal.addEventListener("abort", annuleer, { once: true });
    timer = setTimeout(annuleer, LEESDEADLINE_MS);
  });
  let bytes = 0;
  let tekst = "";
  let klaar = false;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) {
        klaar = true;
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_FOUTBODY_BYTES) return null;
      tekst += decoder.decode(value, { stream: true });
    }
    return JSON.parse(tekst + decoder.decode());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    stop?.();
    if (!klaar) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* een openstaande read kan de lock vasthouden */ }
  }
}

function vasteFoutcode(payload: unknown, challenge: string | null): ProviderFoutcode {
  if (challenge && /(?:^|[,\s])error="insufficient_claims"(?:[,\s]|$)/i.test(challenge)) {
    return "insufficient_claims";
  }
  const error = object(object(payload)?.error);
  if (!error) return "onbekend";
  // Dit is uitsluitend een diagnostisch label, nooit een autorisatiebesluit.
  // De vrije providerboodschap wordt niet bewaard of doorgegeven.
  if (error.message === "Authorization Failed - User does not have valid license") {
    return "licentie_melding";
  }
  const nested = object(error.innerError ?? error.innererror);
  for (const waarde of [nested?.code, error.code]) {
    switch (waarde) {
      case "insufficient_claims": return "insufficient_claims";
      case "Authorization_RequestDenied": return "authorization_request_denied";
      case "accessDenied":
      case "AccessDenied": return "access_denied";
      case "InvalidAuthenticationToken": return "invalid_authentication_token";
      case "Forbidden":
      case "forbidden": return "forbidden";
    }
  }
  return "onbekend";
}

/**
 * Wikkelt uitsluitend de labcall in. De client blijft eigenaar van HTTP-status,
 * retries en foutnormalisatie; deze wrapper verandert de uitkomst niet.
 */
export function diagnostischeRetrievalFetch(
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  gevonden: (diagnostiek: VeiligeProviderDiagnostiek) => void,
): typeof fetch {
  return (async (invoer: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const clientRequestId = randomUUID();
    const headers = new Headers(init?.headers);
    headers.set("client-request-id", clientRequestId);
    headers.set("return-client-request-id", "true");
    const response = await fetchImpl(invoer, { ...init, headers });
    if (response.status === 401 || response.status === 403) {
      const payload = await leesKleineFoutbody(response, signal);
      // De diagnose mag een beurtafbreking niet omzetten in een HTTP-afwijzing.
      if (signal.aborted) throw signal.reason ?? new DOMException("afgebroken", "AbortError");
      const error = object(object(payload)?.error);
      const inner = object(error?.innerError ?? error?.innererror);
      gevonden({
        foutcode: vasteFoutcode(payload, response.headers.get("www-authenticate")),
        requestId: veiligeUuid(response.headers.get("request-id"))
          ?? veiligeUuid(inner?.["request-id"]),
        clientRequestId,
      });
    }
    return response;
  }) as typeof fetch;
}
