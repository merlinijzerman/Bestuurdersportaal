-- ============================================================================
--  ⚠ PREVIEW-ONLY seed — AI-quotumwaarden (besluit 0180)
--
--  DRAAI DIT NOOIT OP PRODUCTIE. De waarden hieronder zijn het Preview-besluit
--  van 2026-08-15 en zijn afgestemd op een leerfase met een handvol
--  testgebruikers en een Anthropic-werkbudget van USD 150 per maand. Productie
--  krijgt eigen waarden via een eigen seed in een eigen ticket; die waarden
--  volgen uit werkelijk fondsgebruik, niet uit deze.
--
--  Controleer vóór het plakken de projectref in de Supabase-URL:
--      Preview   = swviwoytzvaqypieqgji   ← alleen hier
--      Productie = aebwiufuegsiwhwpdrfb   ← NIET hier
--
--  WAAROM DIT EEN APARTE MIGRATIE IS
--    De basismigratie laat ai_quota_config bewust LEEG, zodat een omgeving die
--    nog niet bewust is geconfigureerd fail-closed dichtstaat in plaats van
--    stilzwijgend met andermans grenzen te draaien. Het invullen van quota is
--    dus een expliciete, per-omgeving handeling.
--
--  IDEMPOTENT: `on conflict do update` — herdraaien zet de waarden terug op de
--  besloten stand. Dat is opzet: deze file is de vastgelegde Preview-nulstand.
--  Een beheerder die de waarden daarna via /platform/ai-begrenzing wijzigt, ziet
--  die wijziging bij een herdraai dus terugvallen. Draai deze seed daarom
--  eenmalig bij inrichting, niet als routine.
--
--  ROLLBACK: 2026_08_16_ai_begrenzing_seed_preview_ROLLBACK.sql
-- ============================================================================

begin;

-- Harde stop als deze seed op een omgeving zonder de basismigratie belandt.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'ai_quota_config'
  ) then
    raise exception 'PREVIEW-SEED FAALT: draai eerst 2026_08_16_ai_begrenzing.sql';
  end if;
end $$;

insert into public.ai_quota_config (sleutel, waarde) values
  ('gebruiker_maand',  150),   -- AI-acties per gebruiker per kalendermaand
  ('fonds_maand',      500),   -- AI-acties per fonds per kalendermaand
  ('globaal_maand',   1200),   -- AI-acties voor heel Preview per kalendermaand
  ('ocr_fonds_maand', 1000)    -- daadwerkelijk aangeboden OCR-pagina's per fonds
on conflict (sleutel) do update
  set waarde = excluded.waarde,
      bijgewerkt = now();

do $$
declare
  n int;
begin
  select count(*) into n from public.ai_quota_config;
  if n <> 4 then
    raise exception 'PREVIEW-SEED FAALT: verwacht 4 quotumrijen, gevonden %', n;
  end if;
  raise notice 'PREVIEW-SEED OK: quota 150 / 500 / 1.200 AI-acties en 1.000 OCR-pagina''s gezet.';
end $$;

commit;

-- ── Verificatie (handmatig ná de seed) ──────────────────────────────────────
--   select sleutel, waarde from public.ai_quota_config order by 1;
--   Verwacht: fonds_maand 500 | gebruiker_maand 150 | globaal_maand 1200 | ocr_fonds_maand 1000
-- ============================================================================
