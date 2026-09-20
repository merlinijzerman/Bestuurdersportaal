-- #413 T4-C — canonicaliseringsvectoren: SQL moet exact doen wat TypeScript doet.
-- ---------------------------------------------------------------------------
-- `microsoft_private.sharepoint_canoniek_weburl()` voedt de gegenereerde kolom
-- waartegen de adapter opzoekt; `canoniekeWebUrl()` in
-- core/lib/microsoft-retrieval/mapping.ts bepaalt waarmee hij zoekt. Lopen die
-- twee uiteen, dan zoekt de arm op een waarde die nooit is opgeslagen — en dat
-- levert geen foutmelding op, maar een arm die stil niets meer vindt.
--
-- Deze lijst is de GEDEELDE waarheid. Dezelfde paren staan in
-- tests/cross-tenant/copilot-mapping.test.ts, en die test faalt zodra een paar
-- hier ontbreekt of hier te veel staat.
--
-- ROL: database-eigenaar/postgres. Leest niets uit de tabellen.
do $vectoren$
declare
  v_paar record;
  v_uitkomst text;
  fouten text := '';
  v_aantal integer := 0;
begin
  for v_paar in
    select * from (values
    ('https://check.sharepoint.com/sites/pgb/Beleid.docx', 'https://check.sharepoint.com/sites/pgb/Beleid.docx'),
    ('https://check.sharepoint.com/sites/pgb/Beleid.docx/', 'https://check.sharepoint.com/sites/pgb/Beleid.docx'),
    ('https://check.sharepoint.com/sites/pgb/Beleid.docx///', 'https://check.sharepoint.com/sites/pgb/Beleid.docx'),
    ('https://check.sharepoint.com/sites/pgb/Beleid.docx?web=1', 'https://check.sharepoint.com/sites/pgb/Beleid.docx'),
    ('https://check.sharepoint.com/sites/pgb/Beleid.docx#fragment', 'https://check.sharepoint.com/sites/pgb/Beleid.docx'),
    ('https://check.sharepoint.com/sites/pgb/Beleid.docx?web=1#x', 'https://check.sharepoint.com/sites/pgb/Beleid.docx'),
    ('https://check.sharepoint.com:443/sites/pgb/Beleid.docx', 'https://check.sharepoint.com/sites/pgb/Beleid.docx'),
    ('https://CHECK.sharepoint.com/sites/pgb/Beleid.docx', 'https://check.sharepoint.com/sites/pgb/Beleid.docx'),
    ('https://check.sharepoint.com/sites/pgb/map%2FX.docx', 'https://check.sharepoint.com/sites/pgb/map%2FX.docx'),
    ('https://check.sharepoint.com/sites/pgb/map/X.docx', 'https://check.sharepoint.com/sites/pgb/map/X.docx'),
    ('https://check.sharepoint.com/sites/pgb/Gedeelde%20documenten/X.docx', 'https://check.sharepoint.com/sites/pgb/Gedeelde%20documenten/X.docx'),
    ('http://check.sharepoint.com/sites/pgb/Beleid.docx', null),
    ('https://user@check.sharepoint.com/sites/pgb/Beleid.docx', null),
    ('https://check.example.com/sites/pgb/Beleid.docx', null),
    ('https://check.sharepoint.com', null),
    ('https://check.sharepoint.com/', null),
    ('geen-url', null),
    ('', null)
    ) as t(invoer, verwacht)
  loop
    v_aantal := v_aantal + 1;
    v_uitkomst := microsoft_private.sharepoint_canoniek_weburl(v_paar.invoer);
    if v_uitkomst is distinct from v_paar.verwacht then
      -- Geen URL in de melding: alleen de positie in de lijst.
      fouten := fouten || format(E'\n- vector %s wijkt af van de TypeScript-canonicalisering', v_aantal);
    end if;
  end loop;

  if v_aantal <> 18 then
    fouten := fouten || format(E'\n- verwacht 18 vectoren, gevonden %s', v_aantal);
  end if;
  if fouten <> '' then raise exception '#413 canonicalisering SQL/TS loopt uiteen:%', fouten; end if;
  raise notice '#413 canonicalisering OK: % vectoren gelijk aan de TypeScript-implementatie.', v_aantal;
end $vectoren$;
