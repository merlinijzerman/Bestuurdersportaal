# Reproduceerbare databasebaseline

`2026_08_14_preview_public.sql` is op 14 augustus 2026 met Supabase CLI 2.114.0
als schema-only dump gemaakt van Supabase-project
`bestuurdersportaal-preview` (`swviwoytzvaqypieqgji`), schema `public`.

De export bevat geen tabeldata, gebruikers, storage-objecten of secrets. De dump
is het uitvoerbare startpunt voor de ephemere RLS-testdatabase. Historische
migraties tot en met
`2026_08_14_security_grant_hygiene_late_recreate.sql` zijn erin gesquasht;
`scripts/testdb-apply-migrations.sh` past alleen latere forward-migraties toe.
`2026_08_14_auth_hooks.sql` herstelt daarnaast de applicatietrigger op de door
Supabase beheerde tabel `auth.users`; een export van alleen `public` bevat zo'n
cross-schema-trigger niet.
`2026_08_14_storage_custom.sql` bevat uitsluitend de vier private buckets en de
vier applicatiespecifieke policies op `storage.objects`. Supabase beheert de
Storage-tabellen zelf; die systeemtabeldefinities worden niet gedupliceerd.

De baseline is Postgres 17-specifiek. `supabase/config.toml` pint de CI-stack op
dezelfde major. `supabase/schema.sql` blijft alleen architectuurdocumentatie en
mag niet meer als herstel- of testbaseline worden gebruikt.

Bij vervanging van deze baseline:

1. exporteer uitsluitend schema, nooit data;
2. controleer op `INSERT`, `COPY`, persoonsgegevens en secrets;
3. werk het cutoff-bestand in `scripts/testdb-apply-migrations.sh` bij;
4. bewijs een volledige schone replay plus alle cross-tenant checks;
5. commit de baseline en het bewijs samen.
