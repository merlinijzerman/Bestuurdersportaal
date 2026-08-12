-- ============================================================================
-- Migratie 2026-08-12 — T4 Regime-borging (Deel B).
-- ----------------------------------------------------------------------------
-- WAAROM (T4-epic, Deel B): er is geen regime-facet; `organisatietype` is vrije
-- tekst en context-only en de retrieval behandelt alle wet als top-autoriteit.
-- Daardoor haalt de assistent de Pensioenwet (PW) als geldend recht op voor een
-- Wvb-fonds (beroepspensioenfonds). T4 borgt dat het GELDENDE regime leidend is
-- en een niet-geldend regime wordt GEDEMOVEERD (niet uitgesloten), gedreven door
-- gestructureerde, door compliance beheerde velden. De software stelt de
-- juridische kwalificatie NIET zelf vast — die zit in beheerde data.
--
-- WAT (in deze migratie):
--   1. Documentfacet `wettelijk_regime` op documenten (pw/wvb/beide/algemeen;
--      NULL ≡ algemeen) + CHECK.
--   2. Denorm van dat facet naar document_chunks via de bestaande fn_chunk_denorm*
--      (spiegelt exact het bronsoort-denorm-patroon uit 2026_06_20e). Set-based
--      backfill, geen re-embed.
--   3. Fonds-velden `fondstype` + `primair_wettelijk_regime` op fondsen +
--      CHECKs. Compliance/platform-beheerd — de tenant-routes raken fondsen niet.
--   4. Beheerde mapping fondstype → primair_wettelijk_regime als reference-tabel
--      (expliciet in data; compliance-eigenaar), zodat de juridische kwalificatie
--      niet impliciet in code zit. Seed = VOORSTEL, door compliance te bevestigen.
--   5. Horizon-seed (demo-fonds) + de twee zoek-RPC's laten `wettelijk_regime`
--      teruggeven zodat de app-laag (lib/weeg-regime.ts) kan wegen.
--
-- GEEN harde uitsluiting van PW: de weging (app-laag, lib/weeg-regime.ts)
-- herordent alleen. Deze migratie voegt daarom BEWUST geen regime-WHERE-clausule
-- aan de RPC's toe — alleen de return-kolom. `beide`/`algemeen`/NULL worden nooit
-- gedemoveerd.
--
-- OUT OF SCOPE (T4-epic): de curatie-tagging van de ~104 bestaande generieke
-- documenten (aparte curatie-actie). Die staan dus op wettelijk_regime = NULL
-- (≡ algemeen) → worden niet gedemoveerd tot compliance ze tagt. Met lege
-- facetdata is REGIME_WEGING-aan dus feitelijk gedrag-neutraal (non-regressief).
--
-- VOLGORDE: EERST in Supabase draaien (op een kloon + structurele gates), DÁN
-- code-deploy — anders returnt de RPC een kolom die de code nog niet verwacht,
-- of andersom. Idempotent. ROLLBACK: 2026_08_12_t4_regime_borging_ROLLBACK.sql.
--
-- GATES na afloop: supabase/checks/2026_07_31_r1_structurele_gates.sql
-- (F+H: ACL na RPC-drop) + de RLS-leescontrole op de nieuwe reference-tabel.
-- ============================================================================

begin;

-- ── 1. Documentfacet: wettelijk_regime op documenten (additief, nullable) ────
-- Alleen zinvol voor bibliotheek='generiek' (net als bronorganisatie/normgewicht/
-- extern_url uit 2026_06_20e): een fondsdocument erft het geldende regime van het
-- fonds zelf. NULL ≡ 'algemeen' (cross-cutting) → nooit gedemoveerd.
alter table public.documenten
  add column if not exists wettelijk_regime text;

alter table public.documenten drop constraint if exists documenten_wettelijk_regime_check;
alter table public.documenten add  constraint documenten_wettelijk_regime_check
  check (wettelijk_regime is null or wettelijk_regime in ('pw','wvb','beide','algemeen'));

-- ── 2. Denorm naar document_chunks (spiegelt 2026_06_20e blok 2) ─────────────
-- 2a. Nieuwe denorm-kolom (additief, nullable; geen CHECK — die draagt documenten).
alter table public.document_chunks
  add column if not exists wettelijk_regime text;

-- BEWUST GEEN index: anders dan bibliotheek wordt wettelijk_regime NIET in de
-- RPC-WHERE gefilterd (de weging is app-side/demoterend). Een index zou dode
-- ballast zijn. Toevoegen kan alsnog zodra er een SQL-filterpad bij komt.

-- 2b. fn_chunk_denorm uitbreiden — DE enige bron van waarheid (besluit 0010).
-- Alleen wettelijk_regime toevoegen; alle bestaande velden blijven exact gelijk.
-- DROP eerst: het return-type (returns table) wijzigt (1 kolom erbij); de
-- plpgsql-triggers roepen de functie via naam aan (late binding), dus veilig.
drop function if exists public.fn_chunk_denorm(uuid);
create or replace function public.fn_chunk_denorm(p_document_id uuid)
returns table (
  procesmodel_id     uuid,
  procesinstantie_id uuid,
  vergadering_id     uuid,
  agendapunt_id      uuid,
  documenttype       text,
  documentstatus     text,
  documentdatum      date,
  periode            text,
  bronstatus         text,
  geldig_vanaf       date,
  geldig_tot         date,
  bibliotheek        text,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text,
  wettelijk_regime   text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    pr.procesmodel_id,
    d.procesinstantie_id,
    d.vergadering_id,
    d.agendapunt_id,
    d.documenttype,
    d.status as documentstatus,
    d.documentdatum,
    case
      when pr.periode_jaar is not null then pr.periode_jaar::text
      when d.documentdatum is not null then extract(year from d.documentdatum)::text
      else null
    end as periode,
    d.bronstatus,
    d.geldig_vanaf,
    d.geldig_tot,
    d.bibliotheek,
    d.bronorganisatie,
    d.normgewicht,
    d.extern_url,
    d.wettelijk_regime
  from public.documenten d
  left join public.procedures pr on pr.id = d.procesinstantie_id
  where d.id = p_document_id;
$$;

-- 2c. BEFORE INSERT op document_chunks: ook wettelijk_regime vullen. Behoudt de
-- COALESCE-fix uit Increment D (per-segment gezette agendapunt/vergadering blijft).
create or replace function public.fn_chunk_denorm_before_insert()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  select * into v from public.fn_chunk_denorm(new.document_id);
  if found then
    new.procesmodel_id     := v.procesmodel_id;
    new.procesinstantie_id := v.procesinstantie_id;
    new.agendapunt_id      := coalesce(new.agendapunt_id, v.agendapunt_id);
    new.vergadering_id     := coalesce(new.vergadering_id, v.vergadering_id);
    new.documenttype       := v.documenttype;
    new.documentstatus     := v.documentstatus;
    new.documentdatum      := v.documentdatum;
    new.periode            := v.periode;
    new.bronstatus         := v.bronstatus;
    new.geldig_vanaf       := v.geldig_vanaf;
    new.geldig_tot         := v.geldig_tot;
    new.bibliotheek        := v.bibliotheek;
    new.bronorganisatie    := v.bronorganisatie;
    new.normgewicht        := v.normgewicht;
    new.extern_url         := v.extern_url;
    new.wettelijk_regime   := v.wettelijk_regime;
  end if;
  return new;
end;
$$;

-- 2d. AFTER UPDATE op documenten: refresh ook wettelijk_regime (curatiewijziging
-- door platform/service-role werkt door naar de chunks).
create or replace function public.fn_chunk_denorm_refresh()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.document_chunks dc
     set procesmodel_id     = v.procesmodel_id,
         procesinstantie_id = v.procesinstantie_id,
         vergadering_id     = v.vergadering_id,
         agendapunt_id      = v.agendapunt_id,
         documenttype       = v.documenttype,
         documentstatus     = v.documentstatus,
         documentdatum      = v.documentdatum,
         periode            = v.periode,
         bronstatus         = v.bronstatus,
         geldig_vanaf       = v.geldig_vanaf,
         geldig_tot         = v.geldig_tot,
         bibliotheek        = v.bibliotheek,
         bronorganisatie    = v.bronorganisatie,
         normgewicht        = v.normgewicht,
         extern_url         = v.extern_url,
         wettelijk_regime   = v.wettelijk_regime
    from public.fn_chunk_denorm(new.id) v
   where dc.document_id = new.id;
  return new;
end;
$$;

-- De AFTER UPDATE-trigger luistert nu ook naar wettelijk_regime, zodat een
-- regime-curatiewijziging op documenten doorwerkt naar de chunks.
drop trigger if exists trg_chunk_denorm_refresh on public.documenten;
create trigger trg_chunk_denorm_refresh
  after update of procesinstantie_id, vergadering_id, agendapunt_id, documenttype,
                  status, bronstatus, documentdatum, geldig_vanaf, geldig_tot,
                  bibliotheek, bronorganisatie, normgewicht, extern_url,
                  wettelijk_regime
  on public.documenten
  for each row execute procedure public.fn_chunk_denorm_refresh();

-- 2e. Backfill bestaande chunks (set-based, geen re-embed). Idempotent.
update public.document_chunks dc
   set wettelijk_regime = d.wettelijk_regime
  from public.documenten d
 where dc.document_id = d.id
   and dc.wettelijk_regime is distinct from d.wettelijk_regime;

-- ── 3. Fonds-velden: fondstype + primair_wettelijk_regime op fondsen ─────────
-- Compliance/platform-beheerd (besluit: op fondsen, NIET op organisatie_profielen
-- — dat is tenant-zelfservice, besluit 0039; het geldende regime mag niet door de
-- tenant zelf muteerbaar zijn). Nullable; NULL ≡ algemeen → geen demotie.
alter table public.fondsen
  add column if not exists fondstype                text,
  add column if not exists primair_wettelijk_regime text;

alter table public.fondsen drop constraint if exists fondsen_fondstype_check;
alter table public.fondsen add  constraint fondsen_fondstype_check
  check (fondstype is null or fondstype in
    ('bedrijfstak','onderneming','beroeps','apf','algemeen'));

alter table public.fondsen drop constraint if exists fondsen_primair_wettelijk_regime_check;
alter table public.fondsen add  constraint fondsen_primair_wettelijk_regime_check
  check (primair_wettelijk_regime is null or primair_wettelijk_regime in
    ('pw','wvb','beide','algemeen'));

-- ── 4. Beheerde mapping fondstype → regime (expliciet in data) ───────────────
-- De juridische kwalificatie zit HIER (data), niet impliciet in code (T4-DoD).
-- Reference/governance-tabel; compliance is eigenaar. De retrieval leest het
-- AUTHORITATIEVE per-fonds veld fondsen.primair_wettelijk_regime (zodat een fonds
-- desnoods afwijkend gezet kan worden); deze tabel legt de generieke regel vast
-- en dient als bron voor een toekomstige beheer-UI + de consistentiecontrole (§6).
create table if not exists public.wettelijk_regime_per_fondstype (
  -- fondstype is de reference-sleutel; GEEN FK (het is een codelijst-waarde, geen
  -- rij-verwijzing). De CHECK spiegelt fondsen_fondstype_check.
  fondstype                text primary key
    check (fondstype in ('bedrijfstak','onderneming','beroeps','apf','algemeen')),
  primair_wettelijk_regime text not null
    check (primair_wettelijk_regime in ('pw','wvb','beide','algemeen')),
  toelichting              text,
  bevestigd_door_compliance boolean not null default false,
  aangemaakt               timestamptz not null default now()
);

comment on table public.wettelijk_regime_per_fondstype is
  'T4 — beheerde mapping fondstype → primair_wettelijk_regime (juridische '
  'kwalificatie in DATA, niet in code). Compliance-eigenaar. Seed = voorstel; '
  'bevestigd_door_compliance markeert per rij of compliance de kwalificatie heeft '
  'bevestigd. Retrieval leest fondsen.primair_wettelijk_regime, niet deze tabel.';

-- Seed = VOORSTEL (bevestigd_door_compliance = false): beroepspensioenfondsen
-- vallen onder de Wvb, overige pensioenfondsen (bedrijfstak/onderneming/APF) onder
-- de Pensioenwet. Dit is de premisse van de T4-epic zelf; compliance bevestigt.
insert into public.wettelijk_regime_per_fondstype
  (fondstype, primair_wettelijk_regime, toelichting)
values
  ('bedrijfstak', 'pw',       'Bedrijfstakpensioenfonds — Pensioenwet.'),
  ('onderneming', 'pw',       'Ondernemingspensioenfonds — Pensioenwet.'),
  ('apf',         'pw',       'Algemeen pensioenfonds (APF) — Pensioenwet.'),
  ('beroeps',     'wvb',      'Beroepspensioenfonds — Wet verplichte beroepspensioenregeling.'),
  ('algemeen',    'algemeen', 'Onbepaald/cross-cutting — geen demotie.')
on conflict (fondstype) do nothing;

-- RLS: globale reference-tabel (T3-register-patroon). Leesbaar voor iedere
-- authenticated (toekomstige beheer-UI); GEEN tenant-schrijfpolicy — compliance/
-- platform muteert via het service-role-pad. anon nergens.
alter table public.wettelijk_regime_per_fondstype enable row level security;
drop policy if exists "regime-mapping lezen" on public.wettelijk_regime_per_fondstype;
create policy "regime-mapping lezen" on public.wettelijk_regime_per_fondstype
  for select using (true);
revoke all on table public.wettelijk_regime_per_fondstype from public, anon;
grant select on table public.wettelijk_regime_per_fondstype to authenticated, service_role;

-- ── 5. Horizon-seed (demo-fonds) ─────────────────────────────────────────────
-- Horizon is een regulier (niet-beroeps) pensioenfonds → primair regime = PW.
-- Dat regime is zeker: alleen beroepspensioenfondsen vallen onder de Wvb. De
-- EXACTE fondstype (BPF/OPF/APF) is een compliance-detail en blijft bewust NULL
-- (geen schijnzekerheid) tot compliance die invult. NULL-fondstype tast de
-- weging niet aan — die leest primair_wettelijk_regime.
update public.fondsen
   set primair_wettelijk_regime = 'pw'
 where slug = 'horizon'
   and primair_wettelijk_regime is distinct from 'pw';

-- ── 6. Verificatie (informatief; verschijnt in de migratie-output) ───────────
do $$
declare
  v_chunks_zonder_regime bigint;
  v_fonds_drift          bigint;
begin
  -- Denorm-backfill: chunks met NULL-regime terwijl het document er een draagt (0).
  select count(*) into v_chunks_zonder_regime
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
   where dc.wettelijk_regime is null and d.wettelijk_regime is not null;
  raise notice 'T4 regime-denorm: % chunks met NULL-regime terwijl het document er een draagt (verwacht 0).',
    v_chunks_zonder_regime;

  -- Consistentie fonds ↔ mapping: fondsen met een fondstype waarvan het
  -- primair_wettelijk_regime afwijkt van de beheerde mapping (verwacht 0; drift =
  -- bewuste override of fout, in beide gevallen zichtbaar te maken voor compliance).
  select count(*) into v_fonds_drift
    from public.fondsen f
    join public.wettelijk_regime_per_fondstype m on m.fondstype = f.fondstype
   where f.primair_wettelijk_regime is distinct from m.primair_wettelijk_regime;
  raise notice 'T4 fonds↔mapping-drift: % fondsen wijken af van de beheerde mapping (verwacht 0; onderzoek elke afwijking met compliance).',
    v_fonds_drift;
end $$;

commit;

-- ============================================================================
-- 7. Zoek-RPC's: `wettelijk_regime` toevoegen aan de RETURN (geen WHERE-filter)
-- ----------------------------------------------------------------------------
-- Byte-identiek aan 2026_08_10_rpc_gearchiveerd_poort.sql, met UITSLUITEND:
--   - `wettelijk_regime text` als extra return-kolom, en
--   - `dc.wettelijk_regime` (resp. c.wettelijk_regime) in de select.
-- GEEN wijziging aan enige WHERE/order-by/limit — de weging is app-side en
-- demoterend, dus de RPC's blijven qua bereik/volgorde ongewijzigd. Het
-- return-type wijzigt (1 kolom erbij) → drop-and-recreate, met de ACL opnieuw.
-- Aparte transactie ná de DDL hierboven (de kolom moet al bestaan).
-- ============================================================================

begin;

-- ── 7a. FTS-route: zoek_chunks ───────────────────────────────────────────────
drop function if exists public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid);

create or replace function public.zoek_chunks(
  p_query               text,
  p_limit               int    default 20,
  p_document_ids        uuid[] default null,
  p_bronstatus          text[] default null,
  p_documentstatus      text[] default null,
  p_procesinstantie_ids uuid[] default null,
  p_modus               text   default 'alles',
  p_peildatum           date   default current_date,
  p_bronsoort           text[] default null,
  p_fonds_id            uuid   default null
)
returns table (
  id                 uuid,
  document_id        uuid,
  tekst              text,
  pagina             int,
  paragraaf          text,
  chunk_index        int,
  titel              text,
  bron               text,
  bibliotheek        text,
  opslag_pad         text,
  rang               real,
  documentstatus     text,
  bronstatus         text,
  documentdatum      date,
  geldig_vanaf       date,
  geldig_tot         date,
  procesinstantie_id uuid,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text,
  fonds_id           uuid,
  volgende_review    date,
  wettelijk_regime   text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.document_id,
    c.tekst,
    c.pagina,
    c.paragraaf,
    c.chunk_index,
    d.titel,
    d.bron,
    d.bibliotheek,
    d.opslag_pad,
    ts_rank_cd(c.zoek_vector, q.query) as rang,
    c.documentstatus,
    c.bronstatus,
    c.documentdatum,
    c.geldig_vanaf,
    c.geldig_tot,
    c.procesinstantie_id,
    c.bronorganisatie,
    c.normgewicht,
    c.extern_url,
    d.fonds_id,
    d.volgende_review,
    c.wettelijk_regime
  from public.document_chunks c
  join public.documenten d on d.id = c.document_id
  cross join websearch_to_tsquery('dutch', p_query) as q(query)
  where d.actief = true
    -- 0154 §3: gearchiveerd universeel uit (NULL-veilig).
    and c.documentstatus is distinct from 'gearchiveerd'
    and c.zoek_vector @@ q.query
    and (p_document_ids is null or c.document_id = any(p_document_ids))
    and (
      p_modus is distinct from 'actueel'
      or (
        c.documentstatus in ('vastgesteld','van_kracht')
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (c.geldig_vanaf is null or c.geldig_vanaf <= p_peildatum)
        and (c.geldig_tot   is null or c.geldig_tot   >= p_peildatum)
      )
    )
    and (p_bronstatus          is null or coalesce(c.bronstatus,'actief') = any(p_bronstatus))
    and (p_documentstatus      is null or c.documentstatus     = any(p_documentstatus))
    and (p_procesinstantie_ids is null or c.procesinstantie_id = any(p_procesinstantie_ids))
    and (p_bronsoort           is null or c.bibliotheek         = any(p_bronsoort))
    and (p_fonds_id is null or d.fonds_id = p_fonds_id or c.bibliotheek = 'generiek')
    and (
      c.bibliotheek is distinct from 'generiek'
      or (
        c.documentstatus = 'van_kracht'
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (d.volgende_review is null or d.volgende_review >= p_peildatum)
      )
    )
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;

comment on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) is
  'RAG-retrieval (ts_rank_cd) met documentscope + Increment G-filters + T4 expliciete fondsfilter en published-only generiek (van_kracht+actief), aangevuld met de T10 review-verval-gate (volgende_review >= p_peildatum OR NULL) en (0154 §3) de universele gearchiveerd-uitsluiting. Returnt d.fonds_id + d.volgende_review + (T4/regime-borging) c.wettelijk_regime voor de app-side demotie. Filter is ADDITIEF op RLS (defense-in-depth). SECURITY INVOKER: RLS blijft primair. Defaults = huidig gedrag.';

revoke all on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) from public, anon;
grant execute on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) to authenticated, service_role;

-- ── 7b. Hybride route: zoek_chunks_hybride ───────────────────────────────────
drop function if exists public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid);

create or replace function public.zoek_chunks_hybride(
  p_query               text,
  p_embedding           vector(1024),
  p_limit               int    default 10,
  p_kandidaten          int    default 40,
  p_k                   int    default 60,
  p_document_ids        uuid[] default null,
  p_bronstatus          text[] default null,
  p_documentstatus      text[] default null,
  p_procesinstantie_ids uuid[] default null,
  p_modus               text   default 'alles',
  p_peildatum           date   default current_date,
  p_bronsoort           text[] default null,
  p_fonds_id            uuid   default null
)
returns table (
  id                 uuid,
  document_id        uuid,
  tekst              text,
  pagina             int,
  paragraaf          text,
  chunk_index        int,
  titel              text,
  bron               text,
  bibliotheek        text,
  opslag_pad         text,
  rang               real,
  fts_rang           int,
  vec_rang           int,
  documentstatus     text,
  bronstatus         text,
  documentdatum      date,
  geldig_vanaf       date,
  geldig_tot         date,
  procesinstantie_id uuid,
  bronorganisatie    text,
  normgewicht        text,
  extern_url         text,
  fonds_id           uuid,
  volgende_review    date,
  wettelijk_regime   text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select websearch_to_tsquery('dutch', p_query) as tsq
  ),
  fts as (
    select dc.id,
           row_number() over (order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    cross join q
    where d.actief = true
      and dc.documentstatus is distinct from 'gearchiveerd'   -- 0154 §3 (NULL-veilig)
      and dc.zoek_vector @@ q.tsq
      and (p_document_ids is null or dc.document_id = any(p_document_ids))
      and (
        p_modus is distinct from 'actueel'
        or (
          dc.documentstatus in ('vastgesteld','van_kracht')
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (dc.geldig_vanaf is null or dc.geldig_vanaf <= p_peildatum)
          and (dc.geldig_tot   is null or dc.geldig_tot   >= p_peildatum)
        )
      )
      and (p_bronstatus          is null or coalesce(dc.bronstatus,'actief') = any(p_bronstatus))
      and (p_documentstatus      is null or dc.documentstatus     = any(p_documentstatus))
      and (p_procesinstantie_ids is null or dc.procesinstantie_id = any(p_procesinstantie_ids))
      and (p_bronsoort           is null or dc.bibliotheek         = any(p_bronsoort))
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (
          dc.documentstatus = 'van_kracht'
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (d.volgende_review is null or d.volgende_review >= p_peildatum)
        )
      )
    order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id
    limit p_kandidaten
  ),
  vec as (
    select dc.id,
           row_number() over (order by dc.embedding <=> p_embedding, dc.id) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    where d.actief = true
      and dc.documentstatus is distinct from 'gearchiveerd'   -- 0154 §3 (NULL-veilig)
      and dc.embedding is not null
      and (p_document_ids is null or dc.document_id = any(p_document_ids))
      and (
        p_modus is distinct from 'actueel'
        or (
          dc.documentstatus in ('vastgesteld','van_kracht')
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (dc.geldig_vanaf is null or dc.geldig_vanaf <= p_peildatum)
          and (dc.geldig_tot   is null or dc.geldig_tot   >= p_peildatum)
        )
      )
      and (p_bronstatus          is null or coalesce(dc.bronstatus,'actief') = any(p_bronstatus))
      and (p_documentstatus      is null or dc.documentstatus     = any(p_documentstatus))
      and (p_procesinstantie_ids is null or dc.procesinstantie_id = any(p_procesinstantie_ids))
      and (p_bronsoort           is null or dc.bibliotheek         = any(p_bronsoort))
      and (p_fonds_id is null or d.fonds_id = p_fonds_id or dc.bibliotheek = 'generiek')
      and (
        dc.bibliotheek is distinct from 'generiek'
        or (
          dc.documentstatus = 'van_kracht'
          and coalesce(dc.bronstatus,'actief') = 'actief'
          and (d.volgende_review is null or d.volgende_review >= p_peildatum)
        )
      )
    order by dc.embedding <=> p_embedding, dc.id
    limit p_kandidaten
  ),
  samen as (
    select coalesce(fts.id, vec.id) as id,
           fts.r as fts_rang,
           vec.r as vec_rang,
           coalesce(1.0 / (p_k + fts.r), 0) + coalesce(1.0 / (p_k + vec.r), 0) as rrf
    from fts
    full outer join vec on fts.id = vec.id
  )
  select dc.id, dc.document_id, dc.tekst, dc.pagina, dc.paragraaf, dc.chunk_index,
         d.titel, d.bron, d.bibliotheek, d.opslag_pad,
         s.rrf::real as rang, s.fts_rang, s.vec_rang,
         dc.documentstatus, dc.bronstatus, dc.documentdatum,
         dc.geldig_vanaf, dc.geldig_tot, dc.procesinstantie_id,
         dc.bronorganisatie, dc.normgewicht, dc.extern_url,
         d.fonds_id,
         d.volgende_review,
         dc.wettelijk_regime
  from samen s
  join public.document_chunks dc on dc.id = s.id
  join public.documenten d on d.id = dc.document_id
  where d.actief = true
  order by s.rrf desc, dc.id
  limit p_limit;
$$;

comment on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) is
  'Hybride RAG-retrieval (FTS+vector via RRF) met documentscope + Increment G-filters + T4 fondsfilter + published-only generiek + T10 review-verval-gate, in BEIDE armen vóór de fusion, aangevuld met (0154 §3) de universele gearchiveerd-uitsluiting. Besluit 0139: deterministische tiebreaker (, dc.id) op alle order-by-clausules. Returnt (T4/regime-borging) dc.wettelijk_regime voor de app-side demotie (geen WHERE-filter). hnsw.ef_search NIET op de functie gezet (Supabase weigert dit, 42501) — blijft default 40, apart belegd. Additief op RLS (defense-in-depth). SECURITY INVOKER: RLS blijft primair. Defaults = huidig gedrag.';

revoke all on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) from public, anon;
grant execute on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) to authenticated, service_role;

commit;

-- ============================================================================
-- CONTROLE (op de kloon, ná COMMIT)
-- ============================================================================
-- 1. Kolommen bestaan:
--   select column_name from information_schema.columns
--    where table_name='documenten' and column_name='wettelijk_regime';
--   select column_name from information_schema.columns
--    where table_name='document_chunks' and column_name='wettelijk_regime';
--   select column_name from information_schema.columns
--    where table_name='fondsen' and column_name in ('fondstype','primair_wettelijk_regime');
-- 2. Beide RPC's bestaan met de nieuwe ACL (gate F+H):
--   select proname, proacl from pg_proc where proname in ('zoek_chunks','zoek_chunks_hybride');
-- 3. Reference-tabel + RLS: select is toegestaan voor authenticated, anon niet.
-- 4. Denorm werkt: update één generiek document naar wettelijk_regime='pw' en
--    bevestig dat de bijbehorende chunks meebewegen (trg_chunk_denorm_refresh).
-- 5. AQLab regime-regressieset before/after: nul onverklaarde verschuivingen op de
--    huidige populatie (facetdata nog leeg → geen demotie).
