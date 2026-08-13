-- 2026_08_14_fase_vi_titel_standaardset.sql
--
-- WO-3-vervolg: de fase VI-titel gelijktrekken met de standaardset —
-- "Nazorg & verantwoording" i.p.v. "Verantwoording & nazorg".
--
-- `procedure_template_fasen` is de LIVE bron voor de fase-accordeon en de
-- fase-weergave (via core/lib/procedure-fasen.ts `laadFasen`) — fase-titels
-- worden niet per procedure gesnapshot. Deze wijziging geldt dus meteen voor
-- alle procedures van dit template. Een fasetitel is pure content: dit raakt
-- stappen, checklist, bewijslast of activatie niet, en tast de
-- snapshot-integriteit van lopende procedures niet aan.
--
-- Idempotent: de titel-guard maakt herhaald draaien een no-op. Geen policy-,
-- grant- of functiewijziging → structurele gates niet vereist.

begin;

update public.procedure_template_fasen
   set titel = 'Nazorg & verantwoording'
 where template_code = 'pf_wtp_invaarbesluit'
   and fase_code = 'VI'
   and titel = 'Verantwoording & nazorg';

commit;
