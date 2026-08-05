-- ============================================================================
--  Migratie 2026-08-05 — T1: tenant-rol `bestuursbureau` (plateau A, besluit 0128)
-- ----------------------------------------------------------------------------
--  WAAROM
--  Het portaal kent drie tenant-rollen, alle drie geschreven vanuit de bestuurder
--  als lezer en beoordelaar. Het bestuursbureau werkt aan de productiekant
--  (stukken maken) en krijgt nu noodgedwongen `beheerder` — inclusief
--  catalogusbeheer, fondsconfiguratie én stem-, inbreng- en dissentrecht die daar
--  governance-technisch geen van alle horen. Deze migratie maakt de vierde rol
--  mogelijk en schermt haar af.
--
--  KERNPUNT: RLS ISOLEERT IN DIT SCHEMA OP `fonds_id`, NIET OP ROL.
--  Een nieuwe rol krijgt daardoor by default álles te zien wat fondsbreed
--  leesbaar is — inclusief persoonlijke inbreng en individueel stemgedrag — en
--  mag by default álles schrijven wat een fondslid mag. De afscherming is dus
--  een ACTIEVE predicaat-uitbreiding, geen vanzelfsprekendheid.
--
--  ⚠ CORRECTIE OP HET ONTWERP (§5.4) ⚠
--  Het ontwerp stelt dat de nieuwe rol "buiten de bestaande
--  rol in ('voorzitter','beheerder')-schrijfpolicies valt en dus correct wordt
--  geweigerd — fail-closed". Dat klopt voor de config-/stuurinfolaag, maar NIET
--  voor de drie handelingen die §5.3 juist uitsluit:
--    • "eigen inbreng schrijven"    : gebruiker_id = auth.uid() + eigen fonds  → bureau mág inbrengen
--    • "fonds stem insert"          : uitgebracht_door = auth.uid() + fonds    → bureau mág stemmen
--    • "fonds stemmingen insert/update": geopend_door = auth.uid() + fonds     → bureau mág een ronde openen/sluiten
--    • "dissent zichtbaarheid write": bestuurder_id = auth.uid() OR privileged → bureau mág dissent vastleggen
--  De app gebruikt een browser-client met de anon-key (core/lib/supabase.ts), dus
--  de gebruiker heeft zijn eigen JWT en kan PostgREST rechtstreeks aanroepen. Een
--  check in een API-route dekt dat niet af. Daarom worden hier óók de
--  SCHRIJFpolicies uitgebreid — anders is FR-7 alleen cosmetisch geborgd.
--
--  ⚠ CORRECTIE 2 — NULL-VEILIG PREDICAAT ⚠
--  Het ontwerp schrijft `(select rol …) <> 'bestuursbureau'`. Bij een profiel met
--  rol IS NULL levert dat NULL → rij onzichtbaar → gedragswijziging voor een
--  BESTAANDE gebruiker, en dus een doorbraak van de nulgrens (G23). `profielen.rol`
--  is nullable (alleen een DEFAULT, geen NOT NULL). Hier staat daarom overal
--  `is distinct from 'bestuursbureau'`: identiek voor elke bekende rol, en
--  NULL-veilig.
--
--  NULGRENS (G23), CONSTRUCTIEF
--  Elke policy hieronder is `<bestaand predicaat> AND <rol is distinct from
--  'bestuursbureau'>`. Voor bestuurder/voorzitter/beheerder is de tweede term
--  altijd true, dus het evaluatieresultaat is per definitie identiek aan vandaag.
--  Er komt geen policy bij of af; geen bestaande tak wordt gewijzigd.
--
--  WAT DEZE MIGRATIE NIET DOET
--   • `"fonds stemmingen select"` blijft ongemoeid — de stemRONDE en de UITSLAG
--     zijn bestuurlijke informatie die in de notulen belandt en die het bureau
--     nodig heeft. Alleen `stem_uitbrengingen` (wie wát stemde) gaat dicht (FR-4).
--   • `"dissent zichtbaarheid select"` blijft ongemoeid — het bureau valt daar in
--     de niet-privileged tak en ziet alleen formele dissent en minderheids-
--     notities, die per definitie in de verantwoording thuishoren (§5.4).
--   • `voorbereidingen` en `gesprekken` blijven ongemoeid — die zijn al strikt
--     eigen rij (FR-5, G10).
--   • Geen enkele capability wordt hier afgedwongen: het capability-model is een
--     CODE-gate (core/lib/capabilities.ts), niet een DB-gate. Zie besluit 0006/B11.
--
--  ⚠ PRE-FLIGHT — VERPLICHT VÓÓR HET PLAKKEN ⚠
--  De policy "fonds inbreng lezen" staat in GEEN ENKELE migratie; ze bestaat
--  alleen in supabase/schema.sql (r.859), en schema.sql mag achterlopen — bewijs:
--  "eigen inbreng schrijven" staat daar nog in de pre-M-01-vorm. De review van
--  31-07-2026 vond drie objecten die wél in productie stonden en in geen migratie.
--  Lees dus eerst de LIVE definitie uit en vergelijk met de predicaten hieronder:
--
--      select tablename, policyname, cmd, qual, with_check
--        from pg_policies
--       where schemaname = 'public'
--         and tablename in ('agendapunt_inbreng','stem_uitbrengingen',
--                           'stemmingen','decision_dissent')
--       order by tablename, policyname;
--
--  Wijkt de live tekst af van de basis hieronder, STOP dan en pas de migratie
--  eerst aan. Anders verzwakt of verhardt deze migratie ongemerkt een grens.
--
--  Idempotent (drop policy if exists → create policy; constraint via dynamische
--  drop + add). Transactioneel, met een fail-closed verificatieblok in dezelfde
--  transactie: draait dat niet schoon, dan rolt alles terug.
--  ROLLBACK: 2026_08_05_bestuursbureau_rol_ROLLBACK.sql
--  Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--
--  VOLGORDE: pre-flight → deze migratie → supabase/checks/2026_08_05_bb_rolgrenzen.sql
--            → supabase/checks/2026_07_31_r1_structurele_gates.sql → pas dán code-deploy.
-- ============================================================================

begin;

-- ── 1. M1 — profielen.rol-CHECK verruimen ───────────────────────────────────
-- De CHECK is inline in CREATE TABLE gedefinieerd (schema.sql r.45) en heeft
-- daardoor een door Postgres gegenereerde naam. Die naam is niet gegarandeerd
-- 'profielen_rol_check', dus we zoeken hem op in plaats van hem aan te nemen.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'profielen'
       and con.contype = 'c'
       -- Vastgepind op de KOLOM `rol`, niet op de tekst van de definitie. Een
       -- match op '%rol%bestuurder%' zou ook een toekomstige CHECK op
       -- profielen.bestuurlijke_rol raken (bv. een waarde 'werkgeversbestuurder')
       -- en die stil droppen zonder hem te herbouwen.
       and con.conkey = array[
             (select attnum from pg_attribute
               where attrelid = rel.oid and attname = 'rol' and not attisdropped)
           ]::smallint[]
  loop
    execute format('alter table public.profielen drop constraint %I', c.conname);
    raise notice 'BB: bestaande rol-CHECK % verwijderd', c.conname;
  end loop;
end $$;

alter table public.profielen
  add constraint profielen_rol_check
  check (rol in ('bestuurder','voorzitter','beheerder','bestuursbureau'));

comment on column public.profielen.rol is
  'Tenant-rol. Vier waarden (CHECK): bestuurder | voorzitter | beheerder | '
  'bestuursbureau. Default blijft bestuurder — maak_profiel() zet de rol niet, '
  'verhoging loopt uitsluitend via het service-role-pad in het platform-'
  'gebruikersscherm. Zelfservice-mutatie is geblokkeerd door '
  'fn_profiel_bevries_kolommen(). Rol -> capabilities staat in code '
  '(core/lib/capabilities.ts), niet in de DB (besluit 0006/B11).';

-- ── 2. M2 — agendapunt_inbreng: inbreng is een bestuurlijke uiting ──────────
-- Het bureau ondersteunt, het spreekt niet mee (§5.3). Vier policies; het
-- bestaande predicaat blijft letterlijk staan, de rol-clausule komt erachter.
-- LET OP gate A2 (2026_07_31_r1_structurele_gates.sql): agendapunt_inbreng heeft
-- geen eigen fonds_id, dus lees- én invoegpolicies MOETEN de parenttabel
-- (agendapunten) blijven noemen. Dat doen ze hieronder.

drop policy if exists "fonds inbreng lezen" on public.agendapunt_inbreng;
create policy "fonds inbreng lezen" on public.agendapunt_inbreng
  for select using (
    agendapunt_id in (
      select ap.id from public.agendapunten ap
      join public.vergaderingen v on v.id = ap.vergadering_id
      where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

drop policy if exists "eigen inbreng schrijven" on public.agendapunt_inbreng;
create policy "eigen inbreng schrijven" on public.agendapunt_inbreng
  for insert with check (
    gebruiker_id = auth.uid()
    and agendapunt_id in (
      select ap.id
        from public.agendapunten ap
        join public.vergaderingen v on v.id = ap.vergadering_id
       where v.fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

drop policy if exists "eigen inbreng wijzigen" on public.agendapunt_inbreng;
create policy "eigen inbreng wijzigen" on public.agendapunt_inbreng
  for update
  using (
    gebruiker_id = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  )
  with check (
    gebruiker_id = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

drop policy if exists "eigen inbreng verwijderen" on public.agendapunt_inbreng;
create policy "eigen inbreng verwijderen" on public.agendapunt_inbreng
  for delete using (
    gebruiker_id = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

comment on table public.agendapunt_inbreng is
  'Inbreng vooraf op een agendapunt. Fondsbreed leesbaar voor bestuurlijke '
  'rollen; NIET voor rol bestuursbureau (G9, migratie 2026_08_05). Tenantgrens '
  'loopt via agendapunten -> vergaderingen.fonds_id (gate A-register).';

-- ── 3. M3 — stem_uitbrengingen: individueel stemgedrag ─────────────────────
-- De stemRONDE en de UITSLAG (public.stemmingen) blijven leesbaar; WIE WÁT
-- stemde niet (FR-4). Parenttabel `stemmingen` blijft genoemd (gate A2).

drop policy if exists "fonds stem select" on public.stem_uitbrengingen;
create policy "fonds stem select" on public.stem_uitbrengingen
  for select using (
    stemming_id in (
      select id from public.stemmingen
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

drop policy if exists "fonds stem insert" on public.stem_uitbrengingen;
create policy "fonds stem insert" on public.stem_uitbrengingen
  for insert with check (
    uitgebracht_door = auth.uid()
    and stemming_id in (
      select id from public.stemmingen
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

drop policy if exists "fonds stem update" on public.stem_uitbrengingen;
create policy "fonds stem update" on public.stem_uitbrengingen
  for update
  using (
    uitgebracht_door = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  )
  with check (
    uitgebracht_door = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

drop policy if exists "fonds stem delete" on public.stem_uitbrengingen;
create policy "fonds stem delete" on public.stem_uitbrengingen
  for delete using (
    uitgebracht_door = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

comment on table public.stem_uitbrengingen is
  'Individueel stemgedrag per stemronde. Fondsbreed leesbaar voor bestuurlijke '
  'rollen (open stemming); NIET voor rol bestuursbureau (G9, migratie '
  '2026_08_05). De ronde en de uitslag staan in public.stemmingen en blijven '
  'voor het bureau wél leesbaar.';

-- ── 4. M4 — stemmingen: geen stemronde openen, wijzigen of sluiten ─────────
-- SELECT blijft bewust ongemoeid. Alleen de schrijfkant gaat dicht: §5.3 sluit
-- "geen stemronde openen of sluiten" expliciet uit, en het bureau bouwt in de
-- praktijk de agenda — het is dus vaak agendapunten.aangemaakt_door en zou langs
-- de aanmaker-tak in de API alsnog een ronde kunnen openen.

drop policy if exists "fonds stemmingen insert" on public.stemmingen;
create policy "fonds stemmingen insert" on public.stemmingen
  for insert with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and geopend_door = auth.uid()
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

drop policy if exists "fonds stemmingen update" on public.stemmingen;
create policy "fonds stemmingen update" on public.stemmingen
  for update
  using (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  )
  with check (
    fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

-- ── 5. M5 — decision_dissent: geen dissent vastleggen ──────────────────────
-- De SELECT-policy blijft ongemoeid (zie kop). Alleen de FOR ALL-schrijfpolicy
-- krijgt de rol-uitsluiting; zonder deze wijziging kan het bureau via de tak
-- `bestuurder_id = auth.uid()` gewoon een eigen dissent aanmaken.
-- Gate G: FOR ALL MOET een with_check houden — die blijft hieronder staan.

drop policy if exists "dissent zichtbaarheid write" on public.decision_dissent;
create policy "dissent zichtbaarheid write" on public.decision_dissent
  for all
  using (
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      bestuurder_id = auth.uid()
      or exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  )
  with check (
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      bestuurder_id = auth.uid()
      or exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
    )
    and (select rol from public.profielen where id = auth.uid()) is distinct from 'bestuursbureau'
  );

-- ── 6. Fail-closed verificatie binnen dezelfde transactie ──────────────────
do $$
declare
  r        record;
  n        int;
  fouten   text := '';
  -- tabel, policy, moet-parenttabel-noemen
  verwacht text[][] := array[
    ['agendapunt_inbreng',  'fonds inbreng lezen',        'agendapunten'],
    ['agendapunt_inbreng',  'eigen inbreng schrijven',    'agendapunten'],
    ['agendapunt_inbreng',  'eigen inbreng wijzigen',     ''],
    ['agendapunt_inbreng',  'eigen inbreng verwijderen',  ''],
    ['stem_uitbrengingen',  'fonds stem select',          'stemmingen'],
    ['stem_uitbrengingen',  'fonds stem insert',          'stemmingen'],
    ['stem_uitbrengingen',  'fonds stem update',          ''],
    ['stem_uitbrengingen',  'fonds stem delete',          ''],
    ['stemmingen',          'fonds stemmingen insert',    ''],
    ['stemmingen',          'fonds stemmingen update',    ''],
    ['decision_dissent',    'dissent zichtbaarheid write','decision_objects']
  ];
  i int;
begin
  -- (a) De CHECK kent exact de vier waarden.
  select count(*) into n
    from pg_constraint con
    join pg_class     rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public' and rel.relname = 'profielen' and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%bestuursbureau%'
     and pg_get_constraintdef(con.oid) like '%bestuurder%'
     and pg_get_constraintdef(con.oid) like '%voorzitter%'
     and pg_get_constraintdef(con.oid) like '%beheerder%';
  if n <> 1 then
    fouten := fouten || format('  - profielen.rol-CHECK met alle vier de waarden ontbreekt (gevonden: %s)%s', n, chr(10));
  end if;

  -- (b) Elke herschreven policy bestaat, noemt bestuursbureau, en behoudt de
  --     parenttabelverwijzing (anders wordt gate A2 later alsnog rood).
  for i in 1 .. array_length(verwacht, 1) loop
    select * into r
      from pg_policies
     where schemaname = 'public'
       and tablename  = verwacht[i][1]
       and policyname = verwacht[i][2];
    if not found then
      fouten := fouten || format('  - policy "%s" op %s ontbreekt%s', verwacht[i][2], verwacht[i][1], chr(10));
      continue;
    end if;
    if coalesce(r.qual, '') || coalesce(r.with_check, '') not like '%bestuursbureau%' then
      fouten := fouten || format('  - policy "%s" op %s mist de rol-uitsluiting%s', verwacht[i][2], verwacht[i][1], chr(10));
    end if;
    if verwacht[i][3] <> ''
       and coalesce(r.qual, '') || coalesce(r.with_check, '') not like '%' || verwacht[i][3] || '%' then
      fouten := fouten || format('  - policy "%s" op %s noemt de parenttabel %s niet meer (gate A2)%s',
                                 verwacht[i][2], verwacht[i][1], verwacht[i][3], chr(10));
    end if;
    if r.cmd = 'ALL' and coalesce(r.with_check, '') = '' then
      fouten := fouten || format('  - FOR ALL-policy "%s" op %s heeft geen with_check (gate G)%s',
                                 verwacht[i][2], verwacht[i][1], chr(10));
    end if;
  end loop;

  -- (c) De leespolicy op stemmingen is NIET aangeraakt: ronde + uitslag blijven
  --     voor het bureau leesbaar (FR-4).
  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename = 'stemmingen'
     and policyname = 'fonds stemmingen select'
     and coalesce(qual, '') not like '%bestuursbureau%';
  if n <> 1 then
    fouten := fouten || '  - "fonds stemmingen select" ontbreekt of is ten onrechte afgeschermd (FR-4)' || chr(10);
  end if;

  if fouten <> '' then
    raise exception E'BB FAALT — bestuursbureau-afscherming niet in de gewenste eindtoestand:\n%', fouten;
  end if;
  raise notice 'BB OK: rol-CHECK verruimd en 11 policies dragen de bestuursbureau-uitsluiting; stemmingen-SELECT ongemoeid.';
end $$;

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- 1. De CHECK kent vier waarden:
--      select pg_get_constraintdef(oid) from pg_constraint
--       where conrelid = 'public.profielen'::regclass and contype = 'c';
--    → verwacht: CHECK (rol = ANY (ARRAY['bestuurder','voorzitter','beheerder','bestuursbureau']))
--
-- 2. Elf policies dragen de uitsluiting:
--      select tablename, policyname, cmd from pg_policies
--       where schemaname = 'public'
--         and coalesce(qual,'') || coalesce(with_check,'') like '%bestuursbureau%'
--       order by tablename, policyname;
--    → verwacht: precies de elf uit sectie 6 hierboven.
--
-- 3. De uitslag blijft leesbaar:
--      select policyname, qual from pg_policies
--       where tablename = 'stemmingen' and cmd = 'SELECT';
--    → verwacht: "fonds stemmingen select", predicaat ZONDER bestuursbureau.
--
-- 4. Draai daarna, in deze volgorde:
--      supabase/checks/2026_08_05_bb_rolgrenzen.sql      (gedragstest, rollback aan het eind)
--      supabase/checks/2026_07_31_r1_structurele_gates.sql (gates A1,A2,B,C,C2,E,F,G,H,D)
--    Pas als beide schoon zijn: code-deploy.
--
-- 5. NB documentatie: supabase/schema.sql is bijgewerkt met de nieuwe CHECK en de
--    VIER agendapunt_inbreng-policies. De zeven andere (stem_uitbrengingen,
--    stemmingen, decision_dissent) staan helemaal niet in schema.sql — die zijn
--    altijd al alleen in migraties gedefinieerd. schema.sql mag achterlopen;
--    deze migratie is authoritatief.
-- ============================================================================
