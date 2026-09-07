// ============================================================================
//  core/lib/microsoft-login-orkestratie-core.ts — de login-/koppelflow (fase 1B,
//  #335 T2; ontwerp §3.4–§3.6, besluit 0211). PUUR: alle I/O geïnjecteerd.
// ----------------------------------------------------------------------------
//  Productie wiret dit in core/lib/microsoft-login.ts (server-only) met de T1-
//  gateway, de OIDC-client en de Supabase-serverclient. De sanity-suite draait
//  dezelfde flow met mocks — zo zijn de fail-closed volgordes toetsbaar zonder
//  Entra, GoTrue of database.
//
//  Invarianten die hier hard staan (ontwerp §6):
//    • inloggen: GEEN signInWithIdToken zonder `active` binding (zoekIdentiteit);
//    • koppelen: reserveer (pending) → linkIdentity → verifieer → activeer;
//      faalt link, dan bestaat er door de GoTrue-transactie geen identiteit en
//      wordt de reservering `failed`;
//    • na elke Supabase-sessie-uitgifte: user.id, provider_id === sub, profiel in
//      het host-fonds — anders signOut en weigeren;
//    • foutpaden geven een MicrosoftLoginError met categorie; de audit krijgt
//      alleen categorie + sha256(tid:oid) + correlatie; nooit tokens/claims/e-mail.
// ============================================================================

import { identiteitHash, type BindingStatus } from "@/core/lib/microsoft-login-binding-core";
import { loginAad, ontsleutelLoginGeheim, versleutelLoginGeheim, type LoginSleutel, type LoginVersleuteldBlob } from "@/core/lib/microsoft-login-crypto-core";
import { MicrosoftLoginError, microsoftLoginFoutcategorie, type MicrosoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";
import {
  callbackUrlVoorHost,
  codeChallenge,
  maakFlowGeheimen,
  nonceHash,
  parseTransactieGeheim,
  serialiseerTransactieGeheim,
  stateHash,
  TRANSACTIE_GELDIGHEID_MS,
  type FlowIntent,
} from "@/core/lib/microsoft-login-flow-core";
import { valideerIdToken, type MicrosoftLoginIdentiteit } from "@/core/lib/microsoft-login-identity-core";
import {
  beoordeelDiscovery,
  beoordeelTokenResponse,
  bouwAuthorizeUrl,
  bouwTokenRequestBody,
  decodeJwt,
  discoveryUrl,
  kiesJwk,
  verifieerRs256,
  verwachteIssuer,
  type DiscoveryDocument,
  type TokenResponseAfwijsreden,
} from "@/core/lib/microsoft-login-oidc-core";

// ── Geïnjecteerde afhankelijkheden ──────────────────────────────────────────

/** Exact de T1-gateway (core/lib/microsoft-login-gateway.ts), als interface. */
export type LoginGateway = {
  microsoftLoginActief(fondsId: string): Promise<{ actief: true; entraTenantId: string } | { actief: false }>;
  reserveerIdentiteit(args: { fondsId: string; userId: string; identiteit: MicrosoftLoginIdentiteit; correlatieId: string }): Promise<string>;
  activeerIdentiteit(args: { bindingId: string; userId: string; sub: string }): Promise<void>;
  herstelKoppeling(args: { bindingId: string; userId: string; sub: string }): Promise<void>;
  markeerMislukt(args: { bindingId: string; userId: string; categorie: string }): Promise<void>;
  startIntrekking(args: { fondsId: string; userId: string; doorUserId: string; correlatieId: string }): Promise<string>;
  voltooiIntrekking(args: { bindingId: string; userId: string; correlatieId: string }): Promise<void>;
  zoekIdentiteit(identiteit: { tid: string; oid: string }): Promise<{ id: string; userId: string; fondsId: string } | null>;
  levendeBinding(userId: string): Promise<{ id: string; fondsId: string; status: BindingStatus; pendingVerlooptOp: Date | null; geactiveerdOp: Date | null; laatstGebruiktOp: Date | null } | null>;
  markeerGebruikt(bindingId: string): Promise<void>;
  maakTransactie(args: { stateHash: string; fondsId: string; userId: string | null; intent: FlowIntent; verlooptOp: Date; blob: { sleutelVersie: number; iv: string; tag: string; ciphertext: string; aad: string } }): Promise<void>;
  consumeerTransactie(stateHash: string): Promise<{ fondsId: string; userId: string | null; intent: FlowIntent; blob: { sleutelVersie: number; iv: string; tag: string; ciphertext: string; aad: string } } | null>;
  registreerGebeurtenis(args: { fondsId: string; userId: string | null; gebeurtenis: string; foutcategorie?: string | null; identiteitHash?: string | null; correlatieId: string }): Promise<void>;
};

/** OIDC-I/O (server-only implementatie in microsoft-login-oidc.ts). */
export type OidcClient = {
  discovery(url: string): Promise<unknown>;
  jwks(url: string): Promise<unknown>;
  wisselCode(tokenEndpoint: string, body: string): Promise<unknown>;
};

/** Supabase-auth-adapter rond de serverclient van het huidige request. */
export type SupabaseIdentiteit = { provider: string; providerId: string };
export type AuthAdapter = {
  huidigeGebruiker(): Promise<{ id: string; identities: SupabaseIdentiteit[] } | null>;
  signInWithIdToken(args: { token: string; nonce: string }): Promise<{ user: { id: string; identities: SupabaseIdentiteit[] } } | { fout: "hook_geweigerd" | "auth_fout" }>;
  linkIdentity(args: { token: string; nonce: string }): Promise<{ user: { id: string; identities: SupabaseIdentiteit[] } } | { fout: "hook_geweigerd" | "auth_fout" }>;
  unlinkAzure(): Promise<boolean>;
  signOut(scope: "local" | "global"): Promise<void>;
  /** Fonds van het profiel van de INGELOGDE gebruiker (RLS), of null. */
  profielFondsId(userId: string): Promise<string | null>;
};

export type LoginConfig = {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly sleutel: LoginSleutel;
  readonly authority: string;
  readonly lokaalToegestaan: boolean;
};

export type OrkestratieDeps = {
  gateway: LoginGateway;
  oidc: OidcClient;
  auth: AuthAdapter;
  config: () => LoginConfig;
  nu?: () => Date;
  correlatieId?: () => string;
  random?: (n: number) => Buffer;
  /** Alleen categorie + fase; nooit inhoud. */
  log?: (regel: string) => void;
};

// ── Resultaattypen ──────────────────────────────────────────────────────────

export type StartResultaat = { url: string; correlatieId: string };

export type CallbackResultaat =
  | { intent: "inloggen"; next: string; correlatieId: string }
  | { intent: "koppelen"; correlatieId: string };

export type KoppelStatus =
  | { status: "geen" }
  | { status: "pending"; herstelMogelijk: boolean; pendingVerlooptOp: Date | null }
  | { status: "active"; geactiveerdOp: Date | null; laatstGebruiktOp: Date | null }
  | { status: "revoking" };

/** Fout met categorie én de (audit)context die de route nodig heeft voor de redirect. */
export class MicrosoftLoginFlowFout extends MicrosoftLoginError {
  readonly intent: FlowIntent | null;
  readonly correlatieId: string;
  readonly diagnostiek: TokenResponseAfwijsreden | null;
  constructor(
    categorie: MicrosoftLoginFoutcategorie,
    ctx: { intent: FlowIntent | null; correlatieId: string; diagnostiek?: TokenResponseAfwijsreden | null },
    oorzaak?: unknown,
  ) {
    super(categorie, oorzaak);
    this.name = "MicrosoftLoginFlowFout";
    this.intent = ctx.intent;
    this.correlatieId = ctx.correlatieId;
    this.diagnostiek = ctx.diagnostiek ?? null;
  }
}

// ── Fabriek ─────────────────────────────────────────────────────────────────

export function maakMicrosoftLogin(deps: OrkestratieDeps) {
  const nu = deps.nu ?? (() => new Date());
  const correlatie = deps.correlatieId ?? (() => crypto.randomUUID());
  const log = deps.log ?? (() => {});

  async function audit(args: { fondsId: string; userId: string | null; gebeurtenis: string; categorie?: MicrosoftLoginFoutcategorie | null; identiteit?: { tid: string; oid: string } | null; correlatieId: string }) {
    try {
      await deps.gateway.registreerGebeurtenis({
        fondsId: args.fondsId,
        userId: args.userId,
        gebeurtenis: args.gebeurtenis,
        foutcategorie: args.categorie ?? null,
        identiteitHash: args.identiteit ? identiteitHash(args.identiteit.tid, args.identiteit.oid) : null,
        correlatieId: args.correlatieId,
      });
    } catch {
      // Audit is best-effort NA de beslissing; de beslissing zelf is al genomen.
      log(`[MICROSOFT-LOGIN] audit niet weggeschreven: ${args.gebeurtenis}`);
    }
  }

  async function discovery(cfg: LoginConfig): Promise<DiscoveryDocument> {
    let json: unknown;
    try {
      json = await deps.oidc.discovery(discoveryUrl(cfg.authority, cfg.tenantId));
    } catch (e) {
      throw new MicrosoftLoginError("discovery_fout", e);
    }
    const oordeel = beoordeelDiscovery(json, { authority: cfg.authority, tenantId: cfg.tenantId });
    if (!oordeel.ok) throw new MicrosoftLoginError("discovery_fout");
    return oordeel.document;
  }

  /**
   * Start (inloggen of koppelen): maakt geheimen, bewaart de versleutelde
   * transactie server-side en geeft de authorize-URL terug. Fail-closed: geen
   * config of flag uit → fout vóór er iets wordt opgeslagen.
   */
  async function start(args: { intent: FlowIntent; hostFondsId: string; host: string; userId: string | null; next: string }): Promise<StartResultaat> {
    const correlatieId = correlatie();
    const cfg = deps.config();
    const actief = await deps.gateway.microsoftLoginActief(args.hostFondsId);
    if (!actief.actief) throw new MicrosoftLoginFlowFout("login_uit", { intent: args.intent, correlatieId });
    if (actief.entraTenantId.toLowerCase() !== cfg.tenantId.toLowerCase()) {
      throw new MicrosoftLoginFlowFout("tenant_mismatch", { intent: args.intent, correlatieId });
    }
    if (args.intent === "koppelen" && !args.userId) throw new MicrosoftLoginFlowFout("sessie_mismatch", { intent: args.intent, correlatieId });

    const doc = await discovery(cfg);
    const g = maakFlowGeheimen(deps.random);
    const redirectUri = callbackUrlVoorHost(args.host, { lokaalToegestaan: cfg.lokaalToegestaan });
    const geheim = serialiseerTransactieGeheim({ nonce: g.nonce, verifier: g.verifier, next: args.next, host: args.host, redirectUri });
    const aad = loginAad({ fondsId: args.hostFondsId, userId: args.intent === "koppelen" ? args.userId : null, intent: args.intent });
    const blob = versleutelLoginGeheim(geheim, aad, cfg.sleutel);
    await deps.gateway.maakTransactie({
      stateHash: stateHash(g.state),
      fondsId: args.hostFondsId,
      userId: args.intent === "koppelen" ? args.userId : null,
      intent: args.intent,
      verlooptOp: new Date(nu().getTime() + TRANSACTIE_GELDIGHEID_MS),
      blob: { ...blob, aad },
    });
    await audit({ fondsId: args.hostFondsId, userId: args.intent === "koppelen" ? args.userId : null, gebeurtenis: `${args.intent}.gestart`, correlatieId });
    return {
      url: bouwAuthorizeUrl({
        authorizationEndpoint: doc.authorization_endpoint,
        clientId: cfg.clientId,
        redirectUri,
        state: g.state,
        nonceHash: nonceHash(g.nonce),
        codeChallenge: codeChallenge(g.verifier),
      }),
      correlatieId,
    };
  }

  /** Gemeenschappelijk callbackdeel: transactie → token → handtekening → claims. */
  async function verwerkCode(args: { host: string; hostFondsId: string; code: string | null; state: string | null; error: string | null }) {
    const correlatieId = correlatie();
    const cfg = deps.config();
    if (!args.state) throw new MicrosoftLoginFlowFout("transactie_ongeldig", { intent: null, correlatieId });

    const tx = await deps.gateway.consumeerTransactie(stateHash(args.state));
    if (!tx) throw new MicrosoftLoginFlowFout("transactie_ongeldig", { intent: null, correlatieId });
    const ctx = { intent: tx.intent, correlatieId };
    const faal = (categorie: MicrosoftLoginFoutcategorie, oorzaak?: unknown) =>
      new MicrosoftLoginFlowFout(categorie, ctx, oorzaak);

    if (tx.fondsId !== args.hostFondsId) throw faal("host_mismatch");
    if (args.error) throw faal("geweigerd_door_gebruiker");
    if (!args.code) throw faal("transactie_ongeldig");

    let geheim;
    try {
      const aad = loginAad({ fondsId: tx.fondsId, userId: tx.intent === "koppelen" ? tx.userId : null, intent: tx.intent });
      if (aad !== tx.blob.aad) throw new Error("aad");
      const b: LoginVersleuteldBlob = { sleutelVersie: tx.blob.sleutelVersie, iv: tx.blob.iv, tag: tx.blob.tag, ciphertext: tx.blob.ciphertext };
      geheim = parseTransactieGeheim(ontsleutelLoginGeheim(b, aad, cfg.sleutel));
    } catch (e) {
      throw faal("transactie_ongeldig", e);
    }
    if (!geheim) throw faal("transactie_ongeldig");
    if (geheim.host !== args.host) throw faal("host_mismatch");

    const doc = await discovery(cfg).catch((e: unknown) => {
      throw faal(microsoftLoginFoutcategorie(e), e);
    });

    let tokenJson: unknown;
    try {
      tokenJson = await deps.oidc.wisselCode(
        doc.token_endpoint,
        bouwTokenRequestBody({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, code: args.code, redirectUri: geheim.redirectUri, codeVerifier: geheim.verifier }),
      );
    } catch (e) {
      throw faal("token_exchange", e);
    }
    const tokenOordeel = beoordeelTokenResponse(tokenJson);
    if (!tokenOordeel.ok) {
      throw new MicrosoftLoginFlowFout(tokenOordeel.categorie, { ...ctx, diagnostiek: tokenOordeel.reden });
    }

    const delen = decodeJwt(tokenOordeel.idToken);
    if (!delen) throw faal("handtekening_ongeldig");
    let jwks: unknown;
    try {
      jwks = await deps.oidc.jwks(doc.jwks_uri);
    } catch (e) {
      throw faal("jwks_fout", e);
    }
    const jwk = kiesJwk(jwks, delen.header.kid);
    if (!jwk || !verifieerRs256(delen, jwk)) throw faal("handtekening_ongeldig");

    const oordeel = valideerIdToken(delen.payload, {
      tenantId: cfg.tenantId,
      clientId: cfg.clientId,
      nonceHash: nonceHash(geheim.nonce),
      nuSeconden: Math.floor(nu().getTime() / 1000),
      issuer: verwachteIssuer(cfg.authority, cfg.tenantId),
    });
    if (!oordeel.ok) throw faal(oordeel.categorie);

    return { tx, ctx, geheim, idToken: tokenOordeel.idToken, identiteit: oordeel.identiteit, faal };
  }

  function azureIdentiteit(identities: SupabaseIdentiteit[]): SupabaseIdentiteit | null {
    const oauth = identities.filter((i) => i.provider !== "email" && i.provider !== "phone");
    return oauth.length === 1 && oauth[0]!.provider === "azure" ? oauth[0]! : null;
  }

  /**
   * Callback voor beide intents (§3.4 stap 7–12, §3.5 stap 7–12).
   */
  async function voltooiCallback(args: { host: string; hostFondsId: string; code: string | null; state: string | null; error: string | null }): Promise<CallbackResultaat> {
    const v = await verwerkCode(args);
    const { tx, ctx, geheim, idToken, identiteit, faal } = v;
    const weiger = async (categorie: MicrosoftLoginFoutcategorie, userId: string | null, oorzaak?: unknown) => {
      await audit({ fondsId: tx.fondsId, userId, gebeurtenis: `${tx.intent}.geweigerd`, categorie, identiteit, correlatieId: ctx.correlatieId });
      return faal(categorie, oorzaak);
    };

    if (tx.intent === "inloggen") {
      const binding = await deps.gateway.zoekIdentiteit(identiteit);
      if (!binding) throw await weiger("binding_ontbreekt", null);
      if (binding.fondsId !== args.hostFondsId) throw await weiger("fonds_mismatch", null);

      const sessie = await deps.auth.signInWithIdToken({ token: idToken, nonce: geheim.nonce });
      if ("fout" in sessie) throw await weiger(sessie.fout === "hook_geweigerd" ? "hook_geweigerd" : "token_exchange", binding.userId);

      const az = azureIdentiteit(sessie.user.identities);
      if (sessie.user.id !== binding.userId || !az || az.providerId !== identiteit.sub) {
        await deps.auth.signOut("local");
        throw await weiger("identiteit_mismatch", sessie.user.id);
      }
      const fondsId = await deps.auth.profielFondsId(sessie.user.id);
      if (fondsId !== args.hostFondsId) {
        await deps.auth.signOut("local");
        throw await weiger(fondsId ? "fonds_mismatch" : "profiel_ontbreekt", sessie.user.id);
      }
      await deps.gateway.markeerGebruikt(binding.id).catch(() => undefined);
      await audit({ fondsId: tx.fondsId, userId: binding.userId, gebeurtenis: "inloggen.geslaagd", identiteit, correlatieId: ctx.correlatieId });
      return { intent: "inloggen", next: geheim.next, correlatieId: ctx.correlatieId };
    }

    // koppelen
    const gebruiker = await deps.auth.huidigeGebruiker();
    if (!gebruiker || !tx.userId || gebruiker.id !== tx.userId) throw await weiger("sessie_mismatch", tx.userId);
    const profielFonds = await deps.auth.profielFondsId(gebruiker.id);
    if (profielFonds !== tx.fondsId) throw await weiger(profielFonds ? "fonds_mismatch" : "profiel_ontbreekt", gebruiker.id);

    const bestaandeOAuth = gebruiker.identities.filter((i) => i.provider !== "email" && i.provider !== "phone");
    const bestaandeAzure = azureIdentiteit(gebruiker.identities);
    if (bestaandeOAuth.length > 0 && (!bestaandeAzure || bestaandeAzure.providerId !== identiteit.sub)) {
      throw await weiger("identiteit_mismatch", gebruiker.id);
    }

    let bindingId: string;
    try {
      bindingId = await deps.gateway.reserveerIdentiteit({ fondsId: tx.fondsId, userId: gebruiker.id, identiteit, correlatieId: ctx.correlatieId });
    } catch (e) {
      // De DB heeft conflict/fondsmismatch/flag/tenant al geaudit (T1: (id, categorie)).
      throw faal(microsoftLoginFoutcategorie(e), e);
    }

    // Idempotent herstel wanneer GoTrue de Azure-identiteit in een eerdere
    // poging al aan precies dit account heeft gehangen, maar de app de pending
    // binding nog niet kon activeren. `sub` is bij de Azure-provider exact de
    // provider-id; de DB-binding bevat daarnaast het door ons geverifieerde
    // tid/oid en een latere tokenuitgifte wordt opnieuw door de hook getoetst.
    if (bestaandeAzure) {
      try {
        await deps.gateway.herstelKoppeling({ bindingId, userId: gebruiker.id, sub: identiteit.sub });
      } catch (e) {
        throw faal("activering_mislukt", e);
      }
      return { intent: "koppelen", correlatieId: ctx.correlatieId };
    }

    const link = await deps.auth.linkIdentity({ token: idToken, nonce: geheim.nonce });
    if ("fout" in link) {
      const categorie: MicrosoftLoginFoutcategorie = link.fout === "hook_geweigerd" ? "hook_geweigerd" : "link_geweigerd";
      await deps.gateway.markeerMislukt({ bindingId, userId: gebruiker.id, categorie }).catch(() => undefined);
      throw faal(categorie);
    }
    // Vraag na de link de actuele GoTrue-gebruiker opnieuw op. De tokenrespons
    // kan een gebruikerssnapshot van vóór de identity-insert bevatten, terwijl
    // getUser() de definitieve identiteitstoestand teruggeeft.
    const actueel = await deps.auth.huidigeGebruiker();
    const az = actueel ? azureIdentiteit(actueel.identities) : null;
    if (link.user.id !== gebruiker.id || !actueel || actueel.id !== gebruiker.id || !az || az.providerId !== identiteit.sub) {
      await deps.gateway.markeerMislukt({ bindingId, userId: gebruiker.id, categorie: "identiteit_mismatch" }).catch(() => undefined);
      // De gelinkte sessie is nu `oauth` zonder activering: beëindig haar overal.
      await deps.auth.signOut("global");
      throw faal("identiteit_mismatch");
    }
    try {
      await deps.gateway.activeerIdentiteit({ bindingId, userId: gebruiker.id, sub: identiteit.sub });
    } catch (e) {
      // Identiteit bestaat, binding nog pending: herstelbaar via herstelKoppeling.
      throw faal("activering_mislukt", e);
    }
    return { intent: "koppelen", correlatieId: ctx.correlatieId };
  }

  /** Status voor de profielkaart. `herstelMogelijk` = pending + azure-identiteit aanwezig. */
  async function status(args: { userId: string }): Promise<KoppelStatus> {
    const b = await deps.gateway.levendeBinding(args.userId);
    if (!b) return { status: "geen" };
    if (b.status === "active") return { status: "active", geactiveerdOp: b.geactiveerdOp, laatstGebruiktOp: b.laatstGebruiktOp };
    if (b.status === "revoking") return { status: "revoking" };
    const gebruiker = await deps.auth.huidigeGebruiker();
    const herstelMogelijk = !!gebruiker && azureIdentiteit(gebruiker.identities) !== null;
    return { status: "pending", herstelMogelijk, pendingVerlooptOp: b.pendingVerlooptOp };
  }

  /** Idempotent herstel na een crash tussen linkIdentity en activeren (§4.3). */
  async function herstel(args: { userId: string }): Promise<{ hersteld: boolean }> {
    const correlatieId = correlatie();
    const b = await deps.gateway.levendeBinding(args.userId);
    if (!b) throw new MicrosoftLoginFlowFout("onbekende_binding", { intent: "koppelen", correlatieId });
    if (b.status === "active") return { hersteld: true };
    if (b.status !== "pending") throw new MicrosoftLoginFlowFout("ongeldige_overgang", { intent: "koppelen", correlatieId });
    const gebruiker = await deps.auth.huidigeGebruiker();
    const az = gebruiker && gebruiker.id === args.userId ? azureIdentiteit(gebruiker.identities) : null;
    if (!az) throw new MicrosoftLoginFlowFout("identiteit_mismatch", { intent: "koppelen", correlatieId });
    try {
      await deps.gateway.herstelKoppeling({ bindingId: b.id, userId: args.userId, sub: az.providerId });
    } catch (e) {
      throw new MicrosoftLoginFlowFout(microsoftLoginFoutcategorie(e), { intent: "koppelen", correlatieId }, e);
    }
    return { hersteld: true };
  }

  /** Ontkoppelen: revoking → unlinkIdentity → revoked. Mislukt unlink: blijft revoking. */
  async function ontkoppel(args: { fondsId: string; userId: string }): Promise<{ ontkoppeld: boolean }> {
    const correlatieId = correlatie();
    let bindingId: string;
    try {
      bindingId = await deps.gateway.startIntrekking({ fondsId: args.fondsId, userId: args.userId, doorUserId: args.userId, correlatieId });
    } catch (e) {
      throw new MicrosoftLoginFlowFout(microsoftLoginFoutcategorie(e), { intent: "koppelen", correlatieId }, e);
    }
    const weg = await deps.auth.unlinkAzure();
    if (!weg) {
      await audit({ fondsId: args.fondsId, userId: args.userId, gebeurtenis: "ontkoppelen.unlink_mislukt", categorie: "unlink_mislukt", correlatieId });
      throw new MicrosoftLoginFlowFout("unlink_mislukt", { intent: "koppelen", correlatieId });
    }
    await deps.gateway.voltooiIntrekking({ bindingId, userId: args.userId, correlatieId });
    return { ontkoppeld: true };
  }

  return { start, voltooiCallback, status, herstel, ontkoppel };
}

export type MicrosoftLogin = ReturnType<typeof maakMicrosoftLogin>;
