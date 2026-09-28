import "server-only";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { microsoftConfig } from "@/core/lib/microsoft-config";
import { ontsleutelMicrosoftGeheim, versleutelMicrosoftGeheim } from "@/core/lib/microsoft-crypto";
import { MicrosoftConnectorError } from "@/core/lib/microsoft-connector-error-core";
import * as vault from "@/core/lib/microsoft-vault";

type ConnectorContext = { fondsId: string; gebruikerId: string };
type GedelegeerdeScope = "Calendars.Read.Shared" | "Sites.Selected" | "Files.Read.All";

const aad = (fondsId: string, gebruikerId: string, soort: string) =>
  `m365:v1:${fondsId}:${gebruikerId}:${soort}`;

function client(fondsId: string) {
  const cfg = microsoftConfig(fondsId);
  return new ConfidentialClientApplication({
    auth: {
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
    },
  });
}

/**
 * Geeft een token voor precies één gedelegeerde Graph-scope terug. De helper
 * bewaart uitsluitend de vernieuwde MSAL-cache en geeft het token nooit aan de
 * browser of logging door. Ontbreekt de scope, dan faalt hij gesloten.
 */
export async function gedelegeerdToken(ctx: ConnectorContext, scope: GedelegeerdeScope) {
  const [verbinding, cache] = await Promise.all([
    vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId),
    vault.leesCache(ctx.fondsId, ctx.gebruikerId),
  ]);
  if (!verbinding || verbinding.status !== "gekoppeld" || !cache || !verbinding.scopes.includes(scope)) {
    throw new MicrosoftConnectorError("test_silent_token");
  }

  const msal = client(ctx.fondsId);
  msal.getTokenCache().deserialize(
    ontsleutelMicrosoftGeheim(cache, aad(ctx.fondsId, ctx.gebruikerId, "cache"))
  );
  const account = await msal.getTokenCache().getAccountByHomeId(verbinding.home_account_id);
  if (!account) throw new MicrosoftConnectorError("test_account_lookup");

  // OIDC-scopes horen bij de interactieve autorisatie. De stille Graph-call
  // vraagt bewust alleen om de ene gedelegeerde permissie die hij nodig heeft.
  const result = await msal.acquireTokenSilent({ account, scopes: [scope] });
  if (!result.accessToken) throw new MicrosoftConnectorError("test_silent_token");

  const bewaard = await vault.bewaarCache({
    fondsId: ctx.fondsId,
    gebruikerId: ctx.gebruikerId,
    expectedVersion: cache.versie,
    cache: versleutelMicrosoftGeheim(
      msal.getTokenCache().serialize(),
      aad(ctx.fondsId, ctx.gebruikerId, "cache")
    ),
  });
  if (!bewaard) throw new MicrosoftConnectorError("test_cache_save");

  return {
    accessToken: result.accessToken,
    tenantId: verbinding.tenant_id,
    objectId: verbinding.microsoft_object_id,
  };
}

export async function sharepointAccessToken(ctx: ConnectorContext) {
  return gedelegeerdToken(ctx, "Sites.Selected");
}
