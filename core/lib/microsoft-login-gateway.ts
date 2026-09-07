// ============================================================================
//  core/lib/microsoft-login-gateway.ts — server-only gateway naar login_private
//  (Microsoft-login fase 1B, #335, T1; besluit 0211).
// ----------------------------------------------------------------------------
//  Eén Pool op de minimale databaserol login_gateway. Die rol mag uitsluitend
//  de vierentwintig gatewayfuncties uitvoeren (dertien uit T1, tel_startpoging
//  uit T2/V9 en tien uit fase 1C/#344); tabellen zijn onbereikbaar. Geen
//  Supabase service-roleclient, geen browserpad. Het toestandsmodel en de fonds-
//  isolatie worden in de database afgedwongen; deze laag vertaalt alleen typen
//  en categoriseert fouten inhoudsvrij (nooit een ruwe databasemelding, nooit
//  claims, tokens of e-mailadressen naar de aanroeper of het log).
//  Patroon: core/lib/microsoft-vault.ts en core/lib/ai-gateway/config-db.ts.
// ============================================================================
import "server-only";
import { Pool } from "pg";
import { loginGatewayDbConfig } from "@/core/lib/microsoft-login-gateway-config-core";
import {
  gatewayFoutcategorie,
  isBindingStatus,
  isGeldigeIdentiteitsvorm,
  type BindingStatus,
  type LoginGatewayFoutcategorie,
} from "@/core/lib/microsoft-login-binding-core";
import {
  isBeleidFoutcategorie,
  loginModus,
  type BeleidFoutcategorie,
  type LoginModus,
  type Preflight,
  type Sessiebeleid,
} from "@/core/lib/microsoft-login-beleid-core";

export class MicrosoftLoginGatewayError extends Error {
  readonly categorie: LoginGatewayFoutcategorie;
  constructor(categorie: LoginGatewayFoutcategorie, oorzaak?: unknown) {
    super(categorie, oorzaak instanceof Error ? { cause: oorzaak } : undefined);
    this.name = "MicrosoftLoginGatewayError";
    this.categorie = categorie;
  }
}

export type MicrosoftIdentiteit = { readonly tid: string; readonly oid: string; readonly sub: string };
export type LoginConfig = { readonly actief: boolean; readonly entraTenantId: string | null; readonly modus: LoginModus };
export type LevendeBinding = {
  readonly id: string;
  readonly fondsId: string;
  readonly status: BindingStatus;
  readonly pendingVerlooptOp: Date | null;
  readonly geactiveerdOp: Date | null;
  readonly laatstGebruiktOp: Date | null;
};
export type Transactie = {
  readonly fondsId: string;
  readonly userId: string | null;
  readonly intent: "koppelen" | "inloggen";
  readonly blob: { sleutelVersie: number; iv: string; tag: string; ciphertext: string; aad: string };
};

let pool: Pool | undefined;
function db(): Pool {
  if (pool) return pool;
  let config;
  try {
    config = loginGatewayDbConfig(process.env.LOGIN_GATEWAY_DATABASE_URL, process.env.LOGIN_GATEWAY_CA_CERT_BASE64, {
      sslUit: process.env.LOGIN_GATEWAY_DB_SSL,
      doelomgeving: process.env.SEED_DOELOMGEVING,
    });
  } catch (fout) {
    throw new MicrosoftLoginGatewayError("config_ontbreekt", fout);
  }
  pool = new Pool({
    connectionString: config.connectionString,
    max: 2,
    ssl: config.ssl === false ? false : { ca: config.ssl.ca, rejectUnauthorized: true },
  });
  return pool;
}

/** Voert één gatewayfunctie uit en vertaalt elke fout naar een vaste categorie. */
async function roep<T>(sql: string, params: readonly unknown[]): Promise<T[]> {
  try {
    const r = await db().query(sql, [...params]);
    return r.rows as T[];
  } catch (fout) {
    if (fout instanceof MicrosoftLoginGatewayError) throw fout;
    throw new MicrosoftLoginGatewayError(gatewayFoutcategorie(fout), fout);
  }
}

function eisIdentiteit(identiteit: MicrosoftIdentiteit): void {
  if (!isGeldigeIdentiteitsvorm(identiteit)) throw new MicrosoftLoginGatewayError("gateway_fout");
}

// ── Configuratie ────────────────────────────────────────────────────────────
export async function leesConfig(fondsId: string): Promise<LoginConfig | null> {
  const rijen = await roep<{ actief: boolean; entra_tenant_id: string | null; modus: string }>(
    "select actief, entra_tenant_id, modus from login_private.lees_config($1)",
    [fondsId]
  );
  const r = rijen[0];
  return r ? { actief: r.actief === true, entraTenantId: r.entra_tenant_id, modus: loginModus(r.modus) } : null;
}

/** Strikte poort: alleen `actief === true` met een gezette tenant telt (fail-closed). */
export async function microsoftLoginActief(fondsId: string): Promise<{ actief: true; entraTenantId: string } | { actief: false }> {
  const c = await leesConfig(fondsId);
  return c && c.actief === true && typeof c.entraTenantId === "string" && c.entraTenantId.length > 0
    ? { actief: true, entraTenantId: c.entraTenantId }
    : { actief: false };
}

// ── Bindingen (toestandsmodel in de DB) ─────────────────────────────────────
export async function reserveerIdentiteit(args: { fondsId: string; userId: string; identiteit: MicrosoftIdentiteit; correlatieId: string }): Promise<string> {
  eisIdentiteit(args.identiteit);
  // De DB geeft (id, categorie) terug en raist niet: zo blijft een conflict of
  // fondsmismatch in de audit staan (een raise zou de auditregel terugrollen).
  const rijen = await roep<{ id: string | null; categorie: string | null }>(
    "select id, categorie from login_private.reserveer_identiteit($1,$2,$3,$4,$5,$6)",
    [args.fondsId, args.userId, args.identiteit.tid, args.identiteit.oid, args.identiteit.sub, args.correlatieId]
  );
  const r = rijen[0];
  if (!r) throw new MicrosoftLoginGatewayError("gateway_fout");
  if (!r.id) {
    const c = r.categorie;
    throw new MicrosoftLoginGatewayError(c === "fonds_mismatch" || c === "login_uit" || c === "tenant_mismatch" || c === "binding_conflict" ? c : "gateway_fout");
  }
  return r.id;
}

export async function activeerIdentiteit(args: { bindingId: string; userId: string; sub: string }): Promise<void> {
  await roep("select login_private.activeer_identiteit($1,$2,$3)", [args.bindingId, args.userId, args.sub]);
}

export async function herstelKoppeling(args: { bindingId: string; userId: string; sub: string }): Promise<void> {
  await roep("select login_private.herstel_koppeling($1,$2,$3)", [args.bindingId, args.userId, args.sub]);
}

export async function markeerMislukt(args: { bindingId: string; userId: string; categorie: string }): Promise<void> {
  await roep("select login_private.markeer_mislukt($1,$2,$3)", [args.bindingId, args.userId, args.categorie]);
}

/** Persoonlijk ontkoppelen. De DB geeft (id, categorie) terug in plaats van te
 *  raisen (fase 1C): zo blijft een weigering in modus `verplicht` in de audit
 *  staan — een raise zou de auditregel met de subtransactie terugrollen. */
export async function startIntrekking(args: { fondsId: string; userId: string; doorUserId: string; correlatieId: string }): Promise<string> {
  const rijen = await roep<{ id: string | null; categorie: string | null }>(
    "select id, categorie from login_private.start_intrekking($1,$2,$3,$4)",
    [args.fondsId, args.userId, args.doorUserId, args.correlatieId]
  );
  const r = rijen[0];
  if (!r) throw new MicrosoftLoginGatewayError("gateway_fout");
  if (!r.id) {
    const c = r.categorie;
    throw new MicrosoftLoginGatewayError(c === "onbekende_binding" ? "onbekende_binding" : c === "ontkoppelen_verplicht" ? "ontkoppelen_verplicht" : "gateway_fout");
  }
  return r.id;
}

export async function voltooiIntrekking(args: { bindingId: string; userId: string; correlatieId: string }): Promise<void> {
  await roep("select login_private.voltooi_intrekking($1,$2,$3)", [args.bindingId, args.userId, args.correlatieId]);
}

/** Alleen een `active` binding; gebruikt door het inlogpad vóór signInWithIdToken. */
export async function zoekIdentiteit(identiteit: Pick<MicrosoftIdentiteit, "tid" | "oid">): Promise<{ id: string; userId: string; fondsId: string } | null> {
  const rijen = await roep<{ id: string; user_id: string; fonds_id: string }>(
    "select id, user_id, fonds_id from login_private.zoek_identiteit($1,$2)",
    [identiteit.tid, identiteit.oid]
  );
  const r = rijen[0];
  return r ? { id: r.id, userId: r.user_id, fondsId: r.fonds_id } : null;
}

/** De levende binding (pending/active/revoking) van een account, of null. */
export async function levendeBinding(userId: string): Promise<LevendeBinding | null> {
  const rijen = await roep<{ id: string; fonds_id: string; status: string; pending_verloopt_op: Date | string | null; geactiveerd_op: Date | string | null; laatst_gebruikt_op: Date | string | null }>(
    "select id, fonds_id, status, pending_verloopt_op, geactiveerd_op, laatst_gebruikt_op from login_private.levende_binding($1)",
    [userId]
  );
  const r = rijen[0];
  if (!r) return null;
  if (!isBindingStatus(r.status)) throw new MicrosoftLoginGatewayError("gateway_fout");
  const datum = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v : new Date(v));
  return {
    id: r.id,
    fondsId: r.fonds_id,
    status: r.status,
    pendingVerlooptOp: datum(r.pending_verloopt_op),
    geactiveerdOp: datum(r.geactiveerd_op),
    laatstGebruiktOp: datum(r.laatst_gebruikt_op),
  };
}

export async function markeerGebruikt(bindingId: string): Promise<void> {
  await roep("select login_private.markeer_gebruikt($1)", [bindingId]);
}

// ── Eenmalige flowtransacties (T2 gebruikt ze; hier al typed) ───────────────
export async function maakTransactie(args: {
  stateHash: string; fondsId: string; userId: string | null; intent: "koppelen" | "inloggen"; verlooptOp: Date;
  blob: { sleutelVersie: number; iv: string; tag: string; ciphertext: string; aad: string };
}): Promise<void> {
  await roep("select login_private.maak_transactie($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
    args.stateHash, args.fondsId, args.userId, args.intent, args.verlooptOp,
    args.blob.sleutelVersie, args.blob.iv, args.blob.tag, args.blob.ciphertext, args.blob.aad,
  ]);
}

export async function consumeerTransactie(stateHash: string): Promise<Transactie | null> {
  const rijen = await roep<{ fonds_id: string; user_id: string | null; intent: "koppelen" | "inloggen"; sleutel_versie: number; iv: string; tag: string; ciphertext: string; aad: string }>(
    "select fonds_id, user_id, intent, sleutel_versie, iv, tag, ciphertext, aad from login_private.consumeer_transactie($1)",
    [stateHash]
  );
  const r = rijen[0];
  return r
    ? { fondsId: r.fonds_id, userId: r.user_id, intent: r.intent, blob: { sleutelVersie: r.sleutel_versie, iv: r.iv, tag: r.tag, ciphertext: r.ciphertext, aad: r.aad } }
    : null;
}

// ── Tempolimiet startroute (#335 T2, V9; migratie 2026_09_07_microsoft_login_startlimiet) ──
/** Atomische telling per HMAC-sleutel en vast venster; de sleutel is nooit een ruw IP. */
export async function telStartpoging(args: { sleutel: string; limiet: number; vensterSeconden: number }): Promise<{ toegestaan: boolean; resterend: number; resetOp: Date | null }> {
  if (!/^[0-9a-f]{64}$/.test(args.sleutel)) throw new MicrosoftLoginGatewayError("gateway_fout");
  const rijen = await roep<{ toegestaan: boolean; resterend: number; reset_op: Date | string | null }>(
    "select toegestaan, resterend, reset_op from login_private.tel_startpoging($1,$2,$3)",
    [args.sleutel, args.limiet, args.vensterSeconden]
  );
  const r = rijen[0];
  if (!r) throw new MicrosoftLoginGatewayError("gateway_fout");
  return { toegestaan: r.toegestaan === true, resterend: r.resterend, resetOp: r.reset_op === null ? null : r.reset_op instanceof Date ? r.reset_op : new Date(r.reset_op) };
}

// ── Audit (inhoudsvrij) ─────────────────────────────────────────────────────
export async function registreerGebeurtenis(args: {
  fondsId: string; userId: string | null; gebeurtenis: string; foutcategorie?: string | null; identiteitHash?: string | null; correlatieId: string;
}): Promise<void> {
  await roep("select login_private.registreer_gebeurtenis($1,$2,$3,$4,$5,$6)", [
    args.fondsId, args.userId, args.gebeurtenis, args.foutcategorie ?? null, args.identiteitHash ?? null, args.correlatieId,
  ]);
}

// ── Fondsbeleid (fase 1C, #344; migratie 2026_09_07_microsoft_login_beleidsmodus) ──
// Elk van deze wrappers roept exact één gatewayfunctie aan. De autorisatie van
// de ACTOR (capability login.beleid.manage) hoort in de route; de database toetst
// fondsconsistentie, de preflight en de toestandsovergangen zelf.

/** Vertaalt een categorie-uit-de-DB naar de vaste beleidscategorie. */
function beleidCategorie(v: string | null | undefined): BeleidFoutcategorie | null {
  if (v === null || v === undefined) return null;
  return isBeleidFoutcategorie(v) ? v : "config_ontbreekt";
}

/** De stand van één account tegenover het fondsbeleid; `null` = geen fondsprofiel. */
export async function sessiebeleid(userId: string): Promise<Sessiebeleid | null> {
  const rijen = await roep<{ fonds_id: string; modus: string; config_ontbreekt: boolean; binding_status: string | null; break_glass: boolean; breakglass_venster_tot: Date | string | null; link_only: boolean }>(
    "select fonds_id, modus, config_ontbreekt, binding_status, break_glass, breakglass_venster_tot, link_only from login_private.sessiebeleid($1)",
    [userId]
  );
  const r = rijen[0];
  if (!r) return null;
  if (r.binding_status !== null && !isBindingStatus(r.binding_status)) throw new MicrosoftLoginGatewayError("gateway_fout");
  return {
    fondsId: r.fonds_id,
    modus: loginModus(r.modus),
    configOntbreekt: r.config_ontbreekt === true,
    bindingStatus: (r.binding_status as BindingStatus | null) ?? null,
    breakGlass: r.break_glass === true,
    breakglassVensterTot: r.breakglass_venster_tot === null ? null : r.breakglass_venster_tot instanceof Date ? r.breakglass_venster_tot : new Date(r.breakglass_venster_tot),
    linkOnly: r.link_only === true,
  };
}

/** Opent (of hergebruikt) het activeringsvenster van een verhoogde
 *  break-glasssessie en levert daarmee de auditgebeurtenis `breakglass.gebruikt`.
 *  De guard roept dit aan bij het eerste serververzoek van zo'n sessie. */
export async function openBreakglassVenster(args: { userId: string; vensterSeconden: number; correlatieId: string }): Promise<{ vensterTot: Date } | { categorie: BeleidFoutcategorie }> {
  const rijen = await roep<{ venster_tot: Date | string | null; categorie: string | null }>(
    "select venster_tot, categorie from login_private.open_breakglass_venster($1,$2,$3)",
    [args.userId, args.vensterSeconden, args.correlatieId]
  );
  const r = rijen[0];
  if (!r) throw new MicrosoftLoginGatewayError("gateway_fout");
  if (!r.venster_tot) return { categorie: beleidCategorie(r.categorie) ?? "onbekende_uitzondering" };
  return { vensterTot: r.venster_tot instanceof Date ? r.venster_tot : new Date(r.venster_tot) };
}

export type BreakglassRegel = {
  readonly id: string;
  readonly userId: string;
  readonly naam: string | null;
  readonly redenCategorie: string;
  readonly uitgegevenOp: Date;
  readonly herzienVoor: Date;
  readonly herzieningVerlopen: boolean;
  readonly laatstGebruiktOp: Date | null;
};

/** Beheeroverzicht van de duurzame aanwijzingen, met de verloopbewaking. */
export async function breakglassOverzicht(fondsId: string): Promise<BreakglassRegel[]> {
  const rijen = await roep<{ id: string; user_id: string; naam: string | null; reden_categorie: string; uitgegeven_op: Date | string; herzien_voor: Date | string; herziening_verlopen: boolean; laatst_gebruikt_op: Date | string | null }>(
    "select id, user_id, naam, reden_categorie, uitgegeven_op, herzien_voor, herziening_verlopen, laatst_gebruikt_op from login_private.breakglass_overzicht($1)",
    [fondsId]
  );
  const datum = (v: Date | string) => (v instanceof Date ? v : new Date(v));
  return rijen.map((r) => ({
    id: r.id,
    userId: r.user_id,
    naam: r.naam,
    redenCategorie: r.reden_categorie,
    uitgegevenOp: datum(r.uitgegeven_op),
    herzienVoor: datum(r.herzien_voor),
    herzieningVerlopen: r.herziening_verlopen === true,
    laatstGebruiktOp: r.laatst_gebruikt_op === null ? null : datum(r.laatst_gebruikt_op),
  }));
}

/** Wat blokkeert de omslag naar `verplicht`? Leesbaar voor het beheerscherm. */
export async function activeringPreflight(fondsId: string): Promise<Preflight> {
  const rijen = await roep<{ gereed: boolean; categorie: string | null; ongedekte_accounts: number; breakglass_accounts: number; breakglass_herziening_verlopen: number }>(
    "select gereed, categorie, ongedekte_accounts, breakglass_accounts, breakglass_herziening_verlopen from login_private.activering_preflight($1)",
    [fondsId]
  );
  const r = rijen[0];
  if (!r) throw new MicrosoftLoginGatewayError("gateway_fout");
  return {
    gereed: r.gereed === true,
    categorie: beleidCategorie(r.categorie),
    ongedekteAccounts: Number(r.ongedekte_accounts ?? 0),
    breakglassAccounts: Number(r.breakglass_accounts ?? 0),
    breakglassHerzieningVerlopen: Number(r.breakglass_herziening_verlopen ?? 0),
  };
}

/** Zet de modus. `null` = gelukt; anders de reden waarom niet (fail-closed). */
export async function zetModus(args: { fondsId: string; modus: LoginModus; actorId: string; correlatieId: string }): Promise<BeleidFoutcategorie | null> {
  const rijen = await roep<{ categorie: string | null }>(
    "select login_private.zet_modus($1,$2,$3,$4) as categorie",
    [args.fondsId, args.modus, args.actorId, args.correlatieId]
  );
  return beleidCategorie(rijen[0]?.categorie ?? null);
}

export type DekkingsRegel = {
  readonly userId: string;
  readonly naam: string | null;
  readonly rol: string | null;
  readonly bindingStatus: BindingStatus | null;
  readonly laatstGebruiktOp: Date | null;
  readonly breakGlass: boolean;
  readonly uitnodigingOpen: boolean;
};

/** Beheeroverzicht per gebruiker: koppelstatus en laatste gebruik, meer niet.
 *  Nooit tid/oid/sub, nooit e-mail, nooit een Microsoft-claim. */
export async function dekkingsrapport(fondsId: string): Promise<DekkingsRegel[]> {
  const rijen = await roep<{ user_id: string; naam: string | null; rol: string | null; binding_status: string | null; laatst_gebruikt_op: Date | string | null; break_glass: boolean; uitnodiging_open: boolean }>(
    "select user_id, naam, rol, binding_status, laatst_gebruikt_op, break_glass, uitnodiging_open from login_private.dekkingsrapport($1)",
    [fondsId]
  );
  return rijen.map((r) => ({
    userId: r.user_id,
    naam: r.naam,
    rol: r.rol,
    bindingStatus: r.binding_status !== null && isBindingStatus(r.binding_status) ? r.binding_status : null,
    laatstGebruiktOp: r.laatst_gebruikt_op === null ? null : r.laatst_gebruikt_op instanceof Date ? r.laatst_gebruikt_op : new Date(r.laatst_gebruikt_op),
    breakGlass: r.break_glass === true,
    uitnodigingOpen: r.uitnodiging_open === true,
  }));
}

/** Beheerintrekking. `afronden` geeft het levende slot direct vrij (vertrokken
 *  gebruiker); zonder `afronden` blijft de binding `revoking`, zodat de gebruiker
 *  de GoTrue-identiteit in de eigen sessie nog netjes kan losmaken. */
export async function beheerIntrekking(args: { fondsId: string; doelUserId: string; actorId: string; afronden: boolean; correlatieId: string }): Promise<{ bindingId: string } | { categorie: BeleidFoutcategorie }> {
  const rijen = await roep<{ id: string | null; categorie: string | null }>(
    "select id, categorie from login_private.beheer_intrekking($1,$2,$3,$4,$5)",
    [args.fondsId, args.doelUserId, args.actorId, args.afronden, args.correlatieId]
  );
  const r = rijen[0];
  if (!r) throw new MicrosoftLoginGatewayError("gateway_fout");
  if (!r.id) return { categorie: beleidCategorie(r.categorie) ?? "config_ontbreekt" };
  return { bindingId: r.id };
}

/** Break-glass verlenen: een DUURZAME aanwijzing (geldig tot intrekking). Niet
 *  zelf toe te kennen (de DB weigert actor = doel) en pas werkzaam met een
 *  geverifieerde MFA-factor (de Auth-hook toetst dat). `herzienOverDagen` zet
 *  alleen de herzieningsdatum voor de verloopbewaking, niet de geldigheid. */
export async function verleenBreakGlass(args: {
  fondsId: string; doelUserId: string; reden: "entra_storing" | "beheerherstel" | "migratie";
  actorId: string; herzienOverDagen: number; correlatieId: string;
}): Promise<{ id: string } | { categorie: BeleidFoutcategorie }> {
  const rijen = await roep<{ id: string | null; categorie: string | null }>(
    "select id, categorie from login_private.verleen_break_glass($1,$2,$3,$4,$5,$6)",
    [args.fondsId, args.doelUserId, args.reden, args.actorId, args.herzienOverDagen, args.correlatieId]
  );
  const r = rijen[0];
  if (!r) throw new MicrosoftLoginGatewayError("gateway_fout");
  if (!r.id) return { categorie: beleidCategorie(r.categorie) ?? "config_ontbreekt" };
  return { id: r.id };
}

export async function trekBreakGlassIn(args: { id: string; fondsId: string; actorId: string; correlatieId: string }): Promise<BeleidFoutcategorie | null> {
  const rijen = await roep<{ categorie: string | null }>(
    "select login_private.trek_break_glass_in($1,$2,$3,$4) as categorie",
    [args.id, args.fondsId, args.actorId, args.correlatieId]
  );
  return beleidCategorie(rijen[0]?.categorie ?? null);
}

/** Uitnodiging voor een beperkte koppel-/herstelsessie. De aanroeper levert
 *  UITSLUITEND de sha256 van het opake token; het token zelf gaat nooit naar de
 *  database, het log of de audit. */
export async function maakUitnodiging(args: { fondsId: string; doelUserId: string; tokenHash: string; geldigSeconden: number; actorId: string; correlatieId: string }): Promise<BeleidFoutcategorie | null> {
  if (!/^[0-9a-f]{64}$/.test(args.tokenHash)) throw new MicrosoftLoginGatewayError("gateway_fout");
  const rijen = await roep<{ categorie: string | null }>(
    "select login_private.maak_uitnodiging($1,$2,$3,$4,$5,$6) as categorie",
    [args.fondsId, args.doelUserId, args.tokenHash, args.geldigSeconden, args.actorId, args.correlatieId]
  );
  return beleidCategorie(rijen[0]?.categorie ?? null);
}

/** Verzilvert de uitnodiging atomisch en eenmalig en opent het venster. */
export async function activeerUitnodiging(args: { tokenHash: string; fondsId: string; vensterSeconden: number; correlatieId: string }): Promise<{ userId: string; vensterTot: Date } | { categorie: BeleidFoutcategorie }> {
  if (!/^[0-9a-f]{64}$/.test(args.tokenHash)) return { categorie: "uitnodiging_ongeldig" };
  const rijen = await roep<{ user_id: string | null; venster_tot: Date | string | null; categorie: string | null }>(
    "select user_id, venster_tot, categorie from login_private.activeer_uitnodiging($1,$2,$3,$4)",
    [args.tokenHash, args.fondsId, args.vensterSeconden, args.correlatieId]
  );
  const r = rijen[0];
  if (!r) throw new MicrosoftLoginGatewayError("gateway_fout");
  if (!r.user_id || !r.venster_tot) return { categorie: beleidCategorie(r.categorie) ?? "uitnodiging_ongeldig" };
  return { userId: r.user_id, vensterTot: r.venster_tot instanceof Date ? r.venster_tot : new Date(r.venster_tot) };
}

export async function trekUitnodigingIn(args: { fondsId: string; doelUserId: string; actorId: string; correlatieId: string }): Promise<BeleidFoutcategorie | null> {
  const rijen = await roep<{ categorie: string | null }>(
    "select login_private.trek_uitnodiging_in($1,$2,$3,$4) as categorie",
    [args.fondsId, args.doelUserId, args.actorId, args.correlatieId]
  );
  return beleidCategorie(rijen[0]?.categorie ?? null);
}
