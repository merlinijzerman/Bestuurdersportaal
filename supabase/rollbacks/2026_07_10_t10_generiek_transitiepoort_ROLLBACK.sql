-- ============================================================================
-- ROLLBACK van 2026_07_10_t10_generiek_transitiepoort.sql (Increment T10).
-- ----------------------------------------------------------------------------
-- Verwijdert de generieke toestandsmachine en herstelt de bestaande fonds-
-- lifecycle-statustrigger (2026_06_18) naar de body ZONDER generiek-skip.
-- LET OP: draai dit alleen samen met de code-rollback; zonder de generieke
-- transitiepoort valt de generieke content terug op alléén de fonds-lifecycle-
-- trigger (die deprecated→published verbiedt) plus de app-laag-validatie.
-- ============================================================================

drop trigger if exists trg_generiek_status_overgang on public.documenten;
drop function if exists public.fn_generiek_status_overgang_check();
drop function if exists public.fn_generiek_transitie(text, text);
drop function if exists public.fn_generiek_geldigheidsstatus(text, text);

-- Herstel de originele fonds-lifecycle-statustrigger-body (2026_06_18, TO §3.1),
-- zonder de T10 generiek-skip.
create or replace function public.fn_document_status_overgang_check()
returns trigger language plpgsql as $$
declare
  v_toegestaan boolean;
begin
  if new.status is distinct from old.status then
    if coalesce(current_setting('app.status_transitie_bypass', true), 'off') = 'on' then
      return new;
    end if;
    if old.status is null then
      return new;
    end if;
    select toegestaan into v_toegestaan
      from public.fn_document_status_transitie(old.status, new.status);
    if not coalesce(v_toegestaan, false) then
      raise exception
        'Ongeldige documentstatus-overgang: % → % (niet toegestaan volgens transitietabel TO §3.1)',
        old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;
