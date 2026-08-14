# Preview-database opbouwen

De Preview-database is een schoon, zelfstandig Supabase-project. Zij wordt niet
uit een Productiedump opgebouwd.

1. Maak een leeg project in de gekozen Preview-regio.
2. Pas de historische baseline en alle voorwaartse migraties toe.
3. Draai `supabase/preview/seed.sql`.
4. Draai achtereenvolgens de structurele, tenantgrens- en capabilitychecks uit
   `supabase/checks`.
5. Bewijs dat `auth.users`, `storage.objects`, `documenten` en
   `document_chunks` leeg zijn voordat testaccounts of synthetische documenten
   worden toegevoegd.

De seed is omgevingsspecifiek en hoort daarom niet in de algemene migratiereeks.
Zij verwijdert alle door de reguliere migraties aangemaakte Productiehosts uit
`tenant_domains` en registreert exact vier Previewhosts. Meridiaan is de
fictieve generieke sandbox achter `app.preview.bestuurdersportaal.com`.

## Bekende historische replay-afhankelijkheden

De bestaande bestandsnamen vormen nog geen volledig betrouwbare lineaire
replayvolgorde. Een schone herbouw vereist momenteel deze afhankelijkheden:

- dossier- en agendapuntkolommen vóór de documentstatusmetadata;
- T11-tabel vóór de T11-seed;
- `procedure_afschriften` vóór `afschrift_ai_tekst`;
- procedure-toelichtingkolommen vóór requirements-seed v2;
- de actuele negenargument-signatuur van `profiel_opslaan` bij de T14b-grant.

Los dit op met een gecontroleerde baseline/squash voordat deze replay als
zelfbedieningsherstelprocedure wordt gebruikt. Wijzig reeds toegepaste
historische migraties niet stilzwijgend.
