-- ROLLBACK van 2026_08_27_govevent_stemmingen.sql (#183b spoor T, stemmingen).
begin;

drop trigger if exists trg_stemming_ketengebeurtenis on public.stemmingen;
drop function if exists public.fn_stemming_ketengebeurtenis();

commit;
