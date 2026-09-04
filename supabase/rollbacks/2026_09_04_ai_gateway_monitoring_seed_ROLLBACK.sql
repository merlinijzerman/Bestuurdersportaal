-- Rollback #311/T5. Verwijdert uitsluitend de door deze seed toegevoegde configrij.
delete from public.platform_signaal_config where signaal = 'gateway_log_fouten';

