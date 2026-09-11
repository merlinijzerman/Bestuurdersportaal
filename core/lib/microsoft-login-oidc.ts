// ============================================================================
//  core/lib/microsoft-login-oidc.ts — server-only OIDC-I/O voor de login-flow.
//  Alleen discovery, JWKS en de code-uitwisseling; uitsluitend naar URL's op de
//  authority-oorsprong (de kern toetst dat vóór de aanroep; hier nog eens hard).
//  Geen tokencache, geen refresh, geen Graph, geen MSAL. Responsinhoud gaat
//  nooit naar logs.
// ============================================================================
import "server-only";
import { isToegestaneEndpointUrl } from "@/core/lib/microsoft-login-oidc-core";
import type { OidcClient } from "@/core/lib/microsoft-login-orkestratie-core";

const TIMEOUT_MS = 8_000;

async function haalJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: controller.signal });
    if (!res.ok) throw new Error(`OIDC-endpoint gaf status ${res.status}.`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export function maakOidcClient(authority: string): OidcClient {
  const eis = (url: string) => {
    if (!isToegestaneEndpointUrl(url, authority)) throw new Error("OIDC-endpoint ligt niet op de authority.");
  };
  return {
    async discovery(url) {
      eis(url);
      return haalJson(url, { method: "GET", headers: { accept: "application/json" } });
    },
    async jwks(url) {
      eis(url);
      return haalJson(url, { method: "GET", headers: { accept: "application/json" } });
    },
    async wisselCode(tokenEndpoint, body) {
      eis(tokenEndpoint);
      return haalJson(tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body,
      });
    },
  };
}
