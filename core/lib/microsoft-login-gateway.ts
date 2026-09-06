// ============================================================================
//  core/lib/microsoft-login-gateway.ts — server-only gateway naar login_private
//  (Microsoft-login fase 1B, #335, T1; besluit 0211).
// ----------------------------------------------------------------------------
//  Eén Pool op de minimale databaserol login_gateway. Die rol mag uitsluitend
//  de dertien gatewayfuncties uitvoeren; tabellen zijn onbereikbaar. Geen
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

export class MicrosoftLoginGatewayError extends Error {
  readonly categorie: LoginGatewayFoutcategorie;
  constructor(categorie: LoginGatewayFoutcategorie, oorzaak?: unknown) {
    super(categorie, oorzaak instanceof Error ? { cause: oorzaak } : undefined);
    this.name = "MicrosoftLoginGatewayError";
    this.categorie = categorie;
  }
}

export type MicrosoftIdentiteit = { readonly tid: string; readonly oid: string; readonly sub: string };
export type LoginConfig = { readonly actief: boolean; readonly entraTenantId: string | null; readonly pilotstatus: string };
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
  const rijen = await roep<{ actief: boolean; entra_tenant_id: string | null; pilotstatus: string }>(
    "select actief, entra_tenant_id, pilotstatus from login_private.lees_config($1)",
    [fondsId]
  );
  const r = rijen[0];
  return r ? { actief: r.actief === true, entraTenantId: r.entra_tenant_id, pilotstatus: r.pilotstatus } : null;
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
  if (!r.id) throw new MicrosoftLoginGatewayError(r.categorie === "fonds_mismatch" || r.categorie === "binding_conflict" ? r.categorie : "gateway_fout");
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

export async function startIntrekking(args: { fondsId: string; userId: string; doorUserId: string; correlatieId: string }): Promise<string> {
  const rijen = await roep<{ id: string }>(
    "select login_private.start_intrekking($1,$2,$3,$4) as id",
    [args.fondsId, args.userId, args.doorUserId, args.correlatieId]
  );
  const id = rijen[0]?.id;
  if (!id) throw new MicrosoftLoginGatewayError("gateway_fout");
  return id;
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

// ── Audit (inhoudsvrij) ─────────────────────────────────────────────────────
export async function registreerGebeurtenis(args: {
  fondsId: string; userId: string | null; gebeurtenis: string; foutcategorie?: string | null; identiteitHash?: string | null; correlatieId: string;
}): Promise<void> {
  await roep("select login_private.registreer_gebeurtenis($1,$2,$3,$4,$5,$6)", [
    args.fondsId, args.userId, args.gebeurtenis, args.foutcategorie ?? null, args.identiteitHash ?? null, args.correlatieId,
  ]);
}
