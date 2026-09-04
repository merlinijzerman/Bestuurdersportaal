-- Microsoft 365 fase 1. Publieke productconfiguratie is read-only onder RLS.
-- Geheimen, cache, OAuth-transacties en gezaghebbende status leven in de private
-- schema en zijn uitsluitend bereikbaar via de aparte microsoft_vault DB-rol.
-- ROLLBACK: ../rollbacks/2026_09_04_microsoft_fase1_connectorfundament_ROLLBACK.sql
begin;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'microsoft_vault') then
    raise exception 'microsoft_vault-login ontbreekt; provision deze volgens security/MICROSOFT-365-F1-RUNBOOK.md vóór de migratie';
  end if;
end $$;
create table if not exists public.fonds_integratie_profielen (
  fonds_id uuid primary key references public.fondsen(id) on delete cascade,
  integratieprofiel text not null default 'eigen' check (integratieprofiel in ('eigen','microsoft')),
  microsoft_koppeling_pilot boolean not null default false,
  bijgewerkt timestamptz not null default now()
);
insert into public.fonds_integratie_profielen (fonds_id, integratieprofiel, microsoft_koppeling_pilot)
select id, 'eigen', false from public.fondsen on conflict (fonds_id) do nothing;
create or replace function public.fn_fonds_integratieprofiel_standaard() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  insert into public.fonds_integratie_profielen (fonds_id, integratieprofiel, microsoft_koppeling_pilot)
  values (new.id, 'eigen', false);
  return new;
end $$;
revoke all on function public.fn_fonds_integratieprofiel_standaard() from public, anon, authenticated;
drop trigger if exists trg_fonds_integratieprofiel_standaard on public.fondsen;
create trigger trg_fonds_integratieprofiel_standaard
after insert on public.fondsen for each row execute function public.fn_fonds_integratieprofiel_standaard();
alter table public.fonds_integratie_profielen enable row level security;
revoke all on public.fonds_integratie_profielen from public, anon, authenticated;
grant select on public.fonds_integratie_profielen to authenticated;
create policy "integratieprofiel lezen eigen fonds" on public.fonds_integratie_profielen for select to authenticated using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

create schema if not exists microsoft_private;
revoke all on schema microsoft_private from public, anon, authenticated;
create table if not exists microsoft_private.oauth_transacties (
  state_hash text primary key, fonds_id uuid not null references public.fondsen(id), gebruiker_id uuid not null references auth.users(id), verloopt_op timestamptz not null, gebruikt_op timestamptz,
  sleutel_versie integer not null, iv text not null, tag text not null, ciphertext text not null, aad text not null
);
create table if not exists microsoft_private.verbindingen (
  id uuid primary key default gen_random_uuid(), fonds_id uuid not null references public.fondsen(id), gebruiker_id uuid not null references auth.users(id), tenant_id text not null, microsoft_object_id text not null, home_account_id text not null,
  display_name text, masked_username text, status text not null check (status in ('gekoppeld','fout','ontkoppeld')), scopes text[] not null, gekoppeld_op timestamptz, laatst_getest_op timestamptz, ontkoppeld_op timestamptz, foutcategorie text, unique (fonds_id, gebruiker_id)
);
create table if not exists microsoft_private.token_cache (
  verbinding_id uuid primary key references microsoft_private.verbindingen(id) on delete cascade, versie integer not null default 1, sleutel_versie integer not null, iv text not null, tag text not null, ciphertext text not null, bijgewerkt timestamptz not null default now()
);
create table if not exists microsoft_private.audit_log (
  id uuid primary key default gen_random_uuid(), fonds_id uuid not null, gebruiker_id uuid not null, gebeurtenis text not null, foutcategorie text, aangemaakt timestamptz not null default now()
);
alter table microsoft_private.oauth_transacties enable row level security;
alter table microsoft_private.verbindingen enable row level security;
alter table microsoft_private.token_cache enable row level security;
alter table microsoft_private.audit_log enable row level security;
create or replace function microsoft_private.maak_oauth_transactie(p_state_hash text,p_fonds uuid,p_gebruiker uuid,p_verloopt timestamptz,p_sleutel integer,p_iv text,p_tag text,p_cipher text,p_aad text) returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$ begin insert into oauth_transacties values (p_state_hash,p_fonds,p_gebruiker,p_verloopt,null,p_sleutel,p_iv,p_tag,p_cipher,p_aad); end $$;
create or replace function microsoft_private.consumeer_oauth_transactie(p_state_hash text) returns table(fonds_id uuid,gebruiker_id uuid,sleutel_versie integer,iv text,tag text,ciphertext text) language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$ begin return query update oauth_transacties set gebruikt_op=now() where oauth_transacties.state_hash=p_state_hash and gebruikt_op is null and verloopt_op>now() returning oauth_transacties.fonds_id,oauth_transacties.gebruiker_id,oauth_transacties.sleutel_versie,oauth_transacties.iv,oauth_transacties.tag,oauth_transacties.ciphertext; end $$;
create or replace function microsoft_private.lees_verbinding(p_fonds uuid,p_gebruiker uuid) returns setof microsoft_private.verbindingen language sql security definer set search_path = microsoft_private, public, pg_temp as $$ select * from verbindingen where fonds_id=p_fonds and gebruiker_id=p_gebruiker $$;
create or replace function microsoft_private.lees_cache(p_fonds uuid,p_gebruiker uuid) returns table(verbinding_id uuid,versie integer,sleutel_versie integer,iv text,tag text,ciphertext text) language sql security definer set search_path = microsoft_private, public, pg_temp as $$ select c.verbinding_id,c.versie,c.sleutel_versie,c.iv,c.tag,c.ciphertext from token_cache c join verbindingen v on v.id=c.verbinding_id where v.fonds_id=p_fonds and v.gebruiker_id=p_gebruiker and v.status='gekoppeld' $$;
create or replace function microsoft_private.bewaar_koppeling(p_fonds uuid,p_gebruiker uuid,p_tenant text,p_object text,p_home text,p_naam text,p_user text,p_scopes text[],p_sleutel integer,p_iv text,p_tag text,p_cipher text) returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$ declare v_id uuid; begin insert into verbindingen(fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,display_name,masked_username,status,scopes,gekoppeld_op,foutcategorie) values(p_fonds,p_gebruiker,p_tenant,p_object,p_home,p_naam,p_user,'gekoppeld',p_scopes,now(),null) on conflict(fonds_id,gebruiker_id) do update set tenant_id=excluded.tenant_id,microsoft_object_id=excluded.microsoft_object_id,home_account_id=excluded.home_account_id,display_name=excluded.display_name,masked_username=excluded.masked_username,status='gekoppeld',scopes=excluded.scopes,gekoppeld_op=now(),ontkoppeld_op=null,foutcategorie=null returning id into v_id; insert into token_cache(verbinding_id,sleutel_versie,iv,tag,ciphertext) values(v_id,p_sleutel,p_iv,p_tag,p_cipher) on conflict(verbinding_id) do update set versie=token_cache.versie+1,sleutel_versie=excluded.sleutel_versie,iv=excluded.iv,tag=excluded.tag,ciphertext=excluded.ciphertext,bijgewerkt=now(); insert into audit_log(fonds_id,gebruiker_id,gebeurtenis) values(p_fonds,p_gebruiker,'microsoft.koppeling.geslaagd'); end $$;
create or replace function microsoft_private.bewaar_cache(p_fonds uuid,p_gebruiker uuid,p_verwacht integer,p_sleutel integer,p_iv text,p_tag text,p_cipher text) returns boolean language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$ declare v_id uuid; begin select id into v_id from verbindingen where fonds_id=p_fonds and gebruiker_id=p_gebruiker and status='gekoppeld' for update; update token_cache set versie=versie+1,sleutel_versie=p_sleutel,iv=p_iv,tag=p_tag,ciphertext=p_cipher,bijgewerkt=now() where verbinding_id=v_id and versie=p_verwacht; return found; end $$;
create or replace function microsoft_private.registreer_test(p_fonds uuid,p_gebruiker uuid,p_ok boolean,p_fout text) returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$ begin update verbindingen set laatst_getest_op=case when p_ok then now() else laatst_getest_op end,status=case when p_ok then 'gekoppeld' else 'fout' end,foutcategorie=p_fout where fonds_id=p_fonds and gebruiker_id=p_gebruiker; insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,foutcategorie) values(p_fonds,p_gebruiker,case when p_ok then 'microsoft.test.geslaagd' else 'microsoft.test.mislukt' end,p_fout); end $$;
create or replace function microsoft_private.registreer_koppelfout(p_fonds uuid,p_gebruiker uuid,p_fout text) returns void language sql security definer set search_path = microsoft_private, public, pg_temp as $$ insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,foutcategorie) values(p_fonds,p_gebruiker,'microsoft.koppeling.mislukt',p_fout) $$;
create or replace function microsoft_private.ontkoppel(p_fonds uuid,p_gebruiker uuid) returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$ declare v_id uuid; begin select id into v_id from verbindingen where fonds_id=p_fonds and gebruiker_id=p_gebruiker for update; delete from token_cache where verbinding_id=v_id; update verbindingen set status='ontkoppeld',ontkoppeld_op=now(),foutcategorie=null where id=v_id; insert into audit_log(fonds_id,gebruiker_id,gebeurtenis) values(p_fonds,p_gebruiker,'microsoft.lokaal_ontkoppeld'); end $$;
revoke all on all tables in schema microsoft_private from public, anon, authenticated;
revoke all on all functions in schema microsoft_private from public, anon, authenticated;
alter default privileges in schema microsoft_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema microsoft_private revoke all on functions from public, anon, authenticated;
grant usage on schema microsoft_private to microsoft_vault;
grant execute on function microsoft_private.maak_oauth_transactie(text,uuid,uuid,timestamptz,integer,text,text,text,text) to microsoft_vault;
grant execute on function microsoft_private.consumeer_oauth_transactie(text) to microsoft_vault;
grant execute on function microsoft_private.lees_verbinding(uuid,uuid) to microsoft_vault;
grant execute on function microsoft_private.lees_cache(uuid,uuid) to microsoft_vault;
grant execute on function microsoft_private.bewaar_koppeling(uuid,uuid,text,text,text,text,text,text[],integer,text,text,text) to microsoft_vault;
grant execute on function microsoft_private.bewaar_cache(uuid,uuid,integer,integer,text,text,text) to microsoft_vault;
grant execute on function microsoft_private.registreer_test(uuid,uuid,boolean,text) to microsoft_vault;
grant execute on function microsoft_private.registreer_koppelfout(uuid,uuid,text) to microsoft_vault;
grant execute on function microsoft_private.ontkoppel(uuid,uuid) to microsoft_vault;
-- Runbook: maak loginrol microsoft_vault vóór deze migratie; gebruik zijn URL alleen als MICROSOFT_VAULT_DATABASE_URL.
commit;
