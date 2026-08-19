-- ============================================================================
-- ROLLBACK 2026-07-08 — T3 RLS-hardening: WITH CHECK op schrijf-policies
-- ----------------------------------------------------------------------------
-- Herstelt de situatie van vóór 2026_07_08_t3_rls_with_check.sql: de policies
-- krijgen weer alleen USING, zonder WITH CHECK.
--
-- LET OP: dit heropent bewust de schrijfkant (cross-tenant INSERT/UPDATE van
-- vreemde fonds_id wordt weer mogelijk — de kwetsbaarheid uit besluit 0040 /
-- v0.4 §14). Alleen gebruiken als de hardening een aantoonbare regressie
-- veroorzaakt, en dan zo snel mogelijk een gecorrigeerde hardening uitrollen.
-- ============================================================================

begin;

-- ── Klasse A ────────────────────────────────────────────────────────────────
drop policy if exists "fonds log" on public.governance_log;
create policy "fonds log" on public.governance_log
  for all using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds vergaderingen" on public.vergaderingen;
create policy "fonds vergaderingen" on public.vergaderingen
  for all using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds risicos" on public.risicos;
create policy "fonds risicos" on public.risicos
  for all using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds procedures" on public.procedures;
create policy "fonds procedures" on public.procedures
  for all using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds decision_objects" on public.decision_objects;
create policy "fonds decision_objects" on public.decision_objects
  for all using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

-- ── Klasse B ────────────────────────────────────────────────────────────────
drop policy if exists "fonds agendapunten" on public.agendapunten;
create policy "fonds agendapunten" on public.agendapunten
  for all using (
    vergadering_id in (
      select id from public.vergaderingen where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds maatregelen" on public.risico_maatregelen;
create policy "fonds maatregelen" on public.risico_maatregelen
  for all using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds risico log" on public.risico_log;
create policy "fonds risico log" on public.risico_log
  for all using (
    risico_id in (
      select id from public.risicos where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc eigenaars" on public.procedure_eigenaars;
create policy "fonds proc eigenaars" on public.procedure_eigenaars
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc stappen" on public.procedure_stappen;
create policy "fonds proc stappen" on public.procedure_stappen
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc checklist" on public.procedure_checklist;
create policy "fonds proc checklist" on public.procedure_checklist
  for all using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc bewijs" on public.procedure_bewijs;
create policy "fonds proc bewijs" on public.procedure_bewijs
  for all using (
    stap_id in (
      select s.id from public.procedure_stappen s
      join public.procedures p on p.id = s.procedure_id
      where p.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc besluiten" on public.procedure_besluiten;
create policy "fonds proc besluiten" on public.procedure_besluiten
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

drop policy if exists "fonds proc log" on public.procedure_log;
create policy "fonds proc log" on public.procedure_log
  for all using (
    procedure_id in (
      select id from public.procedures where
        fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );

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
        for all using (
          decision_id in (
            select id from public.decision_objects
             where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
          )
        )
    $p$, t);
  end loop;
end $$;

-- ── Klasse C ────────────────────────────────────────────────────────────────
drop policy if exists "eigen inbreng wijzigen" on public.agendapunt_inbreng;
create policy "eigen inbreng wijzigen" on public.agendapunt_inbreng
  for update using (gebruiker_id = auth.uid());

drop policy if exists "dissent zichtbaarheid write" on public.decision_dissent;
create policy "dissent zichtbaarheid write" on public.decision_dissent
  for all using (
    bestuurder_id = auth.uid()
    or exists (
      select 1 from public.profielen
       where id = auth.uid() and rol in ('voorzitter','beheerder')
    )
  );

drop policy if exists "req write beheerder" on public.procedure_requirements;
create policy "req write beheerder" on public.procedure_requirements
  for all using (
    exists (
      select 1 from public.profielen
       where id = auth.uid() and rol = 'beheerder'
    )
  );

drop policy if exists "fonds stemmingen update" on public.stemmingen;
create policy "fonds stemmingen update" on public.stemmingen
  for update using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

drop policy if exists "fonds stem update" on public.stem_uitbrengingen;
create policy "fonds stem update" on public.stem_uitbrengingen
  for update using (uitgebracht_door = auth.uid());

drop policy if exists "eigen notificaties update" on public.notificaties;
create policy "eigen notificaties update" on public.notificaties
  for update using (ontvanger_id = auth.uid());

commit;
