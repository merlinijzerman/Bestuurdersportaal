import { normaliseerExacteHost } from "./host-validatie";

export const APP365_DEMO_HOSTS = new Set([
  "app365.preview.bestuurdersportaal.com",
  "app365.bestuurdersportaal.com",
]);

/** De markering volgt de exacte requesthost, nooit een deployment- of fondsflag. */
export function isApp365DemoHost(host: string | null | undefined): boolean {
  const canoniek = normaliseerExacteHost(host, { lokaalToegestaan: false });
  return canoniek !== null && APP365_DEMO_HOSTS.has(canoniek);
}
