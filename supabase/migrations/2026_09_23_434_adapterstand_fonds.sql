-- ============================================================================
-- #434 T4-F — een SMAL, geautoriseerd fondsbreed aggregatiepad
-- ----------------------------------------------------------------------------
-- WAAROM DIT BESTAAT.
-- De beheerstand wilde de adapterdiagnostiek van het hele fonds tonen, maar las
-- `governance_log` met de gewone gebruikersclient. De selectpolicy daar is
-- `gebruiker_id = auth.uid() or public.mag_audit(fonds_id)`, en `mag_audit()`
-- vereist de afzonderlijke grant `governance_audit_read`. De beheercapability
-- `fonds.config.manage` verleent die grant NIET. Gevolg: de stand toonde
-- uitsluitend de EIGEN beurten van de beheerder en presenteerde die als de stand
-- van het fonds — een gedeeltelijk beeld dat er volledig uitzag.
--
-- DE OPLOSSING IS NIET HET LEESRECHT VERRUIMEN. `governance_audit_read` opent
-- vraag, antwoord, bronnen en het volledige auditspoor van collega's; dat is een
-- bestuurlijk inzagerecht met een eigen grant-administratie en vier-ogen-
-- procedure, en een beheerweergave over tellers is geen reden om het uit te
-- delen. In plaats daarvan dit: één functie die fondsbreed leest en UITSLUITEND
-- de gesloten adaptertellers teruggeeft.
--
-- WAT ER UIT KOMT. Per auditregel exact de uitvoer van
-- `meta_adapters_projectie()`: `{"adapters": [...]}` of `{}`. Die functie is de
-- vormcontrole uit 2026_09_22_434 en laat per definitie niets anders door — geen
-- vraag, geen antwoord, geen bron, geen gebruiker, geen identifier. Er komt hier
-- dus geen tweede, losse projectie bij die uit de pas kan gaan lopen.
--
-- SECURITY DEFINER, en daarmee BYPASSRLS. Dat betekent dat de WHERE de
-- autorisatie VOLLEDIG moet reproduceren — hetzelfde uitgangspunt als bij
-- `vw_governance_audit`. Dat doet zij: het fonds komt uit het profiel van
-- `auth.uid()` en is geen parameter, dus er is niets te spoofen; zonder sessie
-- is `auth.uid()` null en werpt de functie. Fail-closed voor anon én voor de
-- service-role.
--
-- ROLLBACK: supabase/rollbacks/2026_09_23_434_adapterstand_fonds_ROLLBACK.sql
-- ============================================================================

create or replace function public.fn_adapterstand_fonds(p_limiet integer default 500)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
  v_rol   text;
  r       record;
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

  select p.fonds_id, p.rol into v_fonds, v_rol
    from public.profielen p
   where p.id = v_uid;

  -- ROLGATE. Deze verzameling is EXACT de rolverzameling die in de applicatie
  -- `fonds.config.manage` draagt (core/lib/capabilities-map.ts). Een
  -- pariteitsgate in de testsuite leest beide en gaat rood zodra ze uiteenlopen
  -- — zonder die gate zou een latere versmalling van het rolmodel hier stil
  -- blijven staan, en dat is precies hoe een autorisatie verjaart.
  if v_rol is null or v_rol not in ('beheerder', 'voorzitter') then
    raise exception 'fn_adapterstand_fonds: onvoldoende rechten'
      using errcode = '42501';
  end if;

  -- Een profiel zonder fonds heeft geen tenant om binnen te blijven; dan is er
  -- niets te tonen. Geen fout: de gebruiker mág beheren.
  if v_fonds is null then
    return;
  end if;

  for r in
    select gl.retrieval_meta
      from public.governance_log gl
     where gl.fonds_id = v_fonds
       and gl.retrieval_meta is not null
     order by gl.aangemaakt desc
     limit p_limiet
  loop
    begin
      return next public.meta_adapters_projectie(r.retrieval_meta);
    exception when check_violation then
      -- Eén onleesbare regel mag de hele stand niet omleggen; fail-closed op
      -- rijniveau. NULL is het afgesproken signaal "onleesbaar" en de
      -- aggregatie telt hem als overgeslagen, zodat de stand zichzelf niet
      -- volledig noemt. Uitsluitend `check_violation` — dat is de code die de
      -- vormcontrole werpt; elke andere fout hoort wél door te slaan.
      return next null::jsonb;
    end;
  end loop;
end;
$fn$;

comment on function public.fn_adapterstand_fonds(integer) is
  '#434 T4-F — fondsbrede adapterdiagnostiek voor de beheerstand. Geeft per '
  'auditregel uitsluitend de uitvoer van meta_adapters_projectie() terug: de '
  'gesloten adaptertellers, nooit vraag, antwoord, bron, gebruiker of '
  'identifier. Vervangt GEEN governance_audit_read: dat blijft het bestuurlijke '
  'inzagerecht met eigen grant-administratie. Fonds en rol komen uit het profiel '
  'van auth.uid(); er is geen fondsparameter. NULL in de uitvoer betekent: deze '
  'regel was niet in de gesloten vorm leesbaar.';

revoke all on function public.fn_adapterstand_fonds(integer) from public, anon;
grant execute on function public.fn_adapterstand_fonds(integer) to authenticated;
