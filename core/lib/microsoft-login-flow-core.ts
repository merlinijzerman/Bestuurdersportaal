// ============================================================================
//  core/lib/microsoft-login-flow-core.ts — PURE flowgeheimen en het versleutelde
//  transactiegeheim van de login-flow (fase 1B, #335 T2; ontwerp §3.2, R-31).
// ----------------------------------------------------------------------------
//  state, nonce en PKCE-verifier ontstaan per start en leven UITSLUITEND in de
//  versleutelde server-side transactie (login_private.oauth_transacties, T1).
//  Naar Entra gaat sha256(nonce); GoTrue vergelijkt bij signInWithIdToken/
//  linkIdentity `sha256(nonce)` met de tokenclaim, dus wij geven daar de RUWE
//  nonce door. De transactiesleutel is sha256(state): de state zelf staat nergens
//  opgeslagen.
// ============================================================================

import { createHash, randomBytes } from "node:crypto";

export const TRANSACTIE_GELDIGHEID_MS = 10 * 60_000;

export type FlowIntent = "koppelen" | "inloggen";

export type FlowGeheimen = { readonly state: string; readonly nonce: string; readonly verifier: string };

export function maakFlowGeheimen(random: (n: number) => Buffer = randomBytes): FlowGeheimen {
  return {
    state: random(32).toString("base64url"),
    nonce: random(32).toString("base64url"),
    verifier: random(64).toString("base64url"),
  };
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");
/** Transactiesleutel in de DB. */
export const stateHash = (state: string): string => sha256Hex(state);
/** De `nonce`-parameter richting Entra én de verwachte tokenclaim. */
export const nonceHash = (nonce: string): string => sha256Hex(nonce);
/** PKCE S256. */
export const codeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

/** Wat er versleuteld in de transactie staat. Geen claims, geen tokens. */
export type TransactieGeheim = {
  readonly nonce: string;
  readonly verifier: string;
  /** Veilig vervolgpad (al door veiligVervolgpad gehaald) — alleen bij inloggen. */
  readonly next: string;
  /** Genormaliseerde host waarop de flow startte; de callback eist dezelfde host. */
  readonly host: string;
  /** De redirect-URI zoals naar Entra gestuurd; de tokenrequest gebruikt exact deze. */
  readonly redirectUri: string;
};

export function serialiseerTransactieGeheim(g: TransactieGeheim): string {
  return JSON.stringify({ nonce: g.nonce, verifier: g.verifier, next: g.next, host: g.host, redirectUri: g.redirectUri });
}

const B64URL = /^[A-Za-z0-9_-]{16,}$/;

/** Strikte vormcontrole; alles wat afwijkt is `null` (→ transactie_ongeldig). */
export function parseTransactieGeheim(tekst: string): TransactieGeheim | null {
  let w: unknown;
  try {
    w = JSON.parse(tekst);
  } catch {
    return null;
  }
  const o = w as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const { nonce, verifier, next, host, redirectUri } = o;
  if (typeof nonce !== "string" || !B64URL.test(nonce)) return null;
  if (typeof verifier !== "string" || !B64URL.test(verifier)) return null;
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return null;
  if (typeof host !== "string" || !host || /[\s/\\@]/.test(host)) return null;
  if (typeof redirectUri !== "string") return null;
  try {
    const u = new URL(redirectUri);
    if (u.username || u.password || u.search || u.hash) return null;
  } catch {
    return null;
  }
  return { nonce, verifier, next, host, redirectUri };
}

/**
 * Redirect-URI uit de genormaliseerde host. HTTPS, behalve op de lokale wegwerp-
 * stack (loopback/*.localhost mét SEED_DOELOMGEVING=local). Het pad is vast (E4).
 */
export const MICROSOFT_LOGIN_CALLBACK_PAD = "/auth/microsoft-login/callback";

function isLokaleHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost") || /^(localhost|127\.0\.0\.1):\d+$/.test(host) || /\.localhost:\d+$/.test(host);
}

/**
 * Eigen origin voor redirects, afgeleid uit de GEVERIFIEERDE fondshost (de host is
 * al tegen tenant_domains getoetst). `req.url` is hier niet bruikbaar: achter een
 * proxy of bij `next start` draagt die de luisterhost (`localhost:3000`), niet de
 * fondshost, zodat een redirect op een andere host — zonder sessiecookie — landt.
 * HTTPS, behalve lokaal met toestemming (dezelfde grendel als de callback-URI).
 */
export function origineVoorHost(host: string, opties: { lokaalToegestaan: boolean }): string {
  const schema = isLokaleHost(host) && opties.lokaalToegestaan ? "http" : "https";
  return `${schema}://${host}`;
}

export function callbackUrlVoorHost(host: string, opties: { lokaalToegestaan: boolean }): string {
  return `${origineVoorHost(host, opties)}${MICROSOFT_LOGIN_CALLBACK_PAD}`;
}
