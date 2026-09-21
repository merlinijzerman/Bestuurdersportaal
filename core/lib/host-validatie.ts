// Centrale, pure hostvalidatie voor surface-routing, tenantresolutie en
// Microsoft-login. Tenant-/app-/platformhosts blijven exact; uitsluitend de
// marketing-surface mag `www.` en apex canoniek samenvoegen.

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const POORT_RE = /^[1-9][0-9]{0,4}$/;

export class HostConfiguratieFout extends Error {
  constructor(naam: string, waarde: string) {
    super(`${naam} bevat een ongeldige hostwaarde: ${JSON.stringify(waarde)}.`);
    this.name = "HostConfiguratieFout";
  }
}

export function isLokaleTestHostnaam(hostnaam: string): boolean {
  return hostnaam === "localhost" || hostnaam === "127.0.0.1" || hostnaam.endsWith(".localhost");
}

/** Geen reparatie of trim: ieder afwijkend teken maakt de invoer ongeldig. */
export function normaliseerExacteHost(
  ruw: string | null | undefined,
  opties: { lokaalToegestaan: boolean }
): string | null {
  if (typeof ruw !== "string") return null;
  if (ruw !== ruw.trim() || ruw.length === 0 || /[\s@/\\?#\[\]]/.test(ruw)) return null;

  const laag = ruw.toLowerCase();
  const dubbelepunten = (laag.match(/:/g) ?? []).length;
  if (dubbelepunten > 1) return null;
  const [hostnaam, poort] = dubbelepunten === 1 ? laag.split(":") : [laag, undefined];
  if (!hostnaam || !HOSTNAME_RE.test(hostnaam)) return null;
  if (poort !== undefined) {
    if (
      !opties.lokaalToegestaan ||
      !isLokaleTestHostnaam(hostnaam) ||
      !POORT_RE.test(poort) ||
      Number(poort) > 65535
    ) return null;
    return `${hostnaam}:${poort}`;
  }
  return hostnaam;
}

export function normaliseerMarketingHost(
  ruw: string | null | undefined,
  opties: { lokaalToegestaan: boolean }
): string | null {
  const exact = normaliseerExacteHost(ruw, opties);
  if (!exact) return null;
  const scheiding = exact.lastIndexOf(":");
  const heeftLokalePoort = scheiding > -1;
  const hostnaam = heeftLokalePoort ? exact.slice(0, scheiding) : exact;
  const poort = heeftLokalePoort ? exact.slice(scheiding) : "";
  return `${hostnaam.startsWith("www.") ? hostnaam.slice(4) : hostnaam}${poort}`;
}

export function leesHostConfiguratie(args: {
  naam: string;
  waarde: string | null | undefined;
  type: "exact" | "marketing";
  lokaalToegestaan: boolean;
}): Set<string> {
  if (args.waarde === null || args.waarde === undefined) return new Set();
  const normaliseer = args.type === "marketing" ? normaliseerMarketingHost : normaliseerExacteHost;
  const resultaat = new Set<string>();
  for (const deel of args.waarde.split(",")) {
    const host = normaliseer(deel, { lokaalToegestaan: args.lokaalToegestaan });
    if (!host) throw new HostConfiguratieFout(args.naam, deel);
    resultaat.add(host);
  }
  return resultaat;
}

export function lokaleHostmodus(args: {
  nodeEnv?: string;
  seedDoelomgeving?: string;
}): boolean {
  return args.nodeEnv !== "production" && args.seedDoelomgeving === "local";
}
