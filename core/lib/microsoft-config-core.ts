export function veiligeMicrosoftReturnUrl(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/profiel";
  return value;
}

export type MicrosoftConfigWaarden = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

type MicrosoftOmgeving = Record<string, string | undefined>;

function verplichteWaarde(omgeving: MicrosoftOmgeving, naam: string): string {
  const waarde = omgeving[naam]?.trim();
  if (!waarde) throw new Error(`Microsoft-koppeling mist configuratie ${naam}.`);
  return waarde;
}

function leesConfiguratie(omgeving: MicrosoftOmgeving, prefix: "MICROSOFT_" | "MICROSOFT_APP365_"): MicrosoftConfigWaarden {
  const tenantId = verplichteWaarde(omgeving, `${prefix}TENANT_ID`);
  const clientId = verplichteWaarde(omgeving, `${prefix}CLIENT_ID`);
  const clientSecret = verplichteWaarde(omgeving, `${prefix}CLIENT_SECRET`);
  const callbackUrl = verplichteWaarde(omgeving, `${prefix}CALLBACK_URL`);
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error("Microsoft-callback-URL is ongeldig.");
  }
  if (url.protocol !== "https:" && !(omgeving.NODE_ENV === "development" && url.protocol === "http:")) {
    throw new Error("Microsoft-callback-URL moet HTTPS gebruiken.");
  }
  return { tenantId, clientId, clientSecret, callbackUrl: url.toString() };
}

/**
 * Selecteert de Entra-configuratie op een serververtrouwde fonds-id. De
 * App365-set valt nooit terug op de bestaande PGB-configuratie: een gedeeltelijk
 * ingestelde App365-set faalt gesloten voordat een OAuth-transactie ontstaat.
 */
export function microsoftConfigVoorFonds(
  omgeving: MicrosoftOmgeving,
  fondsId: string | undefined,
): MicrosoftConfigWaarden {
  const app365FondsId = omgeving.MICROSOFT_APP365_FONDS_ID?.trim();
  if (app365FondsId && fondsId === app365FondsId) {
    return leesConfiguratie(omgeving, "MICROSOFT_APP365_");
  }
  return leesConfiguratie(omgeving, "MICROSOFT_");
}
