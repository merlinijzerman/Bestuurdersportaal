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
export type OutlookConfiguratie = {
  id: string; gebruiker_id: string; tenant_id: string; mailbox_id: string; calendar_id: string;
  calendar_naam: string; venster_start: string; venster_eind: string; delta_link: string | null;
  status: "gereed" | "bezig" | "fout" | "toestemming_nodig"; laatst_gelukt_op: string | null;
  laatst_foutcategorie: string | null;
};
export type OutlookRun = {
  run_id: string; configuratie_id: string; tenant_id: string; mailbox_id: string; calendar_id: string;
  venster_start: string; venster_eind: string; delta_link: string | null;
};
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
export async function leesOutlookConfiguratie(fondsId: string, gebruikerId: string): Promise<OutlookConfiguratie | undefined> {
  const r = await db().query("select * from microsoft_private.outlook_lees_configuratie($1,$2)", [fondsId, gebruikerId]);
  return r.rows[0] as OutlookConfiguratie | undefined;
}
export async function configureerOutlookAgenda(args: { fondsId: string; gebruikerId: string; tenantId: string; mailboxId: string; calendarId: string; naam: string; vensterStart: string; vensterEind: string }) {
  const r = await db().query("select microsoft_private.outlook_configureer_agenda($1,$2,$3,$4,$5,$6,$7,$8) as id", [args.fondsId,args.gebruikerId,args.tenantId,args.mailboxId,args.calendarId,args.naam,args.vensterStart,args.vensterEind]);
  return r.rows[0]?.id as string | undefined;
}
export async function startOutlookRun(fondsId: string, gebruikerId: string, correlationId: string): Promise<OutlookRun | undefined> {
  const r = await db().query("select * from microsoft_private.outlook_start_run($1,$2,$3)", [fondsId, gebruikerId, correlationId]);
  return r.rows[0] as OutlookRun | undefined;
}
export async function verwerkOutlookEvent(args: { runId: string; eventId: string; iCalUId: string | null; changeKey: string | null; serieMasterId: string | null; titel: string; start: string; eind: string; tijdzone: string; locatie: string; teamsLink: string; sensitivity: string; geannuleerd: boolean; lokaleDeelnemers: string[]; onbekendeDeelnemers: number }) {
  const r = await db().query("select microsoft_private.outlook_verwerk_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as resultaat", [args.runId,args.eventId,args.iCalUId ?? "",args.changeKey ?? "",args.serieMasterId ?? "",args.titel,args.start,args.eind,args.tijdzone,args.locatie,args.teamsLink,args.sensitivity,args.geannuleerd,args.lokaleDeelnemers,args.onbekendeDeelnemers]);
  return r.rows[0]?.resultaat as "aangemaakt" | "bijgewerkt" | "afgeschermd" | "overgeslagen_privacy" | undefined;
}
export async function voltooiOutlookRun(runId: string, deltaLink: string, aantallen: { gelezen: number; aangemaakt: number; bijgewerkt: number; overgeslagen: number }) {
  await db().query("select microsoft_private.outlook_voltooi_run($1,$2,$3,$4,$5,$6)", [runId,deltaLink,aantallen.gelezen,aantallen.aangemaakt,aantallen.bijgewerkt,aantallen.overgeslagen]);
}
export async function mislukOutlookRun(runId: string, categorie: string) {
  await db().query("select microsoft_private.outlook_misluk_run($1,$2)", [runId,categorie]);
}
