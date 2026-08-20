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
--  Deel B (hash-keten) is READ-ONLY over de bestaande rijen. Alleen exact
--  verklaarde historische forks worden geaccepteerd; iedere nieuwe of
--  gewijzigde vertakking blijft rood.
--
--  Succes = dit script loopt zonder EXCEPTION tot "ALLE PLATFORM-CHECKS OK".
-- ============================================================================

-- ── Deel A: constraint- en immutability-tests (rollback) ───────────────────
begin;

-- Een schema-only baseline bevat referentiedata niet. Maak de check daarom ook
-- op een lege restore zelfdragend; op Preview/Productie is dit een no-op. De
-- tijdelijke rij valt aan het einde samen met de overige fixtures terug.
insert into public.platform_capabilities (capability, omschrijving)
values ('platform.logs.read', 'Tijdelijke fixture voor platform_checks.sql')
on conflict (capability) do nothing;

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
    if sqlerrm like 'FAIL 11:%' then raise; end if;
    raise notice 'OK 11: UPDATE geblokkeerd (%).', sqlerrm;
  end;

  begin
    delete from public.platform_event_log where id = v_id;
    raise exception 'FAIL 11: DELETE op platform_event_log werd TOEGESTAAN';
  exception when others then
    if sqlerrm like 'FAIL 11:%' then raise; end if;
    raise notice 'OK 11: DELETE geblokkeerd (%).', sqlerrm;
  end;
end $$;

-- Het uitzonderingsregister is zelf append-only. De tijdelijke verklaring
-- wordt samen met heel Deel A teruggedraaid.
insert into public.platform_event_fork_declarations (
  fork_prev_hash, toegestane_child_hashes, omgeving, reden, bewijs_ref,
  goedgekeurd_door, goedgekeurd_op
) values (
  repeat('0', 64), array[repeat('1', 64), repeat('2', 64)],
  'regressietest', 'tijdelijke immutabilitytest', 'platform_checks.sql',
  'test', clock_timestamp()
);

do $$
begin
  begin
    update public.platform_event_fork_declarations
       set reden = 'gewijzigd'
     where fork_prev_hash = repeat('0', 64);
    raise exception 'FAIL 11c: UPDATE op forkverklaring werd TOEGESTAAN';
  exception when others then
    if sqlerrm like 'FAIL 11c:%' then raise; end if;
    raise notice 'OK 11c: UPDATE op forkverklaring geblokkeerd (%).', sqlerrm;
  end;

  begin
    delete from public.platform_event_fork_declarations
     where fork_prev_hash = repeat('0', 64);
    raise exception 'FAIL 11c: DELETE op forkverklaring werd TOEGESTAAN';
  exception when others then
    if sqlerrm like 'FAIL 11c:%' then raise; end if;
    raise notice 'OK 11c: DELETE op forkverklaring geblokkeerd (%).', sqlerrm;
  end;
end $$;

-- Een niet-bestaande of gewijzigde fork mag niet door een nieuwe verklaring
-- worden witgewassen. De centrale validator moet de tijdelijke rij weigeren.
do $$
begin
  begin
    perform public.fn_platform_event_chain_assert_valid();
    raise exception 'FAIL 11c: ongeldige forkverklaring werd GEACCEPTEERD';
  exception when others then
    if sqlerrm like 'FAIL 11c:%' then raise; end if;
    if sqlerrm not like 'PLATFORM_EVENT_CHAIN_ONGELDIG:%' then raise; end if;
    raise notice 'OK 11c: ongeldige forkverklaring fail-closed geweigerd.';
  end;
end $$;

-- Test 11b-1: vier rijen in ÉÉN statement met exact hetzelfde tijdstip moeten
-- desondanks één keten vormen. Dit reproduceert de Productie-oorzaak van
-- 2026-08-03 zonder op tijdstip- of UUID-volgorde te vertrouwen.
insert into public.platform_event_log
  (correlatie_id, fase, capability, handeling, tijdstip)
values
  ('00000000-0000-0000-0000-0000000011b1', 'attempt',
   'platform.logs.read', 'check.multirow-chain', '2026-08-15T12:00:00Z'),
  ('00000000-0000-0000-0000-0000000011b1', 'result',
   'platform.logs.read', 'check.multirow-chain', '2026-08-15T12:00:00Z'),
  ('00000000-0000-0000-0000-0000000011b2', 'attempt',
   'platform.logs.read', 'check.multirow-chain', '2026-08-15T12:00:00Z'),
  ('00000000-0000-0000-0000-0000000011b2', 'result',
   'platform.logs.read', 'check.multirow-chain', '2026-08-15T12:00:00Z');

do $$
declare
  v_aantal                 bigint;
  v_interne_verwijzingen   bigint;
  v_dubbele_voorgangers    bigint;
  v_state_afwijking        bigint;
begin
  with testevents as (
    select hash, prev_hash
      from public.platform_event_log
     where handeling = 'check.multirow-chain'
  )
  select
    count(*),
    count(*) filter (
      where exists (select 1 from testevents p where p.hash = t.prev_hash)
    )
  into v_aantal, v_interne_verwijzingen
  from testevents t;

  select coalesce(sum(n - 1), 0)
    into v_dubbele_voorgangers
    from (
      select count(*) as n
        from public.platform_event_log
       where handeling = 'check.multirow-chain'
       group by prev_hash
      having count(*) > 1
    ) q;

  select count(*)
    into v_state_afwijking
    from public.platform_event_chain_state s
   where s.singleton
     and (
       s.event_count <> (select count(*) from public.platform_event_log)
       or s.head_hash is distinct from (
         select laatste.hash
           from public.platform_event_log laatste
          where laatste.handeling = 'check.multirow-chain'
            and not exists (
              select 1 from public.platform_event_log kind
               where kind.prev_hash = laatste.hash
            )
       )
     );

  if v_aantal <> 4 or v_interne_verwijzingen <> 3
     or v_dubbele_voorgangers <> 0 or v_state_afwijking <> 0 then
    raise exception
      'FAIL 11b-1: multi-row keten fout (aantal %, intern %, forks %, state %)',
      v_aantal, v_interne_verwijzingen, v_dubbele_voorgangers,
      v_state_afwijking;
  end if;

  raise notice 'OK 11b-1: multi-row insert vormt één deterministische keten.';
end $$;

rollback;  -- niets uit deel A blijft staan

-- ── Deel B: hash-keten-integriteit, READ-ONLY (Test 11) ────────────────────
-- Herbereken elke hash exact zoals fn_platform_event_hash en controleer de
-- keten als graaf. Tijdstip en UUID zijn nadrukkelijk GEEN ketenvolgorde meer:
-- één root, iedere niet-root verwijst naar een bestaande hash en geen hash
-- heeft meer dan één opvolger. Lege tabel → triviaal OK.
do $$
declare
  v_totaal          bigint;
  v_hash_mismatch   bigint;
  v_roots           bigint;
  v_missing_links   bigint;
  v_fork_excess     bigint;
  v_state_mismatch  bigint;
begin
  -- De centrale validator controleert ook het append-only uitzonderingsregister
  -- en eist een exacte kindset per verklaarde historische fork.
  perform public.fn_platform_event_chain_assert_valid();

  with herberekend as (
    select
      id, correlatie_id, fase, identity_id, capability, handeling,
      doel_fonds_id, doel_object, reden, uitkomst, foutcode, effect,
      tijdstip, prev_hash, hash,
      encode(extensions.digest(
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
    from public.platform_event_log
  )
  select
    count(*),
    count(*) filter (where hash <> opnieuw),
    count(*) filter (where prev_hash is null)
  into v_totaal, v_hash_mismatch, v_roots
  from herberekend;

  select count(*)
    into v_missing_links
    from public.platform_event_log e
   where e.prev_hash is not null
     and not exists (
       select 1 from public.platform_event_log p where p.hash = e.prev_hash
     );

  select coalesce(sum(n - 1), 0)
    into v_fork_excess
    from (
      select count(*) as n
        from public.platform_event_log
       where prev_hash is not null
       group by prev_hash
      having count(*) > 1
    ) forks;

  select count(*)
    into v_state_mismatch
    from public.platform_event_chain_state s
   where s.singleton
     and (
       s.event_count <> v_totaal
       or (v_totaal = 0 and s.head_hash is not null)
       or (v_totaal > 0 and (
         not exists (
           select 1 from public.platform_event_log h where h.hash = s.head_hash
         )
         or exists (
           select 1 from public.platform_event_log kind
            where kind.prev_hash = s.head_hash
         )
       ))
     );

  if v_hash_mismatch <> 0 then
    raise exception 'FAIL 11: % rij(en) met een onjuiste hash (geknoeid?)', v_hash_mismatch;
  end if;
  if (v_totaal = 0 and v_roots <> 0) or (v_totaal > 0 and v_roots <> 1) then
    raise exception 'FAIL 11: onjuist aantal ketenroots: %', v_roots;
  end if;
  if v_missing_links <> 0 then
    raise exception 'FAIL 11: % verwijzing(en) naar ontbrekende hashes', v_missing_links;
  end if;
  if v_state_mismatch <> 0 then
    raise exception 'FAIL 11: ketenkop-state wijkt af van het auditlog';
  end if;
  raise notice
    'OK 11: hash-keten, verklaringen en autoritatieve ketenkop intact (% historische extra takken).',
    v_fork_excess;
end $$;

-- ── Test 11b-2 (concurrency) — TWEE SESSIES ─────────────────────────────────
-- Verifieer aanvullend de race-vrijheid
-- door in TWEE psql-sessies tegelijk te inserten en daarna deel B opnieuw te
-- draaien: de keten moet intact blijven (geen twee rijen met hetzelfde
-- prev_hash). Test 11b-1 hierboven dekt de voorheen ontbrekende multi-row-
-- garantie binnen één statement; 11b-2 dekt transacties onderling.

select 'ALLE PLATFORM-CHECKS OK (zie NOTICES hierboven)' as resultaat;
