-- ============================================================
--  Migratie 2026-05-19 — Review-followups op Decision Object MVP-1
--
--  Aanleiding: externe review op `PROCEDURE-MVP1-ONTWERP.md` leverde
--  zes bevindingen op (zie `PROCEDURE-MVP1-AUDIT.md` v1.1). Deze
--  migratie verwerkt de drie schema-gerelateerde fixes:
--
--    1. RLS-permissive policies — `ai validatie domein` op
--       `decision_ai_interactions` als RESTRICTIVE markeren zodat
--       de domein-check niet wordt geneutraliseerd door de generieke
--       fonds-policy.
--
--    2. `governance_events.decision_id` FK — `on delete cascade`
--       vervangen door `on delete restrict`. De v1.0-aanbeveling
--       `on delete set null` werkte feitelijk niet omdat `set null`
--       een UPDATE uitvoert die de no-update-trigger blokkeert.
--       Restrict maakt het al impliciete gedrag (hard-delete niet
--       mogelijk zodra er governance-events hangen) expliciet en
--       intentioneel. Hard-delete van demo-data gebeurt buiten
--       product-FK's om via een admin-script.
--
--    3. `chk_bronnen_array` — CHECK-constraint op
--       `decision_ai_interactions.bronnen` dat het type een array
--       is. Volledig JSON-schema is uit scope voor MVP-1; deze
--       constraint sluit het meest acute gat (willekeurig JSON).
--
--  Plak in Supabase Dashboard → SQL Editor → Run. Idempotent.
-- ============================================================

-- ── 1. AI-validatie-domein-policy: RESTRICTIVE in plaats van PERMISSIVE ──
-- In PostgreSQL worden meerdere policies standaard PERMISSIVE (UNION)
-- gecombineerd. De generieke `for all`-policy "fonds decision_ai_interactions"
-- geeft elke ingelogde gebruiker binnen het fonds UPDATE-rechten, waardoor
-- de specifieke domein-restrictie geen filter is maar slechts een
-- aanvullende toelating. Door deze policy als RESTRICTIVE te markeren
-- wordt zij AND-gecombineerd met de generieke; de domein-check filtert
-- nu echt.
--
-- Server-side rolcheck in app/api/decisions/[id]/ai-interactions/[aiid]/route.ts
-- blijft als defense-in-depth bestaan.
drop policy if exists "ai validatie domein" on public.decision_ai_interactions;

create policy "ai validatie domein" on public.decision_ai_interactions
  as restrictive
  for update using (
    -- Decision binnen eigen fonds (laag 2, ook restrictief afgedwongen)
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
    and (
      -- Algemene output: elke ingelogde gebruiker
      validatie_domein = 'algemeen'
      or
      -- Specialistische domeinen: alleen voorzitter/beheerder.
      (validatie_domein in ('risk','compliance','beleggingen','governance')
       and exists (
         select 1 from public.profielen
          where id = auth.uid() and rol in ('voorzitter','beheerder')
       )
      )
    )
  );

-- ── 2. governance_events.decision_id — FK naar on delete restrict ──
-- `on delete cascade` botst met de append-only trigger op governance_events:
-- de cascade probeert child-rijen te deleten, de trigger raise't een
-- exception, en de parent-delete faalt op een verwarrende manier.
-- `on delete restrict` maakt het impliciete gedrag (Decision Objects met
-- audit-trail zijn niet hard verwijderbaar) expliciet en intentioneel.
-- Annulering verloopt via status (`geannuleerd` / `afgewezen` /
-- `afgesloten`), niet via DELETE.
do $$
declare
  fk_name text;
begin
  -- Vind de huidige FK-naam (Postgres genereert dit automatisch)
  select conname into fk_name
  from pg_constraint
  where conrelid = 'public.governance_events'::regclass
    and contype = 'f'
    and conkey = ARRAY[
      (select attnum from pg_attribute
        where attrelid = 'public.governance_events'::regclass
          and attname = 'decision_id')
    ];

  if fk_name is not null then
    execute format('alter table public.governance_events drop constraint %I', fk_name);
  end if;
end $$;

alter table public.governance_events
  add constraint governance_events_decision_id_fkey
  foreign key (decision_id)
  references public.decision_objects(id)
  on delete restrict;

comment on constraint governance_events_decision_id_fkey on public.governance_events is
  'Restrict: Decision Objects met audit-trail zijn principieel niet hard verwijderbaar. Annulering verloopt via status, niet via DELETE.';

-- ── 3. chk_bronnen_array op decision_ai_interactions.bronnen ──
-- Voorkomt dat willekeurige JSON (niet-array) in het bronnen-veld
-- terechtkomt. Volledige genormaliseerde bron-tabel is iteratie-2-werk.
-- Voor MVP-1: garandeer minimaal het type.
alter table public.decision_ai_interactions
  drop constraint if exists chk_bronnen_array;

alter table public.decision_ai_interactions
  add constraint chk_bronnen_array
  check (jsonb_typeof(bronnen) = 'array');

comment on constraint chk_bronnen_array on public.decision_ai_interactions is
  'Bronnen-veld moet altijd een JSON-array zijn. Element-shape (document_id, titel, paragraaf, fragment) wordt server-side gevalideerd in de API-routes.';

-- ============================================================
--  Verificatie:
--   1. RLS:
--      select pol.polname, pol.polpermissive
--      from pg_policy pol
--      join pg_class c on c.oid = pol.polrelid
--      where c.relname = 'decision_ai_interactions';
--      → "ai validatie domein" moet polpermissive = false hebben
--
--   2. FK:
--      select conname, confdeltype
--      from pg_constraint
--      where conrelid = 'public.governance_events'::regclass
--        and contype = 'f';
--      → confdeltype voor decision_id-FK moet 'r' (restrict) zijn
--
--   3. CHECK:
--      select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--      where conrelid = 'public.decision_ai_interactions'::regclass
--        and conname = 'chk_bronnen_array';
--      → moet aanwezig zijn
-- ============================================================
