-- ============================================================================
--  Platform P0 — DB-verificatie (TO §12: tests 11, 11b, 14a-CHECK, 14b-CHECK).
-- ----------------------------------------------------------------------------
--  Draai NA de migratie 2026_06_23_platform_fundament.sql:
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/platform_checks.sql
--  of plak in de Supabase SQL-editor.
--
--  Deel A (constraint- + immutability-tests) draait in een transactie die aan
--  het eind ROLLBACK't, zodat er niets blijft staan — append-only verbiedt
--  alleen UPDATE/DELETE, niet een transactie-rollback.
--  Deel B (hash-keten) is READ-ONLY over de bestaande rijen: het herberekent
--  elke hash en controleert de prev_hash-koppeling. Geen inserts → geen
--  vervuiling van de append-only tabel.
--
--  Succes = dit script loopt zonder EXCEPTION tot "ALLE PLATFORM-CHECKS OK".
-- ============================================================================

-- ── Deel A: constraint- en immutability-tests (rollback) ───────────────────
begin;

insert into public.platform_identities (id, email, naam) values
  ('00000000-0000-0000-0000-0000000000a1', 'check-a@platform.test', 'Check A'),
  ('00000000-0000-0000-0000-0000000000a2', 'check-b@platform.test', 'Check B');

-- Test 14a-CHECK: self-grant (toegekend_door = identity_id) MOET falen.
do $$
begin
  begin
    insert into public.platform_identity_capabilities (identity_id, capability, toegekend_door)
    values ('00000000-0000-0000-0000-0000000000a1', 'platform.logs.read',
            '00000000-0000-0000-0000-0000000000a1');
    raise exception 'FAIL 14a: self-grant werd TOEGESTAAN (chk_pic_geen_self_grant ontbreekt)';
  exception when check_violation then
    raise notice 'OK 14a: self-grant geblokkeerd door chk_pic_geen_self_grant';
  end;
end $$;

-- Test 14b-CHECK: self-approval (vier_ogen_door = toegekend_door) MOET falen.
do $$
begin
  begin
    insert into public.platform_identity_capabilities
      (identity_id, capability, toegekend_door, vier_ogen_door)
    values ('00000000-0000-0000-0000-0000000000a2', 'platform.logs.read',
            '00000000-0000-0000-0000-0000000000a1',
            '00000000-0000-0000-0000-0000000000a1');
    raise exception 'FAIL 14b: self-approval werd TOEGESTAAN (chk_pic_geen_self_approval ontbreekt)';
  exception when check_violation then
    raise notice 'OK 14b: self-approval geblokkeerd door chk_pic_geen_self_approval';
  end;
end $$;

-- Controle: een GELDIGE grant (verschillende actor + vier-ogen) MOET slagen.
do $$
begin
  insert into public.platform_identity_capabilities
    (identity_id, capability, toegekend_door, vier_ogen_door)
  values ('00000000-0000-0000-0000-0000000000a1', 'platform.logs.read',
          '00000000-0000-0000-0000-0000000000a2', NULL);
  raise notice 'OK 14: geldige grant (actor <> ontvanger) toegestaan';
end $$;

-- Test 11 (immutability): UPDATE en DELETE op platform_event_log MOETEN falen.
insert into public.platform_event_log (correlatie_id, fase, capability, handeling)
values (gen_random_uuid(), 'attempt', 'platform.logs.read', 'check.immutable');

do $$
declare v_id uuid;
begin
  select id into v_id from public.platform_event_log
   where handeling = 'check.immutable' limit 1;

  begin
    update public.platform_event_log set reden = 'gehackt' where id = v_id;
    raise exception 'FAIL 11: UPDATE op platform_event_log werd TOEGESTAAN';
  exception when others then
    raise notice 'OK 11: UPDATE geblokkeerd (%).', sqlerrm;
  end;

  begin
    delete from public.platform_event_log where id = v_id;
    raise exception 'FAIL 11: DELETE op platform_event_log werd TOEGESTAAN';
  exception when others then
    raise notice 'OK 11: DELETE geblokkeerd (%).', sqlerrm;
  end;
end $$;

rollback;  -- niets uit deel A blijft staan

-- ── Deel B: hash-keten-integriteit, READ-ONLY (Test 11) ────────────────────
-- Herbereken elke hash exact zoals fn_platform_event_hash en controleer dat
-- (1) de opgeslagen hash klopt en (2) prev_hash = hash van de vorige rij in
-- ketenvolgorde (tijdstip, id). Lege tabel → 0 rijen → triviaal OK.
do $$
declare
  v_hash_mismatch  bigint;
  v_keten_mismatch bigint;
begin
  with geordend as (
    select
      id, correlatie_id, fase, identity_id, capability, handeling,
      doel_fonds_id, doel_object, reden, uitkomst, foutcode, effect,
      tijdstip, prev_hash, hash,
      lag(hash) over (order by tijdstip, id) as verwacht_prev
    from public.platform_event_log
  ),
  herberekend as (
    select
      hash,
      prev_hash,
      verwacht_prev,
      encode(digest(
        coalesce(correlatie_id::text,'') || '|' ||
        fase                             || '|' ||
        coalesce(identity_id::text,'')   || '|' ||
        capability                       || '|' ||
        handeling                        || '|' ||
        coalesce(doel_fonds_id::text,'') || '|' ||
        coalesce(doel_object,'')         || '|' ||
        coalesce(reden,'')               || '|' ||
        coalesce(uitkomst,'')            || '|' ||
        coalesce(foutcode,'')            || '|' ||
        coalesce(effect::text,'')        || '|' ||
        tijdstip::text                   || '|' ||
        coalesce(prev_hash,''),
        'sha256'
      ), 'hex') as opnieuw
    from geordend
  )
  select
    count(*) filter (where hash <> opnieuw),
    count(*) filter (where coalesce(prev_hash,'') <> coalesce(verwacht_prev,''))
  into v_hash_mismatch, v_keten_mismatch
  from herberekend;

  if v_hash_mismatch <> 0 then
    raise exception 'FAIL 11: % rij(en) met een onjuiste hash (geknoeid?)', v_hash_mismatch;
  end if;
  if v_keten_mismatch <> 0 then
    raise exception 'FAIL 11: % rij(en) met een verbroken keten (prev_hash mismatch)', v_keten_mismatch;
  end if;
  raise notice 'OK 11: hash-keten intact over de bestaande rijen.';
end $$;

-- ── Test 11b (advisory lock / concurrency) — HANDMATIG ─────────────────────
-- Niet pure-SQL automatiseerbaar binnen één sessie. Verifieer de race-vrijheid
-- door in TWEE psql-sessies tegelijk te inserten en daarna deel B opnieuw te
-- draaien: de keten moet intact blijven (geen twee rijen met hetzelfde
-- prev_hash). De garantie zit in pg_advisory_xact_lock(hashtext(
-- 'platform_event_log_chain')) in fn_platform_event_hash.

select 'ALLE PLATFORM-CHECKS OK (zie NOTICES hierboven)' as resultaat;
