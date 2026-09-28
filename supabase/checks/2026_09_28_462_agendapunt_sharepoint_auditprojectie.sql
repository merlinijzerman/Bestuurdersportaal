-- ROL: postgres/database-eigenaar; deze suite toetst de gesloten projectie en
-- functieprivileges rechtstreeks in de catalogus, niet een eindgebruikerspad.
do $check$
declare
  v jsonb := '{"agendapunt_sharepoint":{"document_refs":["11111111-1111-4111-8111-111111111111"],"map_refs":["22222222-2222-4222-8222-222222222222"],"kandidaten":4,"gebruikte_documenten":2,"afgekapt":false}}'::jsonb;
  v_faalde boolean := false;
begin
  if public.meta_basisniveau(v) ? 'agendapunt_sharepoint' then
    raise exception '#462 PR-5: lokale refs zichtbaar op basisniveau';
  end if;
  if public.meta_bronniveau(v)->'agendapunt_sharepoint' is distinct from v->'agendapunt_sharepoint' then
    raise exception '#462 PR-5: gesloten bronmetadata ontbreekt';
  end if;
  begin
    perform public.meta_bronniveau(
      '{"agendapunt_sharepoint":{"document_refs":[],"map_refs":[],"kandidaten":0,"gebruikte_documenten":0,"afgekapt":false,"pad":"geheim"}}'::jsonb
    );
  exception when check_violation then
    v_faalde := true;
  end;
  if not v_faalde then
    raise exception '#462 PR-5: onbekend/lekkend veld niet fail-closed geweigerd';
  end if;
  if has_function_privilege('anon', 'public.meta_agendapunt_sharepoint_projectie(jsonb)', 'execute') then
    raise exception '#462 PR-5: anon mag de bronprojectie uitvoeren';
  end if;
end;
$check$;
