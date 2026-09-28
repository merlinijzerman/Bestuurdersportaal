-- #438 — PREVIEW ONLY: geef de expliciete max-effortcanary vier minuten.
-- De live Opus 5.5-smoke raakte de bestaande 120 s-generatiegrens zonder output.
-- Uitsluitend m365-demo; overige fondsen en Production blijven ongewijzigd.
-- ROLLBACK: ../../rollbacks/2026_09_28_438_max_effort_timeout_canary_ROLLBACK.sql

begin;

do $$
declare
  v_fonds uuid;
  v_huidig jsonb;
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then
    raise exception '#438 max-effortbudget: uitsluitend portal_preview';
  end if;

  select id into strict v_fonds
    from public.fondsen
   where slug = 'm365-demo' and naam = 'Bestuurdersportaal M365 Demo';

  select waarde into strict v_huidig
    from public.fonds_feature_flags
   where fonds_id = v_fonds and flag_key = 'generatie_timeout_ms'
   for update;

  if v_huidig not in ('120000'::jsonb, '240000'::jsonb) then
    raise exception '#438 max-effortbudget: onverwachte huidige waarde %', v_huidig;
  end if;

  update public.fonds_feature_flags
     set waarde = '240000'::jsonb,
         versie = versie + 1,
         bijgewerkt = now(),
         bijgewerkt_door = null
   where fonds_id = v_fonds
     and flag_key = 'generatie_timeout_ms'
     and waarde is distinct from '240000'::jsonb;

  if not exists (select 1 from public.fonds_feature_flags
                  where fonds_id = v_fonds
                    and flag_key = 'generatie_timeout_ms'
                    and waarde = '240000'::jsonb)
  then
    raise exception '#438 max-effortbudget: eindstand niet bereikt';
  end if;
end $$;

commit;
