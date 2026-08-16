-- Herstel least-privilege tabelgrants na de actuele preview-baseline.
--
-- RLS geldt niet voor TRUNCATE. REFERENCES en TRIGGER zijn evenmin nodig voor
-- browserrollen. De baseline bevatte deze rechten opnieuw op alle public
-- tabellen, vermoedelijk doordat tabellen na de eerdere R4-migratie zijn
-- aangemaakt onder brede default privileges.

begin;

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon;

revoke truncate, references, trigger
  on all tables in schema public from authenticated;

alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

do $$
declare
  resterend int;
begin
  select count(*) into resterend
    from information_schema.role_table_grants
   where table_schema = 'public'
     and (
       (grantee = 'anon' and privilege_type in
         ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))
       or
       (grantee = 'authenticated' and privilege_type in
         ('TRUNCATE', 'REFERENCES', 'TRIGGER'))
     );

  if resterend <> 0 then
    raise exception 'SECURITY_TABLE_GRANTS: % ongewenste grant(s) resteren', resterend;
  end if;
end $$;

commit;
