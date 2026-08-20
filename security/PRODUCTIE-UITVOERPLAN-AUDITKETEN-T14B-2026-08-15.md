# Productie-uitvoerplan — auditketen, forkverklaring en T14b

- **Datum:** 2026-08-15
- **Doelproject:** Productie `aebwiufuegsiwhwpdrfb`
- **Status:** restoretest applicatieschema groen; volledige restore en actuele
  Productiesnapshot nog rood; **niet goedgekeurd en niet uitgevoerd**
- **Menselijke go/no-go-eigenaar:** Merlin
- **Vier-ogen:** pas verplicht vanaf de daadwerkelijke Huisartsen-live; vanaf
  dat moment is ook Roberts expliciete goedkeuring nodig

## 1. Bewezen uitgangspositie

Read-only vastgesteld op Productie:

- 272 platformevents;
- één root;
- geen lege, dubbele of inhoudelijk afwijkende hashes;
- geen verwijzingen naar ontbrekende hashes;
- één historische fork met exact vier directe kinderen;
- Productie is tijdens deze inventarisatie niet gewijzigd.

De exacte hashes staan uitsluitend in de omgevingsspecifieke migratieseed
`2026_08_15_platform_event_fork_declarations_seed_production.sql`. Dit document
blijft gesaneerd.

## 2. Voorwaarden vóór go

- [ ] Verse Productieback-up beschikbaar en checksum geregistreerd. De geteste
  back-up van `2026-08-15T07:17:55Z` had een geldige checksum, maar bevatte 270
  events tegenover de later read-only gemeten 272 en geldt daarom niet als
  finale verse snapshot.
- [ ] Volledige restore naar een lege, geïsoleerde oefendatabase voltooid. Het
  applicatieschema met alle 118 `public`-tabellen is groen hersteld; de volledige
  datarestore stopte fail-closed doordat de losse Postgres-image niet dezelfde
  actuele managed `auth`-schemaversie had als het Supabase-bronproject.
- [ ] Onderstaande vier migraties ongewijzigd in dezelfde volgorde op een
  actuele restore toegepast. De eerste drie waren groen; stap 4 weigerde de
  270-event snapshot terecht omdat de Production-seed exact 272 verwacht.
- [x] `platform_checks.sql` en de P1-cataloguscheck op de applicatierestore
  groen, na een uitsluitend lokale snapshotvariant met eventvoorwaarde 270.
- [ ] Volledige §15-suite blijft lokaal vanaf een lege database groen.
- [ ] Geen nieuwe Productiefork of wijziging in de read-only tellingen.
- [ ] Merlin heeft datum/tijd, back-upreferentie en expliciet **GO** vastgelegd.
- [ ] Indien Huisartsen inmiddels live is: Robert heeft afzonderlijk **GO**
  vastgelegd.

Zonder alle toepasselijke vinkjes: **NO-GO**.

### Restorebewijs 2026-08-15

- Back-uparchief: checksum groen; bronproject en aanmaaktijd uit het gesaneerde
  manifest bevestigd.
- Volledige datarestore: fail-closed gestopt vóór applicatiedata door een
  ontbrekende kolom in de lokale managed `auth`-tabel. De Supabase CLI sluit
  managed schema-DDL bewust uit en veronderstelt een actueel, leeg Supabase-
  doelproject (of een exact overeenkomende lokale stack); de gebruikte losse
  Postgres-image voldeed niet aan die voorwaarde.
- Applicatierestore: 118 `public`-tabellen zonder fout geladen; geen data naar
  Preview of een externe omgeving gekopieerd.
- Migraties 1–3: groen.
- Ongewijzigde Production-seed: verwacht rood met `count 270`; mismatch, roots,
  missing links, duplicates en forkafwijkingen bleven verder nul.
- Lokale snapshotvariant: uitsluitend de eventvoorwaarde 272→270 aangepast om
  de resterende migratie- en regressiepaden te testen; niet opgeslagen in git
  en nooit geschikt voor Productie.
- Eindcontroles op die snapshot: `ALLE PLATFORM-CHECKS OK`; P1-catalogusgate en
  JSON-null-negatief groen; eventtelling bleef 270, één declaratie en één
  ketenkoprij.

Conclusie: het applicatieherstel en de migratielogica zijn aangetoond, maar de
Productiepoort blijft **NO-GO**. Eerst zijn een nieuwe back-up na de laatste
Productie-inventaris en een reproduceerbare restore naar een actueel, leeg
Supabase-doelproject of exact overeenkomende lokale stack nodig.

## 3. Exacte migratievolgorde

Voer ieder bestand afzonderlijk uit en stop bij de eerste fout:

1. `supabase/migrations/2026_08_15_platform_event_chain_head.sql`
2. `supabase/migrations/2026_08_15_platform_event_fork_declarations.sql`
3. `supabase/migrations/2026_08_15_t14b_production_drift_repair.sql`
4. `supabase/migrations/2026_08_15_platform_event_fork_declarations_seed_production.sql`

Waarom deze volgorde:

- eerst wordt de toekomstige ketenkop race-vrij en database-afgedwongen;
- daarna bestaat de centrale validator en het append-only register;
- vervolgens wordt de onafhankelijke T14b-drift hersteld;
- pas als laatste committeert de Productie-seed de exact waargenomen
  historische fork. De seed herhaalt vóór insert alle telling-, hash-, link- en
  forkchecks en faalt gesloten bij iedere afwijking.

## 4. Nacontrole

Voer direct na stap 4 uit:

1. `scripts/platform_checks.sql`
2. `supabase/checks/2026_08_15_p1_audit_t14b.sql`
3. de gesaneerde read-only inventarisatie uit §1 opnieuw;
4. cataloguscontrole op grants/RLS:
   - geen direct tabelrecht voor `service_role` op ketenkop of forkregister;
   - geen `EXECUTE` voor applicatierollen op de twee interne validatorfuncties;
   - `anon` kan de stuurinfo-RPC niet uitvoeren, `authenticated` wel;
5. één gecontroleerd nieuw platformevent via het bestaande applicatiepad,
   gevolgd door opnieuw `scripts/platform_checks.sql`.

Verwacht na het gecontroleerde event: eventtelling +1, dezelfde ene verklaarde
historische fork, geen nieuwe fork, de state-head is een blad en alle hashes
blijven herberekenbaar.

## 5. Stop- en rollbackregels

- Iedere migratie is transactioneel. Een fout binnen een bestand betekent:
  transactie terug, niets uit dat bestand behouden, direct stoppen.
- Vóór de Productie-seed bestaat nog geen nieuw append-only incidentbewijs. De
  generieke registryrollback kan dan alleen worden gebruikt als de registry
  leeg is.
- Ná een geslaagde Productie-seed wordt de declaratie niet verwijderd of
  gewijzigd. De seedrollback faalt daarom bewust gesloten; correctie is een
  nieuw append-only protocol/forward fix.
- De ketenkoprollback weigert zodra na initialisatie een nieuw event bestaat.
  Gebruik geen handmatige omzeiling, UPDATE, DELETE, herhash of reseed.
- Bij een rode nacontrole: blokkeer platformbeheerhandelingen die nieuwe events
  schrijven, bewaar het bewijs, en kies herstel naar de vooraf geteste back-up
  of een expliciete forward fix. Geen improvisatie in Productie.
- T14b kan alleen met de meegeleverde gerichte rollback worden teruggedraaid als
  dit noodzakelijk is en de overige ketencontroles groen blijven.

## 6. Go/no-go-record

```text
Productieback-up/ref:
Restoretest datum/tijd:
Platformchecks restore:
P1-check restore:
Read-only Productiedelta:
Merlin GO/NO-GO + datum/tijd:
Robert GO/NO-GO + datum/tijd: n.v.t. tot Huisartsen-live
Uitvoerder:
Nacontrole:
```

Dit document verleent zelf geen toestemming om Productie te wijzigen.
