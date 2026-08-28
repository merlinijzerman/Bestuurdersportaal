-- ROLLBACK van 2026_08_27_govevent_brontabellen.sql (#183b spoor T).
begin;

drop trigger if exists trg_agendapunt_ketengebeurtenis on public.agendapunten;
drop function if exists public.fn_agendapunt_ketengebeurtenis();
drop trigger if exists trg_inbreng_ketengebeurtenis on public.agendapunt_inbreng;
drop function if exists public.fn_inbreng_ketengebeurtenis();
drop trigger if exists trg_vergadering_ketengebeurtenis on public.vergaderingen;
drop function if exists public.fn_vergadering_ketengebeurtenis();
drop trigger if exists trg_orgprofiel_ketengebeurtenis on public.organisatie_profielen;
drop function if exists public.fn_orgprofiel_ketengebeurtenis();
drop trigger if exists trg_stem_ketengebeurtenis on public.stem_uitbrengingen;
drop function if exists public.fn_stem_ketengebeurtenis();

commit;
