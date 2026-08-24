-- ============================================================================
-- Migratie 2026-08-24 — profielen.rol wordt NOT NULL
-- ----------------------------------------------------------------------------
-- WAAROM
-- Voorwaarde voor de W7-fase-2-vlagflip (besluit 0188). Onder handhaving
-- (`ENFORCE_CAPABILITY` aan) geeft de capability-poort bij een profiel met
-- `rol IS NULL` een 403 op ELKE route (`reden: "geen-rol"`), want
-- `rolHeeftCapability(null, …)` is false. Vandaag valt dat niet op omdat de
-- meeste routes de rol niet toetsen; onder fase 2 wel.
--
-- De CHECK-constraint op de kolom laat NULL door — een SQL-CHECK evalueert op
-- NULL naar UNKNOWN en blokkeert niet. De kolom is `text DEFAULT 'bestuurder'`
-- ZONDER NOT NULL. De telling is nul op preview én productie (W7-meting
-- 23-08-2026), dus deze migratie is een pure constraint-toevoeging zonder
-- datamigratie.
--
-- FAIL-CLOSED: bestaat er tóch een NULL-rol, dan faalt `SET NOT NULL` met een
-- duidelijke fout en verandert er niets — beter dan stil een default opleggen
-- die een profiel een rol geeft die het nooit bewust kreeg.
--
-- Idempotent: draait de migratie twee keer, dan is de tweede een no-op.
-- ============================================================================

begin;

do $migratie$
declare
  v_nulls bigint;
  v_al_notnull boolean;
begin
  select attnotnull
    into v_al_notnull
    from pg_attribute
   where attrelid = 'public.profielen'::regclass
     and attname = 'rol';

  if v_al_notnull then
    raise notice 'profielen.rol is al NOT NULL — niets te doen.';
    return;
  end if;

  select count(*) into v_nulls from public.profielen where rol is null;
  if v_nulls > 0 then
    raise exception
      'Kan profielen.rol niet op NOT NULL zetten: % rij(en) met rol IS NULL. '
      'Wijs eerst expliciet een rol toe (géén stille default); zie besluit 0188.',
      v_nulls;
  end if;

  alter table public.profielen alter column rol set not null;
  raise notice 'profielen.rol is nu NOT NULL (0 rijen gemigreerd).';
end
$migratie$;

commit;
