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
  if (typeof host !== "string" || canoniekeFondsHost(host, { lokaalToegestaan: true }) !== host) return null;
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

// ── Canonieke fondshost ──────────────────────────────────────────────────────
//  Reviewbevinding PR #339 (ronde 2): een ruwe Host-header mag NOOIT in een URL
//  terechtkomen. `pgb.example:443@evil.example` wordt door normaliseerHost() voor
//  de fondscontrole tot `pgb.example` teruggebracht, maar als URL gelezen is het een
//  redirect naar evil.example. Daarom één strikte canonicalisering die overal
//  dezelfde waarde levert (fondscontrole, callback-URI, redirects, limietsleutel):
//    • alleen kleine letters, cijfers, `-` en `.` in DNS-labelvorm; geen userinfo,
//      geen pad, geen `?`/`#`, geen witruimte, geen `[`/`]`;
//    • in productie GEEN poort (Vercel-hosts dragen er geen);
//    • een poort alleen lokaal (SEED_DOELOMGEVING=local) én alleen op `.localhost`,
//      `localhost` of `127.0.0.1` — de expliciete lokale testhosts.
//  Alles wat afwijkt is `null` → de route antwoordt met een neutrale 404.

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const POORT_RE = /^[1-9][0-9]{0,4}$/;

function isLokaleTestHostnaam(hostnaam: string): boolean {
  return hostnaam === "localhost" || hostnaam === "127.0.0.1" || hostnaam.endsWith(".localhost");
}

/**
 * Canonieke fondshost uit een ruwe Host-headerwaarde, of `null` als de waarde niet
 * exact een hostnaam (lokaal: optioneel met poort) is. Geen trim van binnenruimte,
 * geen "repareren": één afwijkend teken maakt de host ongeldig.
 */
export function canoniekeFondsHost(ruw: string | null | undefined, opties: { lokaalToegestaan: boolean }): string | null {
  if (typeof ruw !== "string") return null;
  if (ruw !== ruw.trim() || ruw.length === 0 || /[\s@/\\?#\[\]]/.test(ruw)) return null;
  const laag = ruw.toLowerCase();
  const dubbelepunten = (laag.match(/:/g) ?? []).length;
  if (dubbelepunten > 1) return null;
  const [hostnaam, poort] = dubbelepunten === 1 ? laag.split(":") : [laag, undefined];
  if (!hostnaam || !HOSTNAME_RE.test(hostnaam)) return null;
  if (poort !== undefined) {
    if (!opties.lokaalToegestaan || !isLokaleTestHostnaam(hostnaam) || !POORT_RE.test(poort) || Number(poort) > 65535) return null;
    return `${hostnaam}:${poort}`;
  }
  return hostnaam;
}

function eisCanoniek(host: string, opties: { lokaalToegestaan: boolean }): string {
  const c = canoniekeFondsHost(host, opties);
  if (c === null || c !== host) throw new Error("Fondshost is niet canoniek.");
  return c;
}

/**
 * Eigen origin voor redirects, uitsluitend uit de CANONIEKE, tegen tenant_domains
 * geverifieerde fondshost. `req.url` is hier niet bruikbaar: achter een proxy of
 * bij `next start` draagt die de luisterhost (`localhost:3000`), niet de fondshost.
 * Productie: altijd `https://<host>` zonder poort; lokaal (met toestemming) http.
 */
export function origineVoorHost(host: string, opties: { lokaalToegestaan: boolean }): string {
  const c = eisCanoniek(host, opties);
  const [hostnaam] = c.split(":");
  const schema = opties.lokaalToegestaan && isLokaleTestHostnaam(hostnaam!) ? "http" : "https";
  return `${schema}://${c}`;
}

export function callbackUrlVoorHost(host: string, opties: { lokaalToegestaan: boolean }): string {
  return `${origineVoorHost(host, opties)}${MICROSOFT_LOGIN_CALLBACK_PAD}`;
}
