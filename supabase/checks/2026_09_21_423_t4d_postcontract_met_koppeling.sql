-- ============================================================================
--  #423 T4-D — CI-bewijs: post-contractcontrole accepteert een echte koppeling
-- ----------------------------------------------------------------------------
--  UITSLUITEND VOOR EEN WEGWERP-DB/CI. Deze suite schrijft binnen een transactie
--  en rolt alles terug. Gebruik op Preview of Productie uitsluitend de aparte
--  read-only post-contractcontrole.
--
--  ROL: database-eigenaar/postgres. De fixture moet een synthetisch fonds en
--  auth-gebruiker kunnen zaaien en roept daarna de SECURITY DEFINER-koppelfunctie
--  aan. De rolscheiding zelf wordt door het ingesloten operationele script via
--  has_function_privilege() over alle relevante rollen gemeten.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_fonds uuid := gen_random_uuid();
  v_gebruiker uuid := gen_random_uuid();
  v_client_id text;
begin
  insert into public.fondsen(id, naam, slug)
  values (v_fonds, 'T4D Postcontract Wegwerpfonds', 't4d-postcontract-' || left(v_fonds::text, 8));
  insert into auth.users(id) values (v_gebruiker);

  perform microsoft_private.bewaar_koppeling(
    v_fonds, v_gebruiker, 'tenant-a', 'oid-1', 'oid-1.tenant-a', 'Naam',
    'n***@x', array['Files.Read.All','Sites.Read.All'],
    1, 'iv', 'tag', 'cipher', 'client-preview');

  select client_id into v_client_id
    from microsoft_private.verbindingen
   where fonds_id = v_fonds and gebruiker_id = v_gebruiker;
  if v_client_id is distinct from 'client-preview' then
    raise exception 'T4-D postcontractfixture schreef client_id % in plaats van client-preview', v_client_id;
  end if;
end $$;

-- Draai exact het operationele script terwijl de legitieme client_id bestaat.
\ir 2026_09_21_423_t4d_postcontract_readonly.sql

rollback;
