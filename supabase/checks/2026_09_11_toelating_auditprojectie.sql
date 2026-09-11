-- ============================================================================
-- #322 PR-C — de toelatingssamenvatting is LEESBAAR uit het auditspoor.
-- ----------------------------------------------------------------------------
-- Bewijst tegen de echte database dat `retrieval_meta.toelating` beide
-- leesniveaus overleeft, met de tellingen intact. Dit is de check die de
-- review-bevinding vangt: tot de migratie van 2026-09-11 werd de samenvatting
-- wél opgeslagen, maar filterde `meta_projectie()` hem bij het lezen weg.
--
-- Read-only: alleen functieaanroepen op een letterlijke jsonb, geen tabellen.
--
-- ROL: authenticated — dat is de ENIGE rol met `execute` op `meta_basisniveau()`
-- en `meta_bronniveau()` (beide `revoke … from public, anon`). Meten als
-- `postgres` zou alleen bewijzen dat de projectielogica de sleutel doorlaat,
-- niet dat de werkelijke lezer hem ook te zien krijgt. Zo bewijst deze check
-- beide: de logica én het bereik voor de rol die het auditspoor leest.
-- ============================================================================
\set ON_ERROR_STOP on

begin;
set local role authenticated;

do $$
declare
  v_meta jsonb := jsonb_build_object(
    'methode', 'sharepoint_live',
    'toelating', jsonb_build_object(
      'geweigerd', 4,
      'categorieen', jsonb_build_object(
        'toestemming_geweigerd', 2, 'configuratiefout', 1, 'providerfout', 1
      ),
      'gronden', jsonb_build_object(
        'geen_bewijs', 1, 'binding_andere_bron', 1,
        'filter_niet_ondersteund', 1, 'v5_hook_fout', 1
      )
    ),
    'gateway', jsonb_build_object(
      'provider', 'anthropic', 'model', 'claude', 'profiel_id', 'p1', 'config_versie', 3
    )
  );
  v_basis jsonb := public.meta_basisniveau(v_meta);
  v_bron  jsonb := public.meta_bronniveau(v_meta);
  niveau  text;
  v       jsonb;
begin
  foreach niveau in array array['basis', 'bron'] loop
    v := case niveau when 'basis' then v_basis else v_bron end;

    if not (v ? 'toelating') then
      raise exception '[toelating] % niveau: de samenvatting verdwijnt bij het lezen', niveau;
    end if;
    if (v->'toelating'->>'geweigerd')::int <> 4 then
      raise exception '[toelating] % niveau: totaal niet intact (%)', niveau, v->'toelating'->>'geweigerd';
    end if;
    if (v->'toelating'->'categorieen'->>'providerfout')::int <> 1
       or (v->'toelating'->'categorieen'->>'configuratiefout')::int <> 1
       or (v->'toelating'->'categorieen'->>'toestemming_geweigerd')::int <> 2 then
      raise exception '[toelating] % niveau: categorieën niet intact', niveau;
    end if;
    if (v->'toelating'->'gronden'->>'filter_niet_ondersteund')::int <> 1 then
      raise exception '[toelating] % niveau: telling per grond niet intact', niveau;
    end if;
    if not (v ? 'gateway') then
      raise exception '[toelating] % niveau: gateway verdwijnt bij het lezen', niveau;
    end if;
  end loop;

  raise notice 'GROEN: toelating en gateway zijn als authenticated op basis- én bronniveau leesbaar, tellingen intact.';
end;
$$;

rollback;
