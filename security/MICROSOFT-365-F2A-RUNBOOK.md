# Microsoft 365 — Outlook fase 2A Preview-runbook

1. Pas na fase-1-smoke de forwardmigratie `2026_09_04_microsoft_outlook_fase2a.sql` toe en voer zowel de fase-1- als fase-2A-check als database-eigenaar uit.
2. Verifieer dat `microsoft_vault` precies de zes extra Outlook-functies mag uitvoeren en geen directe rechten op private tabellen heeft.
3. Controleer de PGB-fondsrij op ID, zet daarna uitsluitend voor die rij het integratieprofiel op `microsoft` en de flag `microsoft_outlook_fase2a` op JSON-boolean `true`. Leg de wijziging buiten de browser vast. Rollback: eerst de flag uit, daarna profiel terug naar `eigen` wanneer geen Outlook-koppeling meer actief is.
4. Laat een fondsbeheerder op de PGB-previewhost consent uitbreiden. Controleer dat alleen `Calendars.Read.Shared` bijkomt; application- en schrijfpermissies zijn niet toegestaan.
5. Kies één test-/gedeelde agenda, voer een eerste sync uit en bewaar alleen veilige tellingen en correlation-id als bewijs.
6. Herhaal de sync zonder duplicaat; wijzig daarna tijd, locatie en Teams-link; test een annulering, een private/personal afspraak, confidential afspraak, terugkerende occurrence, zomertijd en een 429 met `Retry-After`.
7. Test negatief: gewone bestuurder krijgt 403 op consent/selectie/sync; verkeerd fonds, andere gekoppelde mailbox, niet-opgesomde kalender-ID en gemanipuleerd event-ID worden geweigerd. Trek consent in en controleer herstelbare fout zonder geheimlek.

`@removed` markeert een afspraak niet als verwijderd. Controleer na een mislukte run dat deltaLink en bestaande vergaderingen ongewijzigd blijven.
