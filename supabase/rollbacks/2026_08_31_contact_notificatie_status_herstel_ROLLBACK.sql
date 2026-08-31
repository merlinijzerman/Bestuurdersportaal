-- #212 — geen onveilige rollback voor een publiek SECURITY DEFINER-schrijfpad.
--
-- De vorige baselinetoestand was onbegrensd en is dus geen veilige doelstaat.
-- Bij afbreken van een release blijft deze reparatie actief; herstel zo nodig
-- alleen de applicatiecode/deploy, niet de brede publieke update-RPC.

begin;

do $$
begin
  raise exception 'Geen veilige rollback: behoud de begrensde contact_notificatie_status-RPC en herstel uitsluitend de code-deploy.';
end $$;

rollback;
