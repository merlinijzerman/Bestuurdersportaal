import "server-only";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { createHash, randomBytes } from "node:crypto";
import { microsoftConfig, MICROSOFT_SCOPES } from "@/core/lib/microsoft-config";
import { ontsleutelMicrosoftGeheim, versleutelMicrosoftGeheim, type VersleuteldBlob } from "@/core/lib/microsoft-crypto";
import { microsoftIdentiteitGeldig } from "@/core/lib/microsoft-identity-core";
import {
  MicrosoftConnectorError,
  type MicrosoftKoppelFoutcategorie,
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

function client() {
  const cfg = microsoftConfig();
  return new ConfidentialClientApplication({ auth: { clientId: cfg.clientId, clientSecret: cfg.clientSecret, authority: `https://login.microsoftonline.com/${cfg.tenantId}` } });
}
export async function microsoftPilotActief(supabase: { from: (table: string) => any }, fondsId: string): Promise<boolean> {
  const { data } = await supabase.from("fonds_integratie_profielen").select("integratieprofiel, microsoft_koppeling_pilot").eq("fonds_id", fondsId).maybeSingle();
  return data?.integratieprofiel === "eigen" && data?.microsoft_koppeling_pilot === true;
}
export async function startKoppeling(ctx: ConnectorContext, returnTo: string) {
  const state = b64url(32), nonce = b64url(32), verifier = b64url(64);
  const cfg = microsoftConfig();
  await vault.maakOAuthTransactie({ state, fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, expiresAt: new Date(Date.now() + 10 * 60_000), blob: versleutelMicrosoftGeheim(JSON.stringify({ nonce, verifier, returnTo }), aad(ctx.fondsId, ctx.gebruikerId, "oauth")) });
  return client().getAuthCodeUrl({ scopes: [...MICROSOFT_SCOPES], redirectUri: cfg.callbackUrl, state, nonce, codeChallenge: challenge(verifier), codeChallengeMethod: "S256" });
}
function mask(username: string | undefined) { if (!username) return null; const [left, right] = username.split("@"); return `${left.slice(0, 1)}***${right ? `@${right}` : ""}`; }
export async function voltooiKoppeling(args: ConnectorContext & { state: string; code: string }) {
  const tx = await koppelStap("oauth_transactie", () => vault.consumeerOAuthTransactie(args.state));
  if (!tx || tx.fonds_id !== args.fondsId || tx.gebruiker_id !== args.gebruikerId) {
    throw new MicrosoftConnectorError("oauth_transactie");
  }
  const geheim = koppelStapSync("oauth_decryptie", () => {
    const waarde = JSON.parse(ontsleutelMicrosoftGeheim({ sleutelVersie: tx.sleutel_versie, iv: tx.iv, tag: tx.tag, ciphertext: tx.ciphertext }, aad(args.fondsId, args.gebruikerId, "oauth"))) as Record<string, unknown>;
    if (typeof waarde.nonce !== "string" || typeof waarde.verifier !== "string" || typeof waarde.returnTo !== "string") {
      throw new Error("OAuth-transactie is onvolledig.");
    }
    return { nonce: waarde.nonce, verifier: waarde.verifier, returnTo: waarde.returnTo };
  });
  const cfg = microsoftConfig();
  const msal = client();
  const result = await koppelStap("token_exchange", () => msal.acquireTokenByCode({
    code: args.code,
    scopes: [...MICROSOFT_SCOPES],
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
  await koppelStap("vault_save", () => vault.bewaarKoppeling({ fonds_id: args.fondsId, gebruiker_id: args.gebruikerId, tenant_id: cfg.tenantId, microsoft_object_id: profiel.id!, home_account_id: result.account!.homeAccountId, display_name: profiel.displayName?.slice(0, 160) ?? null, masked_username: mask(profiel.userPrincipalName), scopes: [...MICROSOFT_SCOPES], cache: versleutelMicrosoftGeheim(msal.getTokenCache().serialize(), aad(args.fondsId,args.gebruikerId,"cache")) }));
  return geheim.returnTo;
}
export async function testKoppeling(ctx: ConnectorContext) {
  const verbinding = await vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId);
  const cache = await vault.leesCache(ctx.fondsId, ctx.gebruikerId);
  if (!verbinding || verbinding.status !== "gekoppeld" || !cache) throw new Error("Er is geen actieve Microsoft-koppeling.");
  const msal = client();
  try {
    msal.getTokenCache().deserialize(ontsleutelMicrosoftGeheim(cache, aad(ctx.fondsId,ctx.gebruikerId,"cache")));
    const account = await msal.getTokenCache().getAccountByHomeId(verbinding.home_account_id);
    if (!account) throw new Error("Microsoft-sessie is verlopen.");
    const result = await msal.acquireTokenSilent({ account, scopes: ["User.Read"] });
    const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=id", { headers: { Authorization: `Bearer ${result.accessToken}` }, cache: "no-store" });
    if (!me.ok) throw new Error("Microsoft-verbinding kon niet worden getest.");
    if (!(await vault.bewaarCache({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, expectedVersion: cache.versie, cache: versleutelMicrosoftGeheim(msal.getTokenCache().serialize(), aad(ctx.fondsId,ctx.gebruikerId,"cache")) }))) throw new Error("Microsoft-sessie wijzigde gelijktijdig; probeer opnieuw.");
    await vault.markeerTest(ctx.fondsId, ctx.gebruikerId, true, null);
  } catch (error) {
    await vault.markeerTest(ctx.fondsId, ctx.gebruikerId, false, "token_of_graph_fout");
    throw error;
  }
}
export async function statusKoppeling(ctx: ConnectorContext) { return vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId); }
export async function registreerKoppelfout(ctx: ConnectorContext, categorie: MicrosoftKoppelFoutcategorie) { await vault.registreerKoppelfout(ctx.fondsId, ctx.gebruikerId, categorie); }
export async function ontkoppelKoppeling(ctx: ConnectorContext) { await vault.ontkoppel(ctx.fondsId, ctx.gebruikerId); }
