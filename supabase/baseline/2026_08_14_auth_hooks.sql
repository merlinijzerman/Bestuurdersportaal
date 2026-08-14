-- Cross-schema object dat niet in de schema-only public-dump terechtkomt:
-- auth.users is Supabase-beheerd, maar de registratie-trigger is applicatielogica.
drop trigger if exists bij_registratie on auth.users;

create trigger bij_registratie
  after insert on auth.users
  for each row execute function public.maak_profiel();
