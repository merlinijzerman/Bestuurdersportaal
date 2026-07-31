-- ============================================================================
--  Migratie 2026-07-31 — R3: herstel profielen-RLS in PRODUCTIE
--
--  BEVINDING K-03 (gevonden 31-07-2026 tijdens de live driftverificatie na R1/R2)
--
--  WAT IS ER AAN DE HAND
--  De productiedatabase draagt op public.profielen precies één policy:
--
--      profielen | eigen profiel | ALL
--
--  Dat is de ONGEHARDE toestand uit schema.sql §10. Migratie
--  supabase/migrations/2026_07_03_profielen_rls_hardening.sql — die deze policy
--  had moeten vervangen — is nooit op productie gedraaid. Er is geen
--  migratierunner; migraties worden handmatig in de SQL-editor geplakt, en deze
--  is overgeslagen. De verificatienotitie in die migratie zegt letterlijk:
--
--      "→ verwacht: 'profiel select eigen' (SELECT), 'profiel update eigen'
--       (UPDATE); géén 'eigen profiel' (ALL) meer."
--
--  Productie voldoet daar niet aan.
--
--  WAAROM DIT KRITIEK IS
--  "eigen profiel" is FOR ALL met USING (auth.uid() = id) en ZONDER WITH CHECK.
--  Postgres valt voor de schrijfkant dan terug op USING. Bij een UPDATE wordt
--  dus alleen getoetst wélke rij je wijzigt (de eigen rij), niet wat erin komt
--  te staan. Gevolg — uitvoerbaar door elke ingelogde gebruiker, rechtstreeks
--  op PostgREST, zonder de applicatie aan te raken:
--
--    update public.profielen set rol = 'beheerder' where id = auth.uid();
--        → rechtenescalatie: `rol` ontgrendelt de beheerfuncties in de
--          API-checks.
--
--    update public.profielen set fonds_id = '<ander fonds>' where id = auth.uid();
--        → volledige doorbraak van de tenantisolatie. Vrijwel élke RLS-policy
--          in dit schema sleutelt op
--          (select fonds_id from public.profielen where id = auth.uid()).
--          Wie die waarde zelf kan zetten, verplaatst zichzelf naar een ander
--          fonds en krijgt daar LEES- én SCHRIJFrechten — inclusief documenten,
--          besluiten, stemmen en dissent.
--
--  Dit is zwaarder dan K-01 en K-02: die vereisen respectievelijk een geldige
--  sessie met een specifiek doel-id en een schrijfpad naar de RAG-corpus. Deze
--  geeft een willekeurige bestuurder in fonds A de volledige rechten van een
--  beheerder in fonds B.
--
--  MITIGERENDE OMSTANDIGHEID (feitelijk, geen geruststelling)
--  In productie staat op dit moment één fonds. Cross-tenant verplaatsing heeft
--  daarmee vandaag geen doelwit; de rechtenescalatie naar 'beheerder' werkt wél
--  onmiddellijk. Zodra het tweede fonds wordt aangemaakt, is de tenantisolatie
--  vanaf dat moment onbewijsbaar.
--
--  WAT DEZE MIGRATIE DOET
--  Identiek aan 2026_07_03_profielen_rls_hardening.sql (policy-split +
--  bevriezingstrigger), aangevuld met een fail-closed verificatie binnen dezelfde
--  transactie. Draait de verificatie niet schoon, dan rolt alles terug in plaats
--  van een halve toestand achter te laten.
--
--  REGRESSIERISICO: nihil, opnieuw gecontroleerd op 31-07-2026.
--   - De app benadert profielen alleen op de eigen rij (.eq("id", user.id)).
--   - De enige schrijfacties op `rol` staan in
--     app/(platform)/platform/(beveiligd)/gebruikers/acties.ts (r.178, r.236) en
--     draaien op de service-role: die omzeilt RLS én de trigger (auth.uid() is
--     null).
--   - RPC profiel_opslaan (security invoker) raakt rol/fonds_id niet aan.
--   - INSERT op profielen loopt via de maak_profiel()-trigger op auth.users
--     (draait als tabel-eigenaar); DELETE via on delete cascade. Beide zijn
--     onafhankelijk van deze policies.
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--  Idempotent. Rollback: 2026_07_31_r3_profielen_rls_herstel_ROLLBACK.sql
--  (die herstelt bewust een kritieke escalatie — zie de waarschuwing daar).
-- ============================================================================

begin;

-- ── 1. Policy-split: SELECT en UPDATE, strikt eigen rij ─────────────────────
drop policy if exists "eigen profiel" on public.profielen;

drop policy if exists "profiel select eigen" on public.profielen;
create policy "profiel select eigen" on public.profielen
  for select using (auth.uid() = id);

drop policy if exists "profiel update eigen" on public.profielen;
create policy "profiel update eigen" on public.profielen
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── 2. Kolombevriezing fonds_id + rol bij zelfservice-updates ───────────────
--  Tweede slot naast WITH CHECK: ook bestand tegen een toekomstige
--  policy-wijziging die de kolommen weer vrijgeeft.
create or replace function public.fn_profiel_bevries_kolommen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Alleen zelfservice (ingelogde gebruiker wijzigt de eigen rij) wordt
  -- beperkt; service-role en tabel-eigenaar (auth.uid() IS NULL) blijven vrij,
  -- zodat back-officebeheer van rollen mogelijk blijft.
  if auth.uid() is not null and auth.uid() = old.id and (
       new.fonds_id is distinct from old.fonds_id
    or new.rol      is distinct from old.rol
  ) then
    raise exception 'fonds_id en rol zijn niet via zelfservice te wijzigen'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiel_bevries_kolommen on public.profielen;
create trigger trg_profiel_bevries_kolommen
  before update on public.profielen
  for each row execute function public.fn_profiel_bevries_kolommen();

-- ── 3. Fail-closed verificatie binnen dezelfde transactie ───────────────────
do $$
declare
  n_all      int;
  n_select   int;
  n_update   int;
  n_trigger  int;
  wc         text;
  fouten     text := '';
begin
  select count(*) into n_all
    from pg_policies
   where schemaname = 'public' and tablename = 'profielen' and cmd = 'ALL';
  if n_all <> 0 then
    fouten := fouten || format('  - er staat nog %s FOR ALL-policy op profielen%s', n_all, chr(10));
  end if;

  select count(*) into n_select
    from pg_policies
   where schemaname = 'public' and tablename = 'profielen'
     and policyname = 'profiel select eigen' and cmd = 'SELECT';
  if n_select <> 1 then
    fouten := fouten || '  - "profiel select eigen" (SELECT) ontbreekt' || chr(10);
  end if;

  select count(*), max(coalesce(with_check, '')) into n_update, wc
    from pg_policies
   where schemaname = 'public' and tablename = 'profielen'
     and policyname = 'profiel update eigen' and cmd = 'UPDATE';
  if n_update <> 1 then
    fouten := fouten || '  - "profiel update eigen" (UPDATE) ontbreekt' || chr(10);
  elsif coalesce(wc, '') = '' then
    fouten := fouten || '  - "profiel update eigen" heeft GEEN with_check — schrijfkant blijft ongetoetst' || chr(10);
  end if;

  select count(*) into n_trigger
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'profielen'
     and t.tgname = 'trg_profiel_bevries_kolommen' and not t.tgisinternal;
  if n_trigger <> 1 then
    fouten := fouten || '  - trigger trg_profiel_bevries_kolommen ontbreekt' || chr(10);
  end if;

  if fouten <> '' then
    raise exception E'R3 FAALT — profielen niet in de gewenste eindtoestand:\n%', fouten;
  end if;
  raise notice 'R3 OK: profielen draagt select+update (eigen rij, mét with_check) en de bevriezingstrigger staat.';
end $$;

commit;

-- ============================================================================
--  Verificatie ná de migratie (handmatig; leesbaar, wijzigt niets)
-- ============================================================================
-- 1. Eindtoestand van de policies:
--      select policyname, cmd, qual, with_check
--        from pg_policies where schemaname='public' and tablename='profielen'
--       order by policyname;
--    → verwacht exact twee rijen: "profiel select eigen" (SELECT) en
--      "profiel update eigen" (UPDATE, with_check gevuld). Géén ALL.
--
-- 2. Trigger aanwezig:
--      select tgname, tgenabled from pg_trigger t
--        join pg_class c on c.oid = t.tgrelid
--       where c.relname = 'profielen' and not t.tgisinternal;
--    → verwacht trg_profiel_bevries_kolommen met tgenabled = 'O'.
--
-- 3. Gedragstest (als ingelogde tenantgebruiker, via de app of impersonation):
--      update public.profielen set naam = naam where id = auth.uid();
--        → slaagt (zelfbeheer blijft werken);
--      update public.profielen set rol = 'beheerder' where id = auth.uid();
--        → faalt met 42501.
--
-- ============================================================================
--  FORENSISCHE CONTROLE — is het al misbruikt? (draai dit vóór of ná R3)
-- ============================================================================
-- Er is geen wijzigingsspoor op profielen.rol/fonds_id zelf, dus dit is een
-- indicatie, geen bewijs. Leg de uitkomst vast in het reviewdossier.
--
-- a) Rolverdeling: staan er beheerders die je niet verwacht?
--      select id, naam, rol, fonds_id from public.profielen order by rol, naam;
--
-- b) Profielen in een fonds waar ze niet horen (uitnodiging vs. huidige stand),
--    voor zover er een uitnodigingstabel is:
--      select p.id, p.naam, p.rol, p.fonds_id
--        from public.profielen p
--       where p.fonds_id is not null
--       order by p.fonds_id;
--
-- c) Audit: rolmutaties via de back-office lopen door withPlatform en landen in
--    public.platform_event_log. Een profiel met een rol waarvoor géén
--    bijbehorende auditregel bestaat, is buiten de applicatie om gewijzigd:
--      select * from public.platform_event_log
--       where handeling ilike '%rol%' or doel ilike '%profiel%'
--       order by 1 desc limit 50;
--    (kolomnamen kunnen afwijken — doe eerst
--       select * from public.platform_event_log limit 1;)
