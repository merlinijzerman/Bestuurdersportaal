// ============================================================================
//  monitoring-health-core.ts — PURE helpers van de healthcheck (P5).
// ----------------------------------------------------------------------------
//  Geen `server-only`, geen fetch, geen env: alleen string-/foutlogica die de
//  tenant-app-probe (monitoring-health.ts) gebruikt. Apart gehouden zodat ze
//  programmatisch toetsbaar is (monitoring-health.sanity.ts) — dezelfde splitsing
//  als monitoring-signalen.ts (puur) vs. monitoring-queries.ts (server).
// ============================================================================

/**
 * APP_HOST mag een komma-lijst zijn (bv. apex + www). Geeft de gesaneerde,
 * ontdubbelde hostnamen terug in volgorde. Saneren voorkomt de klassieke
 * misconfig waarbij een schema of pad in de env-var staat: `https://app.x/` →
 * `app.x`, zodat de probe (die zelf `https://` prependt) geen ongeldige URL bouwt
 * (die anders meteen zou gooien → het opake "onbereikbaar").
 */
export function parseHosts(waarde: string | undefined): string[] {
  if (!waarde) return [];
  const gezien = new Set<string>();
  const uit: string[] = [];
  for (const deel of waarde.split(",")) {
    const host = saneerHost(deel);
    if (host && !gezien.has(host)) {
      gezien.add(host);
      uit.push(host);
    }
  }
  return uit;
}

/** Strip schema, pad/query, trailing dot en witruimte van één hostwaarde. */
export function saneerHost(deel: string): string | null {
  const host = deel
    .trim()
    .replace(/^https?:\/\//i, "") // schema eraf — de probe zet zelf https:// ervoor
    .replace(/\/.*$/, "") // pad/query eraf
    .replace(/\.$/, "") // trailing dot (FQDN-punt)
    .trim();
  return host.length > 0 ? host : null;
}

/**
 * Vertaalt een gegooide fetch-fout naar een VASTE, dataloze reden uit een gesloten
 * verzameling — nooit de rauwe (externe) foutmelding (gesloten-catalogus-invariant,
 * zie de kop van monitoring-health.ts). Undici hangt de onderliggende oorzaak vaak
 * onder `.cause.code`.
 */
export function klassificeerNetwerkfout(e: unknown): string {
  const err = e as { name?: string; code?: string; cause?: { code?: string } };
  const code = err?.cause?.code ?? err?.code ?? "";
  const naam = err?.name ?? "";
  if (naam === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT")
    return "time-out";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns-fout";
  if (code === "ECONNREFUSED") return "verbinding geweigerd";
  if (code === "ECONNRESET") return "verbinding verbroken";
  if (code === "ERR_INVALID_URL") return "ongeldige host";
  if (
    code.startsWith("CERT_") ||
    code.includes("TLS") ||
    code.includes("SSL") ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  )
    return "tls-fout";
  return "onbereikbaar";
}
