-- Cross-schema object dat niet in de schema-only public-dump terechtkomt:
-- auth.users is Supabase-beheerd, maar de registratie-trigger is applicatielogica.
drop trigger if exists bij_registratie on auth.users;

create trigger bij_registratie
  after insert on auth.users
  for each row execute function public.maak_profiel();

-- Supabase GoTrue can persist app_metadata in a follow-up service-role update
-- after auth.admin.createUser(). The provisioning function therefore also
-- runs on the protected metadata update; user-metadata remains untrusted.
drop trigger if exists bij_app_metadata on auth.users;

create trigger bij_app_metadata
  after update of raw_app_meta_data on auth.users
  for each row execute function public.maak_profiel();
