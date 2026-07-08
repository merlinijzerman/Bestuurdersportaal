-- ============================================================================
-- Migratie 2026-07-08 — T3 RLS-hardening: WITH CHECK op schrijf-policies
-- ----------------------------------------------------------------------------
-- WAAROM: een RLS-policy met alleen USING toetst bij INSERT niets, en bij
-- UPDATE alleen de oude rij — niet wat er ingeschreven wordt. Elke `for all`-
-- of `for update`-policy zonder WITH CHECK laat daardoor de schrijfkant open:
-- een geauthenticeerde gebruiker kan een rij met een VREEMDE fonds_id (of, bij
-- eigenaar-policies, met een andere eigenaar) INSERT-en of via UPDATE naar een
-- ander fonds/eigenaar verplaatsen. De leidende casus is public.governance_log
-- ("fonds log"): een willekeurige fonds_id in een auditregel injecteerbaar.
--
-- Dit is besluit 0040 / beslisnotitie v0.4 §14 (blokkerende hardening vóór
-- onboarding fonds 2). RLS blijft de primaire tenant-isolatie; deze migratie
-- maakt de schrijfkant fail-closed.
--
-- AANPAK (minimaal-invasief, app-gedrag blijft identiek): elke policy hieronder
-- krijgt een WITH CHECK die de bestaande USING-predicaat EXACT spiegelt. Geen
-- USING wordt verruimd of versmald; een legitieme schrijfactie voldeed al aan
-- USING en voldoet dus ook aan de identieke WITH CHECK. Alleen het injecteren
-- van een vreemde sleutel wordt geblokkeerd.
--
-- SCOPE: 28 policies over 27 tabellen. Policies die al een correcte WITH CHECK
-- of gesplitste insert-policy hebben (documenten, gesprekken, voorbereidingen,
-- stemmingen/stem_uitbrengingen insert, catalogus_*, organisatie_profielen,
-- procesmodellen, document_metadata_*, reindex_runs, notulen_segmenten,
-- classificatie_voorstellen, document_inzage, agendapunt_log,
-- profiel_expertises/gremia/focusgebieden, profiel_log, notificaties insert)
-- blijven ONGEMOEID.
--
-- Idempotent (drop if exists + create). Transactioneel.
-- ROLLBACK: 2026_07_08_t3_rls_with_check_ROLLBACK.sql
-- TENANT-IMPACT: geen. Bestaande legitieme reads/writes van Horizon blijven
-- werken; er is nog geen tweede fonds. Effect is puur additioneel-restrictief
-- op de schrijfkant (voorkomt cross-tenant injectie).
-- ============================================================================

begin;

-- ── Klasse A — directe fonds_id, for all: spiegel WITH CHECK ────────────────

drop policy if exists "fonds log" on public.governance_log;
create policy "fonds log" on public.governance_log
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds vergaderingen" on public.vergaderingen;
create policy "fonds vergaderingen" on public.vergaderingen
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds risicos" on public.risicos;
create policy "fonds risicos" on public.risicos
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds procedures" on public.procedures;
create policy "fonds procedures" on public.procedures
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds decision_objects" on public.decision_objects;
create policy "fonds decision_objects" on public.decision_objects
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── Klasse B — isolatie via parent-subquery, for all: spiegel WITH CHECK ────

drop policy if exists "fonds agendapunten" on public.agendapunten;
create policy "fonds agendapunten" on public.agendapunten
  for all
  using (
    vergadering_id in (
      select id from public.vergaderingen where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    vergadering_id in (
      select id from public.vergaderingen where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds maatregelen" on public.risico_maatregelen;
create policy "fonds maatregelen" on public.risico_maatregelen
  for all
  using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds risico log" on public.risico_log;
create policy "fonds risico log" on public.risico_log
  for all
  using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc eigenaars" on public.procedure_eigenaars;
create policy "fonds proc eigenaars" on public.procedure_eigenaars
  for all
  using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc stappen" on public.procedure_stappen;
create policy "fonds proc stappen" on public.procedure_stappen
  for all
  using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc checklist" on public.procedure_checklist;
create policy "fonds proc checklist" on public.procedure_checklist
  for all
  using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc bewijs" on public.procedure_bewijs;
create policy "fonds proc bewijs" on public.procedure_bewijs
  for all
  using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc besluiten" on public.procedure_besluiten;
create policy "fonds proc besluiten" on public.procedure_besluiten
  for all
  using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc log" on public.procedure_log;
create policy "fonds proc log" on public.procedure_log
  for all
  using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  )
  with check (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

-- decision-chain satellieten (8): dezelfde generieke loop als migratie
-- 2026_05_07_decision_object.sql, nu mét gespiegelde WITH CHECK.
do $$
declare
  t text;
  policies text[] := array[
    'decision_assumptions',
    'decision_risks',
    'decision_conditions',
    'decision_actions',
    'decision_evaluations',
    'decision_ai_interactions',
    'governance_events',
    'decision_audit_snapshots'
  ];
begin
  foreach t in array policies loop
    execute format('drop policy if exists "fonds %1$s" on public.%1$s', t);
    execute format($p$
      create policy "fonds %1$s" on public.%1$s
        for all
        using (
          decision_id in (
            select id from public.decision_objects
             where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
          )
        )
        with check (
          decision_id in (
            select id from public.decision_objects
             where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
          )
        )
    $p$, t);
  end loop;
end $$;

-- ── Klasse C — eigenaar/rol-predicaat: spiegel dat predicaat in WITH CHECK ──

drop policy if exists "eigen inbreng wijzigen" on public.agendapunt_inbreng;
create policy "eigen inbreng wijzigen" on public.agendapunt_inbreng
  for update
  using (gebruiker_id = auth.uid())
  with check (gebruiker_id = auth.uid());

drop policy if exists "dissent zichtbaarheid write" on public.decision_dissent;
create policy "dissent zichtbaarheid write" on public.decision_dissent
  for all
  using (
    bestuurder_id = auth.uid()
    or exists (
      select 1 from public.profielen
       where id = auth.uid() and rol in ('voorzitter','beheerder')
    )
  )
  with check (
    bestuurder_id = auth.uid()
    or exists (
      select 1 from public.profielen
       where id = auth.uid() and rol in ('voorzitter','beheerder')
    )
  );

-- procedure_requirements is een GLOBALE template-tabel (geen fonds_id; read-all
-- voor alle ingelogde gebruikers, zie globale-referentietabellen-register).
-- De schrijfkant blijft beheerder-only; WITH CHECK sluit aan op USING.
drop policy if exists "req write beheerder" on public.procedure_requirements;
create policy "req write beheerder" on public.procedure_requirements
  for all
  using (
    exists (
      select 1 from public.profielen
       where id = auth.uid() and rol = 'beheerder'
    )
  )
  with check (
    exists (
      select 1 from public.profielen
       where id = auth.uid() and rol = 'beheerder'
    )
  );

drop policy if exists "fonds stemmingen update" on public.stemmingen;
create policy "fonds stemmingen update" on public.stemmingen
  for update
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds stem update" on public.stem_uitbrengingen;
create policy "fonds stem update" on public.stem_uitbrengingen
  for update
  using (uitgebracht_door = auth.uid())
  with check (uitgebracht_door = auth.uid());

drop policy if exists "eigen notificaties update" on public.notificaties;
create policy "eigen notificaties update" on public.notificaties
  for update
  using (ontvanger_id = auth.uid())
  with check (ontvanger_id = auth.uid());

commit;

-- ── Verificatie (handmatig draaien ná de migratie) ──────────────────────────
-- 1. Alle 28 doel-policies hebben nu een WITH CHECK (qual + with_check gevuld):
--      select tablename, policyname, cmd,
--             (with_check is not null) as heeft_check
--        from pg_policies
--       where schemaname = 'public'
--         and policyname in (
--           'fonds log','fonds vergaderingen','fonds risicos','fonds procedures',
--           'fonds decision_objects','fonds agendapunten','fonds maatregelen',
--           'fonds risico log','fonds proc eigenaars','fonds proc stappen',
--           'fonds proc checklist','fonds proc bewijs','fonds proc besluiten',
--           'fonds proc log','fonds decision_assumptions','fonds decision_risks',
--           'fonds decision_conditions','fonds decision_actions',
--           'fonds decision_evaluations','fonds decision_ai_interactions',
--           'fonds governance_events','fonds decision_audit_snapshots',
--           'eigen inbreng wijzigen','dissent zichtbaarheid write',
--           'req write beheerder','fonds stemmingen update','fonds stem update',
--           'eigen notificaties update')
--       order by tablename, policyname;
--    → verwacht: elke rij heeft_check = true.
-- 2. Negatieve cross-tenant test: zie supabase/checks/2026_07_08_t3_cross_tenant.sql
--    (een INSERT met vreemde fonds_id moet falen).
