-- Spike T0.5 (#335) — opruimen van het wegwerp-prototype (lokale stack). Zet eerst de hook uit
-- in supabase/config.toml en herstart de stack.
begin;
drop function if exists public.spike_access_token_hook(jsonb);
drop schema if exists spike_private cascade;
drop role if exists spike_hook_owner;
commit;
