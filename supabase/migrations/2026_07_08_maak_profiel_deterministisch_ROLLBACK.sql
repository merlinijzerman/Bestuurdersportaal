-- ============================================================================
-- ROLLBACK 2026-07-08 — herstel maak_profiel() naar de 2026-06-23b-definitie:
-- platform-skip-guard behouden, fondstoewijzing terug naar het EERSTE fonds
-- (`select id from public.fondsen limit 1`).
-- ----------------------------------------------------------------------------
-- LET OP — deze rollback herstelt bewust de R1-ZWAKTE: na terugdraaien koppelt
-- elke nieuwe registratie weer aan het eerste fonds (`limit 1`). Dat is alleen
-- veilig zolang er precies ÉÉN fonds bestaat. Draai deze rollback NIET terug
-- terwijl er een tweede fonds in `public.fondsen` staat — dan zouden nieuwe
-- signups stil aan fonds 1 gekoppeld worden (de cross-tenant-fout die T2 wegnam).
-- Bestaande profielen-rijen blijven ongemoeid. De trigger blijft staan.
-- ============================================================================

create or replace function public.maak_profiel()
returns trigger
language plpgsql
security definer
as $function$
begin
  -- 3b-guard: platform-back-office-accounts krijgen bewust GEEN tenant-profiel.
  if coalesce(new.raw_user_meta_data->>'platform', '') = 'true' then
    return new;
  end if;

  insert into public.profielen (id, naam, fonds_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'naam', new.email),
    (select id from public.fondsen limit 1)
  );
  return new;
end;
$function$;

drop trigger if exists bij_registratie on auth.users;
create trigger bij_registratie
  after insert on auth.users
  for each row execute function public.maak_profiel();
