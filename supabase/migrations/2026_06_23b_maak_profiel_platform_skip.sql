-- ============================================================================
-- Migratie 2026-06-23b — auto-profiel: platform-accounts overslaan + trigger
-- alsnog in version control brengen.
-- ----------------------------------------------------------------------------
-- CONTEXT: in de live DB bestond al een trigger `bij_registratie` op auth.users
-- die bij ELKE signup `maak_profiel()` draait en een public.profielen-rij
-- aanmaakt (rol=bestuurder, eerste fonds). Die trigger + functie stonden NIET in
-- supabase/migrations/ — alleen los in de DB. Dat (a) maakte ze onzichtbaar voor
-- de repo (CLAUDE.md: code+migraties = bron van waarheid) en (b) botste met het
-- 3b-platformidentiteitsmodel (Increment P0, decisions/0021): een platform-
-- identiteit mag juist GEEN profielen-rij hebben, maar kreeg er door deze trigger
-- automatisch één → de platform-gate weigerde het account.
--
-- DEZE MIGRATIE:
--  1. herdefinieert maak_profiel() met een guard die platform-accounts overslaat
--     (gemarkeerd via raw_user_meta_data {"platform": true}); de tenant-onboarding
--     blijft exact gelijk (zelfde insert, zelfde naam-/fonds-logica);
--  2. herstelt de trigger idempotent, zodat hij vanaf nu in version control staat.
--
-- GEVOLG VOOR BOOTSTRAP: nadat dit live staat hoeft stap 0b van
-- scripts/platform_bootstrap_identiteit.sql niet meer — maak een platform-account
-- met user-metadata {"platform": true} (Supabase → Authentication → Add user →
-- User Metadata) en er wordt geen profiel meer aangemaakt.
--
-- VEILIG: idempotent (create or replace + drop trigger if exists). Raakt bestaande
-- profielen-rijen niet. Bestaande tenant-accounts blijven ongemoeid.
-- ============================================================================

create or replace function public.maak_profiel()
returns trigger
language plpgsql
security definer
as $function$
begin
  -- 3b-guard: platform-back-office-accounts krijgen bewust GEEN tenant-profiel.
  -- Markeer zo'n account bij aanmaak met user-metadata {"platform": true}.
  if coalesce(new.raw_user_meta_data->>'platform', '') = 'true' then
    return new;
  end if;

  -- Ongewijzigde tenant-onboarding: profiel voor het eerste fonds, naam uit
  -- metadata of anders het e-mailadres.
  insert into public.profielen (id, naam, fonds_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'naam', new.email),
    (select id from public.fondsen limit 1)
  );
  return new;
end;
$function$;

-- Trigger idempotent (her)plaatsen — identiek aan de live definitie, nu getrackt.
drop trigger if exists bij_registratie on auth.users;
create trigger bij_registratie
  after insert on auth.users
  for each row execute function public.maak_profiel();
