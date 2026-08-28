-- ROLLBACK van 2026_08_27_platform_pipeline_operate_capability.sql (besluit 0193).
-- LET OP: draai dit alleen terug als óók de code-union en de 5 worker-routes zijn
-- teruggedraaid — anders schrijven de workers een capability die de seed niet kent
-- (geen FK, dus geen harde fout, maar wel code<->seed-drift op test 17).

begin;

alter table public.platform_identity_capabilities
  drop constraint if exists chk_pic_geen_machinegezag;

delete from public.platform_capabilities
  where capability = 'platform.pipeline.operate';

commit;
