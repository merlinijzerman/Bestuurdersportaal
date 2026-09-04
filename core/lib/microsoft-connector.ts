import "server-only";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { createHash, randomBytes } from "node:crypto";
import { microsoftConfig, MICROSOFT_OUTLOOK_SCOPES, MICROSOFT_SCOPES } from "@/core/lib/microsoft-config";
import { ontsleutelMicrosoftGeheim, versleutelMicrosoftGeheim, type VersleuteldBlob } from "@/core/lib/microsoft-crypto";
import { microsoftIdentiteitGeldig } from "@/core/lib/microsoft-identity-core";
import {
  MicrosoftConnectorError,
  type MicrosoftKoppelFoutcategorie,
  type MicrosoftTestFoutcategorie,
  microsoftTestFoutcategorie,
} from "@/core/lib/microsoft-connector-error-core";
import * as vault from "@/core/lib/microsoft-vault";

export type ConnectorContext = { fondsId: string; gebruikerId: string };
const aad = (fondsId: string, gebruikerId: string, soort: string) => `m365:v1:${fondsId}:${gebruikerId}:${soort}`;
const b64url = (bytes: number) => randomBytes(bytes).toString("base64url");
const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

async function koppelStap<T>(categorie: MicrosoftKoppelFoutcategorie, actie: () => Promise<T>): Promise<T> {
  try {
    return await actie();
  } catch (fout) {
    if (fout instanceof MicrosoftConnectorError) throw fout;
    throw new MicrosoftConnectorError(categorie, fout);
  }
}

function koppelStapSync<T>(categorie: MicrosoftKoppelFoutcategorie, actie: () => T): T {
  try {
    return actie();
  } catch (fout) {
    if (fout instanceof MicrosoftConnectorError) throw fout;
    throw new MicrosoftConnectorError(categorie, fout);
  }
}

async function testStap<T>(categorie: MicrosoftTestFoutcategorie, actie: () => Promise<T>): Promise<T> {
  try {
    return await actie();
  } catch (fout) {
    if (fout instanceof MicrosoftConnectorError) throw fout;
    throw new MicrosoftConnectorError(categorie, fout);
  }
}

function testStapSync<T>(categorie: MicrosoftTestFoutcategorie, actie: () => T): T {
  try {
    return actie();
  } catch (fout) {
    if (fout instanceof MicrosoftConnectorError) throw fout;
    throw new MicrosoftConnectorError(categorie, fout);
  }
}

function client() {
  const cfg = microsoftConfig();
  return new ConfidentialClientApplication({ auth: { clientId: cfg.clientId, clientSecret: cfg.clientSecret, authority: `https://login.microsoftonline.com/${cfg.tenantId}` } });
}
export async function microsoftPilotActief(supabase: { from: (table: string) => any }, fondsId: string): Promise<boolean> {
  const { data } = await supabase.from("fonds_integratie_profielen").select("integratieprofiel, microsoft_koppeling_pilot").eq("fonds_id", fondsId).maybeSingle();
  return data?.integratieprofiel === "eigen" && data?.microsoft_koppeling_pilot === true;
}
export async function microsoftOutlookActief(supabase: { from: (table: string) => any }, fondsId: string): Promise<boolean> {
  const [{ data: profiel }, { data: vlag }] = await Promise.all([
    supabase.from("fonds_integratie_profielen").select("integratieprofiel, microsoft_koppeling_pilot").eq("fonds_id", fondsId).maybeSingle(),
    supabase.from("fonds_feature_flags").select("waarde").eq("fonds_id", fondsId).eq("flag_key", "microsoft_outlook_fase2a").maybeSingle(),
  ]);
  return profiel?.integratieprofiel === "microsoft" && profiel?.microsoft_koppeling_pilot === true && vlag?.waarde === true;
}
export async function startKoppeling(ctx: ConnectorContext, returnTo: string, scopes: readonly string[] = MICROSOFT_SCOPES) {
  const state = b64url(32), nonce = b64url(32), verifier = b64url(64);
  const cfg = microsoftConfig();
  await vault.maakOAuthTransactie({ state, fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, expiresAt: new Date(Date.now() + 10 * 60_000), blob: versleutelMicrosoftGeheim(JSON.stringify({ nonce, verifier, returnTo, scopes }), aad(ctx.fondsId, ctx.gebruikerId, "oauth")) });
  return client().getAuthCodeUrl({ scopes: [...scopes], redirectUri: cfg.callbackUrl, state, nonce, codeChallenge: challenge(verifier), codeChallengeMethod: "S256" });
}
export function startOutlookToestemming(ctx: ConnectorContext, returnTo: string) { return startKoppeling(ctx, returnTo, MICROSOFT_OUTLOOK_SCOPES); }
function mask(username: string | undefined) { if (!username) return null; const [left, right] = username.split("@"); return `${left.slice(0, 1)}***${right ? `@${right}` : ""}`; }
export async function voltooiKoppeling(args: ConnectorContext & { state: string; code: string }) {
  const tx = await koppelStap("oauth_transactie", () => vault.consumeerOAuthTransactie(args.state));
  if (!tx || tx.fonds_id !== args.fondsId || tx.gebruiker_id !== args.gebruikerId) {
    throw new MicrosoftConnectorError("oauth_transactie");
  }
  const geheim = koppelStapSync("oauth_decryptie", () => {
    const waarde = JSON.parse(ontsleutelMicrosoftGeheim({ sleutelVersie: tx.sleutel_versie, iv: tx.iv, tag: tx.tag, ciphertext: tx.ciphertext }, aad(args.fondsId, args.gebruikerId, "oauth"))) as Record<string, unknown>;
    if (typeof waarde.nonce !== "string" || typeof waarde.verifier !== "string" || typeof waarde.returnTo !== "string" || !Array.isArray(waarde.scopes) || !waarde.scopes.every((scope) => typeof scope === "string")) {
      throw new Error("OAuth-transactie is onvolledig.");
    }
    return { nonce: waarde.nonce, verifier: waarde.verifier, returnTo: waarde.returnTo, scopes: waarde.scopes as string[] };
  });
  const cfg = microsoftConfig();
  const msal = client();
  const result = await koppelStap("token_exchange", () => msal.acquireTokenByCode({
    code: args.code,
    scopes: geheim.scopes,
    redirectUri: cfg.callbackUrl,
    codeVerifier: geheim.verifier,
    nonce: geheim.nonce,
  }));
  const claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;
  if (!microsoftIdentiteitGeldig(claims, { tenantId: cfg.tenantId, clientId: cfg.clientId, nonce: geheim.nonce, homeAccountId: result.account?.homeAccountId })) {
    throw new MicrosoftConnectorError("identity_validation");
  }
  const profiel = await koppelStap("graph_me", async () => {
    const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName", { headers: { Authorization: `Bearer ${result.accessToken}`, Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("Graph /me gaf geen succesvolle status.");
    const waarde = await response.json() as { id?: string; displayName?: string; userPrincipalName?: string };
    if (!waarde.id) throw new Error("Graph /me-profiel is onvolledig.");
    return waarde;
  });
  await koppelStap("vault_save", () => vault.bewaarKoppeling({ fonds_id: args.fondsId, gebruiker_id: args.gebruikerId, tenant_id: cfg.tenantId, microsoft_object_id: profiel.id!, home_account_id: result.account!.homeAccountId, display_name: profiel.displayName?.slice(0, 160) ?? null, masked_username: mask(profiel.userPrincipalName), scopes: geheim.scopes, cache: versleutelMicrosoftGeheim(msal.getTokenCache().serialize(), aad(args.fondsId,args.gebruikerId,"cache")) }));
  return geheim.returnTo;
}
export async function testKoppeling(ctx: ConnectorContext) {
  try {
    const { verbinding, cache } = await testStap("test_cache_read", async () => ({
      verbinding: await vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId),
      cache: await vault.leesCache(ctx.fondsId, ctx.gebruikerId),
    }));
    if (!verbinding || verbinding.status !== "gekoppeld" || !cache) throw new MicrosoftConnectorError("test_cache_read");
    const msal = client();
    testStapSync("test_cache_decryptie", () => msal.getTokenCache().deserialize(ontsleutelMicrosoftGeheim(cache, aad(ctx.fondsId,ctx.gebruikerId,"cache"))));
    const account = await testStap("test_account_lookup", () => msal.getTokenCache().getAccountByHomeId(verbinding.home_account_id));
    if (!account) throw new MicrosoftConnectorError("test_account_lookup");
    const result = await testStap("test_silent_token", () => msal.acquireTokenSilent({ account, scopes: ["User.Read"] }));
    await testStap("test_graph_me", async () => {
      const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id", { headers: { Authorization: `Bearer ${result.accessToken}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Graph /me gaf geen succesvolle status.");
    });
    await testStap("test_cache_save", async () => {
      const bewaard = await vault.bewaarCache({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, expectedVersion: cache.versie, cache: versleutelMicrosoftGeheim(msal.getTokenCache().serialize(), aad(ctx.fondsId,ctx.gebruikerId,"cache")) });
      if (!bewaard) throw new Error("Microsoft-cache wijzigde gelijktijdig.");
    });
    await testStap("test_status_save", () => vault.markeerTest(ctx.fondsId, ctx.gebruikerId, true, null));
  } catch (fout) {
    const categorie = microsoftTestFoutcategorie(fout);
    console.error(`[MICROSOFT] Verbindingstest mislukt: ${categorie}`);
    await vault.markeerTest(ctx.fondsId, ctx.gebruikerId, false, categorie).catch(() => undefined);
    throw fout;
  }
}
export async function statusKoppeling(ctx: ConnectorContext) { return vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId); }
export async function registreerKoppelfout(ctx: ConnectorContext, categorie: MicrosoftKoppelFoutcategorie) { await vault.registreerKoppelfout(ctx.fondsId, ctx.gebruikerId, categorie); }
export async function ontkoppelKoppeling(ctx: ConnectorContext) { await vault.ontkoppel(ctx.fondsId, ctx.gebruikerId); }

/** Geeft een gedelegeerd token terug en bewaart alleen de vernieuwde MSAL-cache.
 * De route geeft het token nooit door aan de browser of aan logging. */
export async function outlookAccessToken(ctx: ConnectorContext) {
  const [verbinding, cache] = await Promise.all([vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId), vault.leesCache(ctx.fondsId, ctx.gebruikerId)]);
  if (!verbinding || verbinding.status !== "gekoppeld" || !cache || !verbinding.scopes.includes("Calendars.Read.Shared")) throw new MicrosoftConnectorError("test_silent_token");
  const msal = client();
  msal.getTokenCache().deserialize(ontsleutelMicrosoftGeheim(cache, aad(ctx.fondsId, ctx.gebruikerId, "cache")));
  const account = await msal.getTokenCache().getAccountByHomeId(verbinding.home_account_id);
  if (!account) throw new MicrosoftConnectorError("test_account_lookup");
  // OIDC scopes belong to the interactive authorization flow; the silent Graph
  // request intentionally asks only for the delegated calendar permission.
  const result = await msal.acquireTokenSilent({ account, scopes: ["Calendars.Read.Shared"] });
  if (!result.accessToken) throw new MicrosoftConnectorError("test_silent_token");
  const bewaard = await vault.bewaarCache({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, expectedVersion: cache.versie, cache: versleutelMicrosoftGeheim(msal.getTokenCache().serialize(), aad(ctx.fondsId,ctx.gebruikerId,"cache")) });
  if (!bewaard) throw new MicrosoftConnectorError("test_cache_save");
  return { accessToken: result.accessToken, tenantId: verbinding.tenant_id, mailboxId: verbinding.microsoft_object_id };
}
