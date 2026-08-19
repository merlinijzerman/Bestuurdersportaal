-- ROLLBACK van 2026_08_14_fase_vi_titel_standaardset.sql
-- Zet de fase VI-titel terug naar de oorspronkelijke D8-seedwaarde.

begin;

update public.procedure_template_fasen
   set titel = 'Verantwoording & nazorg'
 where template_code = 'pf_wtp_invaarbesluit'
   and fase_code = 'VI'
   and titel = 'Nazorg & verantwoording';

commit;
