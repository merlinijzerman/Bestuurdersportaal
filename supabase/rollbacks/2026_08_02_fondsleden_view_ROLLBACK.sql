-- ROLLBACK van 2026_08_02_fondsleden_view.sql
-- Verwijdert de view. De app valt daarna terug op de bevroren
-- `procedure_eigenaars.gebruiker_naam` — de schermen zijn daar tolerant voor
-- gebouwd, dus dit is geen breaking change (wel weer e-mailadressen in beeld
-- bij accounts zonder ingevulde weergavenaam).
begin;
drop view if exists public.vw_fondsleden;
commit;
