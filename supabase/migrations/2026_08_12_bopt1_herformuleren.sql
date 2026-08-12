-- ============================================================================
-- Migratie 2026-08-12 (B-opt tranche 1a) — actie `herformuleren` op de
-- reflectietoestandsmachine.
-- ----------------------------------------------------------------------------
-- WAAROM. De knop "Aanpassen" in de conceptweergave beloofde de bestuurder dat
-- hij zijn eigen overweging kon bijstellen. In de praktijk zette hij de focus op
-- de NORMALE invoerbalk, en een beurt daar stuurt server-side `afbreken` (FR-56):
-- de reflectie eindigde en de herformulering werd een gewone chatvraag mét
-- retrieval. Dat is de beloftebreuk H-1 uit VOORSTEL-REFLECTIE-OPTIMALISATIE.md §H.
--
-- WAT DEZE MIGRATIE DOET. Eén nieuwe actie `herformuleren`, uitsluitend geldig
-- vanuit `conceptweergave`, die IN `conceptweergave` blijft en de beurt, de
-- ingang en de bevroren bronset NIET verandert. Daarna bouwt de chatroute het
-- concept opnieuw op met de aangescherpte inbreng. Geen nieuwe status, geen
-- nieuwe kolom, geen tabelwijziging — alleen `create or replace` op de bestaande
-- SECURITY DEFINER-functie. Spiegel: core/lib/reflectie-flow.ts (transitietabel).
--
-- GEEN LIMIET OP HERFORMULEREN. Het verhoogt de beurt niet en is de eigen tekst
-- van de bestuurder; een teller zou registratie van reflectiegedrag zijn
-- (besluit 0112). De client zet de knop uit tijdens het genereren.
--
-- SEARCH_PATH. `public, pg_temp` blijft ongewijzigd: deze functie roept `digest()`
-- niet zelf aan (dat doet public.reflectie_bronset_hash, die `extensions` al in
-- zijn eigen pad heeft). Er is hier dus geen 42883-risico en geen `extensions`
-- nodig.
--
-- GRANTS. `create or replace` behoudt de bestaande ACL, maar we herhalen de
-- revoke/grant expliciet — `revoke ... from public` alléén is op Supabase niet
-- genoeg (de default-ACL kent EXECUTE expliciet aan anon toe). Zo blijft gate H
-- groen ongeacht een platform-herziening van de default privileges.
--
-- Idempotent (create or replace). Transactioneel.
-- ROLLBACK: 2026_08_12_bopt1_herformuleren_ROLLBACK.sql (herstelt de 5-actie-versie).
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--
-- ⚠ Na deze migratie: draai supabase/checks/2026_07_31_r1_structurele_gates.sql
-- (gates A–H) én supabase/checks/2026_08_05_b_reflectie_flow.sql tegen de
-- doeldatabase — dit is een wijziging aan een SECURITY DEFINER-functie.
-- ============================================================================

begin;

create or replace function public.reflectie_transitie(
  p_gesprek_id     uuid,
  p_actie          text,
  p_ingang         text default null,
  p_bronset_log_id uuid default null
) returns public.gesprek_reflectie_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_eigenaar     uuid;
  v_fonds        uuid;
  v_status       text;
  v_beurt        smallint;
  v_bijgewerkt   timestamptz;
  v_nieuw_status text;
  v_nieuwe_beurt smallint;
  v_meta         jsonb;
  v_versie       text;
  v_bestaat      boolean;
  v_rij          public.gesprek_reflectie_state;
begin
  if v_uid is null then
    raise exception 'niet_geauthenticeerd' using errcode = '28000';
  end if;

  -- B-opt tranche 1a: `herformuleren` toegevoegd aan de allowlist.
  if p_actie is null or p_actie not in
     ('start','antwoord','concept','afronden','afbreken','herformuleren') then
    raise exception 'ongeldige_actie' using errcode = '22023';
  end if;

  -- Eigenaarschap komt uit `gesprekken`, niet uit de parameters. Row lock zodat
  -- het gesprek niet onder de transitie vandaan verwijderd kan worden.
  select g.gebruiker_id, g.fonds_id into v_eigenaar, v_fonds
    from public.gesprekken g
   where g.id = p_gesprek_id
   for update;

  if not found then
    raise exception 'gesprek_niet_gevonden' using errcode = 'P0002';
  end if;
  if v_eigenaar is distinct from v_uid then
    raise exception 'geen_eigenaar' using errcode = '42501';
  end if;

  -- De actuele status, opnieuw uitgelezen en vergrendeld.
  select s.status, s.beurt, s.bijgewerkt_op
    into v_status, v_beurt, v_bijgewerkt
    from public.gesprek_reflectie_state s
   where s.gesprek_id = p_gesprek_id
   for update;

  v_bestaat := found;
  if not v_bestaat then
    v_status     := 'niet_actief';
    v_beurt      := 0;
    v_bijgewerkt := now();
  end if;

  -- Een gewone chatbeurt roept `afbreken` aan. Bestaat er nog geen statusrij,
  -- dan liep er ook geen reflectie: dan géén rij aanmaken. Anders zou elk
  -- gesprek waarin nooit is gereflecteerd tóch een rij in deze tabel krijgen —
  -- en dat is precies het soort registratie dat besluit 0112 wil vermijden.
  if p_actie = 'afbreken' and not v_bestaat then
    v_rij.gesprek_id    := p_gesprek_id;
    v_rij.gebruiker_id  := v_uid;
    v_rij.fonds_id      := v_fonds;
    v_rij.status        := 'niet_actief';
    v_rij.beurt         := 0;
    v_rij.bijgewerkt_op := now();
    return v_rij;
  end if;

  -- FAIL-SAFE (FR-57, TO §6.1). Een status die langer dan 24 uur stil heeft
  -- gelegen telt niet meer. Werkhypothese uit besluit 0122, gevalideerd in de
  -- gebruikerstoets. Liever een reflectie die opnieuw gestart moet worden dan
  -- een chat die morgen onverwacht in reflectiemodus staat.
  if v_status <> 'niet_actief' and v_bijgewerkt < now() - interval '24 hours' then
    v_status := 'niet_actief';
    v_beurt  := 0;
  end if;

  -- ── Transitietabel (TO §6.1 / v1.0 §9.4) ─────────────────────────────────
  -- Spiegel van core/lib/reflectie-flow.ts. Elke combinatie die hieronder niet
  -- voorkomt, valt door naar `ongeldige_transitie`.
  v_nieuwe_beurt := v_beurt;

  if p_actie = 'afbreken' then
    -- Kan vanuit elke status; ook vanuit `niet_actief` (dan is het een no-op).
    -- Wordt óók getriggerd door een gewone chatbeurt via de normale invoerbalk.
    v_nieuw_status := 'niet_actief';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'start' then
    if v_status <> 'niet_actief' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    if p_ingang is null or p_ingang not in
       ('informatie_ontbreekt','onderbouwing','uitvoeringsrisico','evenwichtigheid',
        'alternatief','uitlegbaarheid','niet_te_plaatsen','overtuiging') then
      raise exception 'ongeldige_ingang' using errcode = '22023';
    end if;
    v_nieuw_status := 'ingang_gekozen';
    v_nieuwe_beurt := 0;

  elsif p_actie = 'antwoord' then
    -- ⚠ CORRECTIE OP TO §6.1. Het TO laat `verdieping_3 + antwoord` toe én zegt
    -- "bij beurt ≥ 3 verplicht conceptweergave". Die twee sluiten elkaar uit:
    -- omdat `beurt` het aantal gegeven antwoorden telt, zou `verdieping_3` dan
    -- onbereikbaar zijn. Opgelost door het beurtplafond leidend te maken — het
    -- derde antwoord landt in `verdieping_3`, een vierde bestaat niet. Netto
    -- maximaal drie verdiepingsantwoorden, precies zoals v1.0 §9.6 vraagt.
    -- Spiegel: core/lib/reflectie-flow.ts.
    if v_status not in ('ingang_gekozen','verdieping_1','verdieping_2') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    -- De beurtteller kan ALLEEN omhoog; de client levert hem niet aan.
    v_nieuwe_beurt := (v_beurt + 1)::smallint;
    if v_nieuwe_beurt > 3 then
      raise exception 'beurtplafond_bereikt' using errcode = '22023';
    end if;
    if v_status = 'ingang_gekozen' then
      v_nieuw_status := 'verdieping_1';
    elsif v_status = 'verdieping_1' then
      v_nieuw_status := 'verdieping_2';
    else
      v_nieuw_status := 'verdieping_3';
    end if;

  elsif p_actie = 'concept' then
    -- Zowel wanneer de assistent na beurt 1 of 2 al genoeg heeft, als wanneer
    -- het beurtplafond is bereikt. Verhoogt de beurt niet.
    if v_status not in ('verdieping_1','verdieping_2','verdieping_3') then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

  elsif p_actie = 'herformuleren' then
    -- ── B-opt tranche 1a ──────────────────────────────────────────────────
    -- De bestuurder scherpt vanuit de conceptweergave zijn EIGEN overweging aan.
    -- Blijft in `conceptweergave`; de beurt verandert NIET (v_nieuwe_beurt is
    -- gelijk aan v_beurt, hierboven gezet). Ingang en bevroren bronset blijven
    -- behouden via de ON CONFLICT-tak (p_actie <> 'start'). Het is geen extra
    -- verdiepingsvraag maar dezelfde overweging opnieuw verwoord.
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'conceptweergave';

  elsif p_actie = 'afronden' then
    if v_status <> 'conceptweergave' then
      raise exception 'ongeldige_transitie' using errcode = '22023';
    end if;
    v_nieuw_status := 'afgerond';
  end if;

  -- ── Bevroren bronset (B-4), uitsluitend bij `start` ───────────────────────
  -- De logregel moet van DEZE gebruiker én DIT gesprek zijn. Dat is wat "een
  -- willekeurige bronset kiezen" uit AC-18 onmogelijk maakt: een log-id uit een
  -- ander gesprek of van een andere gebruiker levert hier geen rij op.
  if p_actie = 'start' and p_bronset_log_id is not null then
    select gl.retrieval_meta into v_meta
      from public.governance_log gl
     where gl.id               = p_bronset_log_id
       and gl.gebruiker_id     = v_uid
       and gl.gesprek_audit_id = p_gesprek_id;

    if not found then
      raise exception 'bronset_niet_van_dit_gesprek' using errcode = '42501';
    end if;

    v_versie := public.reflectie_bronset_hash(coalesce(v_meta, '{}'::jsonb));
  end if;

  insert into public.gesprek_reflectie_state as s
    (gesprek_id, gebruiker_id, fonds_id, status, ingang, beurt,
     bronset_log_id, reflectie_bronset_versie, gestart_op, bijgewerkt_op)
  values
    (p_gesprek_id, v_uid, v_fonds, v_nieuw_status,
     case when p_actie = 'start' then p_ingang else null end,
     v_nieuwe_beurt,
     case when p_actie = 'start' then p_bronset_log_id else null end,
     case when p_actie = 'start' then v_versie else null end,
     case when p_actie = 'start' then now() else null end,
     now())
  on conflict (gesprek_id) do update
     set status                   = excluded.status,
         beurt                    = excluded.beurt,
         bijgewerkt_op            = now(),
         -- Ingang en bronset worden UITSLUITEND bij `start` gezet en bij
         -- `afbreken` gewist. Een vervolgactie — inclusief `herformuleren` —
         -- kan ze niet vervangen; dat zou de bevriezing waardeloos maken.
         ingang                   = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.ingang
                                      else s.ingang
                                    end,
         bronset_log_id           = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.bronset_log_id
                                      else s.bronset_log_id
                                    end,
         reflectie_bronset_versie = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.reflectie_bronset_versie
                                      else s.reflectie_bronset_versie
                                    end,
         gestart_op               = case
                                      when excluded.status = 'niet_actief' then null
                                      when p_actie = 'start' then excluded.gestart_op
                                      else s.gestart_op
                                    end
  returning * into v_rij;

  return v_rij;
end;
$$;

comment on function public.reflectie_transitie(uuid, text, text, uuid) is
  'DE ENIGE schrijfweg naar gesprek_reflectie_state (besluit 0110, AC-18). '
  'Valideert de gevraagde ACTIE tegen de opnieuw uitgelezen actuele status '
  '(FR-67); de client geeft nooit een gewenste einddstatus door. Beurtteller '
  'kan alleen omhoog; bronset alleen bij `start`, en alleen uit een '
  'governance_log-rij van dezelfde gebruiker én hetzelfde gesprek. Fail-safe: '
  'een status ouder dan 24 uur telt als niet_actief (FR-57). B-opt 1a: '
  '`herformuleren` blijft in conceptweergave en laat beurt, ingang en bronset '
  'ongemoeid — de bestuurder scherpt zijn eigen overweging aan.';

-- Zie de kop: expliciet herhaald zodat gate H groen blijft, ook al behoudt
-- create or replace de ACL.
revoke all on function public.reflectie_transitie(uuid, text, text, uuid) from public, anon;
grant execute on function public.reflectie_transitie(uuid, text, text, uuid) to authenticated;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
-- 1. De allowlist accepteert nu 6 acties — een herformuleren vanuit een
--    verdiepingsstatus moet 'ongeldige_transitie' geven, niet 'ongeldige_actie':
--      (zie supabase/checks/2026_08_05_b_reflectie_flow.sql, blok AC-18g)
-- 2. search_path is nog steeds gepind op public, pg_temp:
--      select proconfig from pg_proc
--       where oid = 'public.reflectie_transitie(uuid,text,text,uuid)'::regprocedure;
-- 3. anon heeft geen EXECUTE:
--      select has_function_privilege('anon',
--        'public.reflectie_transitie(uuid,text,text,uuid)', 'execute');
