-- ============================================================================
-- ROLLBACK 2026-08-12 — T4 Regime-borging terugdraaien.
-- ----------------------------------------------------------------------------
-- Herstelt de pre-T4-toestand:
--   - fn_chunk_denorm* + trg_chunk_denorm_refresh terug naar de 2026_06_20e-versie
--     (ZONDER wettelijk_regime).
--   - zoek_chunks / zoek_chunks_hybride terug naar de 2026_08_10-versie
--     (ZONDER wettelijk_regime), inclusief ACL-hygiëne.
--   - drop van de reference-tabel, de fonds-velden, en de facet-/denorm-kolommen.
--
-- LET OP: draai dit alleen als de code-deploy die wettelijk_regime uit de RPC-
-- return leest, óók is teruggedraaid — anders leest de code een kolom die de RPC
-- niet meer teruggeeft.
-- ============================================================================

begin;

-- ── 1. fn_chunk_denorm* terug naar 2026_06_20e (zonder wettelijk_regime) ─────
drop function if exists public.fn_chunk_denorm(uuid);
create or replace function public.fn_chunk_denorm(p_document_id uuid)
returns table (
  procesmodel_id uuid, procesinstantie_id uuid, vergadering_id uuid,
  agendapunt_id uuid, documenttype text, documentstatus text, documentdatum date,
  periode text, bronstatus text, geldig_vanaf date, geldig_tot date,
  bibliotheek text, bronorganisatie text, normgewicht text, extern_url text
)
language sql stable security invoker set search_path = public, pg_temp
as $$
  select
    pr.procesmodel_id, d.procesinstantie_id, d.vergadering_id, d.agendapunt_id,
    d.documenttype, d.status as documentstatus, d.documentdatum,
    case
      when pr.periode_jaar is not null then pr.periode_jaar::text
      when d.documentdatum is not null then extract(year from d.documentdatum)::text
      else null
    end as periode,
    d.bronstatus, d.geldig_vanaf, d.geldig_tot,
    d.bibliotheek, d.bronorganisatie, d.normgewicht, d.extern_url
  from public.documenten d
  left join public.procedures pr on pr.id = d.procesinstantie_id
  where d.id = p_document_id;
$$;

create or replace function public.fn_chunk_denorm_before_insert()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v record;
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
  end if;
  return new;
end;
$$;

create or replace function public.fn_chunk_denorm_refresh()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  update public.document_chunks dc
     set procesmodel_id = v.procesmodel_id, procesinstantie_id = v.procesinstantie_id,
         vergadering_id = v.vergadering_id, agendapunt_id = v.agendapunt_id,
         documenttype = v.documenttype, documentstatus = v.documentstatus,
         documentdatum = v.documentdatum, periode = v.periode,
         bronstatus = v.bronstatus, geldig_vanaf = v.geldig_vanaf,
         geldig_tot = v.geldig_tot, bibliotheek = v.bibliotheek,
         bronorganisatie = v.bronorganisatie, normgewicht = v.normgewicht,
         extern_url = v.extern_url
    from public.fn_chunk_denorm(new.id) v
   where dc.document_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_chunk_denorm_refresh on public.documenten;
create trigger trg_chunk_denorm_refresh
  after update of procesinstantie_id, vergadering_id, agendapunt_id, documenttype,
                  status, bronstatus, documentdatum, geldig_vanaf, geldig_tot,
                  bibliotheek, bronorganisatie, normgewicht, extern_url
  on public.documenten
  for each row execute procedure public.fn_chunk_denorm_refresh();

-- ── 2. Kolommen + reference-tabel weg ────────────────────────────────────────
alter table public.document_chunks drop column if exists wettelijk_regime;

alter table public.documenten drop constraint if exists documenten_wettelijk_regime_check;
alter table public.documenten drop column if exists wettelijk_regime;

alter table public.fondsen drop constraint if exists fondsen_fondstype_check;
alter table public.fondsen drop constraint if exists fondsen_primair_wettelijk_regime_check;
alter table public.fondsen drop column if exists fondstype;
alter table public.fondsen drop column if exists primair_wettelijk_regime;

drop table if exists public.wettelijk_regime_per_fondstype;

commit;

-- ── 3. Zoek-RPC's terug naar 2026_08_10 (zonder wettelijk_regime) ────────────
begin;

drop function if exists public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid);
create or replace function public.zoek_chunks(
  p_query text, p_limit int default 20, p_document_ids uuid[] default null,
  p_bronstatus text[] default null, p_documentstatus text[] default null,
  p_procesinstantie_ids uuid[] default null, p_modus text default 'alles',
  p_peildatum date default current_date, p_bronsoort text[] default null,
  p_fonds_id uuid default null
)
returns table (
  id uuid, document_id uuid, tekst text, pagina int, paragraaf text,
  chunk_index int, titel text, bron text, bibliotheek text, opslag_pad text,
  rang real, documentstatus text, bronstatus text, documentdatum date,
  geldig_vanaf date, geldig_tot date, procesinstantie_id uuid,
  bronorganisatie text, normgewicht text, extern_url text, fonds_id uuid,
  volgende_review date
)
language sql stable security invoker set search_path = public, pg_temp
as $$
  select
    c.id, c.document_id, c.tekst, c.pagina, c.paragraaf, c.chunk_index,
    d.titel, d.bron, d.bibliotheek, d.opslag_pad,
    ts_rank_cd(c.zoek_vector, q.query) as rang,
    c.documentstatus, c.bronstatus, c.documentdatum, c.geldig_vanaf, c.geldig_tot,
    c.procesinstantie_id, c.bronorganisatie, c.normgewicht, c.extern_url,
    d.fonds_id, d.volgende_review
  from public.document_chunks c
  join public.documenten d on d.id = c.document_id
  cross join websearch_to_tsquery('dutch', p_query) as q(query)
  where d.actief = true
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
revoke all on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) from public, anon;
grant execute on function public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) to authenticated, service_role;

drop function if exists public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid);
create or replace function public.zoek_chunks_hybride(
  p_query text, p_embedding vector(1024), p_limit int default 10,
  p_kandidaten int default 40, p_k int default 60, p_document_ids uuid[] default null,
  p_bronstatus text[] default null, p_documentstatus text[] default null,
  p_procesinstantie_ids uuid[] default null, p_modus text default 'alles',
  p_peildatum date default current_date, p_bronsoort text[] default null,
  p_fonds_id uuid default null
)
returns table (
  id uuid, document_id uuid, tekst text, pagina int, paragraaf text,
  chunk_index int, titel text, bron text, bibliotheek text, opslag_pad text,
  rang real, fts_rang int, vec_rang int, documentstatus text, bronstatus text,
  documentdatum date, geldig_vanaf date, geldig_tot date, procesinstantie_id uuid,
  bronorganisatie text, normgewicht text, extern_url text, fonds_id uuid,
  volgende_review date
)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with q as (select websearch_to_tsquery('dutch', p_query) as tsq),
  fts as (
    select dc.id,
           row_number() over (order by ts_rank_cd(dc.zoek_vector, q.tsq) desc, dc.id) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    cross join q
    where d.actief = true
      and dc.documentstatus is distinct from 'gearchiveerd'
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
      and dc.documentstatus is distinct from 'gearchiveerd'
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
    select coalesce(fts.id, vec.id) as id, fts.r as fts_rang, vec.r as vec_rang,
           coalesce(1.0 / (p_k + fts.r), 0) + coalesce(1.0 / (p_k + vec.r), 0) as rrf
    from fts full outer join vec on fts.id = vec.id
  )
  select dc.id, dc.document_id, dc.tekst, dc.pagina, dc.paragraaf, dc.chunk_index,
         d.titel, d.bron, d.bibliotheek, d.opslag_pad,
         s.rrf::real as rang, s.fts_rang, s.vec_rang,
         dc.documentstatus, dc.bronstatus, dc.documentdatum,
         dc.geldig_vanaf, dc.geldig_tot, dc.procesinstantie_id,
         dc.bronorganisatie, dc.normgewicht, dc.extern_url,
         d.fonds_id, d.volgende_review
  from samen s
  join public.document_chunks dc on dc.id = s.id
  join public.documenten d on d.id = dc.document_id
  where d.actief = true
  order by s.rrf desc, dc.id
  limit p_limit;
$$;
revoke all on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) from public, anon;
grant execute on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid) to authenticated, service_role;

commit;
