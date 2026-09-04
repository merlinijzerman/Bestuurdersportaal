import "server-only";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import type { VersleuteldBlob } from "@/core/lib/microsoft-crypto";
import { microsoftVaultDbConfig } from "@/core/lib/microsoft-vault-config-core";
import type { MicrosoftConnectorFoutcategorie } from "@/core/lib/microsoft-connector-error-core";
import {
  normaliseerMicrosoftCacheRij,
  type MicrosoftCacheDatabaseRij,
} from "@/core/lib/microsoft-vault-row-core";

type Verbinding = { id: string; fonds_id: string; gebruiker_id: string; tenant_id: string; microsoft_object_id: string; home_account_id: string; display_name: string | null; masked_username: string | null; status: "gekoppeld" | "fout" | "ontkoppeld"; scopes: string[]; laatst_getest_op: string | null; gekoppeld_op: string | null };
let pool: Pool | undefined;
function db() {
  const config = microsoftVaultDbConfig(
    process.env.MICROSOFT_VAULT_DATABASE_URL,
    process.env.MICROSOFT_VAULT_CA_CERT_BASE64,
  );
  pool ??= new Pool({
    connectionString: config.connectionString,
    max: 2,
    ssl: { ca: config.ca, rejectUnauthorized: true },
  });
  return pool;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function maakOAuthTransactie(args: { state: string; fondsId: string; gebruikerId: string; expiresAt: Date; blob: VersleuteldBlob }) {
  await db().query("select microsoft_private.maak_oauth_transactie($1,$2,$3,$4,$5,$6,$7,$8,$9)", [hash(args.state), args.fondsId, args.gebruikerId, args.expiresAt, args.blob.sleutelVersie, args.blob.iv, args.blob.tag, args.blob.ciphertext, "microsoft.oauth"]);
}
export async function consumeerOAuthTransactie(state: string) {
  const r = await db().query("select * from microsoft_private.consumeer_oauth_transactie($1)", [hash(state)]);
  return r.rows[0] as { fonds_id: string; gebruiker_id: string; sleutel_versie: number; iv: string; tag: string; ciphertext: string } | undefined;
}
export async function leesVerbinding(fondsId: string, gebruikerId: string): Promise<Verbinding | undefined> {
  const r = await db().query("select * from microsoft_private.lees_verbinding($1,$2)", [fondsId, gebruikerId]);
  return r.rows[0] as Verbinding | undefined;
}
export async function bewaarKoppeling(args: Omit<Verbinding, "id" | "laatst_getest_op" | "gekoppeld_op" | "status"> & { cache: VersleuteldBlob }) {
  await db().query("select microsoft_private.bewaar_koppeling($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [args.fonds_id,args.gebruiker_id,args.tenant_id,args.microsoft_object_id,args.home_account_id,args.display_name,args.masked_username,args.scopes,args.cache.sleutelVersie,args.cache.iv,args.cache.tag,args.cache.ciphertext]);
}
export async function leesCache(fondsId: string, gebruikerId: string) {
  const r = await db().query("select * from microsoft_private.lees_cache($1,$2)", [fondsId, gebruikerId]);
  return normaliseerMicrosoftCacheRij(r.rows[0] as MicrosoftCacheDatabaseRij | undefined);
}
export async function bewaarCache(args: { fondsId: string; gebruikerId: string; expectedVersion: number; cache: VersleuteldBlob }) {
  const r = await db().query("select microsoft_private.bewaar_cache($1,$2,$3,$4,$5,$6,$7) as ok", [args.fondsId,args.gebruikerId,args.expectedVersion,args.cache.sleutelVersie,args.cache.iv,args.cache.tag,args.cache.ciphertext]);
  return r.rows[0]?.ok === true;
}
export async function markeerTest(fondsId: string, gebruikerId: string, ok: boolean, foutcategorie: string | null) {
  await db().query("select microsoft_private.registreer_test($1,$2,$3,$4)", [fondsId, gebruikerId, ok, foutcategorie]);
}
export async function registreerKoppelfout(fondsId: string, gebruikerId: string, categorie: MicrosoftConnectorFoutcategorie) {
  await db().query("select microsoft_private.registreer_koppelfout($1,$2,$3)", [fondsId, gebruikerId, categorie]);
}
export async function ontkoppel(fondsId: string, gebruikerId: string) {
  await db().query("select microsoft_private.ontkoppel($1,$2)", [fondsId, gebruikerId]);
}
