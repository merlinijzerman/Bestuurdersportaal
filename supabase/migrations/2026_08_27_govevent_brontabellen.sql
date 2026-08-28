-- ==========================================================================
-- 2026-08-27 — Bewijsketen: brontabel-triggers (besluit 0192 §5, #183b spoor T)
-- --------------------------------------------------------------------------
-- Vijf brontabel-triggers naar hetzelfde patroon als fn_stemming_ketengebeurtenis
-- (referentie, apart bewezen op preview). Elk:
--   * SECURITY INVOKER; leidt fonds_id af uit de eigen rij (of via een join) en zet
--     dat op de governance_events-rij — fn_govevent_fonds accepteert/overschrijft.
--   * gecureerde payload (GEEN to_jsonb; dataminimalisatie 0191 §1); oude_waarde bij
--     verwijderen = gewijzigd veld + identiteit.
--   * OLD alleen achter TG_OP; event_type-waarden via het register (drift-/collisiepoort).
-- Vereist 2026_08_27_govevent_tenantketen.sql + _hash_extensions_qualify.sql.
-- `documenten` heeft BEWUST geen trigger: die loopt via fn_document_status_zetten
-- (besluit B, migratie 2026_08_27_govevent_document_status.sql) — geen gepoorte
-- tabeltrigger, geen payload-lezende scannertak.
-- ==========================================================================

begin;

-- ── agendapunten (INSERT) — fonds via vergadering ───────────────────────────
create or replace function public.fn_agendapunt_ketengebeurtenis()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_fonds uuid;
begin
  select v.fonds_id into v_fonds from public.vergaderingen v where v.id = new.vergadering_id;
  insert into public.governance_events (fonds_id, event_type, actor_id, actor_naam, object_type, object_id, nieuwe_waarde)
  values (v_fonds, 'agendapunt_toegevoegd', new.aangemaakt_door,
          (select naam from public.profielen where id = new.aangemaakt_door),
          'agendapunt', new.id,
          jsonb_build_object('vergadering_id', new.vergadering_id, 'titel', new.titel, 'categorie', new.categorie));
  return null;
end; $$;
drop trigger if exists trg_agendapunt_ketengebeurtenis on public.agendapunten;
create trigger trg_agendapunt_ketengebeurtenis after insert on public.agendapunten
  for each row execute function public.fn_agendapunt_ketengebeurtenis();

-- ── agendapunt_inbreng (INSERT/DELETE) — fonds via agendapunt→vergadering ────
create or replace function public.fn_inbreng_ketengebeurtenis()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_fonds uuid; v_event text; v_actor uuid; v_oud jsonb; v_nieuw jsonb;
  v_ap uuid; v_id uuid;
begin
  if tg_op = 'INSERT' then
    v_event := 'inbreng_toegevoegd'; v_actor := new.gebruiker_id;
    v_ap := new.agendapunt_id; v_id := new.id;
    v_nieuw := jsonb_build_object('agendapunt_id', new.agendapunt_id, 'gebruiker_naam', new.gebruiker_naam);
  else
    v_event := 'inbreng_ingetrokken'; v_actor := auth.uid();  -- wie intrekt, niet de auteur
    v_ap := old.agendapunt_id; v_id := old.id;
    v_oud := jsonb_build_object('id', old.id, 'agendapunt_id', old.agendapunt_id);
  end if;
  select v.fonds_id into v_fonds
    from public.agendapunten a join public.vergaderingen v on v.id = a.vergadering_id
   where a.id = v_ap;
  insert into public.governance_events (fonds_id, event_type, actor_id, actor_naam, object_type, object_id, oude_waarde, nieuwe_waarde)
  values (v_fonds, v_event, v_actor, (select naam from public.profielen where id = v_actor),
          'inbreng', v_id, v_oud, v_nieuw);
  return null;
end; $$;
drop trigger if exists trg_inbreng_ketengebeurtenis on public.agendapunt_inbreng;
create trigger trg_inbreng_ketengebeurtenis after insert or delete on public.agendapunt_inbreng
  for each row execute function public.fn_inbreng_ketengebeurtenis();

-- ── vergaderingen (INSERT) — fonds direct ───────────────────────────────────
create or replace function public.fn_vergadering_ketengebeurtenis()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  insert into public.governance_events (fonds_id, event_type, actor_id, actor_naam, object_type, object_id, nieuwe_waarde)
  values (new.fonds_id, 'vergadering_aangemaakt', new.aangemaakt_door,
          (select naam from public.profielen where id = new.aangemaakt_door),
          'vergadering', new.id,
          jsonb_build_object('titel', new.titel, 'datum', new.datum, 'status', new.status));
  return null;
end; $$;
drop trigger if exists trg_vergadering_ketengebeurtenis on public.vergaderingen;
create trigger trg_vergadering_ketengebeurtenis after insert on public.vergaderingen
  for each row execute function public.fn_vergadering_ketengebeurtenis();

-- ── organisatie_profielen (INSERT/UPDATE) — fonds direct; géén vrije tekst ───
create or replace function public.fn_orgprofiel_ketengebeurtenis()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_oud jsonb;
begin
  if tg_op = 'UPDATE' then
    v_oud := jsonb_build_object('peildatum', old.peildatum, 'organisatietype', old.organisatietype, 'omvang', old.omvang);
  end if;
  -- LET OP: organisatie_profielen.bijgewerkt_door is TEXT (de weergavenaam, ctx.naam),
  -- GEEN uuid. Daarom actor_id = auth.uid() (uuid, de handelende gebruiker) en
  -- actor_naam = new.bijgewerkt_door (de reeds opgeslagen naam) — géén profielen-join
  -- (die zou uuid = text vergelijken, 42883).
  insert into public.governance_events (fonds_id, event_type, actor_id, actor_naam, object_type, object_id, oude_waarde, nieuwe_waarde)
  values (new.fonds_id, 'organisatieprofiel_gewijzigd', auth.uid(), new.bijgewerkt_door,
          'organisatieprofiel', new.id, v_oud,
          -- gestructureerde feit-velden; missie/visie/speerpunten/risicohouding (vrije tekst) blijven eruit
          jsonb_build_object('peildatum', new.peildatum, 'organisatietype', new.organisatietype, 'omvang', new.omvang));
  return null;
end; $$;
drop trigger if exists trg_orgprofiel_ketengebeurtenis on public.organisatie_profielen;
create trigger trg_orgprofiel_ketengebeurtenis after insert or update on public.organisatie_profielen
  for each row execute function public.fn_orgprofiel_ketengebeurtenis();

-- ── stem_uitbrengingen (INSERT/UPDATE) — OPTIE 2: dát er gestemd is, niet wat ─
--    Stemvlag staat uit (geen stemmen in de praktijk). PERMANENTE keten legt géén
--    individuele `keuze` vast; het geaggregeerde resultaat zit in stemming_gesloten.
--    Aanzetten van de stemvlag vereist een COMPLIANCE-HERZIENING VÓÓRAF (goedkoopste
--    moment: nu, nog geen enkele stem in de keten). Fonds via stemming.
create or replace function public.fn_stem_ketengebeurtenis()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_fonds uuid;
begin
  select s.fonds_id into v_fonds from public.stemmingen s where s.id = new.stemming_id;
  insert into public.governance_events (fonds_id, event_type, actor_id, actor_naam, object_type, object_id, nieuwe_waarde)
  values (v_fonds,
          case when tg_op = 'INSERT' then 'stem_uitgebracht' else 'stem_gewijzigd' end,
          new.uitgebracht_door, (select naam from public.profielen where id = new.uitgebracht_door),
          'stem_uitbrenging', new.id,
          -- OPTIE 2: geen `keuze`, geen motivering — alleen deelname + integriteit
          jsonb_build_object('stemming_id', new.stemming_id, 'stemgerechtigde_id', new.stemgerechtigde_id, 'is_volmacht', new.is_volmacht));
  return null;
end; $$;
drop trigger if exists trg_stem_ketengebeurtenis on public.stem_uitbrengingen;
create trigger trg_stem_ketengebeurtenis after insert or update on public.stem_uitbrengingen
  for each row execute function public.fn_stem_ketengebeurtenis();

-- Grants — expliciet en intentioneel (V3-gate: geen default-ACL). Triggerfuncties;
-- anon nooit, authenticated+service_role EXECUTE (consistent met fn_govevent_hash /
-- fn_stemming_ketengebeurtenis). Ze vuren in triggercontext; directe aanroep faalt
-- (NEW/TG_OP ontbreken), dus de EXECUTE is onschadelijk en houdt het patroon uniform.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.fn_agendapunt_ketengebeurtenis()',
    'public.fn_inbreng_ketengebeurtenis()',
    'public.fn_vergadering_ketengebeurtenis()',
    'public.fn_orgprofiel_ketengebeurtenis()',
    'public.fn_stem_ketengebeurtenis()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

commit;
