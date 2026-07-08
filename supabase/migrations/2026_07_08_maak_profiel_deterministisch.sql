-- ============================================================================
-- Migratie 2026-07-08 — R1 (increment T2): deterministische fondstoewijzing bij
-- registratie. Vervangt de impliciete `(select id from public.fondsen limit 1)`
-- in maak_profiel() door een expliciet, uit de user-metadata afgeleid fonds.
-- ----------------------------------------------------------------------------
-- CONTEXT: de trigger `bij_registratie` (2026-06-23b) draait bij ELKE signup
-- maak_profiel() en koppelde het nieuwe profiel aan het EERSTE fonds
-- (`limit 1`). Zolang er één fonds is valt dat toevallig goed uit; bij een
-- tweede fonds koppelt élke nieuwe registratie stil aan fonds 1 — een
-- cross-tenant-fout die geruisloos ontstaat (werkopdracht T2, R1; besluit 0040
-- B4 + beslisnotitie multi-tenant v0.4 §14). De DB-trigger heeft géén
-- request-host/resolver-context (die uit T1 leeft in de serverlaag), dus de
-- deterministische bron moet op signup-moment al vaststaan.
--
-- GEKOZEN MECHANISME (decisions/0044, variant a — metadata-gedreven): het fonds
-- komt UITSLUITEND uit `raw_user_meta_data.fonds_id`, gezet bij het aanmaken van
-- het account (Supabase → Authentication → Add user → User Metadata, naast de
-- reeds gebruikte velden `naam` en `platform`). Er is geen self-service signup
-- en geen uitnodigingstabel; accounts worden handmatig aangemaakt, dus de
-- beheerder zet `fonds_id` in dezelfde stap als `naam`.
--
-- FAIL-CLOSED, LUID (variant A): ontbreekt `fonds_id`, is het geen geldige UUID,
-- of bestaat het fonds niet, dan `raise exception`. De AFTER-INSERT-trigger rolt
-- daarmee de auth.users-insert terug → er ontstaat NOOIT een account met een
-- leeg of verkeerd fonds. Bewust GEEN "eerste fonds"/`limit 1`-fallback en geen
-- default-fonds — in geen enkele tak.
--
-- BEHOUDEN: de 3b-platform-skip-guard (platform-back-office-accounts krijgen
-- bewust géén tenant-profiel) staat ongewijzigd als eerste check. maak_profiel()
-- blijft SECURITY DEFINER (draait op de auth-trigger). RLS wordt niet geraakt:
-- dit is identity-hardening (de bron van fonds_id), geen RLS-wijziging — RLS per
-- fonds_id blijft de primaire tenant-isolatie.
--
-- BESTAANDE PROFIELEN: ongemoeid. De trigger vuurt alleen op NIEUWE inserts;
-- geen backfill, geen verschuiving van bestaande koppelingen.
--
-- VEILIG: idempotent (create or replace + drop trigger if exists). Terugrol via
-- 2026_07_08_maak_profiel_deterministisch_ROLLBACK.sql (herstelt de 06_23b-body).
-- ============================================================================

create or replace function public.maak_profiel()
returns trigger
language plpgsql
security definer
as $function$
declare
  v_fonds_tekst text;
  v_fonds_id    uuid;
begin
  -- 3b-guard (2026-06-23b, ongewijzigd): platform-back-office-accounts krijgen
  -- bewust GEEN tenant-profiel. Markeer zo'n account met {"platform": true}.
  if coalesce(new.raw_user_meta_data->>'platform', '') = 'true' then
    return new;
  end if;

  -- R1: het fonds komt uitsluitend uit de user-metadata. Geen limit 1/default.
  v_fonds_tekst := new.raw_user_meta_data->>'fonds_id';

  -- Fail-closed #1 — geen fonds meegegeven.
  if v_fonds_tekst is null or btrim(v_fonds_tekst) = '' then
    raise exception
      'maak_profiel: geen fonds_id in user-metadata. Een tenant-account vereist een expliciet fonds (raw_user_meta_data.fonds_id); er is bewust geen default/eerste-fonds. Zie decisions/0044.'
      using errcode = 'check_violation';
  end if;

  -- Fail-closed #2 — geen geldige UUID (duidelijke boodschap i.p.v. de kale
  -- cast-fout "invalid input syntax for type uuid").
  begin
    v_fonds_id := v_fonds_tekst::uuid;
  exception
    when others then
      raise exception
        'maak_profiel: fonds_id in user-metadata (%) is geen geldige UUID.', v_fonds_tekst
        using errcode = 'check_violation';
  end;

  -- Fail-closed #3 — geldige UUID, maar het fonds bestaat niet.
  if not exists (select 1 from public.fondsen f where f.id = v_fonds_id) then
    raise exception
      'maak_profiel: fonds_id % bestaat niet in public.fondsen.', v_fonds_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Deterministisch profiel op het expliciet meegegeven fonds.
  insert into public.profielen (id, naam, fonds_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'naam', new.email),
    v_fonds_id
  );
  return new;
end;
$function$;

-- Trigger idempotent (her)plaatsen — identiek aan de live definitie, nu getrackt.
drop trigger if exists bij_registratie on auth.users;
create trigger bij_registratie
  after insert on auth.users
  for each row execute function public.maak_profiel();
