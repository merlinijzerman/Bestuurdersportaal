// Lokale DB-integratieproef voor OCR-actieafhandeling. Geen Mistral-verkeer:
// global.fetch wordt vóór de eerste providerpoging volledig onderschept.
// Draaien met SEED_DOELOMGEVING=local TEST_DATABASE_URL=<loopback-url>
//   node --import tsx scripts/test-ocr-actie-lifecycle.mts
// Alle testdata/configwijzigingen vallen onder één transactie met ROLLBACK.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ocrPdfNaarResultaat } from "../core/lib/ocr";
import type { PreflightUitkomst } from "../core/lib/ai-preflight";
import { ocrReserveringMetAfronding } from "../core/lib/ocr-actie-afronding";

const dbUrl = process.env.TEST_DATABASE_URL ?? "";
const bestemming = dbUrl ? new URL(dbUrl) : null;
if (
  process.env.SEED_DOELOMGEVING !== "local" ||
  !bestemming ||
  !["127.0.0.1", "localhost", "::1"].includes(bestemming.hostname) ||
  !["postgres:", "postgresql:"].includes(bestemming.protocol) ||
  bestemming.port !== "54322" ||
  bestemming.username !== "postgres" ||
  bestemming.pathname !== "/postgres"
) {
  throw new Error("OCR-lifecycle-test weigert: uitsluitend de lokale CLI-testdatabase op loopback:54322");
}

const db = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 3000 });
const prefix = `ocr-lifecycle:${randomUUID()}`;
const origineleFetch = globalThis.fetch;
const origineleKey = process.env.MISTRAL_API_KEY;
let transactieOpen = false;

async function status(actieId: string): Promise<string> {
  const identiteit = await db.query<{ rol: string }>("select current_user as rol");
  assert.equal(identiteit.rows[0].rol, "postgres", "statusobservatie moet buiten service_role gebeuren");
  const r = await db.query<{ status: string }>(
    "select status from public.ai_actie where id = $1::uuid", [actieId]
  );
  assert.equal(r.rowCount, 1);
  return r.rows[0].status;
}

// Beperkte RPC-adapter over dezelfde lokale DB-transactie. Zo draaien de
// productiecode voor preflight, poort en afronding en de observaties atomair.
const svc = {
  rpc: async (naam: string, args: Record<string, unknown>) => {
    let rolGewisseld = false;
    try {
      await db.query("set local role service_role");
      rolGewisseld = true;
      const identiteit = await db.query<{ rol: string }>("select current_user as rol");
      assert.equal(identiteit.rows[0].rol, "service_role", "RPC moet als service_role draaien");
      let q: string;
      let params: unknown[];
      if (naam === "fn_ai_preflight_systeem") {
        q = "select public.fn_ai_preflight_systeem($1,$2,$3,$4,$5,$6,$7,$8) as data";
        params = [args.p_actietype, args.p_fonds_id, args.p_provider, args.p_model,
          args.p_ocr_paginas, args.p_idempotentie, args.p_vingerafdruk, args.p_dryrun];
      } else if (naam === "fn_ai_poort_check") {
        q = "select public.fn_ai_poort_check($1,$2) as data";
        params = [args.p_provider, args.p_model];
      } else if (naam === "fn_ai_actie_afronden") {
        q = "select public.fn_ai_actie_afronden($1,$2,$3) as data";
        params = [args.p_actie_id, args.p_status, args.p_resultaat_ref];
      } else {
        throw new Error(`Onverwachte OCR-RPC: ${naam}`);
      }
      const resultaat = await db.query<{ data: unknown }>(q, params);
      await db.query("reset role");
      rolGewisseld = false;
      return { data: resultaat.rows[0]?.data ?? null, error: null };
    } catch (error) {
      if (rolGewisseld) await db.query("reset role").catch(() => undefined);
      return { data: null, error: error as Error };
    }
  },
} as unknown as SupabaseClient;

async function preflightSysteemLokaal(invoer: {
  actietype: "ocr" | "ocr_generiek" | "generiek_curatie";
  fondsId: string | null;
  provider: "mistral" | null;
  model: "mistral-ocr-latest" | null;
  ocrPaginas: number;
  idempotentie: string;
  vingerafdruk: string;
}): Promise<PreflightUitkomst> {
  const { data, error } = await svc.rpc("fn_ai_preflight_systeem", {
    p_actietype: invoer.actietype,
    p_fonds_id: invoer.fondsId,
    p_provider: invoer.provider,
    p_model: invoer.model,
    p_ocr_paginas: invoer.ocrPaginas,
    p_idempotentie: invoer.idempotentie,
    p_vingerafdruk: invoer.vingerafdruk,
    p_dryrun: false,
  });
  if (error) throw error;
  const uitkomst = data as { uitkomst: string; actie_id?: string };
  if (uitkomst.uitkomst === "nieuw") {
    return { uitkomst: "nieuw", actieId: uitkomst.actie_id ?? null, configVersie: null };
  }
  throw new Error(`Lokale preflight geweigerd: ${uitkomst.uitkomst}`);
}

async function reserveer(
  sleutel: string,
  poging: number,
  actieIds: string[],
  metAfronding = true,
  fondsId: string | null = null
): Promise<Awaited<ReturnType<import("../core/lib/ocr").OcrReservering>>> {
  const uitkomst: PreflightUitkomst = await preflightSysteemLokaal({
    actietype: fondsId ? "ocr" : "ocr_generiek",
    fondsId,
    provider: "mistral",
    model: "mistral-ocr-latest",
    ocrPaginas: 1,
    idempotentie: `${sleutel}:${poging}`,
    vingerafdruk: "lokale-ocr-proef",
  });
  assert.equal(uitkomst.uitkomst, "nieuw", `preflight ${sleutel}:${poging}`);
  assert.ok(uitkomst.actieId);
  actieIds.push(uitkomst.actieId);
  return metAfronding ? ocrReserveringMetAfronding(svc, uitkomst) : true;
}

function onderschepProvider(statussen: number[]): () => number {
  let aantal = 0;
  globalThis.fetch = async (input) => {
    assert.equal(input, "https://api.mistral.ai/v1/ocr");
    assert.ok(aantal < statussen.length, "extra, niet verwachte providerpoging");
    const status = statussen[aantal++];
    return status === 200
      ? new Response(JSON.stringify({ pages: [{ index: 0, markdown: "Lokale OCR-proefpagina." }] }), { status })
      : new Response("lokale providerfout", { status });
  };
  return () => aantal;
}

async function ocrMet(
  sleutel: string,
  metAfronding: boolean,
  actieIds: string[],
  fondsId: string | null = null
) {
  return ocrPdfNaarResultaat(
    Buffer.from("plaatsvervangende PDF; provider ontvangt niets"),
    { supabase: svc, label: "lokale-ocr-lifecycle" },
    async (_paginas, poging) => reserveer(sleutel, poging, actieIds, metAfronding, fondsId),
    1
  );
}

try {
  await db.connect();
  const identiteit = await db.query<{ db: string; poort: number }>(
    "select current_database() as db, inet_server_port() as poort"
  );
  console.log(`LOKAAL: database=${identiteit.rows[0].db}, poort=${identiteit.rows[0].poort}`);

  await db.query("begin");
  transactieOpen = true;
  await db.query("set local lock_timeout = '2s'");
  await db.query("set local statement_timeout = '15s'");
  // Alleen de testtransactie. Geen permanente configuratie- of quotawijziging.
  await db.query(`
    insert into public.ai_quota_config (sleutel, waarde)
    values ('globaal_maand', 1000000), ('ocr_fonds_maand', 1000000)
    on conflict (sleutel) do update set waarde = excluded.waarde
  `);
  await db.query(`
    update public.ai_kill_switch
       set status = 'actief', reden = null, open_verzoek_id = null
     where sleutel in ('globaal', 'mistral')
  `);
  await db.query(`
    insert into public.ai_model_allowlist (provider, model, actief)
    values ('mistral', 'mistral-ocr-latest', true)
    on conflict (provider, model) do update set actief = true,
      venster_start = null, venster_eind = null
  `);

  process.env.MISTRAL_API_KEY = "uitsluitend-lokale-fake-key";
  const curatie = await preflightSysteemLokaal({
    actietype: "generiek_curatie", fondsId: null, provider: null, model: null,
    idempotentie: `${prefix}:curatie`, vingerafdruk: "lokale-curatie", ocrPaginas: 0,
  });
  assert.equal(curatie.uitkomst, "nieuw");
  assert.ok(curatie.actieId);

  const succesIds: string[] = [];
  let calls = onderschepProvider([200]);
  const succes = await ocrMet(`${prefix}:succes`, true, succesIds);
  assert.ok(succes.tekst.includes("Lokale OCR-proefpagina"));
  assert.equal(calls(), 1);
  assert.equal(succesIds.length, 1);
  assert.equal(await status(succesIds[0]), "voltooid");
  assert.equal(await status(curatie.actieId), "in_uitvoering", "OCR sloot curatie niet af");
  console.log("OK succes: eigen OCR-actie voltooid, curatie ongemoeid");

  const foutIds: string[] = [];
  calls = onderschepProvider([400]);
  await assert.rejects(ocrMet(`${prefix}:fout`, true, foutIds), /Mistral OCR 400/);
  assert.equal(calls(), 1);
  assert.equal(foutIds.length, 1);
  assert.equal(await status(foutIds[0]), "mislukt");
  console.log("OK fout: eigen OCR-actie mislukt");

  // De partiële unieke index geeft een mislukte sleutel vrij: een latere
  // herverwerking met dezelfde sleutel mag een NIEUW actie-ID reserveren.
  const zelfdeSleutelIds: string[] = [];
  calls = onderschepProvider([200]);
  await ocrMet(`${prefix}:fout`, true, zelfdeSleutelIds);
  assert.equal(calls(), 1);
  assert.notEqual(zelfdeSleutelIds[0], foutIds[0]);
  assert.equal(await status(foutIds[0]), "mislukt");
  assert.equal(await status(zelfdeSleutelIds[0]), "voltooid");
  console.log("OK idempotentie: mislukte sleutel opnieuw bruikbaar, nieuw actie-ID voltooid");

  const retryIds: string[] = [];
  calls = onderschepProvider([429, 200]);
  const retry = await ocrMet(`${prefix}:retry`, true, retryIds);
  assert.ok(retry.tekst.includes("Lokale OCR-proefpagina"));
  assert.equal(calls(), 2);
  assert.equal(retryIds.length, 2);
  assert.notEqual(retryIds[0], retryIds[1]);
  assert.equal(await status(retryIds[0]), "mislukt");
  assert.equal(await status(retryIds[1]), "voltooid");
  console.log("OK retry: eerste actie mislukt, tweede uniek en voltooid");

  // Ook het fondsgebonden OCR-actietype gebruikt dezelfde afronding, maar
  // behoudt zijn eigen fondsquota en krijgt nooit een globaal-actie-ID.
  const fondsId = randomUUID();
  await db.query("insert into public.fondsen (id, naam, slug) values ($1,'OCR-proeffonds',$2)",
    [fondsId, `ocr-proef-${fondsId}`]);
  const fondsIds: string[] = [];
  calls = onderschepProvider([200]);
  await ocrMet(`${prefix}:fonds`, true, fondsIds, fondsId);
  assert.equal(calls(), 1);
  assert.equal(await status(fondsIds[0]), "voltooid");
  const fondsActie = await db.query<{ actietype: string; fonds_id: string }>(
    "select actietype, fonds_id::text from public.ai_actie where id=$1::uuid", [fondsIds[0]]
  );
  assert.deepEqual(fondsActie.rows[0], { actietype: "ocr", fonds_id: fondsId });
  console.log("OK fonds-OCR: eigen actie en fondsgrens behouden");

  const gemistIds: string[] = [];
  calls = onderschepProvider([200]);
  await ocrMet(`${prefix}:negatief`, false, gemistIds);
  assert.equal(calls(), 1);
  assert.equal(await status(gemistIds[0]), "in_uitvoering",
    "negatieve controle: zonder callback hoort de reservering open te blijven");
  console.log("OK negatieve controle: ontbrekende afronding wordt als open actie gedetecteerd");

  const alleIds = [...succesIds, ...foutIds, ...zelfdeSleutelIds, ...retryIds, ...fondsIds, ...gemistIds];
  const verbruik = await db.query<{ actie_id: string }>(
    "select actie_id::text from public.ai_verbruik_log where actie_id = any($1::uuid[])", [alleIds]
  );
  assert.equal(verbruik.rowCount, 7, "iedere providercall heeft eigen verbruiksfeit");
  assert.equal(await status(curatie.actieId), "in_uitvoering");
  await db.query("rollback");
  transactieOpen = false;

  const residu = await db.query<{ n: string }>(
    "select count(*)::text as n from public.ai_actie where idempotentie_sleutel like $1",
    [`${prefix}%`]
  );
  assert.equal(residu.rows[0].n, "0");
  const logResidu = await db.query<{ n: string }>(
    "select count(*)::text as n from public.ai_verbruik_log where actie_id = any($1::uuid[])",
    [[...alleIds, curatie.actieId]]
  );
  assert.equal(logResidu.rows[0].n, "0");
  const fondsResidu = await db.query<{ n: string }>(
    "select count(*)::text as n from public.fondsen where id=$1::uuid", [fondsId]
  );
  assert.equal(fondsResidu.rows[0].n, "0");
  console.log("OK cleanup: ROLLBACK, 0 acties, 0 verbruiksregels, 0 proeffondsen");
} finally {
  globalThis.fetch = origineleFetch;
  if (origineleKey === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = origineleKey;
  if (transactieOpen) await db.query("rollback");
  await db.end().catch(() => undefined);
}
