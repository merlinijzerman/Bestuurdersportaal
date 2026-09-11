# Microsoft 365 — Outlook fase 2A (read-only)

## Besluit en grens

Fase 2A is alleen beschikbaar wanneer het fondsprofiel `microsoft` is, de fase-1-pilotflag aan staat en de afzonderlijke flag `microsoft_outlook_fase2a=true` is gezet. De flag blijft standaard uit. Alleen `fonds.config.manage` mag toestemming uitbreiden, een agenda kiezen of synchroniseren; andere fondsgebruikers zien uitsluitend status.

Graph gebruikt delegated `Calendars.Read.Shared` op v1.0. De server vraagt die scope pas bij de beheeractie, somt daarna alleen `/me/calendars` op en accepteert alleen een ID uit die respons. Een selectie bindt fonds, Entra-tenant, gekoppelde mailbox/account en calendar-id in de private vault.

## Synchronisatiecontract

- `calendarView/delta` werkt binnen een bij selectie vastgelegd venster: drie maanden terug en twaalf maanden vooruit.
- Iedere Graph-pagina draagt `Prefer: IdType="ImmutableId"`; de primaire koppelsleutel is `(tenant, mailbox, calendar, immutable event-id)`. `iCalUId` en `changeKey` zijn uitsluitend aanvullende diagnose-/wijzigingsmetadata.
- De database staat maximaal één actieve run per agenda toe. Alleen een volledig gepagineerde ronde schrijft de definitieve `@odata.deltaLink`; een storing, rate-limit of onvolledige pagina houdt de vorige cursor intact.
- Een door een afgebroken serverrequest achtergebleven run wordt na vijftien minuten als `run_afgebroken` gesloten en geaudit; daarna kan de beheerder veilig opnieuw synchroniseren.
- `Retry-After` wordt maximaal tweemaal gevolgd. Een gekoppeld `@removed`-event krijgt de gecombineerde status `extern_gewijzigd_of_verwijderd`: het is geen bewijs van verwijdering, want het kan buiten het venster zijn verplaatst. Portaalinhoud blijft behouden.
- Een verlopen delta-cursor wordt na de mislukte run gewist; de eerstvolgende handmatige run bouwt een nieuwe volledige baseline op.
- Een expliciet geannuleerde afspraak wordt zichtbaar als geannuleerd; portaalinhoud en audit worden nooit verwijderd.
- Outlook-beheerde titel, datum en locatie zijn in het portaal read-only. De lijst en detailpagina tonen de Outlook-herkomst, veilige synchronisatiestatus en — indien aanwezig — een gevalideerde Teams-link.

## Privacyregel

- `private` en `personal` worden niet nieuw geïmporteerd. Een reeds gekoppelde vergadering krijgt `afgeschermd`; Outlook-titel, locatie, einde, Teams-link en deelnemersprojectie worden verwijderd.
- `confidential` verwerkt alleen titel, start/einde, tijdzone, locatie, Teams-link en de minimale deelnemersprojectie onder gewone fondsautorisatie.
- Ruwe deelnemersnamen/e-mailadressen, eventbody, bijlagen, Graph-responses, authorization codes en tokens worden nooit opgeslagen of gelogd. De server koppelt alleen de tijdens de run geïdentificeerde, al gekoppelde fondsgebruiker aan een lokaal profiel-id; overige deelnemers zijn uitsluitend een aantal.
- Teams-links staan alleen op de fondsgebonden vergadering, nooit in de runaudit of requestlogs.

## Database en rollback

`microsoft_private` bevat agenda-configuraties, runs en eventkoppelingen; browserrollen en de vaultrol krijgen geen directe tabelrechten. Zeven gepinde `SECURITY DEFINER`-functies zijn uitsluitend uitvoerbaar voor `microsoft_vault`. De publieke vergadering draagt uitsluitend afgeleide weergavevelden.

Voer eerst de forwardmigratie uit, daarna `supabase/checks/2026_09_04_microsoft_outlook_fase2a.sql`. De rollback weigert terwijl een run actief is. Productie valt buiten fase 2A.
