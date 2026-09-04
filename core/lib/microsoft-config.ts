import "server-only";
export { veiligeMicrosoftReturnUrl } from "@/core/lib/microsoft-config-core";

export const MICROSOFT_SCOPES = ["openid", "profile", "offline_access", "User.Read"] as const;
/** Alleen na een bewuste fase-2A-actie toegevoegd; nooit bij fase-1-connect. */
export const MICROSOFT_OUTLOOK_SCOPES = [...MICROSOFT_SCOPES, "Calendars.Read.Shared"] as const;

export type MicrosoftConfig = { tenantId: string; clientId: string; clientSecret: string; callbackUrl: string };

export function microsoftConfig(): MicrosoftConfig {
  const tenantId = process.env.MICROSOFT_TENANT_ID?.trim();
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const callbackUrl = process.env.MICROSOFT_CALLBACK_URL?.trim();
  if (!tenantId || !clientId || !clientSecret || !callbackUrl) throw new Error("Microsoft-koppeling is niet geconfigureerd.");
  let url: URL;
  try { url = new URL(callbackUrl); } catch { throw new Error("Microsoft-callback-URL is ongeldig."); }
  if (url.protocol !== "https:" && !(process.env.NODE_ENV === "development" && url.protocol === "http:")) {
    throw new Error("Microsoft-callback-URL moet HTTPS gebruiken.");
  }
  return { tenantId, clientId, clientSecret, callbackUrl: url.toString() };
}
