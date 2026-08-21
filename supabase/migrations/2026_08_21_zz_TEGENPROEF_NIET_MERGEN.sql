-- ============================================================================
--  TEGENPROEF — NIET MERGEN. NIET IN PREVIEW OF PRODUCTIE DRAAIEN.
-- ----------------------------------------------------------------------------
--  Wegwerpmigratie voor het laatste acceptatiecriterium van V4 (#81):
--  "TestPR met bewust lek aantoonbaar geblokkeerd".
--
--  Zonder deze meting weet je alleen dat de gate ROOD kan kleuren, niet dat hij
--  een merge ook daadwerkelijk TEGENHOUDT. Dat zijn twee verschillende dingen,
--  en alleen het tweede is een gate.
--
--  Het lek is SYNTHETISCH en met opzet: een wegwerptabel met een INSERT-policy
--  zonder WITH CHECK. Dat trekt precies T3 deel 1a, de structurele dekkingseis
--  ("elke schrijf-policy in public MOET een WITH CHECK hebben"). Er wordt hier
--  bewust GEEN bestaande policy, trigger of grant gesloopt: de diff van een
--  publieke testPR hoort geen beschrijving te zijn van een echte zwakte.
--
--  Verwachting: `Cross-tenant isolatie (§15 T1-T14)` faalt met
--  "T3-DEKKING FAALT: schrijf-policies zonder WITH CHECK", en de PR is niet
--  mergebaar omdat die check required is.
--
--  Deze PR wordt gesloten zonder mergen en de branch verwijderd.
-- ============================================================================

begin;

create table if not exists public.t3_tegenproef_wegwerp (
  id uuid primary key default uuid_generate_v4(),
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  notitie text
);

alter table public.t3_tegenproef_wegwerp enable row level security;

-- HET LEK: INSERT-policy zonder WITH CHECK. USING telt niet voor INSERT, dus
-- deze policy legt feitelijk niets op — precies wat T3 1a moet vangen.
drop policy if exists "tegenproef schrijven" on public.t3_tegenproef_wegwerp;
create policy "tegenproef schrijven"
  on public.t3_tegenproef_wegwerp
  for update
  to authenticated
  using (true);   -- <-- geen WITH CHECK: pg_policies.with_check blijft NULL

commit;
