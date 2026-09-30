// ============================================================================
//  WP3 legacy-scan — overlaptest: nooit meer dan LEGACY_SCAN_BATCH legacy-
//  documenten tegelijk in de keten, ook bij overlappende workeraanroepen
//  (Refs #500).
// ----------------------------------------------------------------------------
//  Praat met de ECHTE PostgREST + Postgres van de wegwerpstack (service_role,
//  dezelfde rol als de ingestworker) en draait de productiecode `legacyReaper`
//  uit platform/lib/legacy-scan.ts gelijktijdig, in losse HTTP-requests —
//  precies zoals twee overlappende cron-aanroepen. De keten zelf (clean scan →
//  gescand → embedding → finaliseer) wordt op dezelfde jobrij nagebootst, zoals
//  de worker dat doet (yield/backoff/finaliseer raken dezelfde rij).
//
//  O1  8 gelijktijdige reapers, batch 1                  → 1 in de keten
//  O2  gedwongen interleaving (beide lezen "0 bezet")    → 1 in de keten
//  O3  fase ná de clean scan (gescand/embedding, job open) + 8 reapers → geen nieuw document
//  O4  na finaliseer                                      → precies één volgend document
//  O5  twee "workers" in een lus + sampler, batch 1 en 2  → max ≤ batch
//  O6  batch 0                                            → niets
//  N1  NEGATIEVE CONTROLE: zonder uq_dpj_legacy_slot_open levert O2 twee
//      documenten in de keten op (de test onderscheidt dus wél/niet
//      geserialiseerd). De index wordt daarna hersteld.
//
//  Maat voor "in de keten" is ONAFHANKELIJK van de slotmarkering: het aantal
//  geseede documenten met een open job (welke stap/markering dan ook).
//  Draaien:  TEST_DATABASE_URL=… node --import tsx scripts/legacy-scan-overlap.mts
//  Zonder stack: overslaan; met XTENANT_REQUIRE_DB=1 rood.
// ============================================================================
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { legacyReaper } from "../platform/lib/legacy-scan";

const API = process.env.SUPABASE_API_URL ?? "http://127.0.0.1:54321";
const DB = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const verplicht = process.env.XTENANT_REQUIRE_DB === "1";
const PREFIX = "5e1a0000-0000-4000-8000-0000000000";
const IDS = ["01", "02", "03", "04", "05", "06"].map((n) => `${PREFIX}${n}`);

function stop(bericht: string): never {
  if (verplicht) {
    console.error(`FOUT: ${bericht}`);
    process.exit(1);
  }
  console.log(`OVERGESLAGEN: ${bericht}`);
  process.exit(0);
}

function serviceSleutel(): string {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const commando of [["supabase"], ["npx", "--yes", "supabase@2.114.0"]]) {
    try {
      const [bin, ...voor] = commando;
      const uit = execFileSync(bin, [...voor, "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const status = JSON.parse(uit);
      const sleutel = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? "";
      if (sleutel) return sleutel;
    } catch {
      /* volgende poging */
    }
  }
  return "";
}

const psql = (sql: string) =>
  execFileSync(process.env.PSQL_BIN ?? "psql", [DB, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { encoding: "utf8" }).trim();

if (!DB) stop("geen TEST_DATABASE_URL");
const SLEUTEL = serviceSleutel();
if (!SLEUTEL) stop("geen service_role-sleutel van de stack");
const nieuweClient = (): SupabaseClient =>
  createClient(API, SLEUTEL, { auth: { persistSession: false, autoRefreshToken: false } });

let fouten = 0;
function controle(ok: boolean, label: string, detail = ""): void {
  if (ok) console.log(`OK ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fouten += 1;
    console.error(`LEK ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function inKeten(): number {
  return Number(psql(`select count(distinct document_id) from public.document_processing_jobs
    where status in ('wachtend','bezig') and document_id::text like '${PREFIX}%'`));
}

function reset(): void {
  psql(`delete from public.document_processing_jobs where document_id::text like '${PREFIX}%';
        update public.documenten set verwerkingsstatus = 'beschikbaar', geindexeerd = true,
               scan_resultaat = '{"scan":"uitgesteld_wp3"}'::jsonb
         where id::text like '${PREFIX}%';`);
}

function seed(): void {
  const vreemd = Number(psql(`select count(*) from public.document_processing_jobs
    where legacy_slot is not null and status in ('wachtend','bezig') and document_id::text not like '${PREFIX}%'`));
  if (vreemd > 0) stop(`${vreemd} open legacy-slotjobs buiten deze test — geen schone uitgangssituatie`);
  // Andere selecteerbare legacy-documenten zouden slots van deze test innemen.
  const concurrent = Number(psql(`select count(*) from public.documenten d
    where d.actief and d.opslag_pad is not null and d.id::text not like '${PREFIX}%'
      and (d.bestand_hash is null or d.scan_resultaat is null or d.scan_resultaat->>'verdict' is null
           or d.scan_resultaat->>'verdict' in ('scanner_unreachable','error','stale_definitions'))`));
  if (concurrent > 0) stop(`${concurrent} andere legacy-kandidaten in de test-DB — geen schone uitgangssituatie`);
  psql(`delete from public.documenten where id::text like '${PREFIX}%';
    insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
      bestandstype, opslag_pad, bestand_hash, scan_resultaat, verwerkingsstatus, geindexeerd)
    select v::uuid, null, 'generiek', 'Extern', 'Overlaptest ' || right(v, 2), 'van_kracht', 'actief', true,
           'pdf', 'generiek/' || v || '.pdf', encode(sha256(v::bytea), 'hex'),
           '{"scan":"uitgesteld_wp3"}'::jsonb, 'beschikbaar', true
      from unnest(array[${IDS.map((i) => `'${i}'`).join(",")}]) v;`);
}

// Eén workerstap op de open legacy-job (zelfde rij, zoals de worker):
// scan clean → gescand (yield) → embedding → finaliseer (geslaagd).
function werkerStap(): void {
  psql(`with j as (
      select j.id, j.document_id, d.verwerkingsstatus from public.document_processing_jobs j
        join public.documenten d on d.id = j.document_id
       where j.legacy_slot is not null and j.status in ('wachtend','bezig')
         and j.document_id::text like '${PREFIX}%'
       order by j.aangemaakt limit 1 for update of j skip locked)
    , doc as (
      update public.documenten d set
        verwerkingsstatus = case j.verwerkingsstatus when 'beschikbaar' then 'gescand'
                                                    when 'gescand' then 'embedding' else 'beschikbaar' end,
        scan_resultaat = jsonb_build_object('verdict','clean','sha256', d.bestand_hash),
        geindexeerd = (j.verwerkingsstatus = 'embedding')
        from j where d.id = j.document_id returning j.id, j.verwerkingsstatus)
    update public.document_processing_jobs p set
      status = case when doc.verwerkingsstatus = 'embedding' then 'geslaagd' else 'wachtend' end,
      eind = case when doc.verwerkingsstatus = 'embedding' then now() end
      from doc where p.id = doc.id;`);
}

async function reapers(aantal: number, batch: number): Promise<string[]> {
  const uit = await Promise.all(Array.from({ length: aantal }, () =>
    legacyReaper(nieuweClient(), { batch, nuMs: Date.now() })));
  return uit.flat();
}

// O2/N1: beide aanroepen lezen de slots vóór één van beide heeft ge-insert.
async function gedwongenInterleaving(batch: number): Promise<string[]> {
  let bGelezen!: () => void;
  const bHeeftGelezen = new Promise<void>((r) => { bGelezen = r; });
  let aKlaar!: () => void;
  const aIsKlaar = new Promise<void>((r) => { aKlaar = r; });
  const a = legacyReaper(nieuweClient(), { batch, nuMs: Date.now(), pauze: () => bHeeftGelezen })
    .finally(() => aKlaar());
  const b = legacyReaper(nieuweClient(), {
    batch, nuMs: Date.now(), pauze: async () => { bGelezen(); await aIsKlaar; },
  });
  return (await Promise.all([a, b])).flat();
}

async function lusMetSampler(batch: number, rondes: number): Promise<number> {
  let max = 0;
  let actief = true;
  const sampler = (async () => {
    while (actief) {
      max = Math.max(max, inKeten());
      await new Promise((r) => setTimeout(r, 15));
    }
  })();
  const werker = async () => {
    for (let i = 0; i < rondes; i++) {
      await legacyReaper(nieuweClient(), { batch, nuMs: Date.now() });
      max = Math.max(max, inKeten());
      werkerStap();
      max = Math.max(max, inKeten());
    }
  };
  await Promise.all([werker(), werker()]);
  actief = false;
  await sampler;
  return Math.max(max, inKeten());
}

async function main(): Promise<void> {
  try {
    psql("select 1");
  } catch {
    stop("database niet bereikbaar");
  }
  const index = psql(`select count(*) from pg_indexes where schemaname='public' and indexname='uq_dpj_legacy_slot_open'`);
  controle(index === "1", "O0 index uq_dpj_legacy_slot_open aanwezig");
  seed();

  reset();
  const o1 = await reapers(8, 1);
  controle(inKeten() === 1 && o1.length === 1, "O1 8 gelijktijdige reapers, batch 1", `gestart ${o1.length}, in keten ${inKeten()}`);

  reset();
  const o2 = await gedwongenInterleaving(1);
  controle(inKeten() === 1 && o2.length === 1, "O2 gedwongen interleaving (beide lazen 0 bezet)", `gestart ${o2.length}, in keten ${inKeten()}`);

  // O3: dezelfde keten in de fase ná de clean scan.
  werkerStap(); // → gescand, job wachtend (yield)
  const o3a = await reapers(8, 1);
  werkerStap(); // → embedding, job nog open
  const o3b = await reapers(8, 1);
  controle(o3a.length === 0 && o3b.length === 0 && inKeten() === 1,
    "O3 na clean scan (gescand en embedding) start geen tweede document", `in keten ${inKeten()}`);

  werkerStap(); // → finaliseer: job geslaagd, document beschikbaar
  controle(inKeten() === 0, "O4a keten leeg na finaliseer");
  const o4 = await reapers(8, 1);
  controle(o4.length === 1 && inKeten() === 1 && o4[0] !== o2[0], "O4 precies één volgend document", `${o4[0]?.slice(-2)} na ${o2[0]?.slice(-2)}`);

  reset();
  const max1 = await lusMetSampler(1, 12);
  controle(max1 === 1, "O5 lus met twee overlappende workers, batch 1", `max in keten ${max1}`);
  reset();
  const max2 = await lusMetSampler(2, 12);
  controle(max2 <= 2 && max2 >= 2, "O5 lus met twee overlappende workers, batch 2", `max in keten ${max2}`);

  reset();
  const o6 = await reapers(4, 0);
  controle(o6.length === 0 && inKeten() === 0, "O6 batch 0 pauzeert volledig");

  // N1 — negatieve controle zonder de unieke index.
  reset();
  psql("drop index public.uq_dpj_legacy_slot_open");
  try {
    await gedwongenInterleaving(1);
    const zonder = inKeten();
    controle(zonder >= 2, "N1 negatieve controle: zonder uq_dpj_legacy_slot_open ≥ 2 in de keten", `in keten ${zonder}`);
  } finally {
    reset();
    psql(`create unique index if not exists uq_dpj_legacy_slot_open on public.document_processing_jobs (legacy_slot)
          where legacy_slot is not null and status in ('wachtend','bezig')`);
  }

  psql(`delete from public.document_processing_jobs where document_id::text like '${PREFIX}%';
        delete from public.documenten where id::text like '${PREFIX}%';`);
  if (fouten > 0) {
    console.error(`legacy-scan-overlap: ${fouten} controle(s) rood`);
    process.exit(1);
  }
  console.log("legacy-scan-overlap: alle controles groen");
}

await main();
