-- ROLLBACK van 2026_08_27_govevent_notulen.sql (#183b spoor T #5/#6).
-- Herstelt beide RPC's naar hun vorm uit 2026_06_20d_notulen_segmenten.sql
-- (zónder het governance_events-insert). Byte-getrouw.
begin;

create or replace function public.fn_notulen_segment_bevestig(
  p_segment_id uuid,
  p_chunks     jsonb,
  p_reden      text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_seg      record;
  v_status   text;
  v_base     int;
begin
  select id, document_id, vergadering_id, agendapunt_id, bevestigd
    into v_seg
    from public.notulen_segmenten
   where id = p_segment_id;
  if not found then
    raise exception 'Notulensegment % niet gevonden (of geen toegang).', p_segment_id;
  end if;

  select status into v_status from public.documenten where id = v_seg.document_id;
  if v_status is distinct from 'vastgesteld' then
    raise exception 'Notulen % zijn niet vastgesteld (status=%); indexering geweigerd.',
      v_seg.document_id, coalesce(v_status, '(null)');
  end if;

  if p_chunks is null or jsonb_array_length(p_chunks) = 0 then
    raise exception 'Notulensegment % levert geen chunks op; indexering geweigerd.', p_segment_id;
  end if;

  update public.notulen_segmenten
     set bevestigd = true, bevestigd_door = auth.uid(), bevestigd_op = now()
   where id = p_segment_id;

  delete from public.document_chunks
   where document_id = v_seg.document_id and notulen_segment_id is null;
  delete from public.document_chunks
   where notulen_segment_id = p_segment_id;

  select coalesce(max(chunk_index), -1) + 1 into v_base
    from public.document_chunks where document_id = v_seg.document_id;

  insert into public.document_chunks (
    document_id, chunk_index, tekst, pagina, paragraaf,
    embedding, embedding_model, notulen_segment_id, vergadering_id, agendapunt_id
  )
  select
    v_seg.document_id,
    v_base + (c->>'chunk_index')::int,
    c->>'tekst',
    (c->>'pagina')::int,
    c->>'paragraaf',
    case when coalesce(c->>'embedding', '') <> '' then (c->>'embedding')::vector else null end,
    nullif(c->>'embedding_model', ''),
    p_segment_id,
    v_seg.vergadering_id,
    v_seg.agendapunt_id
  from jsonb_array_elements(p_chunks) as c;

  perform public.fn_notulen_segment_audit(
    v_seg.document_id, 'segment_bevestigd',
    case when v_seg.bevestigd then 'true' else 'false' end, 'true',
    p_reden, true
  );
end;
$$;

create or replace function public.fn_notulen_segment_verwijder(
  p_segment_id uuid,
  p_reden      text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_seg record;
begin
  select id, document_id, titel, bevestigd into v_seg
    from public.notulen_segmenten where id = p_segment_id;
  if not found then
    raise exception 'Notulensegment % niet gevonden (of geen toegang).', p_segment_id;
  end if;

  delete from public.notulen_segmenten where id = p_segment_id;

  perform public.fn_notulen_segment_audit(
    v_seg.document_id, 'segment_verwijderd', v_seg.titel, null, p_reden, v_seg.bevestigd
  );
end;
$$;

commit;
