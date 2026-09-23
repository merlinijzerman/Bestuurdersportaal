-- ============================================================================
-- #434 T4-F — een SMAL fondsbreed aggregatiepad, ONDER het auditbeleid van 0119
-- ----------------------------------------------------------------------------
-- WAAROM DIT BESTAAT.
-- De beheerstand wilde de adapterdiagnostiek van het hele fonds tonen, maar las
-- `governance_log` met de gewone gebruikersclient. De selectpolicy daar is
-- `gebruiker_id = auth.uid() or public.mag_audit(fonds_id)`. Zonder de grant
-- `governance_audit_read` levert dat uitsluitend de EIGEN beurten — en die
-- werden gepresenteerd als de stand van het fonds.
--
-- WAAROM DE ROLGATE HIER NIET DEUGDE — de les van deze ronde.
-- De eerste versie loste dat op met een rolgate (`beheerder`/`voorzitter`).
-- Dat is precies het alternatief dat besluit 0119 EXPLICIET heeft verworpen:
-- "een rol is permanent en grofmazig, terwijl auditinzage per persoon, per
-- periode en per aanleiding hoort te worden toegekend". Bovendien schreef die
-- versie geen inzageregel, terwijl 0119 eist dat ELKE inzage in andermans
-- metadata er een schrijft. Dat de uitvoer beperkt is tot tellers maakt dat
-- niet anders: het blijft metadata over de beurten van collega's, en het aantal
-- keer dat een bron faalde is niet minder gevoelig omdat het een getal is.
--
-- HET BELEID IS DUS NIET UITGEZONDERD MAAR GEVOLGD (besluit 0214). Deze functie
-- kent exact hetzelfde tweedelige gedrag als `lees_governance_audit()`:
--   • ZONDER `governance_audit_read`: alleen de eigen beurten, en GEEN
--     inzageregel — je eigen spoor inzien is geen inzage in dat van een ander;
--   • MET de capability: het hele fonds, en één regel in
--     `governance_audit_inzage`.
-- De aanroeper krijgt te horen wélke van de twee hij kreeg (`fondsbreed`), zodat
-- de weergave nooit een eigen stand als fondsstand kan tonen.
--
-- Bronniveau bestaat hier niet: de uitvoer is per definitie basisniveau — de
-- gesloten adaptertellers uit `meta_adapters_projectie()`. Daarom ook geen
-- motivering, conform de CHECK op `governance_audit_inzage`.
--
-- WAT ER UIT KOMT. Per auditregel exact de uitvoer van
-- `meta_adapters_projectie()`: `{"adapters": [...]}` of `{}`. Die functie is de
-- vormcontrole uit 2026_09_22_434 en laat per definitie niets anders door —
-- geen vraag, geen antwoord, geen bron, geen gebruiker, geen identifier. Er komt
-- hier dus geen tweede, losse projectie bij die uit de pas kan gaan lopen.
--
-- SECURITY DEFINER, en daarmee BYPASSRLS. Dat betekent dat de WHERE de
-- autorisatie VOLLEDIG moet reproduceren — hetzelfde uitgangspunt als bij
-- `vw_governance_audit`. Dat doet zij: het fonds komt uit het profiel van
-- `auth.uid()` en is geen parameter, dus er is niets te spoofen; zonder sessie
-- is `auth.uid()` null en werpt de functie. Fail-closed voor anon én voor de
-- service-role.
--
-- VOLATILE, niet STABLE: zij schrijft de inzageregel.
--
-- ROLLBACK: supabase/rollbacks/2026_09_23_434_adapterstand_fonds_ROLLBACK.sql
-- ============================================================================

create or replace function public.fn_adapterstand_fonds(p_limiet integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_fonds      uuid;
  v_fondsbreed boolean;
  v_rijen      jsonb := '[]'::jsonb;
  r            record;
  v_regel      jsonb;
begin
  if v_uid is null then
    raise exception 'fn_adapterstand_fonds vereist een geauthenticeerde gebruiker'
      using errcode = '28000';
  end if;

  -- Begrensd, en niet door de aanroeper op te rekken: een definer-functie die
  -- een onbegrensde LIMIT accepteert, is een leespad met een onbegrensde kost.
  if p_limiet is null or p_limiet < 1 or p_limiet > 500 then
    raise exception 'fn_adapterstand_fonds: limiet buiten bereik'
      using errcode = '22023';
  end if;

  select p.fonds_id into v_fonds from public.profielen p where p.id = v_uid;

  -- Een profiel zonder fonds heeft geen tenant om binnen te blijven.
  if v_fonds is null then
    return jsonb_build_object('fondsbreed', false, 'rijen', '[]'::jsonb);
  end if;

  -- ── De poort van 0119. GEEN rolgate. ────────────────────────────────────
  v_fondsbreed := public.mag_audit(v_fonds);

  if v_fondsbreed then
    -- Inzage in andermans metadata: één append-only regel, vóór de lezing.
    -- `scope` beschrijft de weergave en de omvang — nooit inhoud.
    -- `bronniveau` is false, dus er hoort geen motivering bij (zie de CHECK).
    insert into public.governance_audit_inzage
      (gebruiker_id, fonds_id, scope, bronniveau, motivering)
    values
      (v_uid, v_fonds,
       jsonb_build_object('weergave', 'adapterstand', 'limiet', p_limiet),
       false, null);
  end if;

  for r in
    select gl.retrieval_meta
      from public.governance_log gl
     where gl.fonds_id = v_fonds
       -- Zonder capability uitsluitend de eigen regels. Dit predicaat is de
       -- autorisatie, niet een filter: de definer omzeilt RLS, dus wat hier
       -- niet staat, staat nergens meer.
       and (v_fondsbreed or gl.gebruiker_id = v_uid)
       and gl.retrieval_meta is not null
     order by gl.aangemaakt desc
     limit p_limiet
  loop
    begin
      v_regel := public.meta_adapters_projectie(r.retrieval_meta);
    exception when check_violation then
      -- Eén onleesbare regel mag de hele stand niet omleggen; fail-closed op
      -- rijniveau. JSON-null is het afgesproken signaal "onleesbaar" en de
      -- aggregatie telt hem als overgeslagen, zodat de stand zichzelf niet
      -- volledig noemt. Uitsluitend `check_violation` — dat is de code die de
      -- vormcontrole werpt; elke andere fout hoort wél door te slaan.
      v_regel := null;
    end;
    v_rijen := v_rijen || jsonb_build_array(coalesce(v_regel, 'null'::jsonb));
  end loop;

  -- `fondsbreed` komt van de SERVER. Zou de weergave het zelf moeten afleiden,
  -- dan gokt zij — en een gok over reikwijdte is precies hoe een eigen stand
  -- als fondsstand op het scherm komt.
  return jsonb_build_object('fondsbreed', v_fondsbreed, 'rijen', v_rijen);
end;
$fn$;

comment on function public.fn_adapterstand_fonds(integer) is
  '#434 T4-F — adapterdiagnostiek voor de beheerstand, onder het auditbeleid van '
  'besluit 0119. Zonder governance_audit_read: alleen de eigen beurten en geen '
  'inzageregel. Met die capability: het hele fonds, met een regel in '
  'governance_audit_inzage. Geeft per auditregel uitsluitend de uitvoer van '
  'meta_adapters_projectie() terug: de gesloten adaptertellers, nooit vraag, '
  'antwoord, bron, gebruiker of identifier; JSON-null betekent dat die regel '
  'niet in de gesloten vorm leesbaar was. Fonds komt uit het profiel van '
  'auth.uid(); er is geen fondsparameter. `fondsbreed` zegt welke van de twee '
  'standen is geleverd.';

revoke all on function public.fn_adapterstand_fonds(integer) from public, anon;
grant execute on function public.fn_adapterstand_fonds(integer) to authenticated;
